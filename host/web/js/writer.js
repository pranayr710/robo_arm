/* Writer — makes the arm write REAL BLOCK LETTERS on the paper strip.
 *
 * Each character comes from the vector font (font.js); every stroke is
 * interpolated in paper space and converted through inverse kinematics into
 * servo targets, so the pen tip physically traces the glyph. The exact same
 * angle stream goes to the STM32, so the hardware writes what the sim writes.
 *
 * The engine is a time-based waypoint queue consumed by the render loop
 * (update() each frame) — no setTimeout chains, so it stays reliable even in
 * throttled/background tabs and can be paused instantly by the e-stop. */

import { PAPER, LETTER, WRITE, ARM } from "./config.js";
import { strokesFor, GLYPH_RATIO } from "./font.js";

const Z_DOWN = ARM.penLen;                 // arm-end height putting the tip on paper
const Z_UP = ARM.penLen + WRITE.liftMm;

export class Writer {
  constructor(arm) {
    this.arm = arm;
    this.queue = [];          // waypoints: {t:{base,shoulder,elbow}, pen, holdMs} | {done} | {newPage}
    this.trace = [];          // drawn ink: array of polylines [{x,y}, ...] (paper mm)
    this.cursorX = 0;         // next glyph position from the strip's left margin
    this._item = null;
    this._since = 0;
  }

  get writing() { return this.queue.length > 0 || !!this._item; }

  /* ------------------------------ public --------------------------------- */

  writeText(text, { onDone } = {}) {
    for (const ch of String(text).toUpperCase()) this.enqueueChar(ch);
    if (onDone) this.queue.push({ done: onDone });
  }

  /** Queue one character (used letter-by-letter by blink-Morse). */
  enqueueChar(ch) {
    if (ch === " ") { this.cursorX += LETTER.spaceW; return; }
    const strokes = strokesFor(ch);
    if (!strokes) return;

    const w = LETTER.h * GLYPH_RATIO;
    const usable = PAPER.w - 2 * PAPER.margin;
    if (this.cursorX + w > usable) {           // strip full -> fresh page
      this.queue.push({ newPage: true });
      this.cursorX = 0;
    }
    const left = PAPER.margin + this.cursorX - PAPER.w / 2;   // to centred x
    const baseY = PAPER.margin;

    for (const stroke of strokes) {
      const pts = stroke.map(([sx, sy]) => ({ x: left + sx * w, y: baseY + sy * LETTER.h }));
      this._penMove(pts[0], false, WRITE.settleMs);           // travel (pen up)
      this._penMove(pts[0], true, WRITE.penMs);               // pen down
      for (let i = 1; i < pts.length; i++) this._segment(pts[i - 1], pts[i]);
      this._penMove(pts[pts.length - 1], false, WRITE.penMs); // pen up
    }
    this.cursorX += w + LETTER.gap;
  }

  clear() {
    this.queue.length = 0;
    this._item = null;
    this.trace.length = 0;
    this.cursorX = 0;
    this.arm.penDown = false;
  }

  /** Consume waypoints; called every rendered frame with performance.now(). */
  update(now) {
    if (this.arm.estop) return;                 // frozen — resumes on release
    if (this._item && now - this._since < this._item.holdMs) return;
    const next = this.queue.shift();
    this._item = null;
    if (!next) { return; }
    if (next.done) { next.done(); return this.update(now); }
    if (next.newPage) { this.trace.length = 0; return this.update(now); }
    this.arm.penDown = next.pen;
    this.arm.setTarget(next.t);
    this._item = next;
    this._since = now;
  }

  /* ------------------------------ internal -------------------------------- */

  _penMove(p, pen, holdMs) {
    const t = this.arm.paperToTargets(p.x, p.y, pen ? Z_DOWN : Z_UP);
    this.queue.push({ t: { base: t.base, shoulder: t.shoulder, elbow: t.elbow }, pen, holdMs });
  }

  _segment(a, b) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / WRITE.stepMm));
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      this._penMove({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, true, WRITE.stepMs);
    }
  }
}
