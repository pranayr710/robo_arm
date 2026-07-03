/* Central configuration — ALL physical quantities are in real millimetres so
 * the same numbers describe the on-screen simulation and the real hardware.
 * When your arm arrives: measure L1/L2/shoulder height/pen length, place the
 * writing strip, and update ARM/PAPER below. The compatibility panel in the
 * UI re-validates reach & resolution automatically. */

// Servo limits (degrees) — must match firmware 0..180.
export const SERVO = { min: 0, max: 180 };

// Neutral / rest pose in servo degrees.
export const HOME = { base: 90, grip: 70, shoulder: 90, elbow: 110 };

// Physical arm (millimetres). Convention:
//   shoulder angle: 0° = pointing forward (toward paper), 90° = straight up
//   elbow angle:    90° = straight continuation of the upper arm
export const ARM = {
  L1: 130,          // upper-arm length (shoulder -> elbow)
  L2: 120,          // fore-arm length (elbow -> pen mount)
  shoulderH: 95,    // shoulder pivot height above the table
  penLen: 55,       // pen sticks down this far below the fore-arm end
};

// Writing strip on the table, in front of the robot (top view).
//   dist  = distance from base axis to the strip's NEAR edge
//   w × d = strip width (lateral) × depth (radial)
export const PAPER = { w: 190, d: 52, dist: 173, margin: 6 };

// Block-capital letters (single-stroke vector font, font.js).
// 36 mm passes the resolution check for ~1° hobby servos at this paper
// distance (see the compatibility panel — it re-validates any change).
export const LETTER = { h: 36, gap: 6, spaceW: 14 };

// Writing motion.
export const WRITE = {
  stepMm: 3.5,      // interpolation step along a stroke
  stepMs: 40,       // dwell per step (writing speed)
  penMs: 230,       // pen up/down settle
  settleMs: 210,    // travel-move settle
  liftMm: 22,       // how high the pen lifts between strokes
  contactMm: 1.6,   // tip counts as "touching" below this height
};

// Arm ramp: max degrees per rendered frame (mirrors firmware smoothing).
export const RAMP = { degPerFrame: 2.2 };

// Input -> servo mappings for live control modes.
export const MAP = {
  base: [0, 180], shoulder: [45, 135], elbow: [60, 140], grip: [30, 160],
};

// Eye-blink Morse timing (ms) + blink thresholds (hysteresis).
export const MORSE = {
  dotMaxMs: 320, letterGapMs: 1100, wordGapMs: 2600, debounceMs: 60,
  closeThresh: 0.5, openThresh: 0.32,
};

// View layout (canvas px). Side view of the arm + top view of the paper.
export const VIEW = {
  w: 700, h: 560,
  side: { pivotX: 150, tableY: 322, scale: 0.78 },   // px per mm = scale
  top:  { x: 122, y: 400, scale: 2.4 },               // paper top-view origin
};

// MediaPipe (in-browser, CDN; needs internet on first run).
export const MP = {
  base: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14",
  hand: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  gesture: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
};

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const mapRange = (v, a, b, c, d) =>
  clamp(c + ((v - a) * (d - c)) / (b - a), Math.min(c, d), Math.max(c, d));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
