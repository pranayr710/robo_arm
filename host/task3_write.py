"""
task3_write.py  -  Task 3 complete PC bridge for HASTHA (STM32F401, ACTIVE_TASK 3)

Pipeline:   webcam -> eye-blink -> Morse -> letter -> inverse kinematics
            -> serial "A base shoulder elbow gripper" -> STM32F401 -> pen writes

The STM32 firmware (firmware/main.c, ACTIVE_TASK 3) receives each
    A <base> <shoulder> <elbow> <gripper>\n
line and smoothly moves the servos.  'H\n' homes the arm.

----------------------------------------------------------------------------
INSTALL (PC):   pip install pyserial opencv-python mediapipe numpy
FLASH   (MCU):  build firmware/main.c with  #define ACTIVE_TASK 3

RUN - in this order while bringing it up:
  1) Logic only, no arm, no camera (prints the angle commands it would send):
       python task3_write.py --dry --text "HI"
  2) Find your arm's calibration numbers (type angles, watch the arm):
       python task3_write.py --port COM5 --mode cal
  3) Test writing typed text on the real arm:
       python task3_write.py --port COM5 --mode text --text "HELLO"
  4) Full feature - blink Morse writing:
       python task3_write.py --port COM5 --mode blink

Blink code:  short blink = dot (.)   long blink = dash (-)
             pause = end of letter    longer pause = end of word (writes it)
----------------------------------------------------------------------------
NOTE: the geometry constants below MUST be tuned to your real arm (use --mode cal).
Everything is written to match firmware/main.c but is UNTESTED on hardware.
"""

import argparse, time, sys, math

# ======================= TUNE THESE TO YOUR ARM (mm / degrees) =============
ARM_L1       = 105.0   # shoulder -> elbow length (mm)  -- match config.h ARM_L1
ARM_L2       = 95.0    # elbow -> fore-arm end (mm)      -- match config.h ARM_L2
SHOULDER_H   = 95.0    # shoulder pivot height above table (mm)
PEN_LEN      = 55.0    # pen tip below the fore-arm end (mm)

GRIP_HOLD    = 120     # gripper angle that holds the pen (servo deg) - TUNE

# paper placement (flat sheet in front of the base)
PAPER_FWD    = 150.0   # forward distance from base axis to the writing line (mm)
PAPER_LEFT   = -40.0   # lateral start (mm, - = left of centre)
LETTER_H     = 30.0    # letter height on paper (mm)  (>=30 recommended)
GLYPH_RATIO  = 0.6     # glyph width = ratio * height
LETTER_GAP   = 8.0     # gap between letters (mm)
SPACE_W      = 16.0    # width of a space (mm)
LIFT_MM      = 20.0    # pen lift height between strokes (mm)

# servo angle convention / trim (adjust signs+offsets in --mode cal)
# Convention assumed: shoulder servo 90 deg = upper arm horizontal (up = larger);
# elbow servo = interior bend angle. Re-trim these to YOUR arm with --mode cal.
SH_OFFSET    = 90.0    # added to computed shoulder angle (90 = horizontal datum)
EL_OFFSET    = 0.0     # added to computed elbow interior angle
SH_SIGN      = 1.0
EL_SIGN      = 1.0

# motion timing (firmware ramps ~200 deg/s)
SETTLE_MOVE  = 0.22    # s to wait after a travel move
SETTLE_PEN   = 0.25    # s to wait after pen up/down
SETTLE_STEP  = 0.10    # s per stroke step

# blink Morse timing (seconds)
EAR_THRESH   = 0.21
DOT_MAX      = 0.32
LETTER_GAP_S = 1.2
WORD_GAP_S   = 2.6
DEBOUNCE_S   = 0.06
BAUD         = 115200
# ===========================================================================

def clamp(v, lo, hi): return lo if v < lo else hi if v > hi else v

# ------------------------------------------------------------- serial link
class Arm:
    def __init__(self, port, dry=False):
        self.dry = dry or (port is None)
        self.ser = None
        if not self.dry:
            import serial
            self.ser = serial.Serial(port, BAUD, timeout=0.1)
            time.sleep(1.5)            # let the board boot / print READY
            self._drain()
    def _drain(self):
        if self.ser:
            try:
                while self.ser.in_waiting: self.ser.readline()
            except Exception: pass
    def send(self, base, shoulder, elbow, grip):
        b = int(clamp(round(base),0,180));  s = int(clamp(round(shoulder),0,180))
        e = int(clamp(round(elbow),0,180)); g = int(clamp(round(grip),0,180))
        line = f"A {b} {s} {e} {g}\n"
        if self.dry:
            print("  ->", line.strip())
        else:
            self.ser.write(line.encode()); self._drain()
    def home(self):
        if self.dry: print("  -> H")
        else: self.ser.write(b"H\n"); self._drain()

