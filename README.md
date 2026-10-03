# HASTHA — STM32F401 4-DOF Robotic Arm

An embedded systems project on the **STM32F401CCU6 (Black Pill)**, programmed in
**Keil + CMSIS (C)**. A 4-DOF servo arm with three features:

- **Task 1 — Auto pick & place:** an IR sensor detects an object → shows the status
  (serial monitor + LED, optional 7-segment) → HC-SR04 measures the distance → the
  arm computes the angle, picks the object and places it at a fixed position.
- **Task 2 — Potentiometer control:** a potentiometer rotates the base servo
  (ADC 0–4095 mapped to 0–180°).
- **Task 3 — Blink-to-write:** a laptop webcam reads **eye-blink Morse code** and
  the arm **writes the letters** on paper.

## What runs where

| Code | Language | Runs on |
|------|----------|---------|
| `firmware/main.c` | **C (Keil/CMSIS)** | the STM32F401 chip — all 3 tasks |
| `firmware/servo_90_test.c` | C | the chip — standalone servo test |
| `host/task3_write.py` | Python | the **laptop** — Task 3 webcam/blink only* |

\* A microcontroller cannot run a webcam or vision, so Task 3's blink detection
runs on the PC (Python + OpenCV/MediaPipe) and sends simple serial commands to
the C firmware, which moves the arm. All embedded logic is C.

## Repository layout

```
firmware/
  main.c              STM32F401 firmware - pick the task with ACTIVE_TASK (1/2/3)
  servo_90_test.c     standalone 4-servo PWM test
host/
  task3_write.py      Task 3 PC bridge (webcam blink-Morse -> serial -> arm)
  requirements.txt    Python deps for task3_write.py
docs/                 components list, case study, presentation, block diagram
RUN_GUIDE.md          full setup, wiring, pin config, per-task run steps
```

## Getting started

See **[RUN_GUIDE.md](RUN_GUIDE.md)** for the complete, step-by-step guide:
hardware, wiring, the full pin configuration, flashing in Keil, and how to run
and calibrate each task.

Quick path: flash `firmware/main.c` with `#define ACTIVE_TASK 2`, wire the
potentiometer and base servo, and turn the knob — the base follows.
