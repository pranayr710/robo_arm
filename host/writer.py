"""
writer.py — Phase 4: make the arm physically WRITE a decoded message on paper.

With 4 DOF (base, gripper, shoulder, elbow) and hobby servos, clean cursive
letters aren't realistic. What *is* reliable and directly answers the goal
("the robot hand must write the morse on paper") is writing the MORSE MARKS:
  - a dot  = a short pen tap
  - a dash = a short pen drag along the line
The arm advances left-to-right; letter/word gaps add spacing.

The pen is held in the gripper (fixed grip). X position comes from the BASE
rotation; pen up/down comes from a shoulder+elbow pose. All of that lives in
CALIB below — tune it once for your physical rig.
"""

import time

# --------------------------- CALIBRATION ---------------------------------
# Tune these on the real arm with a pen taped in the gripper and paper below.
CALIB = {
    "grip_hold":   120,        # gripper angle that holds the pen firmly
    "base_left":   60,         # base angle at the left edge of the writing line
    "base_right":  120,        # base angle at the right edge
    "pen_up":      (90, 90),   # (shoulder, elbow) with pen lifted off paper
    "pen_down":    (110, 115), # (shoulder, elbow) with pen touching paper
    "cells":       24,         # how many mark-slots fit across the line
    "settle_s":    0.35,       # time to let the arm reach each waypoint
    "tap_s":       0.15,       # pen-contact dwell for a dot
    "dash_s":      0.30,       # pen-contact dwell/drag for a dash
}


class PenWriter:
    def __init__(self, link, calib=None):
        self.link = link
        self.c = dict(CALIB, **(calib or {}))
        self._col = 0                              # current slot along the line

    # ---- low-level pose helpers ------------------------------------------
    def _base_for_col(self, col):
        c = self.c
        span = c["base_right"] - c["base_left"]
        frac = min(1.0, col / max(1, c["cells"] - 1))
        return int(c["base_left"] + span * frac)

    def _goto(self, base, shoulder, elbow, dwell):
        self.link.set_all(base, self.c["grip_hold"], shoulder, elbow)
        time.sleep(dwell)

    def _pen_up(self, base):
        s, e = self.c["pen_up"]
        self._goto(base, s, e, self.c["settle_s"])

    def _pen_down(self, base, dwell):
        s, e = self.c["pen_down"]
        self._goto(base, s, e, dwell)

    # ---- marks ------------------------------------------------------------
    def _advance(self, cells=1):
        self._col += cells
        if self._col >= self.c["cells"]:
            self._col = 0                          # wrap to start of a new line

    def dot(self):
        base = self._base_for_col(self._col)
        self._pen_up(base)
        self._pen_down(base, self.c["tap_s"])
        self._pen_up(base)
        self._advance(1)

    def dash(self):
        base0 = self._base_for_col(self._col)
        base1 = self._base_for_col(self._col + 1)
        self._pen_up(base0)
        self._pen_down(base0, self.c["dash_s"])
        self._pen_down(base1, self.c["dash_s"])    # drag to next slot
        self._pen_up(base1)
        self._advance(2)

    # ---- public API -------------------------------------------------------
    def write_morse(self, code, on_progress=None):
        """code like '... --- ...'; letters separated by ' ', words by '   '."""
        self.home()
        for token in code.replace("   ", " / ").split(" "):
            if token == "/":
                self._advance(3)                   # word gap
            else:
                for sym in token:
                    if sym == ".": self.dot()
                    elif sym == "-": self.dash()
                    if on_progress: on_progress(sym)
                self._advance(2)                   # letter gap
        self.home()

    def write_text(self, text, on_progress=None):
        """Encode text to Morse, then write the marks."""
        from morse import encode
        self.write_morse(encode(text), on_progress)

    def home(self):
        self.link.home()
        time.sleep(self.c["settle_s"])
        self._col = 0


if __name__ == "__main__":
    # Dry-run against the mock arm: prints the marks it would draw.
    import argparse
    from arm_link import open_arm
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=None)
    ap.add_argument("--text", default="SOS")
    args = ap.parse_args()
    link = open_arm(args.port)
    w = PenWriter(link)
    print(f"Writing '{args.text}' as Morse marks...")
    w.write_text(args.text, on_progress=lambda s: print(s, end="", flush=True))
    print("\ndone")
