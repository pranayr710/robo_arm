/* nlp.js — local natural-language command understanding.
 * Turns free text (typed or spoken) into arm actions. Works fully offline via
 * intent rules; app.js can optionally route hard requests to a Claude endpoint
 * first and fall back here. Returns {ok, message} for user feedback. */

const JOINTS = { base: "base", gripper: "grip", grip: "grip", shoulder: "shoulder", elbow: "elbow" };

export function handle(text, ctx) {
  const { arm, writer, routines, setSpeed, estop, release } = ctx;
  const t = (text || "").toLowerCase().trim();
  const ok = (m) => ({ ok: true, message: m });
  const no = (m) => ({ ok: false, message: m });
  if (!t) return no("(empty)");

  // write / draw a message (real block letters on the paper strip)
  let m = t.match(/^(?:write|draw|type|spell)\s+(.+)$/);
  if (m) { writer.writeText(m[1].toUpperCase()); return ok('writing "' + m[1].toUpperCase() + '" in letters'); }

  // safety
  if (/\b(stop|halt|freeze|emergency|abort)\b/.test(t)) { estop(); return ok("EMERGENCY STOP"); }
  if (/\b(release|resume|unfreeze|continue)\b/.test(t)) { release(); return ok("released"); }

  // routines
  if (/\bwave\b/.test(t)) { routines.run("wave"); return ok("waving 👋"); }
  if (/\b(pick|place|grab.*put|pick.*place)\b/.test(t)) { routines.run("pick"); return ok("pick & place"); }
  if (/\b(nod|yes)\b/.test(t)) { routines.run("nod"); return ok("nodding"); }
  if (/\b(scan|look around|sweep)\b/.test(t)) { routines.run("scan"); return ok("scanning"); }
  if (/\b(home|reset|center|rest|neutral)\b/.test(t)) { arm.setHome(); return ok("home"); }

  // gripper
  if (/\b(open)\b/.test(t) && /\b(grip|gripper|hand|claw|it)?\b/.test(t)) { arm.setTarget({ grip: 30 }); return ok("gripper open"); }
  if (/\b(close|grab|grasp|clench|hold)\b/.test(t)) { arm.setTarget({ grip: 160 }); return ok("gripper closed"); }

  // speed
  if (/\b(fast|faster|quick|quickly|speed up)\b/.test(t)) { setSpeed(6); return ok("faster"); }
  if (/\b(slow|slower|gentle|carefully)\b/.test(t)) { setSpeed(2); return ok("slower"); }

  // "set shoulder to 120" / "base 40"
  m = t.match(/\b(base|gripper|grip|shoulder|elbow)\b[^0-9]*(\d{1,3})/);
  if (m) { const k = JOINTS[m[1]]; arm.setTarget({ [k]: +m[2] }); return ok(`${k} → ${m[2]}°`); }

  // relative nudges
  const nudge = (k, d, lo, hi) => arm.setTarget({ [k]: Math.min(hi, Math.max(lo, arm.tgt[k] + d)) });
  if (/\bleft\b/.test(t)) { nudge("base", -20, 0, 180); return ok("left"); }
  if (/\bright\b/.test(t)) { nudge("base", +20, 0, 180); return ok("right"); }
  if (/\b(up|raise|lift)\b/.test(t)) { nudge("shoulder", -15, 0, 180); return ok("up"); }
  if (/\b(down|lower)\b/.test(t)) { nudge("shoulder", +15, 0, 180); return ok("down"); }
  if (/\b(reach|extend|forward)\b/.test(t)) { nudge("elbow", +15, 0, 180); return ok("reaching"); }
  if (/\b(retract|back|fold)\b/.test(t)) { nudge("elbow", -15, 0, 180); return ok("retracting"); }

  // paper
  if (/\b(clear|erase|wipe|new)\b.*\b(paper|page|sheet|strip)\b/.test(t) || t === "clear") {
    ctx.clearPaper(); return ok("fresh page");
  }

  return no('not understood: "' + text + '"');
}