# ------------------------------------------------------------- kinematics
def ik(r, z_end):
    """2-link IK in the vertical plane: horizontal reach r, fore-arm-end height z_end
       (mm, above table) -> (shoulder_deg, elbow_deg). Returns (sh, el, reachable)."""
    dz = z_end - SHOULDER_H
    D = (r*r + dz*dz - ARM_L1*ARM_L1 - ARM_L2*ARM_L2) / (2*ARM_L1*ARM_L2)
    reachable = -1.0 <= D <= 1.0
    D = clamp(D, -1.0, 1.0)
    e = math.acos(D)                                   # elbow interior angle
    s = math.atan2(dz, r) - math.atan2(ARM_L2*math.sin(e), ARM_L1 + ARM_L2*math.cos(e))
    sh = SH_SIGN * math.degrees(s) + SH_OFFSET
    el = EL_SIGN * math.degrees(e) + EL_OFFSET
    return clamp(sh,0,180), clamp(el,0,180), reachable

def paper_to_servo(lx, fy, pen_down):
    """paper point: lx lateral (mm), fy forward-from-PAPER_FWD (mm); pen_down bool
       -> (base, shoulder, elbow) servo degrees."""
    fwd = PAPER_FWD + fy
    r   = math.hypot(fwd, lx)                           # horizontal reach from base
    base = 90.0 + math.degrees(math.atan2(lx, fwd))     # base yaw sets lateral x
    z_end = PEN_LEN + (0.0 if pen_down else LIFT_MM)    # fore-arm end height above table
    sh, el, ok = ik(r, z_end)
    if not ok:
        print(f"  [warn] point (lx={lx:.0f}, fy={fy:.0f}) not reachable - tune geometry")
    return base, sh, el

# ------------------------------------------------------------- pen moves
def goto(arm, lx, fy, pen_down, settle):
    base, sh, el = paper_to_servo(lx, fy, pen_down)
    arm.send(base, sh, el, GRIP_HOLD)
    time.sleep(settle)

