/* Vision — webcam + in-browser MediaPipe. Two modes:
 *   startHand: hand landmarks -> {base,shoulder,elbow,grip} servo angles
 *   startFace: eye-blink -> Morse symbols (short=dot, long=dash) with gaps
 * All errors are reported through onStatus so the UI can show them. */

import { MP, MAP, MORSE, mapRange } from "./config.js";

let visionFileset = null;   // cached MediaPipe WASM fileset

async function ensureVision(onStatus) {
  if (visionFileset) return window.__mpMod;
  onStatus("loading MediaPipe (first run downloads models)…");
  const mod = await import(/* @vite-ignore */ MP.base);
  window.__mpMod = mod;
  visionFileset = await mod.FilesetResolver.forVisionTasks(MP.base + "/wasm");
  return mod;
}

export class Vision {
  constructor(video, overlay, onStatus) {
    this.video = video; this.overlay = overlay; this.octx = overlay.getContext("2d");
    this.onStatus = onStatus || (() => {});
    this.stream = null; this.landmarker = null; this.running = false; this.lastTs = -1;
  }

  async _openCamera() {
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.overlay.width = 640; this.overlay.height = 480;
  }

  stop() {
    this.running = false;
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.landmarker) { try { this.landmarker.close(); } catch (_) {} this.landmarker = null; }
    if (this.octx) this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  _loop(step) {
    const tick = () => {
      if (!this.running) return;
      if (this.video.currentTime !== this.lastTs && this.video.readyState >= 2) {
        this.lastTs = this.video.currentTime;
        try { step(performance.now()); } catch (e) { this.onStatus("detect error: " + e.message); }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // --- hand-follow ---------------------------------------------------------
  async startHand(onPose) {
    try {
      const mp = await ensureVision(this.onStatus);
      await this._openCamera();
      this.landmarker = await mp.HandLandmarker.createFromOptions(visionFileset, {
        baseOptions: { modelAssetPath: MP.hand, delegate: "GPU" },
        runningMode: "VIDEO", numHands: 1,
      });
      this.running = true;
      this.onStatus("hand-follow live — move your hand");
      this._loop((ts) => {
        const res = this.landmarker.detectForVideo(this.video, ts);
        this.octx.clearRect(0, 0, 640, 480);
        const h = res.landmarks && res.landmarks[0];
        if (!h) return;
        this._drawPoints(h);
        const [wrist, thumb, index, midK] = [h[0], h[4], h[8], h[9]];
        onPose({
          base:     mapRange(wrist.x, 0.15, 0.85, MAP.base[1], MAP.base[0]),      // mirror
          shoulder: mapRange(wrist.y, 0.15, 0.85, MAP.shoulder[0], MAP.shoulder[1]),
          elbow:    mapRange(Math.hypot(wrist.x - midK.x, wrist.y - midK.y), 0.06, 0.20, MAP.elbow[0], MAP.elbow[1]),
          grip:     mapRange(Math.hypot(thumb.x - index.x, thumb.y - index.y), 0.03, 0.18, MAP.grip[1], MAP.grip[0]),
        });
      });
    } catch (e) { this.onStatus("camera/hand error: " + e.message); this.stop(); }
  }

  // --- blink Morse ---------------------------------------------------------
  async startFace({ onSymbol, onLetterGap, onWordGap, onBlink }) {
    try {
      const mp = await ensureVision(this.onStatus);
      await this._openCamera();
      this.landmarker = await mp.FaceLandmarker.createFromOptions(visionFileset, {
        baseOptions: { modelAssetPath: MP.face, delegate: "GPU" },
        runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true,
      });
      this.running = true;
      this.onStatus("blink Morse live — short=dot, long=dash, pause to write");

      let closed = false, closeT = 0, lastAct = performance.now(), letterDone = false;
      this._loop((ts) => {
        const res = this.landmarker.detectForVideo(this.video, ts);
        this.octx.clearRect(0, 0, 640, 480);
        const bs = res.faceBlendshapes && res.faceBlendshapes[0];
        if (!bs) return;
        const score = (n) => (bs.categories.find((c) => c.categoryName === n) || {}).score || 0;
        const blink = (score("eyeBlinkLeft") + score("eyeBlinkRight")) / 2;
        if (onBlink) onBlink(blink, closed);

        if (blink > MORSE.closeThresh && !closed) { closed = true; closeT = ts; }
        else if (blink < MORSE.openThresh && closed) {
          closed = false; const dur = ts - closeT;
          if (dur >= MORSE.debounceMs) { onSymbol(dur < MORSE.dotMaxMs ? "." : "-"); lastAct = ts; letterDone = false; }
        }
        if (!closed) {
          const gap = ts - lastAct;
          if (gap > MORSE.letterGapMs && !letterDone) { onLetterGap(); letterDone = true; }
          if (gap > MORSE.wordGapMs) { onWordGap(); lastAct = ts; }
        }
      });
    } catch (e) { this.onStatus("camera/face error: " + e.message); this.stop(); }
  }

  // --- gesture recognition -------------------------------------------------
  async startGesture(onGesture) {
    try {
      const mp = await ensureVision(this.onStatus);
      await this._openCamera();
      this.landmarker = await mp.GestureRecognizer.createFromOptions(visionFileset, {
        baseOptions: { modelAssetPath: MP.gesture, delegate: "GPU" },
        runningMode: "VIDEO", numHands: 1,
      });
      this.running = true;
      this.onStatus("gesture control live — try ✊ ✋ 👍 ✌️");
      let lastName = "", lastAt = 0;
      this._loop((ts) => {
        const res = this.landmarker.recognizeForVideo(this.video, ts);
        this.octx.clearRect(0, 0, 640, 480);
        if (res.landmarks && res.landmarks[0]) this._drawPoints(res.landmarks[0]);
        const g = res.gestures && res.gestures[0] && res.gestures[0][0];
        if (!g) return;
        const name = g.categoryName;
        // fire once per stable gesture change (debounced), ignore "None"
        if (name && name !== "None" && (name !== lastName || ts - lastAt > 1500)) {
          lastName = name; lastAt = ts;
          onGesture(name, g.score);
        }
      });
    } catch (e) { this.onStatus("camera/gesture error: " + e.message); this.stop(); }
  }

  _drawPoints(h) {
    const c = this.octx;
    // bones
    c.strokeStyle = "rgba(91,155,240,.85)"; c.lineWidth = 3; c.lineCap = "round";
    for (const [a, b] of HAND_BONES) {
      c.beginPath();
      c.moveTo(h[a].x * 640, h[a].y * 480);
      c.lineTo(h[b].x * 640, h[b].y * 480);
      c.stroke();
    }
    // joints
    for (let i = 0; i < h.length; i++) {
      c.beginPath(); c.arc(h[i].x * 640, h[i].y * 480, i === 0 ? 6 : 4, 0, 7);
      c.fillStyle = i % 4 === 0 ? "#e3b341" : "#eaf2fb"; c.fill();
      c.strokeStyle = "#2b4a6f"; c.lineWidth = 1.5; c.stroke();
    }
  }
}

/* MediaPipe hand landmark connections (wrist -> fingers). */
const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],           // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],           // index
  [5, 9], [9, 10], [10, 11], [11, 12],      // middle
  [9, 13], [13, 14], [14, 15], [15, 16],    // ring
  [13, 17], [17, 18], [18, 19], [19, 20],   // pinky
  [0, 17],                                   // palm edge
];
