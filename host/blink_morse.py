"""
blink_morse.py — Phase 4 capstone: eye-blink Morse -> arm writes on paper.

For a fully paralysed user who can only blink:
  short blink            -> dot   (.)
  long  blink            -> dash  (-)
  pause (eyes open)      -> end of letter
  longer pause           -> end of word  ->  arm writes the message in Morse

Blinks are detected with MediaPipe FaceMesh via the Eye-Aspect-Ratio (EAR).
No hardware needed to try the decoding: run against the mock arm.

Deps: pip install opencv-python mediapipe numpy
Run:  python blink_morse.py            (mock arm)
      python blink_morse.py --port COM5
"""

import argparse
import threading
import time

from arm_link import open_arm
from morse import MorseAccumulator
from writer import PenWriter

# ---- tunable timing / thresholds ----------------------------------------
EAR_THRESH   = 0.21     # below this = eye closed
DOT_MAX_S    = 0.35     # blink shorter than this = dot, else dash
LETTER_GAP_S = 1.2      # eyes-open gap that ends a letter
WORD_GAP_S   = 2.6      # eyes-open gap that ends a word (and triggers writing)
DEBOUNCE_S   = 0.05     # ignore sub-50ms flicker

LEFT_EYE  = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]


def _ear(lm, idx, w, h):
    import math
    p = [(lm[i].x * w, lm[i].y * h) for i in idx]
    d = lambda a, b: math.hypot(a[0] - b[0], a[1] - b[1])
    vert = d(p[1], p[5]) + d(p[2], p[4])
    horiz = 2.0 * d(p[0], p[3])
    return vert / horiz if horiz else 0.0


class BlinkMorse:
    def __init__(self, link, cam_index=0):
        self.link = link
        self.writer = PenWriter(link)
        self.acc = MorseAccumulator()
        self.cam_index = cam_index
        self._writing = False

    def _commit_word(self):
        """Write whatever has been decoded so far, on a background thread so
        the camera loop keeps running while the arm moves."""
        self.acc.end_word()
        msg = self.acc.text.strip()
        if not msg or self._writing:
            return
        self._writing = True

        def _job():
            print(f"\n[writing] {msg!r} as Morse marks…")
            self.writer.write_text(msg)
            self.acc.reset()
            self._writing = False
        threading.Thread(target=_job, daemon=True).start()

    def run(self):
        try:
            import cv2
            import mediapipe as mp
        except ImportError as e:
            print(f"missing dependency ({e}). Run: pip install opencv-python mediapipe numpy")
            return

        face = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1, refine_landmarks=True,
            min_detection_confidence=0.6, min_tracking_confidence=0.6)
        cap = cv2.VideoCapture(self.cam_index)

        closed = False
        close_t = 0.0
        last_activity = time.time()
        letter_done = False

        print("Blink Morse ready. Short blink = dot, long blink = dash.")
        print("Pause to end a letter; pause longer to WRITE the word.\n")

        while True:
            ok, frame = cap.read()
            if not ok:
                continue
            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]
            res = face.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            now = time.time()

            if res.multi_face_landmarks:
                lm = res.multi_face_landmarks[0].landmark
                ear = (_ear(lm, LEFT_EYE, w, h) + _ear(lm, RIGHT_EYE, w, h)) / 2.0

                if ear < EAR_THRESH and not closed:
                    closed, close_t = True, now
                elif ear >= EAR_THRESH and closed:
                    dur = now - close_t
                    closed = False
                    if dur >= DEBOUNCE_S:
                        sym = "." if dur < DOT_MAX_S else "-"
                        self.acc.add(sym)
                        last_activity = now
                        letter_done = False
                        print(sym, end="", flush=True)

                # gap handling while eyes are open
                if not closed:
                    gap = now - last_activity
                    if gap > LETTER_GAP_S and not letter_done and self.acc.pending:
                        self.acc.end_letter()
                        letter_done = True
                        print(" ", end="", flush=True)
                    if gap > WORD_GAP_S and self.acc.text and not self._writing:
                        self._commit_word()
                        last_activity = now

                cv2.putText(frame, f"EAR {ear:.2f}", (10, 28),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (80, 200, 255), 2)

            buf = self.acc.text + "[" + self.acc.pending + "]"
            cv2.putText(frame, buf[-40:], (10, h - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (60, 255, 120), 2)
            cv2.imshow("Blink Morse (q to quit)", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=None, help="serial port (omit for mock)")
    ap.add_argument("--cam", type=int, default=0)
    args = ap.parse_args()
    BlinkMorse(open_arm(args.port), cam_index=args.cam).run()
