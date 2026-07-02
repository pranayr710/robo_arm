/* ============================================================================
 * app.js — browser control app for the robotic arm.
 * Runs fully in the browser: webcam hand-follow, trackpad joystick, and
 * eye-blink Morse that the on-screen arm writes on paper. If the Python server
 * has a real STM32 attached, the same angles are streamed to it over /ws.
 * ==========================================================================*/

const MP_VER = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// ------------------------------------------------------------------ helpers
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const map = (v, a, b, c, d) => clamp(c + (v - a) * (d - c) / (b - a), Math.min(c, d), Math.max(c, d));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => { const el = $("log"); el.textContent = m; console.log("[arm]", m); };

// ------------------------------------------------------------------ arm model
const HOME = { base: 90, grip: 60, shoulder: 90, elbow: 90 };
const arm = {
  cur: { ...HOME }, tgt: { ...HOME },
  estop: false, penDown: false,
};
// geometry (canvas coords) — tuned so the writing spot is comfortably reachable
const PIV = { x: 150, y: 165 }, L1 = 105, L2 = 95;
const SHEET = { x0: 70, x1: 470, y: 300 };     // paper strip + writing baseline
const PENX = 250, PEN_UP = 268;                // pen writes here; paper scrolls
// plotter state: marks live in "paper coordinates" that scroll past the pen
const paper = { cursor: 0, curcur: 0, marks: [] };

function setTarget(o) { Object.assign(arm.tgt, o); pushToServer(); }

// forward kinematics -> joint + tip positions from servo angles
function fk(a) {
  const A1 = a.shoulder * Math.PI / 180;
  const ex = PIV.x + L1 * Math.cos(A1), ey = PIV.y - L1 * Math.sin(A1);
  const A2 = A1 + (a.elbow - 90) * Math.PI / 180;
  const tx = ex + L2 * Math.cos(A2), ty = ey - L2 * Math.sin(A2);
  return { ex, ey, tx, ty, A2 };
}

// inverse kinematics: reach canvas point (tx,ty) -> {shoulder,elbow} degrees
function ik(tx, ty) {
  const x = tx - PIV.x, y = -(ty - PIV.y);          // to math y-up
  let D = (x * x + y * y - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  D = clamp(D, -1, 1);
  const q2 = -Math.acos(D);                          // elbow-down solution
  const q1 = Math.atan2(y, x) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2));
  return { shoulder: clamp(q1 * 180 / Math.PI, 0, 180),
           elbow: clamp(q2 * 180 / Math.PI + 90, 0, 180) };
}

