"""
arm_link.py — host-side link to the STM32 arm (Phase 0).

Two things in one file:
  1. ArmLink: a tiny, reusable serial wrapper the Phase 1 web UI, the
     Phase 2 hand-follow, and the Phase 4 Morse writer will all import.
  2. A command-line tester so you can prove the firmware works today:
        python arm_link.py --port COM5
     then type:  A 90 60 90 90   |   S 0 120   |   H   |   E   |   R   |   q

Requires: pip install pyserial
"""

import argparse
import sys
import threading
import time

try:
    import serial  # pyserial
except ImportError:
    sys.exit("pyserial not installed. Run:  pip install pyserial")


class ArmLink:
    def __init__(self, port, baud=115200, timeout=0.05):
        self.ser = serial.Serial(port, baud, timeout=timeout)
        self.state = {"angles": [90, 60, 90, 90], "estop": 0, "mode": 0, "dist": 999}
        self._alive = True
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        time.sleep(0.2)  # let the board send READY

    # ---- outbound commands -------------------------------------------------
    def _send(self, line):
        self.ser.write((line + "\n").encode("ascii"))

    def set_all(self, base, grip, shoulder, elbow):
        self._send(f"A {base} {grip} {shoulder} {elbow}")

    def set_servo(self, ch, angle):
        self._send(f"S {ch} {angle}")

    def home(self):          self._send("H")
    def estop(self):         self._send("E")
    def release(self):       self._send("R")
    def request_state(self): self._send("?")

    # ---- inbound telemetry -------------------------------------------------
    def _read_loop(self):
        buf = b""
        while self._alive:
            data = self.ser.read(64)
            if not data:
                continue
            buf += data
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                self._on_line(line.decode(errors="ignore").strip())

    def _on_line(self, line):
        if line.startswith("STATE"):
            p = line.split()
            if len(p) >= 6:
                self.state["angles"] = [int(x) for x in p[1:5]]
                self.state["estop"] = int(p[5])
            if len(p) >= 8:                       # newer firmware: + mode + dist
                self.state["mode"] = int(p[6])
                self.state["dist"] = int(p[7])
        elif line:
            print(f"  <-- {line}")

    def set_mode(self, joystick):
        self._send(f"J {1 if joystick else 0}")

    def close(self):
        self._alive = False
        self.ser.close()


HOME_POSE = [90, 60, 90, 90]  # matches firmware


class MockArmLink:
    """Drop-in replacement for ArmLink with no hardware. Simulates the
    firmware's non-blocking ramp (SERVO_STEP_DEG every SERVO_STEP_MS) so the
    web UI behaves identically to the real board."""

    STEP_DEG = 3
    STEP_MS = 15

    def __init__(self, *_, **__):
        self.state = {"angles": list(HOME_POSE), "estop": 0, "mode": 0, "dist": 999}
        self._target = list(HOME_POSE)
        self._alive = True
        self.mock = True
        threading.Thread(target=self._ramp_loop, daemon=True).start()

    def set_all(self, base, grip, shoulder, elbow):
        self._target = [int(base), int(grip), int(shoulder), int(elbow)]

    def set_servo(self, ch, angle):
        if 0 <= ch < 4:
            self._target[ch] = int(angle)

    def home(self):    self._target = list(HOME_POSE)
    def estop(self):   self.state["estop"] = 1
    def release(self): self.state["estop"] = 0
    def request_state(self): pass
    def set_mode(self, joystick): self.state["mode"] = 1 if joystick else 0

    def _ramp_loop(self):
        while self._alive:
            if not self.state["estop"]:
                cur = self.state["angles"]
                for i in range(4):
                    diff = self._target[i] - cur[i]
                    if diff > self.STEP_DEG:    cur[i] += self.STEP_DEG
                    elif diff < -self.STEP_DEG: cur[i] -= self.STEP_DEG
                    else:                       cur[i] = self._target[i]
            time.sleep(self.STEP_MS / 1000.0)

    def close(self):
        self._alive = False


def open_arm(port=None, baud=115200):
    """Return a real ArmLink if a port is given and opens, else a MockArmLink."""
    if not port:
        print("No --port given: running in MOCK mode (no hardware).")
        return MockArmLink()
    try:
        return ArmLink(port, baud)
    except serial.SerialException as e:
        print(f"Could not open {port} ({e}); falling back to MOCK mode.")
        return MockArmLink()


def _cli(port, baud):
    link = open_arm(port, baud)
    print("Connected. Type commands (A/S/H/E/R/?) or 'q' to quit, 'st' for state.")
    try:
        while True:
            cmd = input("> ").strip()
            if cmd in ("q", "quit", "exit"):
                break
            if cmd == "st":
                print("  state:", link.state)
                continue
            if cmd:
                link.ser.write((cmd + "\n").encode("ascii"))
    except (KeyboardInterrupt, EOFError):
        pass
    finally:
        link.close()
        print("\nbye")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="STM32 arm serial tester")
    ap.add_argument("--port", default=None, help="serial port e.g. COM5 or /dev/ttyUSB0 (omit for mock)")
    ap.add_argument("--baud", type=int, default=115200)
    args = ap.parse_args()
    _cli(args.port, args.baud)
