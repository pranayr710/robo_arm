/* Renderer — draws the whole scene and owns the frame loop.
 *
 * Two synchronized views of the SAME servo state:
 *   • side view — the arm (pretty metallic links, pen, table, paper edge-on)
 *   • top view  — the paper strip where written letters appear as ink
 *
 * The ink trace is recorded from the arm's ACTUAL animated angles (forward
 * kinematics -> paper coords) whenever the pen tip is at paper height — so
 * what you see written is what the physical arm would really draw, including
 * the slight corner rounding caused by servo ramping. */

import { ARM, PAPER, VIEW, WRITE, clamp } from "./config.js";

const S = VIEW.side, T = VIEW.top;
const DEG = Math.PI / 180;

export class Renderer {
  constructor(canvas, arm, writer) {
    this.cv = canvas; this.ctx = canvas.getContext("2d");
    this.arm = arm; this.writer = writer;
    this._wasDown = false;
  }

  start() {
    const loop = () => { this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    setInterval(() => { if (document.hidden) this.frame(); }, 100);
  }

  frame() {
    this.arm.tick();
    this.writer.update(performance.now());
    this._recordTrace();
    this.render();
  }

  /* -------- ink recording (from real angles, not from commands) ---------- */
  _recordTrace() {
    const p = this.arm.armToPaper();
    const inside = Math.abs(p.x) <= PAPER.w / 2 && p.y >= -2 && p.y <= PAPER.d + 2;
    const touching = p.zTip <= WRITE.contactMm && inside;
    if (touching) {
      const tr = this.writer.trace;
      if (!this._wasDown || !tr.length) tr.push([]);
      const line = tr[tr.length - 1];
      const last = line[line.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) line.push({ x: p.x, y: p.y });
      if (tr.length > 400) tr.shift();
    }
    this._wasDown = touching;
  }

  /* ------------------------------ drawing -------------------------------- */
  render() {
    const { ctx, cv } = this;
    ctx.clearRect(0, 0, cv.width, cv.height);
    this._backdrop();
    this._sideView();
    this._topView();
    if (this.arm.estop) {
      ctx.fillStyle = "#e5484d"; ctx.font = "bold 18px system-ui"; ctx.textAlign = "left";
      ctx.fillText("● E-STOP — arm frozen", 16, 30);
    }
  }

  _backdrop() {
    const { ctx, cv } = this;
    ctx.fillStyle = "rgba(120,160,220,.045)";
    for (let x = 20; x < cv.width; x += 34)
      for (let y = 20; y < S.tableY; y += 34) ctx.fillRect(x, y, 2, 2);
  }

  _label(text, x, y) {
    const { ctx } = this;
    ctx.font = "600 10px system-ui"; ctx.textAlign = "left";
    ctx.fillStyle = "#5f6f80"; ctx.fillText(text.toUpperCase(), x, y);
  }

  /* ---- side view --------------------------------------------------------- */
  _sx(r) { return S.pivotX + r * S.scale; }
  _sz(z) { return S.tableY - z * S.scale; }

  _sideView() {
    const { ctx, arm } = this;
    this._label("robot — side view", 16, 50);

    // table
    const g = ctx.createLinearGradient(0, S.tableY, 0, S.tableY + 42);
    g.addColorStop(0, "#1d2835"); g.addColorStop(1, "#101821");
    ctx.fillStyle = g; ctx.fillRect(0, S.tableY, this.cv.width, 42);
    ctx.strokeStyle = "#2c3a4b"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, S.tableY); ctx.lineTo(this.cv.width, S.tableY); ctx.stroke();

    // paper strip, edge-on
    const px0 = this._sx(PAPER.dist), px1 = this._sx(PAPER.dist + PAPER.d);
    ctx.fillStyle = "#f4f0e4"; ctx.fillRect(px0, S.tableY - 3, px1 - px0, 3);

    const f = arm.fk();
    const X = { p: S.pivotX, e: this._sx(f.er), t: this._sx(f.tr) };
    const Z = { p: this._sz(ARM.shoulderH), e: this._sz(f.ez), t: this._sz(f.tz) };

    // soft shadow under the arm
    ctx.fillStyle = "rgba(0,0,0,.32)";
    ctx.beginPath(); ctx.ellipse((X.p + X.t) / 2, S.tableY + 7, Math.abs(X.t - X.p) / 2 + 26, 6, 0, 0, 7); ctx.fill();

    // base turntable + column
    ctx.fillStyle = "#151d27";
    ctx.beginPath(); ctx.ellipse(S.pivotX, S.tableY, 46, 11, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = "#33445a"; ctx.lineWidth = 2; ctx.stroke();
    const ba = (arm.cur.base - 90) * DEG;                      // yaw indicator
    ctx.strokeStyle = "#5b9bf0"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(S.pivotX, S.tableY);
    ctx.lineTo(S.pivotX + Math.sin(ba) * 40, S.tableY - Math.cos(ba) * 9); ctx.stroke();
    const cg = ctx.createLinearGradient(S.pivotX - 15, 0, S.pivotX + 15, 0);
    cg.addColorStop(0, "#243040"); cg.addColorStop(.5, "#3d4d63"); cg.addColorStop(1, "#243040");
    ctx.fillStyle = cg;
    ctx.fillRect(S.pivotX - 15, Z.p, 30, S.tableY - Z.p);

    // links: dark outline + gradient body + sheen line
    this._link(X.p, Z.p, X.e, Z.e, 15, "#2f6fc4", "#6fb0ff");
    this._link(X.e, Z.e, X.t, Z.t, 12, "#4d8fe0", "#a6cdff");

    // joints
    this._joint(X.p, Z.p, 10); this._joint(X.e, Z.e, 7.5);

    // servo body at the shoulder
    ctx.fillStyle = "#1b2634"; ctx.strokeStyle = "#3a4d66"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(X.p - 13, Z.p - 22, 26, 16, 4); ctx.fill(); ctx.stroke();

    // gripper claws + pen
    const open = clamp((arm.cur.grip - 30) / 130, 0, 1) * 10 + 4;
    ctx.strokeStyle = "#93a3b5"; ctx.lineWidth = 4.5; ctx.lineCap = "round";
    for (const s of [1, -1]) {
      ctx.beginPath(); ctx.moveTo(X.t, Z.t);
      ctx.lineTo(X.t + s * open * 0.5, Z.t + 6); ctx.lineTo(X.t + s * open * 0.5, Z.t + 15);
      ctx.stroke();
    }
    // pen: body + tip, held vertically
    const tipY = this._sz(f.tz - ARM.penLen);
    const penG = ctx.createLinearGradient(X.t - 3, 0, X.t + 3, 0);
    penG.addColorStop(0, "#c96a1e"); penG.addColorStop(.5, "#f5a04a"); penG.addColorStop(1, "#c96a1e");
    ctx.fillStyle = penG;
    ctx.fillRect(X.t - 3, Z.t + 2, 6, tipY - Z.t - 8);
    ctx.fillStyle = "#20242a";
    ctx.beginPath(); ctx.moveTo(X.t - 3, tipY - 7); ctx.lineTo(X.t + 3, tipY - 7); ctx.lineTo(X.t, tipY); ctx.closePath(); ctx.fill();
    if (this._wasDown) {                                        // contact glow
      ctx.fillStyle = "rgba(229,72,77,.85)";
      ctx.beginPath(); ctx.arc(X.t, tipY, 3.5, 0, 7); ctx.fill();
    }
  }

  _link(x1, y1, x2, y2, w, c1, c2) {
    const { ctx } = this;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#101820"; ctx.lineWidth = w + 4;         // outline
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.strokeStyle = g; ctx.lineWidth = w;                     // body
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = w * 0.22; // sheen
    ctx.beginPath(); ctx.moveTo(x1, y1 - w * 0.22); ctx.lineTo(x2, y2 - w * 0.22); ctx.stroke();
  }

  _joint(x, y, r) {
    const { ctx } = this;
    const g = ctx.createRadialGradient(x - r / 3, y - r / 3, 1, x, y, r);
    g.addColorStop(0, "#f4f8fd"); g.addColorStop(1, "#aebdcf");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = "#5a6c81"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#33404f"; ctx.beginPath(); ctx.arc(x, y, r * 0.32, 0, 7); ctx.fill();
  }

  /* ---- top view (paper) --------------------------------------------------- */
  _tx(xmm) { return T.x + (xmm + PAPER.w / 2) * T.scale; }
  _ty(ymm) { return T.y + (PAPER.d - ymm) * T.scale; }

  _topView() {
    const { ctx, writer, arm } = this;
    const w = PAPER.w * T.scale, h = PAPER.d * T.scale;
    this._label(`paper — top view (${PAPER.w} × ${PAPER.d} mm)`, T.x, T.y - 8);

    // sheet with shadow
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#f7f4ea";
    ctx.beginPath(); ctx.roundRect(T.x, T.y, w, h, 4); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#dcd3bd"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(T.x, T.y, w, h, 4); ctx.stroke();
    // writing baseline (faint rule)
    ctx.strokeStyle = "#e9e1cc";
    ctx.beginPath(); ctx.moveTo(T.x + 6, this._ty(PAPER.margin)); ctx.lineTo(T.x + w - 6, this._ty(PAPER.margin)); ctx.stroke();

    // ink
    ctx.save();
    ctx.beginPath(); ctx.roundRect(T.x + 2, T.y + 2, w - 4, h - 4, 3); ctx.clip();
    ctx.strokeStyle = "#1c2733"; ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const line of writer.trace) {
      if (line.length < 2) {
        if (line.length === 1) { ctx.beginPath(); ctx.arc(this._tx(line[0].x), this._ty(line[0].y), 1.4, 0, 7); ctx.fillStyle = "#1c2733"; ctx.fill(); }
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(this._tx(line[0].x), this._ty(line[0].y));
      for (let i = 1; i < line.length; i++) ctx.lineTo(this._tx(line[i].x), this._ty(line[i].y));
      ctx.stroke();
    }
    ctx.restore();

    // live pen marker
    const p = arm.armToPaper();
    if (Math.abs(p.x) <= PAPER.w / 2 + 10 && p.y >= -12 && p.y <= PAPER.d + 12) {
      const mx = this._tx(clamp(p.x, -PAPER.w / 2, PAPER.w / 2));
      const my = this._ty(clamp(p.y, 0, PAPER.d));
      const down = p.zTip <= WRITE.contactMm;
      ctx.strokeStyle = down ? "rgba(229,72,77,.9)" : "rgba(91,155,240,.85)";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(mx - 8, my); ctx.lineTo(mx + 8, my); ctx.moveTo(mx, my - 8); ctx.lineTo(mx, my + 8); ctx.stroke();
      ctx.beginPath(); ctx.arc(mx, my, 3.2, 0, 7);
      ctx.fillStyle = down ? "#e5484d" : "#5b9bf0"; ctx.fill();
    }
  }
}