// ------------------------------------------------------------------ rendering
const cv = $("stage"), ctx = cv.getContext("2d");
function render() {
  // ramp current -> target (smooth, mimics firmware)
  if (!arm.estop) for (const k of ["base", "grip", "shoulder", "elbow"]) {
    const d = arm.tgt[k] - arm.cur[k];
    arm.cur[k] += Math.abs(d) > 3 ? Math.sign(d) * 3 : d;
  }
  paper.curcur += clamp(paper.cursor - paper.curcur, -5, 5);   // scroll the paper
  ctx.clearRect(0, 0, cv.width, cv.height);

  // paper sheet
  const H = 74;
  ctx.fillStyle = "#f6f3ea"; ctx.strokeStyle = "#d9d2be"; ctx.lineWidth = 1;
  ctx.fillRect(SHEET.x0, SHEET.y - 46, SHEET.x1 - SHEET.x0, H);
  ctx.strokeRect(SHEET.x0, SHEET.y - 46, SHEET.x1 - SHEET.x0, H);
  ctx.strokeStyle = "#e7e0cd";
  ctx.beginPath(); ctx.moveTo(SHEET.x0, SHEET.y); ctx.lineTo(SHEET.x1, SHEET.y); ctx.stroke();
  // marks (scroll left as paper feeds; drawn only inside the sheet)
  const sx = p => PENX - (paper.curcur - p);
  const vis = x => x > SHEET.x0 + 6 && x < SHEET.x1 - 6;
  ctx.strokeStyle = "#141414"; ctx.fillStyle = "#141414"; ctx.lineWidth = 3.2; ctx.lineCap = "round";
  for (const m of paper.marks) {
    if (m.t === "dot") { const x = sx(m.p); if (vis(x)) { ctx.beginPath(); ctx.arc(x, SHEET.y, 2.8, 0, 7); ctx.fill(); } }
    else { let a = sx(m.p0), b = sx(m.p1); if (vis(a) || vis(b)) {
      a = clamp(a, SHEET.x0 + 6, SHEET.x1 - 6); b = clamp(b, SHEET.x0 + 6, SHEET.x1 - 6);
      ctx.beginPath(); ctx.moveTo(a, SHEET.y); ctx.lineTo(b, SHEET.y); ctx.stroke(); } }
  }

  // pedestal
  ctx.fillStyle = "#2a3340"; ctx.fillRect(PIV.x - 26, PIV.y, 52, 60);
  ctx.fillStyle = "#1c232c"; ctx.fillRect(PIV.x - 40, PIV.y + 54, 80, 10);

  const p = fk(arm.cur);
  const link = (x1, y1, x2, y2, w, c1, c2) => {
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.strokeStyle = g; ctx.lineWidth = w; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };
  link(PIV.x, PIV.y, p.ex, p.ey, 13, "#3f7fd6", "#5b9bf0");
  link(p.ex, p.ey, p.tx, p.ty, 11, "#5b9bf0", "#8fc0ff");
  const joint = (x, y, r) => { ctx.fillStyle = "#e9eef5"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = "#9fb4cc"; ctx.lineWidth = 2; ctx.stroke(); };
  joint(PIV.x, PIV.y, 8); joint(p.ex, p.ey, 6);

  // gripper claw / pen
  const open = map(arm.cur.grip, 30, 160, 22, 4);
  const perp = p.A2 + Math.PI / 2;
  for (const s of [1, -1]) {
    const bx = p.tx + Math.cos(perp) * open * s, by = p.ty - Math.sin(perp) * open * s;
    const tx = bx + Math.cos(p.A2) * 20, ty = by - Math.sin(p.A2) * 20;
    ctx.strokeStyle = "#aeb9c6"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(p.tx, p.ty); ctx.lineTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
  }
  // pen indicator when writing
  if (arm.penDown) { ctx.fillStyle = "#e5484d"; ctx.beginPath(); ctx.arc(p.tx, p.ty, 4, 0, 7); ctx.fill(); }

  if (arm.estop) { ctx.fillStyle = "rgba(229,72,77,.95)"; ctx.font = "bold 18px system-ui";
    ctx.fillText("● E-STOP", 18, 30); }
}

// Drive rendering: rAF when the tab is visible (smooth), plus a timer fallback
// so animation/paper still update if rAF is paused (hidden/background tab).
function rafLoop() { render(); requestAnimationFrame(rafLoop); }
requestAnimationFrame(rafLoop);
setInterval(() => { if (document.hidden) render(); }, 120);

// ------------------------------------------------------------------ server bridge (optional real arm)
let ws = null;
function connectWS() {
  try {
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => setBadge("conn", "server", "ok");
    ws.onclose = () => { setBadge("conn", "offline", "off"); ws = null; setTimeout(connectWS, 2000); };
    ws.onmessage = e => { const s = JSON.parse(e.data); if (!s.mock) setBadge("conn", "STM32 LIVE", "live"); };
  } catch (_) {}
}
function pushToServer() {
  if (ws && ws.readyState === 1)
    ws.send(JSON.stringify({ cmd: "A", angles: [arm.tgt.base | 0, arm.tgt.grip | 0, arm.tgt.shoulder | 0, arm.tgt.elbow | 0] }));
}
function sendRaw(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

// ------------------------------------------------------------------ modes
let mode = "manual";
let stopCam = null;            // function to stop current camera loop

async function setMode(m) {
  if (stopCam) { stopCam(); stopCam = null; }
  mode = m;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.mode === m));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("show", p.dataset.for === m));
  $("camwrap").classList.toggle("show", m === "hand" || m === "morse");
  if (m === "hand") stopCam = await startHand();
  if (m === "morse") stopCam = await startMorse();
  if (m === "manual" || m === "trackpad") setTarget({ ...HOME });
}

// ---- manual sliders ----
const SERVOS = [["Base", "base"], ["Gripper", "grip"], ["Shoulder", "shoulder"], ["Elbow", "elbow"]];
(function buildSliders() {
  const box = $("sliders");
  SERVOS.forEach(([label, key]) => {
    const row = document.createElement("div"); row.className = "srow";
    row.innerHTML = `<span>${label}</span><b id="sv-${key}">${HOME[key]}°</b>`;
    const inp = document.createElement("input");
    inp.type = "range"; inp.min = 0; inp.max = 180; inp.value = HOME[key]; inp.id = "sl-" + key;
    inp.oninput = () => { setTarget({ [key]: +inp.value }); $("sv-" + key).textContent = inp.value + "°"; };
    box.append(row, inp);
  });
})();

