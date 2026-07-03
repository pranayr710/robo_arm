/* app.js — wires model, renderer, writer, vision, bridge, AI layer and UI. */

import { HOME, MAP, mapRange, clamp } from "./config.js";
import { ArmModel } from "./arm.js";
import { Writer } from "./writer.js";
import { Renderer } from "./renderer.js";
import { Vision } from "./vision.js";
import { Bridge } from "./bridge.js";
import { Accumulator } from "./morse.js";
import { Routines } from "./routines.js";
import { Voice } from "./voice.js";
import { handle as nlpHandle } from "./nlp.js";
import { checkCompat } from "./compat.js";

const $ = (id) => document.getElementById(id);
const log = (m) => { $("log").textContent = m; };
const say = (m) => { $("asay").textContent = m; };

/* ---- core objects -------------------------------------------------------- */
const arm = new ArmModel();
const writer = new Writer(arm);
const renderer = new Renderer($("stage"), arm, writer);
const bridge = new Bridge((text, cls) => setBadge("conn", text, cls));
const vision = new Vision($("cam"), $("overlay"), log);
const routines = new Routines(arm);
const acc = new Accumulator();

arm.onChange = (angles) => bridge.sendAngles(angles);
renderer.start();
window.__dbg = { arm, writer };            // handy for console debugging

/* ---- badges / status ------------------------------------------------------ */
function setBadge(id, text, cls) { const b = $(id); b.textContent = text; b.className = "badge " + (cls || "off"); }
setBadge("conn", "offline", "off");

function setSpeed(step) { arm.stepDeg = step; bridge.raw({ cmd: "RAW", line: "V " + Math.round(step * 2) }); }
const doEstop = () => { arm.estop = true; bridge.raw({ cmd: "E" }); };
const doRelease = () => { arm.estop = false; bridge.raw({ cmd: "R" }); };
const clearPaper = () => { writer.clear(); };

/* command context shared by the console, voice and gestures */
const ctx = { arm, writer, routines, setSpeed, estop: doEstop, release: doRelease, clearPaper };
function runCommand(text) {
  const res = nlpHandle(text, ctx);
  say((res.ok ? "✓ " : "✕ ") + res.message);
  syncSliders();
  return res;
}

/* ---- hardware compatibility panel ----------------------------------------- */
(function renderCompat() {
  const r = checkCompat(arm);
  const box = $("compat");
  box.innerHTML = `<div class="crow head"><span>Hardware compatibility check</span>
    <b class="${r.ok ? "cok" : "cbad"}">${r.ok ? "PASS" : "FAIL"}</b></div>` +
    r.items.map((i) =>
      `<div class="crow"><span>${i.label}</span><b class="c${i.status}">${i.value}</b></div>`).join("");
})();

/* ---- sliders (manual) ------------------------------------------------------ */
const SERVOS = [["Base", "base"], ["Gripper", "grip"], ["Shoulder", "shoulder"], ["Elbow", "elbow"]];
const sliders = {};
(function build() {
  const box = $("sliders");
  for (const [label, key] of SERVOS) {
    const row = document.createElement("div"); row.className = "srow";
    row.innerHTML = `<span>${label}</span><b id="sv-${key}">${HOME[key]}°</b>`;
    const inp = document.createElement("input");
    inp.type = "range"; inp.min = 0; inp.max = 180; inp.value = HOME[key]; inp.id = "sl-" + key;
    inp.oninput = () => { arm.setTarget({ [key]: +inp.value }); $("sv-" + key).textContent = inp.value + "°"; };
    box.append(row, inp); sliders[key] = inp;
  }
})();
function syncSliders() {
  for (const [, key] of SERVOS) if (sliders[key]) {
    const v = Math.round(arm.tgt[key]);
    sliders[key].value = v; $("sv-" + key).textContent = v + "°";
  }
}
function enableSliders(on) { for (const k in sliders) sliders[k].disabled = !on; }

/* ---- trackpad joystick ------------------------------------------------------ */
(function trackpad() {
  const pad = $("pad"), dot = $("paddot"); let dragging = false;
  const at = (e) => {
    const r = pad.getBoundingClientRect();
    const px = clamp((e.touches ? e.touches[0].clientX : e.clientX) - r.left, 0, r.width);
    const py = clamp((e.touches ? e.touches[0].clientY : e.clientY) - r.top, 0, r.height);
    dot.style.left = px + "px"; dot.style.top = py + "px";
    arm.setTarget({
      base: mapRange(px, 0, r.width, MAP.base[0], MAP.base[1]),
      shoulder: mapRange(py, 0, r.height, MAP.shoulder[0], MAP.shoulder[1]),
    });
  };
  const down = (e) => { dragging = true; at(e); e.preventDefault(); };
  pad.addEventListener("mousedown", down);
  pad.addEventListener("mousemove", (e) => dragging && at(e));
  window.addEventListener("mouseup", () => (dragging = false));
  pad.addEventListener("touchstart", down, { passive: false });
  pad.addEventListener("touchmove", (e) => { at(e); e.preventDefault(); }, { passive: false });
  window.addEventListener("touchend", () => (dragging = false));
})();

