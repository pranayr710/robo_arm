# Component lists — reference

Two builds side by side:
1. **The YouTube tutorials** (Kit4Curious — the arm you're buying)
2. **Our project** (STM32F401 + PC vision/AI)

> Note: YouTube blocked full video-description scraping, so list (1) is
> compiled from the Kit4Curious kit documentation, the video titles, and their
> published control methods. Core items are certain; "variant" items appear
> across their different control tutorials. Confirm servo model on the label.

---

## 1. Components in the videos (Kit4Curious build)

### Video 2 — "Curious Arm Assembling tutorial" (mechanical assembly)

| # | Component | Model / spec | Qty | Purpose |
|---|-----------|--------------|-----|---------|
| 1 | Robotic-arm kit frame | Kit4Curious "Curious Arm" — laser-cut acrylic, 4-DOF, gripper (ASIN B07R6SWCM7 / B07D5TVNQZ) | 1 | mechanical structure |
| 2 | Servo motor | **TowerPro SG90** (9 g, plastic gear, 180°, 4.8–6 V, ~1.8 kg·cm) | 4 | base, shoulder, elbow, gripper |
| 3 | Fasteners | M3 nuts / bolts / screws (in kit) | set | assembly |
| 4 | Servo horns | single-arm horns (in kit) | 4 | joint couplings |

*(This video is assembly only — no electronics.)*

### Video 1 — "Servo Robotic arm PC Control Complete Tutorial"

| # | Component | Model / spec | Qty | Purpose |
|---|-----------|--------------|-----|---------|
| 5 | Microcontroller board | **Arduino UNO R3** (ATmega328P) — or Arduino Nano | 1 | drives the servos |
| 6 | USB cable | USB-A to USB-B (Uno) | 1 | program + serial to PC |
| 7 | Servos | 4× TowerPro SG90 (same as above) | 4 | — |
| 8 | Jumper wires | male–female Dupont | ~12 | servo signal/power to Arduino |
| 9 | PC software | Kit4Curious "Curious Arm" PC app (serial) | — | on-screen sliders → serial → arm |
| 10 | Power | Arduino 5 V (or optional external 5 V adapter) | 1 | servo power |

### Kit4Curious control variants (across their other tutorials)

| Component | Model / spec | Qty | Used in variant |
|-----------|--------------|-----|-----------------|
| Potentiometer | 10 kΩ linear | 4 | manual pot control |
| Joystick module | KY-023 (dual-axis) | 2 | joystick control |
| Bluetooth module | **HC-05** | 1 | Android-app control |
| Android app | Kit4Curious BT app / MIT App Inventor | — | phone control |
| Breadboard | 400/830-point | 1 | prototyping |

**Summary of their approach:** Arduino UNO + 4× SG90, controlled by
potentiometers / joysticks / a PC serial app / or HC-05 Bluetooth + phone app.
Straightforward direct servo control — no vision, no kinematics, no writing.

---

## 2. Components for our project (STM32F401 build)

### Controller & programming

| # | Component | Model / spec | Qty | ~₹ | Notes |
|---|-----------|--------------|-----|----|-------|
| 1 | Microcontroller | **STM32F401CCU6 "Black Pill"** (WeAct) — Cortex-M4 @84 MHz, 256 KB flash, 64 KB RAM, USB-C | 1 | 450 | project-required board |
| 2 | USB cable | USB-C | 1 | (have) | power + DFU flashing |
| 3 | Programmer (optional) | **ST-Link V2** (clone) | 1 | 350 | optional — Black Pill flashes via USB DFU |

### Arm & actuation (from the Kit4Curious kit)

| # | Component | Model / spec | Qty | ~₹ | Notes |
|---|-----------|--------------|-----|----|-------|
| 4 | Arm frame + servos | Kit4Curious Curious Arm + 4× SG90 + screws | 1 | (buying) | covered by your purchase |
| 5 | Pen | light ballpoint / gel pen | 1 | 20 | held in gripper for writing |

### Power

| # | Component | Model / spec | Qty | ~₹ | Notes |
|---|-----------|--------------|-----|----|-------|
| 6 | Power supply | **5 V 3 A SMPS** adapter, 5.5×2.1 mm DC jack | 1 | 350 | 3 A ample for 4× SG90 (5 A optional) |
| 7 | DC jack breakout | female barrel jack → screw terminal | 1 | 30 | rail connection |
| 8 | Buck converter (optional) | **LM2596** module | 1 | 120 | only if using a >5 V source |
| 9 | Bulk capacitor | 1000 µF / 16 V electrolytic | 2 | 40 | across the 5 V rail (anti-brownout) |
| 10 | Decoupling capacitor | 100 nF ceramic | 4 | 10 | one per servo |

### Communication

| # | Component | Model / spec | Qty | ~₹ | Notes |
|---|-----------|--------------|-----|----|-------|
| 11 | USB–serial | **CP2102** module (6-pin) | 1 | 150 | PC link for all vision/AI features |
| 12 | Bluetooth | **HC-05** (ZS-040 carrier) | 1 | 300 | wireless / phone app |
| 13 | WiFi (optional) | **ESP-01 (ESP8266)** | 1 | 150 | optional future scope; shares USART1 |

### Sensors / control input

| # | Component | Model / spec | Qty | ~₹ | Notes |
|---|-----------|--------------|-----|----|-------|
| 14 | Joystick | **KY-023** dual-axis module | 1 | 90 | wired teleop → PA4/PA5 (VCC = 3.3 V!) |
| 15 | Ultrasonic sensor | **HC-SR04** | 1 | 90 | emergency-stop → PB0/PB6 |

### Vision (AI features)

| # | Component | Model / spec | Qty | ~₹ | Notes |
|---|-----------|--------------|-----|----|-------|
| 16 | Webcam | laptop built-in (or any 720p USB UVC, e.g. Logitech C270) | 1 | (have) | hand-follow / gesture / blink writing |

### Wiring & misc

| # | Component | Model / spec | Qty | ~₹ | Notes |
|---|-----------|--------------|-----|----|-------|
| 17 | Breadboard | 830-point | 1 | 120 | connections |
| 18 | Jumper wires | Dupont M-M / M-F / F-F | 40 ea | 200 | wiring |
| 19 | Resistors | 1 kΩ ×5, 2 kΩ ×5 (¼ W) | lot | 30 | 5 V→3.3 V dividers |

**New-purchase total (excl. arm kit & webcam): ≈ ₹1,900** (₹2,270 with optional
ST-Link, ₹2,420 with the ESP-01 WiFi option).

---

## 3. Key differences

| Aspect | Videos (Kit4Curious) | Our project |
|--------|----------------------|-------------|
| Brain | Arduino UNO (8-bit, 16 MHz) | STM32F401 (32-bit M4, 84 MHz) |
| Control | pots / joystick / PC app / BT app | web UI + hand-follow + gesture + voice + AI console + blink writing + joystick + BT |
| Intelligence | none (direct angle) | inverse kinematics, computer vision, AI |
| Writing | no | real block-letter writing on paper |
| Safety | none | ultrasonic e-stop + link-loss failsafe |
| Wireless | HC-05 Bluetooth | HC-05 (+ optional ESP-01 WiFi) |
| Same parts | arm frame, 4× SG90 servos, HC-05, joystick | same |