# ------------------------------------------------------------- vector font (A-Z 0-9)
# each glyph = list of strokes; each stroke = list of [x,y] on a 4(wide) x 6(tall) grid,
# y up, baseline at 0.  (ported from the project's font.js)
GRID = {
 "A":[[[0,0],[2,6],[4,0]],[[1,2.6],[3,2.6]]],
 "B":[[[0,0],[0,6],[3,6],[4,5],[4,4],[3,3],[0,3]],[[3,3],[4,2],[4,1],[3,0],[0,0]]],
 "C":[[[4,1],[3,0],[1,0],[0,1],[0,5],[1,6],[3,6],[4,5]]],
 "D":[[[0,0],[0,6],[2,6],[4,4],[4,2],[2,0],[0,0]]],
 "E":[[[4,0],[0,0],[0,6],[4,6]],[[0,3],[3,3]]],
 "F":[[[0,0],[0,6],[4,6]],[[0,3],[3,3]]],
 "G":[[[4,5],[3,6],[1,6],[0,5],[0,1],[1,0],[3,0],[4,1],[4,3],[2,3]]],
 "H":[[[0,0],[0,6]],[[4,0],[4,6]],[[0,3],[4,3]]],
 "I":[[[1,6],[3,6]],[[2,6],[2,0]],[[1,0],[3,0]]],
 "J":[[[4,6],[4,1],[3,0],[1,0],[0,1]]],
 "K":[[[0,0],[0,6]],[[4,6],[0,3],[4,0]]],
 "L":[[[0,6],[0,0],[4,0]]],
 "M":[[[0,0],[0,6],[2,3],[4,6],[4,0]]],
 "N":[[[0,0],[0,6],[4,0],[4,6]]],
 "O":[[[1,0],[0,1],[0,5],[1,6],[3,6],[4,5],[4,1],[3,0],[1,0]]],
 "P":[[[0,0],[0,6],[3,6],[4,5],[4,4],[3,3],[0,3]]],
 "Q":[[[1,0],[0,1],[0,5],[1,6],[3,6],[4,5],[4,1],[3,0],[1,0]],[[2.6,1.6],[4,0]]],
 "R":[[[0,0],[0,6],[3,6],[4,5],[4,4],[3,3],[0,3]],[[2,3],[4,0]]],
 "S":[[[4,5],[3,6],[1,6],[0,5],[0,4],[1,3],[3,3],[4,2],[4,1],[3,0],[1,0],[0,1]]],
 "T":[[[0,6],[4,6]],[[2,6],[2,0]]],
 "U":[[[0,6],[0,1],[1,0],[3,0],[4,1],[4,6]]],
 "V":[[[0,6],[2,0],[4,6]]],
 "W":[[[0,6],[1,0],[2,4],[3,0],[4,6]]],
 "X":[[[0,0],[4,6]],[[0,6],[4,0]]],
 "Y":[[[0,6],[2,3],[4,6]],[[2,3],[2,0]]],
 "Z":[[[0,6],[4,6],[0,0],[4,0]]],
 "0":[[[1,0],[0,1],[0,5],[1,6],[3,6],[4,5],[4,1],[3,0],[1,0]],[[1,1],[3,5]]],
 "1":[[[1,5],[2,6],[2,0]],[[1,0],[3,0]]],
 "2":[[[0,5],[1,6],[3,6],[4,5],[4,4],[0,1],[0,0],[4,0]]],
 "3":[[[0,5],[1,6],[3,6],[4,5],[4,4],[3,3],[1,3]],[[3,3],[4,2],[4,1],[3,0],[1,0],[0,1]]],
 "4":[[[3,0],[3,6],[0,2],[4,2]]],
 "5":[[[4,6],[0,6],[0,4],[3,4],[4,3],[4,1],[3,0],[1,0],[0,1]]],
 "6":[[[3,6],[1,6],[0,5],[0,1],[1,0],[3,0],[4,1],[4,2],[3,3],[0,3]]],
 "7":[[[0,6],[4,6],[1,0]]],
 "8":[[[1,3],[0,4],[0,5],[1,6],[3,6],[4,5],[4,4],[3,3],[1,3]],[[1,3],[0,2],[0,1],[1,0],[3,0],[4,1],[4,2],[3,3]]],
 "9":[[[1,0],[3,0],[4,1],[4,5],[3,6],[1,6],[0,5],[0,4],[1,3],[4,3]]],
}

# ------------------------------------------------------------- writer
class Writer:
    def __init__(self, arm):
        self.arm = arm
        self.cursor = 0.0        # lateral offset from PAPER_LEFT (mm)
    def home(self):
        self.arm.home(); time.sleep(0.6); self.cursor = 0.0
    def write_char(self, ch):
        ch = ch.upper()
        if ch == " ":
            self.cursor += SPACE_W; return
        strokes = GRID.get(ch)
        if not strokes:
            return
        w = LETTER_H * GLYPH_RATIO
        base_lx = PAPER_LEFT + self.cursor
        for stroke in strokes:
            pts = [(base_lx + (sx/4.0)*w, (sy/6.0)*LETTER_H) for sx, sy in stroke]
            # travel to first point (pen up), then pen down and trace
            goto(self.arm, pts[0][0], pts[0][1], False, SETTLE_MOVE)
            goto(self.arm, pts[0][0], pts[0][1], True,  SETTLE_PEN)
            for (lx, fy) in pts[1:]:
                goto(self.arm, lx, fy, True, SETTLE_STEP)
            goto(self.arm, pts[-1][0], pts[-1][1], False, SETTLE_PEN)
        self.cursor += w + LETTER_GAP
    def write_text(self, text):
        print(f'[write] "{text}"')
        for ch in text:
            self.write_char(ch)
        self.home()
        print("[write] done")

# ------------------------------------------------------------- Morse
MORSE = {".-":"A","-...":"B","-.-.":"C","-..":"D",".":"E","..-.":"F","--.":"G",
 "....":"H","..":"I",".---":"J","-.-":"K",".-..":"L","--":"M","-.":"N","---":"O",
 ".--.":"P","--.-":"Q",".-.":"R","...":"S","-":"T","..-":"U","...-":"V",".--":"W",
 "-..-":"X","-.--":"Y","--..":"Z","-----":"0",".----":"1","..---":"2","...--":"3",
 "....-":"4",".....":"5","-....":"6","--...":"7","---..":"8","----.":"9"}