/* ---- morse transcript -------------------------------------------------------- */
function renderMorse() { $("pending").textContent = acc.pending || "·"; $("transcript").textContent = acc.text || "—"; }

/* ---- gesture -> action -------------------------------------------------------- */
const GESTURE_ACTION = {
  Closed_Fist: () => { arm.setTarget({ grip: 160 }); return "✊ grip close"; },
  Open_Palm:   () => { arm.setHome(); return "✋ home"; },
  Thumb_Up:    () => { writer.writeText($("wtext").value || "OK"); return "👍 writing"; },
  Victory:     () => { routines.run("wave"); return "✌️ wave"; },
  Pointing_Up: () => { routines.run("scan"); return "☝️ scan"; },
  ILoveYou:    () => { routines.run("nod"); return "🤟 nod"; },
};

/* ---- modes ---------------------------------------------------------------- */
let mode = "manual";
async function setMode(m) {
  vision.stop();
  mode = m;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.mode === m));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("show", p.dataset.for === m));
  document.body.classList.toggle("camera-on", m === "hand" || m === "morse" || m === "gesture");
  enableSliders(m === "manual");
  $("gest").style.display = (m === "gesture") ? "block" : "none";
  $("blink").style.display = (m === "morse") ? "block" : "none";

  if (m === "manual" || m === "trackpad") { arm.setHome(); syncSliders(); log("ready."); }

  if (m === "hand") await vision.startHand((pose) => arm.setTarget(pose));

  if (m === "gesture") {
    await vision.startGesture((name, score) => {
      $("gest").textContent = name.replace(/_/g, " ") + "  " + Math.round(score * 100) + "%";
      const act = GESTURE_ACTION[name];
      if (act) say("✓ " + act());
    });
  }

  if (m === "morse") {
    acc.reset(); renderMorse();
    await vision.startFace({
      onSymbol: (s) => { acc.add(s); renderMorse(); },
      onLetterGap: () => {                       // <- each decoded letter is WRITTEN
        const ch = acc.endLetter(); renderMorse();
        if (ch && ch !== "?") { writer.enqueueChar(ch); log(`writing "${ch}" on the paper…`); }
      },
      onWordGap: () => { if (acc.endWord()) { writer.enqueueChar(" "); renderMorse(); } },
      onBlink: (v, closed) => { $("blink").textContent = "blink " + v.toFixed(2) + (closed ? " ●" : ""); },
    });
  }
}

/* ---- voice ------------------------------------------------------------------ */
const voice = new Voice((phrase) => { say("🎤 " + phrase); runCommand(phrase); }, say);
function toggleMic() {
  const on = voice.toggle();
  $("micbtn").textContent = on ? "🎤 Listening…" : "🎤 Voice";
  $("micbtn").classList.toggle("danger", on);
}

/* ---- buttons ------------------------------------------------------------------ */
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => setMode(t.dataset.mode)));
$("home").onclick = () => { arm.setHome(); syncSliders(); };
$("estop").onclick = doEstop;
$("release").onclick = doRelease;
$("wbtn").onclick = () => { writer.writeText($("wtext").value || "SOS"); log("writing…"); };
$("clearpaper").onclick = () => { clearPaper(); log("fresh page."); };
$("clearmorse").onclick = () => { acc.reset(); renderMorse(); };
$("cmdsend").onclick = () => { const v = $("cmdtext").value; runCommand(v); $("cmdtext").value = ""; };
$("cmdtext").addEventListener("keydown", (e) => { if (e.key === "Enter") $("cmdsend").click(); });
$("micbtn").onclick = toggleMic;

/* routine buttons */
(function buildRoutines() {
  const box = $("routineBtns");
  for (const name of routines.list()) {
    const b = document.createElement("button"); b.className = "act";
    b.textContent = name; b.onclick = () => { routines.run(name); say("running " + name); };
    box.appendChild(b);
  }
})();

/* ---- boot ---------------------------------------------------------------------- */
renderMorse();
setMode("manual");