// ---- trackpad joystick ----
(function trackpad() {
  const pad = $("pad"), dot = $("paddot"); let drag = false;
  const move = e => {
    const r = pad.getBoundingClientRect();
    const px = clamp((e.touches ? e.touches[0].clientX : e.clientX) - r.left, 0, r.width);
    const py = clamp((e.touches ? e.touches[0].clientY : e.clientY) - r.top, 0, r.height);
    dot.style.left = px + "px"; dot.style.top = py + "px";
    setTarget({ base: map(px, 0, r.width, 0, 180), shoulder: map(py, 0, r.height, 40, 150) });
  };
  const down = e => { drag = true; move(e); };
  const up = () => drag = false;
  pad.addEventListener("mousedown", down); pad.addEventListener("mousemove", e => drag && move(e));
  window.addEventListener("mouseup", up);
  pad.addEventListener("touchstart", down); pad.addEventListener("touchmove", e => { move(e); e.preventDefault(); });
  window.addEventListener("touchend", up);
})();

// ------------------------------------------------------------------ MediaPipe
let vision = null;
async function loadVision() {
  if (vision) return;
  log("loading MediaPipe (first time downloads models)…");
  const mp = await import(/* @vite-ignore */ MP_BASE);
  window.__mp = mp;
  vision = await mp.FilesetResolver.forVisionTasks(MP_BASE + "/wasm");
}
async function openCamera() {
  const video = $("cam");
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = stream; await video.play();
  return () => stream.getTracks().forEach(t => t.stop());
}
function overlaySetup() {
  const ov = $("overlay"); ov.width = 640; ov.height = 480; return ov.getContext("2d");
}

// ---- hand-follow ----
async function startHand() {
  try {
    await loadVision(); const mp = window.__mp;
    const closeCam = await openCamera();
    const lm = await mp.HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
      runningMode: "VIDEO", numHands: 1
    });
    const video = $("cam"), octx = overlaySetup(); let run = true, last = -1;
    log("hand-follow running — move your hand");
    (function loop() {
      if (!run) return;
      const t = performance.now();
      if (video.currentTime !== last) {
        last = video.currentTime;
        const res = lm.detectForVideo(video, t);
        octx.clearRect(0, 0, 640, 480);
        if (res.landmarks && res.landmarks[0]) {
          const h = res.landmarks[0];
          drawHand(octx, h);
          const wrist = h[0], thumb = h[4], index = h[8], midK = h[9];
          const base = map(wrist.x, 0.15, 0.85, 180, 0);   // mirror
          const shoulder = map(wrist.y, 0.15, 0.85, 40, 150);
          const reach = Math.hypot(wrist.x - midK.x, wrist.y - midK.y);
          const elbow = map(reach, 0.06, 0.20, 60, 140);
          const pinch = Math.hypot(thumb.x - index.x, thumb.y - index.y);
          const grip = map(pinch, 0.03, 0.18, 160, 30);
          setTarget({ base, shoulder, elbow, grip });
        }
      }
      requestAnimationFrame(loop);
    })();
    return () => { run = false; closeCam(); };
  } catch (e) { log("hand-follow error: " + e.message); return null; }
}
function drawHand(c, h) {
  c.fillStyle = "#5b9bf0";
  for (const p of h) { c.beginPath(); c.arc(p.x * 640, p.y * 480, 4, 0, 7); c.fill(); }
}

