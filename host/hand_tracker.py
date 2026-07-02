"""
hand_tracker.py — Phase 2: real-time hand -> arm mapping.

Runs MediaPipe Hands on a webcam and converts each detected hand pose into 4
servo angles [base, gripper, shoulder, elbow], calling a callback ~30x/sec.
The server (or any script) feeds those angles straight into arm_link.

Mapping (intentionally simple; 4 DOF can't mirror all 5 fingers):
  - wrist X  -> base      (left/right sweep)
  - wrist Y  -> shoulder  (up/down reach)
  - reach    -> elbow     (hand near/far, from wrist->middle-knuckle length)
  - pinch    -> gripper   (thumb-index distance: pinch = close)

Everything is exponentially smoothed to kill servo jitter.

Deps (optional): pip install opencv-python mediapipe numpy
"""

import threading


def _clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def _map(v, in_lo, in_hi, out_lo, out_hi):
    if in_hi == in_lo:
        return out_lo
    t = (v - in_lo) / (in_hi - in_lo)
    return _clamp(out_lo + t * (out_hi - out_lo), min(out_lo, out_hi), max(out_lo, out_hi))


class HandTracker:
    def __init__(self, on_angles, cam_index=0, show_window=True, alpha=0.35):
        """
        on_angles: callable(list[int]) -> None, called with [base,grip,shoulder,elbow]
        alpha:     smoothing factor (0..1); higher = snappier, lower = smoother
        """
        self.on_angles = on_angles
        self.cam_index = cam_index
        self.show_window = show_window
        self.alpha = alpha
        self._alive = False
        self._thread = None
        self._smooth = [90.0, 60.0, 90.0, 90.0]

    def start(self):
        if self._alive:
            return
        self._alive = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._alive = False

    # ---- internals --------------------------------------------------------
    def _emit(self, raw):
        a = self.alpha
        for i in range(4):
            self._smooth[i] = (1 - a) * self._smooth[i] + a * raw[i]
        self.on_angles([int(round(x)) for x in self._smooth])

    def _run(self):
        try:
            import cv2
            import mediapipe as mp
            import math
        except ImportError as e:
            print(f"[hand_tracker] missing dependency ({e}). "
                  f"Run: pip install opencv-python mediapipe numpy")
            self._alive = False
            return

        hands = mp.solutions.hands.Hands(
            max_num_hands=1, min_detection_confidence=0.6,
            min_tracking_confidence=0.5)
        draw = mp.solutions.drawing_utils
        cap = cv2.VideoCapture(self.cam_index)

        while self._alive:
            ok, frame = cap.read()
            if not ok:
                continue
            frame = cv2.flip(frame, 1)                      # mirror = intuitive
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = hands.process(rgb)

            if res.multi_hand_landmarks:
                lm = res.multi_hand_landmarks[0].landmark
                wrist, thumb, index, mid_mcp = lm[0], lm[4], lm[8], lm[9]

                base     = _map(wrist.x, 0.15, 0.85, 0, 180)
                shoulder = _map(wrist.y, 0.15, 0.85, 40, 150)
                reach    = math.hypot(wrist.x - mid_mcp.x, wrist.y - mid_mcp.y)
                elbow    = _map(reach, 0.06, 0.20, 60, 140)
                pinch    = math.hypot(thumb.x - index.x, thumb.y - index.y)
                gripper  = _map(pinch, 0.03, 0.18, 160, 30)  # small = closed(160)

                self._emit([base, gripper, shoulder, elbow])

                if self.show_window:
                    draw.draw_landmarks(
                        frame, res.multi_hand_landmarks[0],
                        mp.solutions.hands.HAND_CONNECTIONS)

            if self.show_window:
                cv2.putText(frame, "Hand-follow (q to close window)", (10, 26),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (80, 200, 255), 2)
                cv2.imshow("Hand tracker", frame)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    break

        cap.release()
        if self.show_window:
            cv2.destroyAllWindows()
        self._alive = False


if __name__ == "__main__":
    # Standalone demo: drive the arm (mock or real) directly from your hand.
    import argparse
    from arm_link import open_arm
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=None)
    ap.add_argument("--cam", type=int, default=0)
    args = ap.parse_args()
    link = open_arm(args.port)
    t = HandTracker(lambda a: link.set_all(*a), cam_index=args.cam)
    t.start()
    print("Hand-follow running. Ctrl-C to stop.")
    try:
        while True:
            import time; time.sleep(0.5)
    except KeyboardInterrupt:
        t.stop()
