# HASTHA — Run Guide (STM32F401 4-DOF Robotic Arm)

A complete, step-by-step guide to wire, flash, and run the three tasks:

- **Task 1** — IR detects an object → shows it on the display → ultrasonic measures distance → the arm computes the angle, **picks the object and places it** at a fixed drop position.
- **Task 2** — a **potentiometer** rotates the **base servo** (ADC 0–4095 mapped to 0–180°).
- **Task 3** — the **webcam** reads **eye-blink Morse code** and the arm **writes the letters** on paper.

> Firmware: `firmware/main.c` (Keil + CMSIS, bare-metal).
> Task-3 PC bridge: `host/task3_write.py` (Python).

---

## 0. Repository layout

```
firmware/
  main.c            <- the STM32F401 firmware (all 3 tasks, pick with ACTIVE_TASK)
  config.h          <- hardware config (older multi-feature firmware; main.c is self-contained)
host/
  task3_write.py    <- Task 3 PC bridge: webcam blink-Morse -> serial -> arm
docs/               <- component lists, wiring, case study, presentation
RUN_GUIDE.md        <- this file
```

---

## 1. Hardware you need

| Item | Used by |
|------|---------|
| STM32F401CCU6 "Black Pill" | all |
| ST-Link V2 (or USB-C DFU) | flashing |
| 4-DOF arm + 4× SG90 servos | all |
| Potentiometer (10 kΩ) | Task 2 |
| IR obstacle sensor | Task 1 |
| HC-SR04 ultrasonic | Task 1 |
| 16×2 I²C LCD (PCF8574) | Task 1 & 2 display *(see note)* |
| USB-to-Serial (CP2102) | Task 3 (PC link) |
| Laptop webcam | Task 3 |
| External **5 V** supply + 1000 µF cap | servo power |
| Breadboard, jumpers, resistors | wiring |

> **Display note:** the firmware prints status to a **16×2 I²C LCD**. If you don't connect one, the I²C calls will **hang**. Either connect an I²C LCD, or ask for the 7-segment/LED version of the display code.

---

## 2. Wiring (Black Pill pin map)

| Signal | Black Pill pin | Connect to |
|--------|----------------|------------|
| Base servo | **PA0** | base servo signal |
| Shoulder servo | **PA1** | shoulder servo signal |
| Elbow servo | **PA2** | elbow servo signal |
| Gripper servo | **PA3** | gripper servo signal |
| Potentiometer | **PA4** | pot wiper (ends → 3.3 V and GND) |
| Serial TX | **PA9** | USB-serial **RX** |
| Serial RX | **PA10** | USB-serial **TX** |
| Ultrasonic TRIG | **PB0** | HC-SR04 TRIG |
| Ultrasonic ECHO | **PB6** | HC-SR04 ECHO (via 1 kΩ + 2 kΩ divider) |
| IR sensor | **PB7** | IR module OUT |
| LCD SCL | **PB8** | I²C LCD SCL |
| LCD SDA | **PB9** | I²C LCD SDA |
| Status LED | **PC13** | onboard |
| Programmer | **PA13 / PA14** | ST-Link SWDIO / SWCLK |

Optional (only if you add the solar battery monitor):

| Signal | Black Pill pin | Connect to |
|--------|----------------|------------|
| Battery monitor | **PA5** (ADC1_IN5) | battery + via a 10 kΩ + 10 kΩ divider (enable `BATT_MON`) |

**Which pins each task uses:**

| Task | Pins involved |
|------|---------------|
| **Task 2** (pot → base) | PA4 (pot), PA0 (base servo), PB8/PB9 (LCD), PC13 |
| **Task 1** (pick & place) | PA0–PA3 (servos), PB7 (IR), PB0/PB6 (ultrasonic), PB8/PB9 (LCD), PC13 |
| **Task 3** (blink write) | PA0–PA3 (servos), PA9/PA10 (serial to PC), PC13 |

