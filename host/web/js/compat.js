/* compat.js — hardware compatibility checker.
 * Validates, from the SAME config the writer uses, whether the physical arm
 * can actually write the letters: reachability of every corner of the writing
 * zone (pen down AND lifted), required base sweep, servo resolution at the
 * pen, recommended letter size, and speed. Shown as a panel in the UI so any
 * config change is re-checked instantly. */

import { ARM, PAPER, LETTER, WRITE } from "./config.js";
import { GLYPH_RATIO } from "./font.js";

const DEG = Math.PI / 180;

export function checkCompat(arm) {
  const items = [];
  const zDown = ARM.penLen, zUp = ARM.penLen + WRITE.liftMm;

  // 1) Reachability: all 4 corners of the glyph zone, pen down + lifted.
  const xs = [-(PAPER.w / 2 - PAPER.margin), PAPER.w / 2 - PAPER.margin];
  const ys = [PAPER.margin, PAPER.margin + LETTER.h];
  let reachable = true, worst = "";
  for (const x of xs) for (const y of ys) for (const z of [zDown, zUp]) {
    const t = arm.paperToTargets(x, y, z);
    if (!t.ok) { reachable = false; worst = `corner (${x},${y}) z=${z}`; }
  }
  items.push({
    label: "Writing zone reachable (IK, all corners)",
    value: reachable ? "yes" : "NO — " + worst,
    status: reachable ? "ok" : "bad",
  });

  // 2) Base sweep needed for the strip width.
  const sweep = Math.atan2(PAPER.w / 2 - PAPER.margin, PAPER.dist) / DEG;
  items.push({
    label: "Base sweep needed",
    value: `±${sweep.toFixed(1)}° (servo has ±90°)`,
    status: sweep < 60 ? "ok" : sweep < 85 ? "warn" : "bad",
  });

  // 3) Resolution: pen movement per 1° servo step at the far edge.
  const rFar = Math.hypot(PAPER.w / 2, PAPER.dist + PAPER.d);
  const res = rFar * Math.tan(1 * DEG);          // mm per 1° of base
  const recMin = Math.ceil(8 * res);             // ~8 steps per letter height
  items.push({
    label: "Pen resolution (1° servo step)",
    value: `≈${res.toFixed(1)} mm at the pen`,
    status: res < 3 ? "ok" : res < 5 ? "warn" : "bad",
  });
  items.push({
    label: `Letter height ${LETTER.h} mm vs recommended ≥${recMin} mm`,
    value: LETTER.h >= recMin ? "OK — legible block capitals" : "increase LETTER.h or move paper closer",
    status: LETTER.h >= recMin ? "ok" : LETTER.h >= 5 * res ? "warn" : "bad",
  });

  // 4) Capacity + speed.
  const w = LETTER.h * GLYPH_RATIO;
  const perLine = Math.floor((PAPER.w - 2 * PAPER.margin) / (w + LETTER.gap));
  const strokeMm = LETTER.h * 3.2;               // typical glyph path length
  const secPerChar = (Math.ceil(strokeMm / WRITE.stepMm) * WRITE.stepMs
    + 2.5 * (WRITE.penMs + WRITE.settleMs)) / 1000;
  items.push({ label: "Letters per strip", value: `${perLine} (then auto new page)`, status: "info" });
  items.push({ label: "Writing speed", value: `≈${secPerChar.toFixed(1)} s per letter`, status: "info" });

  // 5) Wire honesty note.
  items.push({
    label: "Hardware fidelity",
    value: "same angle stream as sim, quantised to 1° on the wire; calibrate with C cmd first",
    status: "info",
  });

  return { ok: reachable, items };
}