# ------------------------------------------------------------- modes
def mode_text(arm, text):
    w = Writer(arm); w.home(); w.write_text(text)

def mode_cal(arm):
    print("CALIBRATION - type:  base shoulder elbow grip   (0-180), 'h' home, 'q' quit")
    print("Find: pen-DOWN pose (pen just touches paper), then note shoulder/elbow,")
    print("and the gripper angle that holds the pen. Put the values into the TUNE block.")
    while True:
        s = input("angles> ").strip()
        if s in ("q","quit"): break
        if s in ("h","home"): arm.home(); continue
        try:
            b,sh,el,g = (int(x) for x in s.split())
            arm.send(b,sh,el,g)
        except Exception:
            print("  format: base shoulder elbow grip  (e.g. 90 110 120 120)")

def mode_blink(arm):
    try:
        import cv2, numpy as np, mediapipe as mp
    except ImportError as e:
        sys.exit(f"missing dependency: {e}\n  pip install opencv-python mediapipe numpy")
    LEFT  = [33,160,158,133,153,144]
    RIGHT = [362,385,387,263,373,380]
    def ear(lm, idx, w, h):
        p = [(lm[i].x*w, lm[i].y*h) for i in idx]
        d = lambda a,b: math.hypot(a[0]-b[0], a[1]-b[1])
        vert = d(p[1],p[5]) + d(p[2],p[4]); horiz = 2.0*d(p[0],p[3])
        return vert/horiz if horiz else 0.0

    writer = Writer(arm); writer.home()
    face = mp.solutions.face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True,
            min_detection_confidence=0.6, min_tracking_confidence=0.6)
    cap = cv2.VideoCapture(0)
    pending = ""; text = ""; writing = [False]
    closed = False; close_t = 0.0; last_act = time.time(); letter_done = False
    print("BLINK MORSE  - short=dot  long=dash  pause=letter  longer pause=write  (q quits)")

    def commit_word():
        nonlocal text, pending
        if pending:
            text += MORSE.get(pending, "?"); pending = ""
        msg = text.strip()
        if msg and not writing[0]:
            writing[0] = True
            print(f"\n[writing] {msg!r}")
            writer.write_text(msg)              # blocks camera briefly - fine
            text = ""; writing[0] = False

    while True:
        ok, frame = cap.read()
        if not ok: continue
        frame = cv2.flip(frame, 1); h, w = frame.shape[:2]
        res = face.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        now = time.time()
        if res.multi_face_landmarks:
            lm = res.multi_face_landmarks[0].landmark
            e = (ear(lm, LEFT, w, h) + ear(lm, RIGHT, w, h)) / 2.0
            if e < EAR_THRESH and not closed:
                closed, close_t = True, now
            elif e >= EAR_THRESH and closed:
                closed = False; dur = now - close_t
                if dur >= DEBOUNCE_S:
                    sym = "." if dur < DOT_MAX else "-"
                    pending += sym; last_act = now; letter_done = False
                    print(sym, end="", flush=True)
            if not closed:
                gap = now - last_act
                if gap > LETTER_GAP_S and not letter_done and pending:
                    text += MORSE.get(pending, "?"); pending = ""; letter_done = True
                    print(" ", end="", flush=True)
                if gap > WORD_GAP_S and text and not writing[0]:
                    commit_word(); last_act = now
            cv2.putText(frame, f"EAR {e:.2f}", (10,28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (80,200,255), 2)
        cv2.putText(frame, (text + "[" + pending + "]")[-32:], (10, h-18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (60,255,120), 2)
        cv2.imshow("Blink Morse (q quits)", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'): break
    cap.release(); cv2.destroyAllWindows()

# ------------------------------------------------------------- main
if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="HASTHA Task 3 - blink Morse -> arm writes letters")
    ap.add_argument("--port", default=None, help="serial port, e.g. COM5 (omit with --dry)")
    ap.add_argument("--mode", choices=["text","cal","blink"], default="blink")
    ap.add_argument("--text", default="HI", help="text for --mode text / --dry")
    ap.add_argument("--dry", action="store_true", help="print commands, no serial/arm")
    args = ap.parse_args()

    arm = Arm(args.port, dry=args.dry)
    if args.dry:
        mode_text(arm, args.text)
    elif args.mode == "cal":
        mode_cal(arm)
    elif args.mode == "text":
        mode_text(arm, args.text)
    else:
        mode_blink(arm)
