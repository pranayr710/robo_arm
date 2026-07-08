# 🤖 STM32-Based 4-DOF Robotic Arm

An embedded systems project implemented in C using the **STM32F103C8T6 (Blue Pill)** microcontroller to control a 4-DOF servo-actuated robotic arm.

> **v2 upgrade** — the arm is now *reactive* instead of pre-scripted. See
> [System v2](#-system-v2--reactive-arm) below. The original scripted demos
> (`object.c`, `write.c`) are kept for reference.

Capabilities:

- Real-time **hand-follow** (webcam → arm mirrors your hand)
- **Gesture control** (✊✋👍✌️) and **voice control** ("write hello", "wave", "home")
- **AI assistant console** — natural-language commands → arm actions
- **Eye-blink Morse** → the arm writes the message on paper (for paralysed users)
- **Web UI** to visualize + control the arm; **routines** (wave / pick / scan)
- **Bluetooth** (HC-05) + **analog joystick** teleop
- **Ultrasonic emergency-stop** + link-loss failsafe
- **Hardware-agnostic firmware** — set servo count, pins, calibration & limits in `config.h`
- Original: pick-and-place, alphabet writing, smooth PWM motion

---

## 🚀 System v2 — reactive arm

Two tiers: the STM32 is a fast, safe *servo server*; all vision/planning runs
on a host PC that streams simple serial commands.

```
firmware/config.h        Hardware config: servo count, pins, calibration, limits, toggles.
firmware/arm_control.c   Non-blocking firmware: TIM3 1kHz loop, IRQ UART command
                         server, joystick ADC, HC-SR04 e-stop, failsafe, telemetry.
host/server.py           Serves the web app + optional serial bridge to the STM32.
host/arm_link.py         Serial link (real + mock arm).
host/web/index.html      The UI shell (cards, tabs, styles).
host/web/js/config.js    All browser-side tunables (geometry, maps, timings).
host/web/js/arm.js       ArmModel — source of truth: servo angles, ramp, FK/IK.
host/web/js/renderer.js  Canvas scene (arm + paper + marks), robust frame loop.
host/web/js/plotter.js   Pen-plotter writing engine (Morse marks on paper).
host/web/js/vision.js    Webcam + MediaPipe: hand-follow, gesture, blink detect.
host/web/js/routines.js  Choreography (wave / pick / nod / scan / home).
host/web/js/nlp.js       Natural-language command understanding.
host/web/js/voice.js     Web Speech API voice control.
host/web/js/morse.js     Morse encode/decode + accumulator.
host/web/js/bridge.js    Throttled WebSocket link to the server/STM32.
host/web/js/app.js       Wires everything + UI.
docs/HARDWARE.md         ★ Exact part models, every pin connection, build-from-scratch guide.
docs/BUILD_PLAN.md       Bill of materials (₹8–10k) + hardware bring-up steps.
docs/wiring.md           Pin map + wiring + safety.  docs/bluetooth_app.md  HC-05 phone app.
docs/demo_runbook.md     Click-by-click demo order.  PROTOCOL.md  serial protocol.
```

(Python `hand_tracker.py` / `blink_morse.py` / `writer.py` / `morse.py` remain
as an alternative host-side path; the browser app above is the primary one.)

### Run it

```bash
cd host
pip install -r requirements.txt          # add mediapipe for camera features

python server.py                         # MOCK mode (no hardware) → http://localhost:8000
python server.py --port COM5             # real arm over USB-TTL / HC-05

python hand_tracker.py                   # standalone hand-follow demo
python blink_morse.py                    # standalone eye-blink Morse writer
```

Flash `firmware/arm_control.c` to the Blue Pill exactly like the original code
(STM32CubeIDE + ST-Link; relies on the standard CMSIS 72 MHz `SystemInit()`).

---

## 📁 Repository Structure

```
Robotic-arm/
├── object.c              # Pick-and-place control logic
├── write.c               # Alphabet writing (trajectory control)
├── poster.pdf            # Academic project poster
├── es_project_video.mp4  # Demo video
└── README.md             # Project documentation
```

---

## 📖 Project Overview

This project implements a servo-controlled robotic arm using hardware-level register programming on the STM32 platform.

The system:
- Generates **50 Hz PWM signals** using Timer2
- Controls **4 servo motors** (Base, Shoulder, Elbow, Gripper)
- Implements **smooth movement** using incremental angle transitions
- Demonstrates **object manipulation** and **handwriting automation**

This project demonstrates core embedded concepts including:
- PWM (Pulse Width Modulation)
- Timer configuration
- Direct register programming
- Multi-servo coordination
- Motion sequencing algorithms

---

## ⚙️ Hardware Configuration

| Component | Description |
|-----------|-------------|
| Microcontroller | STM32F103C8T6 (Blue Pill) |
| Timer Used | TIM2 (4 PWM Channels) |
| Servo Motors | SG90 / MG90S |
| Channels Used | PA0–PA3 (TIM2 CH1–CH4) |
| Power Supply | External 5V (2A recommended) |
| Programmer | ST-Link V2 |

---

## 🔌 Servo Mapping

| Servo | Pin | Timer Channel | Function |
|-------|-----|---------------|----------|
| Base | PA0 | TIM2_CH1 | Horizontal rotation |
| Gripper | PA1 | TIM2_CH2 | Open/Close |
| Shoulder | PA2 | TIM2_CH3 | Vertical lift |
| Elbow | PA3 | TIM2_CH4 | Arm extension |

---

## ✍️ Functional Features

### 🔹 Pick and Place
- Base rotation control
- Shoulder & elbow coordinated motion
- Gripper open/close logic
- Smooth movement using incremental angle stepping

### 🔹 Alphabet Writing
- Trajectory-based motion control
- Coordinated base + shoulder motion
- Controlled pen lift and placement
- Demonstrated writing of letter **"A"**

---

## 🛠️ Software Architecture

### 1️⃣ PWM Initialization
- Timer2 configured at **50 Hz**
- Prescaler: `72`
- ARR: `20000`
- PWM Mode 1 enabled on all 4 channels

### 2️⃣ Servo Angle Conversion

```c
pulse = 350 + ((angle * 2300) / 180);
```

Converts angle (0–180°) to pulse width (µs).

### 3️⃣ Smooth Movement Logic

Gradual angle stepping for fluid motion:

```c
for(i = from; i <= to; i++)
    Servo_SetAngle(ch, i);
```

---

## 🚀 Getting Started

### Clone Repository

```bash
git clone https://github.com/navadeep555/Robotic-arm.git
cd Robotic-arm
```

### Flash to STM32

1. Open project in **STM32CubeIDE**
2. Connect **ST-Link V2** to your Blue Pill board
3. Build the project (`Project → Build All`)
4. Flash to board (`Run → Debug` or `Run → Run`)
5. Provide an **external 5V / 2A supply** to the servo motors

---

## 🎥 Demo

A demonstration video is included in the repository: [`es_project_video.mp4`](./es_project_video.mp4)

Shows:
- Pick-and-place operation
- Alphabet writing demonstration

---

## 📄 Project Poster

Academic documentation and system design overview: [`poster.pdf`](./poster.pdf)

Includes:
- Block diagram
- Hardware architecture
- Software flow
- Results and conclusions

---

## 📚 Learning Outcomes

This project demonstrates practical understanding of:
- Embedded C programming
- Direct hardware register manipulation
- PWM signal generation
- Real-time motion control
- Multi-servo synchronization
- Mechanical-electrical integration

---


## 📜 License

This project is developed for **academic purposes**. For commercial use, please contact the authors.

