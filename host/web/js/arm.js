/* ArmModel — single source of truth for the arm.
 * Holds servo angles (0..180, the exact numbers the STM32 firmware consumes),
 * ramps smoothly toward targets, and provides kinematics in REAL MILLIMETRES:
 *
 *   fk()            planar forward kinematics (radial r, height z) in mm
 *   ik(r, z)        planar inverse kinematics -> {shoulder, elbow, ok}
 *   armToPaper()    current pen-tip position in paper coords {x, y, zTip}
 *   paperToTargets  paper coords -> {base, shoulder, elbow, ok}
 *
 * Because everything is mm-real, the same targets that animate the simulation
 * drive the physical arm — the bridge just streams the angles. */

import { HOME, ARM, RAMP, SERVO, PAPER, clamp } from "./config.js";

const DEG = Math.PI / 180;
const KEYS = ["base", "grip", "shoulder", "elbow"];

export class ArmModel {
  constructor() {
    this.cur = { ...HOME };        // rendered angles (ramped, float)
    this.tgt = { ...HOME };        // commanded angles
    this.estop = false;
    this.penDown = false;          // commanded pen state (writer sets this)
    this.stepDeg = RAMP.degPerFrame;
    this.onChange = null;          // (angles[4]) => void
  }

  setTarget(partial) {
    for (const k of KEYS)
      if (partial[k] != null) this.tgt[k] = clamp(partial[k], SERVO.min, SERVO.max);
    if (this.onChange) this.onChange(this.angles());
  }

  setHome() { this.setTarget({ ...HOME }); }

  /** Wire format: integer degrees [base, gripper, shoulder, elbow]. */
  angles() { return KEYS.map((k) => Math.round(this.tgt[k])); }

  /** Advance rendered angles toward targets (once per frame). */
  tick() {
    if (this.estop) return;
    for (const k of KEYS) {
      const d = this.tgt[k] - this.cur[k];
      this.cur[k] += Math.abs(d) > this.stepDeg ? Math.sign(d) * this.stepDeg : d;
    }
  }

  /* ---------------- planar kinematics (arm's own vertical plane) --------- */

  /** Forward kinematics from angles -> mm positions.
   *  r = horizontal distance from the base axis, z = height above the table. */
  fk(a = this.cur) {
    const A1 = a.shoulder * DEG;                 // 0 = forward, 90 = up
    const A2 = A1 + (a.elbow - 90) * DEG;        // elbow 90 = straight
    const er = ARM.L1 * Math.cos(A1);
    const ez = ARM.shoulderH + ARM.L1 * Math.sin(A1);
    const tr = er + ARM.L2 * Math.cos(A2);
    const tz = ez + ARM.L2 * Math.sin(A2);
    return { er, ez, tr, tz, A2 };
  }

  /** Planar IK: reach (r, z) mm with the fore-arm end.
   *  Tries elbow-down then elbow-up; ok=true only if a solution lies within
   *  servo limits AND reproduces the target within 1.5 mm. */
  ik(r, z) {
    const dz = z - ARM.shoulderH;
    const { L1, L2 } = ARM;
    let D = (r * r + dz * dz - L1 * L1 - L2 * L2) / (2 * L1 * L2);
    D = clamp(D, -1, 1);
    let fallback = null;
    for (const sign of [-1, 1]) {                 // elbow-down preferred
      const q2 = sign * Math.acos(D);
      const q1 = Math.atan2(dz, r) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2));
      const shoulder = q1 / DEG, elbow = q2 / DEG + 90;
      const sol = { shoulder, elbow };
      if (shoulder >= SERVO.min && shoulder <= SERVO.max &&
          elbow >= SERVO.min && elbow <= SERVO.max) {
        const f = this.fk({ shoulder, elbow });
        const err = Math.hypot(f.tr - r, f.tz - z);
        if (err < 1.5) return { ...sol, ok: true };
      }
      if (!fallback) fallback = sol;
    }
    return {
      shoulder: clamp(fallback.shoulder, SERVO.min, SERVO.max),
      elbow: clamp(fallback.elbow, SERVO.min, SERVO.max),
      ok: false,
    };
  }

  /* ---------------- paper-space mapping (writing) ------------------------ */

  /** Current PEN TIP in paper coords: x lateral (0 at strip centre, +right),
   *  y radial from the strip's near edge, zTip height above the paper. */
  armToPaper(a = this.cur) {
    const f = this.fk(a);
    const baseRad = (a.base - 90) * DEG;
    return {
      x: f.tr * Math.sin(baseRad),
      y: f.tr * Math.cos(baseRad) - PAPER.dist,
      zTip: f.tz - ARM.penLen,
    };
  }

  /** Paper point (x, y) at arm-end height zEnd -> servo targets. */
  paperToTargets(x, y, zEnd) {
    const fwd = y + PAPER.dist;                   // distance along strip normal
    const r = Math.hypot(x, fwd);                 // radial distance from base
    const base = 90 + Math.atan2(x, fwd) / DEG;
    const s = this.ik(r, zEnd);
    return { base, shoulder: s.shoulder, elbow: s.elbow, ok: s.ok && base >= 0 && base <= 180 };
  }
}
