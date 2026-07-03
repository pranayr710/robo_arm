/* Routines — data-driven motion choreography. Each routine is a list of
 * {a: partial-angles, ms: settle-time} steps streamed to the ArmModel. Voice,
 * gestures and buttons all trigger these. Angles are servo degrees, so the
 * same sequences run on the real STM32 arm. */

import { HOME, sleep } from "./config.js";

const LIB = {
  home: [{ a: { ...HOME }, ms: 600 }],

  wave: [
    { a: { base: 120, shoulder: 60, elbow: 90 }, ms: 400 },
    { a: { base: 60 }, ms: 300 }, { a: { base: 120 }, ms: 300 },
    { a: { base: 60 }, ms: 300 }, { a: { base: 120 }, ms: 300 },
    { a: { ...HOME }, ms: 500 },
  ],

  nod: [
    { a: { shoulder: 70 }, ms: 300 }, { a: { shoulder: 110 }, ms: 300 },
    { a: { shoulder: 70 }, ms: 300 }, { a: { ...HOME }, ms: 400 },
  ],

  pick: [
    { a: { base: 90, shoulder: 90, elbow: 110, grip: 60 }, ms: 500 },
    { a: { grip: 30 }, ms: 400 },                       // open gripper
    { a: { shoulder: 125, elbow: 130 }, ms: 700 },      // reach down
    { a: { grip: 155 }, ms: 500 },                      // grab
    { a: { shoulder: 80, elbow: 100 }, ms: 600 },       // lift
    { a: { base: 40 }, ms: 700 },                       // swing over
    { a: { shoulder: 120, elbow: 125 }, ms: 600 },      // lower
    { a: { grip: 30 }, ms: 500 },                       // release
    { a: { ...HOME }, ms: 700 },                        // home
  ],

  scan: [
    { a: { base: 20 }, ms: 600 }, { a: { base: 160 }, ms: 900 },
    { a: { base: 90 }, ms: 500 },
  ],
};

export class Routines {
  constructor(arm) { this.arm = arm; this.running = false; }
  list() { return Object.keys(LIB); }

  async run(name, { onDone } = {}) {
    const seq = LIB[name];
    if (!seq || this.running || this.arm.estop) return false;
    this.running = true;
    try {
      for (const step of seq) {
        if (this.arm.estop) break;
        this.arm.setTarget(step.a);
        await sleep(step.ms);
      }
    } finally { this.running = false; if (onDone) onDone(); }
    return true;
  }
}