**Power rules (important):**
- Servo V+ (red), LCD VCC, HC-SR04 VCC → **external 5 V rail** (never the board's 5 V pin).
- Potentiometer VCC + IR sensor VCC → board **3.3 V** (PA4/PA5 are **not** 5 V-tolerant).
- **All grounds common:** external-supply GND ↔ board GND ↔ every module GND.
- Put a **1000 µF capacitor across the 5 V rail** (prevents servo brown-out resets).
- 5 V-tolerant pins we rely on: **PB6, PB7, PB8, PB9**. Not 5 V-tolerant: PA0–PA5.

**Reserved Black Pill pins we deliberately avoid:** PA11/PA12 (USB), PC14/PC15 (32 kHz crystal), PH0/PH1 (main crystal), PB2 (BOOT1), PB11 (not on the 48-pin package).

---

## 3. Part A — Build & flash the firmware (Keil)

1. Install **Keil µVision** (MDK-ARM) and the **STM32F4xx device pack**.
2. New project → device **STM32F401CCU6** → let Keil add the CMSIS core + startup file.
3. Add `firmware/main.c` to the project (remove any generated `main.c`).
4. **Choose the task** — open `main.c` and set the line near the top:
   ```c
   #define ACTIVE_TASK   2      // 1, 2 or 3
   ```
5. Build (**F7**). Connect ST-Link to the SWD pins (SWDIO=PA13, SWCLK=PA14, 3V3, GND).
   *(Alternative: flash over USB-C using DFU — hold BOOT0, use STM32CubeProgrammer.)*
6. Flash (**Load / F8**). On boot the LCD shows `HASTHA F401 / Booting...`.

> To switch tasks, change `ACTIVE_TASK`, rebuild, and flash again.

---

## 4. Part B — Running each task

### ▶ Task 2 — Potentiometer → base servo *(start here — simplest)*

1. Set `#define ACTIVE_TASK 2`, build, flash.
2. Power the servo rail (external 5 V).
3. **Turn the potentiometer** → the **base servo** rotates 0°→180°. The LCD shows `Base: <angle>`.

✔ This proves your ADC + PWM + wiring + power are all correct. Do this first.

---

### ▶ Task 1 — Auto pick-and-place

1. Set `#define ACTIVE_TASK 1`, build, flash. Wire the IR sensor, HC-SR04, LCD, and all 4 servos.
2. On boot the arm homes and the LCD shows `Waiting object..`.
3. **Place an object** in front of the IR sensor:
   - LCD → `Object detected`
   - LCD → `Dist: <cm>` (ultrasonic reading)
   - LCD → `Angle computed` + `Sh: <angle>`
   - Arm **opens gripper → reaches down → grasps → lifts → rotates to drop → releases → homes**.
4. Remove the object; it waits for the next one.

**Tuning (needed on first run)** — edit these in `main.c` and re-flash:
- `ARM_L1`, `ARM_L2`, `SHOULDER_H` — your arm's real link lengths (mm).
- `PICK_Z_MM` — gripper height at the table.
- `GRIP_OPEN`, `GRIP_CLOSE` — gripper angles that open/close on your object.
- `BASE_FORWARD`, `BASE_DROP` — where the object is vs where to drop it.

> Task 1 assumes the object is **in front** of the arm; distance → reach angle (base fixed forward). It's tuned for a light object in a defined zone.

---

### ▶ Task 3 — Blink Morse → write letters *(PC + arm)*

This task uses the PC bridge `host/task3_write.py` talking to the firmware over USB-serial.

#### Step 1 — Flash the firmware for Task 3
Set `#define ACTIVE_TASK 3`, build, flash. On boot it prints `READY` on serial and waits.

#### Step 2 — Install PC dependencies
```bash
pip install pyserial opencv-python mediapipe numpy
```

#### Step 3 — Find your serial (COM) port
- Windows: Device Manager → "Ports (COM & LPT)" → note the CP2102 port, e.g. `COM5`.
- Connect the USB-serial: its **TX→PA10**, **RX→PA9**, **GND→GND**.

#### Step 4 — Test the logic first (no arm, no camera)
```bash
cd host
python task3_write.py --dry --text "HI"
```
You should see `A base shoulder elbow gripper` lines printed. No errors = logic OK.

#### Step 5 — Calibrate the arm to the paper
```bash
python task3_write.py --port COM5 --mode cal
```
- Type angles as `base shoulder elbow grip` (0–180), press Enter; the arm moves. `h` = home, `q` = quit.
- Find and note:
  - **`GRIP_HOLD`** — the gripper angle that firmly holds the pen.
  - The **pen-DOWN pose** — where the pen tip just touches the paper.
- Put your values into the **TUNE block** at the top of `task3_write.py`:
  `ARM_L1/L2/SHOULDER_H/PEN_LEN`, `PAPER_FWD`, `PAPER_LEFT`, `LETTER_H`, `GRIP_HOLD`, and the `SH_OFFSET/EL_OFFSET/SIGN` trims.

#### Step 6 — Test writing typed text on the real arm
```bash
python task3_write.py --port COM5 --mode text --text "HELLO"
```
Watch the pen trace the letters. Adjust the TUNE values until letters look right (they'll be block capitals).

#### Step 7 — Full feature: blink Morse
```bash
python task3_write.py --port COM5 --mode blink
```
A webcam window opens:
- **Short blink = dot (.)**, **long blink = dash (-)**
- **Pause** = end of a letter, **longer pause** = end of word → the arm **writes the word**
- Press **q** to quit.

Morse reference: `. - A`, `- ... B`, `... S`, `--- O`, `.... H`, `.. I`, etc.

---

## 5. Quick command reference (Task 3 PC bridge)

| Command | What it does |
|---------|--------------|
| `python task3_write.py --dry --text "HI"` | print commands, no hardware |
| `python task3_write.py --port COM5 --mode cal` | jog the arm to calibrate |
| `python task3_write.py --port COM5 --mode text --text "HELLO"` | write typed text |
| `python task3_write.py --port COM5 --mode blink` | webcam blink-Morse writing |

Serial protocol (what the PC sends to the F401): `A <base> <shoulder> <elbow> <gripper>\n`, and `H\n` to home.

---

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Board resets when servos move | Servos must be on the **external 5 V**, not the board; add the 1000 µF cap |
| Program freezes at boot | I²C LCD not connected (I²C call hangs) — connect the LCD, or use the 7-seg version |
| LCD blank / garbled | Try LCD address `0x3F` instead of `0x27` (`LCD_ADDR` in `main.c`); check SDA/SCL on PB9/PB8 |
| Servo jitters / wrong angle | Tune pulse range / `GRIP_*`; power supply too weak |
| Garbage on serial | Baud must be **115200**, and share a common ground |
| `ultrasonic` always 999 | Check TRIG on PB0, ECHO on PB6 via divider, VCC = 5 V |
| Task 3 "could not open COM5" | Wrong port — check Device Manager; close any other program using it |
| Task 3 arm not moving | Flash must be `ACTIVE_TASK 3`; TX↔RX not crossed (PA9↔serial RX, PA10↔serial TX) |
| Letters distorted | Re-run `--mode cal`; adjust `ARM_*`, `PAPER_*`, `SH_OFFSET/EL_OFFSET` |
| Blinks not detected | Better lighting; lower `EAR_THRESH`; adjust `DOT_MAX`/gap timings |

---

## 7. Notes & honest limits

- The firmware register setup is written for the F401 but **tune the marked constants on your hardware** — especially Task 1's IK poses and Task 3's geometry.
- With SG90 servos (open-loop), written letters are **legible block capitals**, not neat handwriting, and pick-and-place works best for a **light object in a defined zone**.
- Recommended bring-up order: **Task 2 → Task 1 → Task 3.**