// ---- blink Morse ----
async function startMorse() {
  try {
    await loadVision(); const mp = window.__mp;
    const closeCam = await openCamera();
    const lm = await mp.FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
      runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true
    });
    const video = $("cam"), octx = overlaySetup(); let run = true, last = -1;

    // blink state machine
    let closed = false, closeT = 0, lastAct = performance.now(), letterDone = false;
    log("blink Morse — short blink = dot, long blink = dash, pause to write");
    resetMorse();

    (function loop() {
      if (!run) return;
      const t = performance.now();
      if (video.currentTime !== last) {
        last = video.currentTime;
        const res = lm.detectForVideo(video, t);
        octx.clearRect(0, 0, 640, 480);
        let ear = "—";
        if (res.faceBlendshapes && res.faceBlendshapes[0]) {
          const cats = res.faceBlendshapes[0].categories;
          const get = n => (cats.find(c => c.categoryName === n) || {}).score || 0;
          const blink = (get("eyeBlinkLeft") + get("eyeBlinkRight")) / 2;
          ear = blink.toFixed(2);
          const isClosed = blink > 0.5;
          if (isClosed && !closed) { closed = true; closeT = t; }
          else if (!isClosed && closed) {
            closed = false; const dur = t - closeT;
            if (dur >= 60) { const sym = dur < 320 ? "." : "-"; addSym(sym); lastAct = t; letterDone = false; }
          }
          if (!closed) {
            const gap = t - lastAct;
            if (gap > 1200 && !letterDone && morse.pending) { endLetter(); letterDone = true; }
            if (gap > 2600 && morse.text && !morse.writing) { commitWord(); lastAct = t; }
          }
          $("blink").textContent = "blink " + ear + (isClosed ? " (closed)" : "");
        }
      }
      requestAnimationFrame(loop);
    })();
    return () => { run = false; closeCam(); };
  } catch (e) { log("blink Morse error: " + e.message); return null; }
}

// ------------------------------------------------------------------ Morse logic
const MORSE = { A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....",
  I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-",
  R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----." };
const REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
const encode = s => s.toUpperCase().split(" ").filter(Boolean)
  .map(w => [...w].filter(c => MORSE[c]).map(c => MORSE[c]).join(" ")).join("   ");

const morse = { text: "", pending: "", writing: false };
function resetMorse() { morse.text = ""; morse.pending = ""; renderMorse(); }
function addSym(s) { morse.pending += s; renderMorse(); }
function endLetter() { if (morse.pending) { morse.text += REV[morse.pending] || "?"; morse.pending = ""; renderMorse(); } }
function commitWord() { endLetter(); const msg = morse.text.trim(); if (msg) writeMessage(msg); }
function renderMorse() {
  $("pending").textContent = morse.pending || "·";
  $("transcript").textContent = morse.text || "—";
}

// ------------------------------------------------------------------ pen writing (the arm draws the marks)
async function penUp() { arm.penDown = false; setTarget(ik(PENX, PEN_UP)); await sleep(190); }
async function penDown() { arm.penDown = true; setTarget(ik(PENX, SHEET.y)); await sleep(170); }
async function feed(dx, wait = 150) { paper.cursor += dx; await sleep(wait); }

async function writeMorse(code) {
  paper.marks = []; paper.cursor = 0; paper.curcur = 0; arm.penDown = false;
  for (const token of code.split(" ")) {
    if (token === "") { await feed(26); continue; }        // word gap (triple space)
    for (const sym of token) {
      await penUp();
      await penDown();
      if (sym === ".") { paper.marks.push({ t: "dot", p: paper.cursor }); await sleep(90); await feed(14); }
      else { const p0 = paper.cursor; await feed(18, 220); paper.marks.push({ t: "dash", p0, p1: paper.cursor }); await feed(10); }
    }
    await feed(16);                                          // letter gap
  }
  await penUp(); arm.penDown = false; setTarget({ ...HOME });
}
async function writeMessage(text) {
  if (morse.writing) return; morse.writing = true;
  log(`writing "${text}" in Morse…`);
  await writeMorse(encode(text));
  log(`wrote "${text}". blink a new message or clear.`);
  morse.writing = false; resetMorse();
}

// ------------------------------------------------------------------ badges + buttons
function setBadge(id, text, cls) { const b = $(id); b.textContent = text; b.className = "badge " + cls; }

document.querySelectorAll(".tab").forEach(t => t.onclick = () => setMode(t.dataset.mode));
$("home").onclick = () => { setTarget({ ...HOME }); SERVOS.forEach(([, k]) => { const s = $("sl-" + k); if (s) { s.value = HOME[k]; $("sv-" + k).textContent = HOME[k] + "°"; } }); };
$("estop").onclick = () => { arm.estop = true; sendRaw({ cmd: "E" }); };
$("release").onclick = () => { arm.estop = false; sendRaw({ cmd: "R" }); };
$("wbtn").onclick = () => writeMessage($("wtext").value || "SOS");
$("clearmorse").onclick = () => { resetMorse(); };

// ------------------------------------------------------------------ boot
setBadge("conn", "offline", "off");
connectWS();
setMode("manual");
