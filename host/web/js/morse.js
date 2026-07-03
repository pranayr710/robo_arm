/* Pure Morse logic: text <-> code, plus an accumulator that turns a stream of
 * blink-derived dots/dashes into decoded text. No DOM, no side effects. */

export const TABLE = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....",
  I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.",
  Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-",
  5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
};
const REV = Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [v, k]));

/** "SOS OK" -> "... --- ...   -.- ..." (letters by space, words by triple). */
export function encode(text) {
  return text.toUpperCase().split(/\s+/).filter(Boolean)
    .map((w) => [...w].filter((c) => TABLE[c]).map((c) => TABLE[c]).join(" "))
    .join("   ");
}

/** Inverse of encode(). Unknown symbols -> '?'. */
export function decode(code) {
  return code.trim().split("   ")
    .map((w) => w.split(" ").map((s) => REV[s] || "?").join(""))
    .join(" ");
}

/** Incrementally build decoded text from blink symbols. */
export class Accumulator {
  constructor() { this.text = ""; this.pending = ""; }
  add(sym) { if (sym === "." || sym === "-") this.pending += sym; }

  /** Finish the current letter; returns the decoded char ("" if none). */
  endLetter() {
    if (!this.pending) return "";
    const ch = REV[this.pending] || "?";
    this.pending = "";
    this.text += ch;
    return ch;
  }

  /** Word gap: finish the letter, append a space; returns " " if added. */
  endWord() {
    this.endLetter();
    if (this.text && !this.text.endsWith(" ")) { this.text += " "; return " "; }
    return "";
  }

  reset() { this.text = ""; this.pending = ""; }
}
