# Complete hardware guide — exact parts, pinout & build-from-scratch

This is the authoritative hardware document for the project. Follow it top to
bottom and you go from a box of parts to every feature working: sliders,
trackpad, joystick, Bluetooth, emergency-stop, hand-follow, gesture, voice,
and blink-Morse **letter writing on paper**.

The firmware pins below are verified against `firmware/arm_control.c` v3.0.

---

## 1. Bill of materials (exact models)

### Core electronics

| # | Part | Exact model | Qty | ~₹ | Notes / accepted alternates |
|---|------|-------------|-----|----|------------------------------|
| 1 | Microcontroller board | **STM32F103C8T6 "Blue Pill"** (LQFP48, 64 KB flash, 72 MHz) | 1 | 250 | Buy one with a **genuine ST or GD32F103** chip. Avoid boards marked CS32/CH32 — flashing quirks. WeAct "BluePill-Plus" also fine. |
| 2 | Programmer | **ST-Link V2** USB dongle (aluminium stick clone) | 1 | 350 | Any ST-Link V2/V2-1 works; also used for debugging. |
| 3 | USB–serial | **CP2102 module** (6-pin: DTR/RX/TX/5V/3.3V/GND) | 1 | 150 | Alternate: CH340G module. Must expose **TX, RX, GND**. |
| 4 | Bluetooth | **HC-05 on ZS-040 carrier board** (6-pin: STATE/RX/TX/GND/VCC/EN) | 1 | 300 | Alternate: HC-06 (slave-only — fine for this project). |
| 5 | Ultrasonic sensor | **HC-SR04** | 1 | 90 | Alternate: HC-SR04+ (3.3 V native — then no divider question at all). |
| 6 | Joystick | **KY-023 dual-axis joystick module** (VRx/VRy/SW) | 1 | 90 | Any 10 kΩ analog thumb-stick module. |
| 7 | Webcam | **Logitech C270 HD (720p)** | 1 | 1500 | Any 720p USB UVC webcam works; skip if your laptop has one. |

### Actuation & mechanics

| # | Part | Exact model | Qty | ~₹ | Notes |
|---|------|-------------|-----|----|-------|
| 8 | Base + shoulder servos | **TowerPro MG996R** (metal gear, 9.4–11 kg·cm) | 2 | 500 | These joints carry the arm's weight. Genuine TowerPro or "Tiankongrc MG996R". |
| 9 | Elbow + gripper servos | **TowerPro MG90S** (metal gear micro, 2.2 kg·cm) | 2 | 300 | SG90 works but strips gears fast — MG90S is worth it. |
| 10 | Arm frame kit | **4-DOF acrylic robot-arm kit** (MeArm-style / "SNAM" series) | 1 | 1200 | Two common variants: micro-servo MeArm clones (all 4 = MG90S) or the larger acrylic kits with MG996R base+shoulder mounts. Either works — you will **measure L1/L2 and enter them in `config.js`**; the app's compatibility panel re-validates letter writing for your exact geometry. |
| 11 | Pen | any lightweight ballpoint/gel pen | 1 | 20 | Zip-tied or gripped vertically in the gripper. |

### Power (do not skimp here — 90 % of servo-arm problems are power)

| # | Part | Exact model | Qty | ~₹ | Notes |
|---|------|-------------|-----|----|-------|
| 12 | Servo supply | **5 V 5 A SMPS adapter** (e.g. Mean Well GST25U05 / generic 5V5A with DC jack) | 1 | 500 | 4 servos can stall-peak > 4 A combined. USB power **cannot** run them. |
| 13 | DC jack adapter | Female barrel-jack to screw-terminal | 1 | 30 | To break the supply out to the rail. |
| 14 | Bulk capacitors | **1000 µF / 16 V electrolytic** | 2 | 40 | Across the servo 5 V rail — kills brown-out resets. |
| 15 | Decoupling | 100 nF ceramic | 4 | 10 | One near each servo connector. |

### Wiring & misc

| # | Part | Qty | ~₹ |
|---|------|-----|----|
| 16 | Breadboard 830-point | 1 | 120 |
| 17 | Dupont jumpers M-M / M-F / F-F (40 each) | 3 sets | 200 |
| 18 | Resistors: 1 kΩ ×5, 2 kΩ ×5 (¼ W) | 1 lot | 30 |
| 19 | Zip ties, double-sided tape, screws | — | 100 |

**Total ≈ ₹5,800** — comfortably inside the ₹8–10k budget with margin for a
sturdier arm kit or spare servos.

### Tools needed
Small Phillips screwdriver set, wire cutter/stripper, multimeter (strongly
recommended), optionally a soldering iron (Blue Pill headers usually come
pre-soldered; solder them if not).

---

## 2. Power architecture (read before wiring)

```
 5V 5A SMPS ──┬────────────────────────────► Servo V+ rail (red wires ×4)
              │        + 2×1000µF across rail
              ├────────────────────────────► HC-SR04 VCC (5V)
              ├────────────────────────────► HC-05 VCC (5V, ZS-040 has onboard reg)
              └──► Blue Pill "5V" pin (feeds its onboard 3.3V regulator)

 Blue Pill 3.3V pin ───────────────────────► KY-023 joystick VCC   (⚠ see below)

 ALL GROUNDS COMMON: SMPS GND ↔ Blue Pill GND ↔ every module GND ↔ servo browns
```

Three rules that prevent dead boards:

1. **Common ground everywhere.** Servos, sensors, SMPS, Blue Pill, USB-TTL —
   one ground net. Without it, signals are meaningless and pins die.
2. **Joystick VCC must be 3.3 V, not 5 V.** PA4/PA5 are analog pins and are
   **not 5-volt-tolerant** on the F103. Powered at 3.3 V the KY-023 outputs
   0–3.3 V — exactly the ADC's range. (Firmware expects full-scale = VCC.)
3. **Never power servos from the Blue Pill's 5 V/3.3 V pins.** The board's
   regulator supplies ~100 mA; one servo twitch will brown it out.

5-V-tolerance cheat-sheet for the pins we use: `PA9, PA10, PB6` **are**
5 V-tolerant; `PA0–PA7, PB0` are **not**.

---

## 3. Master pin map — every wire

### STM32 Blue Pill connections

| STM32 pin | Peripheral (firmware) | Connects to | Wire note |
|-----------|----------------------|-------------|-----------|
| **PA0** | TIM2_CH1 PWM | Base servo — signal (orange/yellow) | |
| **PA1** | TIM2_CH2 PWM | Gripper servo — signal | |
| **PA2** | TIM2_CH3 PWM | Shoulder servo — signal | |
| **PA3** | TIM2_CH4 PWM | Elbow servo — signal | |
| **PA4** | ADC1_IN4 | Joystick **VRx** | joystick VCC = **3.3 V** |
| **PA5** | ADC1_IN5 | Joystick **VRy** | |
| **PA9** | USART1 TX | USB-TTL **RX**  *or*  HC-05 **RXD** | 3.3 V signal — direct, no divider needed |
| **PA10** | USART1 RX | USB-TTL **TX**  *or*  HC-05 **TXD** | PA10 is 5 V-tolerant |
| **PB0** | GPIO output | HC-SR04 **TRIG** | 3.3 V trigger is accepted by HC-SR04 |
| **PB6** | TIM4_CH1 input-capture | HC-SR04 **ECHO** | PB6 is 5 V-tolerant → direct is safe. For extra safety use 1 kΩ series + 2 kΩ to GND divider. |
| **5V** | — | 5 V rail from SMPS | powers the onboard 3.3 V regulator |
| **3.3V** | — | Joystick VCC | |
| **GND** (any) | — | Common ground rail | use at least 2 ground wires |
| **SWDIO / SWCLK / 3.3V / GND** (4-pin end header) | SWD | ST-Link V2 (SWDIO→SWDIO, SWCLK→SWCLK, GND→GND, 3.3V→3.3V) | flashing only |
| **BOOT0 jumper** | — | position **0** | normal run mode |

### Servo connectors (standard 3-pin)

| Servo wire | Goes to |
|------------|---------|
| Brown / black (GND) | Common ground rail |
| Red (V+) | 5 V servo rail (SMPS) — **not** the Blue Pill |
| Orange / yellow (signal) | PA0/PA1/PA2/PA3 per the table above |

### HC-SR04 (4 pins)

| HC-SR04 | Goes to |
|---------|---------|
| VCC | 5 V rail |
| TRIG | PB0 |
| ECHO | PB6 (direct, or via 1 kΩ series + 2 kΩ-to-GND divider) |
| GND | common ground |

### HC-05 ZS-040 (use the middle 4 of the 6 pins)

| HC-05 | Goes to |
|-------|---------|
| VCC | 5 V rail |
| GND | common ground |
| TXD | PA10 |
| RXD | PA9 |
| EN / STATE | leave unconnected |

> HC-05 and the USB-TTL share USART1 — connect **one at a time**.

### KY-023 joystick (5 pins)

| KY-023 | Goes to |
|--------|---------|
| +5V (VCC) | **3.3 V** pin of Blue Pill  ⚠ not 5 V |
| VRx | PA4 |
| VRy | PA5 |
| SW | unused (leave open) |
| GND | common ground |

### CP2102 USB-TTL

| CP2102 | Goes to |
|--------|---------|
| TX | PA10 |
| RX | PA9 |
| GND | common ground |
| 5V/3V3 | leave unconnected (board is powered by the SMPS) |

---

## 4. Build from scratch — step by step

Each phase ends with a checkpoint. Don't move on until it passes.

### Phase 0 — bench-test every servo (15 min, saves hours)
1. Before any assembly, wire ONE servo: brown→GND rail, red→5 V rail,
   signal→PA0. Power the SMPS, power the Blue Pill.
2. Flash the firmware (Phase 3 below explains how) or use a servo tester.
3. Send `S 0 90` then `S 0 0` then `S 0 180` over serial — the horn should
   sweep smoothly with no chatter. Repeat for all four servos.
   ✅ **Checkpoint:** all 4 servos sweep cleanly.

### Phase 1 — mechanical assembly
1. **Centre every servo to 90° BEFORE screwing on horns** (`S <ch> 90`).
   An off-centre servo assembled into the frame = instant mechanical limits.
2. Assemble the arm kit per its manual: base turntable (MG996R), shoulder
   (MG996R), elbow (MG90S), gripper (MG90S).
3. Route servo cables down the arm with zip ties, slack at each joint.
4. Mount the pen in the gripper pointing straight down; zip-tie if slippery.
5. Mount the arm on a board/heavy base; tape the paper strip in front,
   near edge ≈ **17 cm** from the base rotation axis (this matches
   `PAPER.dist=173` — adjust config later to your real measurement).
   ✅ **Checkpoint:** arm stands rigid; all joints move freely by hand
   (power off) without cable snags.

### Phase 2 — power rail
1. Screw the SMPS into the barrel-jack terminal. Build the 5 V and GND rails
   on the breadboard; add both 1000 µF caps across them (mind polarity!).
2. Wire all 4 servo reds to the 5 V rail, browns to GND rail.
3. Wire Blue Pill `5V`→rail 5 V, `GND`→rail GND.
4. Multimeter check: 5 V rail = 4.9–5.2 V; Blue Pill `3.3V` pin = 3.2–3.4 V.
   ✅ **Checkpoint:** voltages correct, nothing warm.

### Phase 3 — flash the firmware
1. Install **STM32CubeIDE** (free). New STM32 project → part number
   `STM32F103C8`. (Or use Keil µVision — the code is plain CMSIS either way.)
2. Copy `firmware/config.h` and `firmware/arm_control.c` into the project
   (replace the generated `main.c`). The code needs only CMSIS headers +
   the standard `SystemInit()` that sets 72 MHz — CubeIDE provides both.
3. Review **`config.h`** — for a MeArm-class kit the defaults are fine.
4. Connect ST-Link to the SWD header (SWDIO, SWCLK, 3.3V, GND). BOOT0 = 0.
5. Build → Run. If flashing fails with a clone board, use "Connect under
   reset" in the debugger settings.
6. Connect the CP2102 (TX→PA10, RX→PA9, GND→GND), open a 115200-baud
   terminal (or `python host/arm_link.py --port COMx`).
   ✅ **Checkpoint:** board prints `READY v3.0`; `P` answers `PONG`;
   `I` answers `INFO v3.0 servos 4`; `H` moves the arm to home.

### Phase 4 — calibrate (no reflashing needed)
1. Per servo: `S <ch> 0` and `S <ch> 180`. If the horn doesn't reach the true
   mechanical end (or buzzes against it), tune pulse widths live:
   `C <ch> <minUs> <maxUs>` — e.g. `C 0 600 2400` — until 0°/90°/180° are true.
2. Write the final values into `SERVO_CAL_MIN_US/MAX_US` in `config.h` and
   set `SERVO_MIN_DEG/MAX_DEG` to protect joints that must not reach 0/180.
   Reflash once.
3. Set a gentle speed while testing: `V 2`.
   ✅ **Checkpoint:** commanded angles match a protractor within ~2–3°.

### Phase 5 — sensors
1. **Joystick:** wire per pin map (VCC→3.3 V!). Send `J 1` — stick now drives
   base + shoulder; sliders are rejected with `BUSY`. `J 0` returns control.
2. **HC-SR04:** wire per pin map. Watch telemetry (`?` or the stream):
   last field is distance in cm. Put your hand 5 cm from it mid-move —
   the arm must freeze (auto e-stop). `R` releases.
   ✅ **Checkpoint:** joystick teleop works; waving a hand < 10 cm freezes
   the arm and telemetry shows `estop=1`.

### Phase 6 — Bluetooth
1. Disconnect the CP2102 from PA9/PA10; connect HC-05 per pin map.
2. Pair from your phone (PIN `1234` or `0000`). In a Serial Bluetooth
   Terminal app send `H`, `S 0 120`, `E`, `R` — identical protocol.
3. Optional: install the app from `docs/ArmControl.aia` (see
   `docs/bluetooth_app.md`).
   ✅ **Checkpoint:** phone drives the arm wirelessly.

### Phase 7 — connect the web app & write letters
1. Reconnect the CP2102 (or keep HC-05 and note its COM port).
2. `cd host && pip install -r requirements.txt && python server.py --port COMx`
3. Open http://localhost:8000 — badge shows **STM32 LIVE**.
4. **Measure your real arm** and update `host/web/js/config.js` → `ARM`
   (L1 = shoulder→elbow mm, L2 = elbow→pen-mount mm, shoulderH = shoulder
   height above table, penLen = pen-mount→tip) and `PAPER` (strip size and
   distance). Reload — the **Hardware compatibility panel must say PASS**.
   If it fails it tells you exactly what to change (move paper closer,
   bigger letters, etc.).
5. Type `write HI` in the AI console. The sim arm and the real arm execute
   the same angle stream — the pen writes block capitals on the strip.
6. Try every mode: Trackpad, Hand-Follow, Gesture, Blink-Morse, Voice.
   ✅ **Checkpoint:** the physical pen draws legible letters matching the
   on-screen ink.

---

## 5. Full-system test checklist

- [ ] `READY v3.0` on boot, `P`→`PONG`
- [ ] All 4 servos reach true 0/90/180 after calibration
- [ ] Home pose (`H`) is mechanically safe
- [ ] E-stop freezes mid-motion (command `E` and ultrasonic < 10 cm)
- [ ] Link-loss failsafe (optional: set `FAILSAFE_MS 2000` and unplug serial)
- [ ] Joystick mode `J 1` / `J 0`
- [ ] Phone control over HC-05
- [ ] Web UI LIVE badge + sliders + trackpad
- [ ] Compatibility panel PASS with **your measured** config values
- [ ] `write HI` → legible letters on paper
- [ ] Hand-follow mirrors your hand; gestures trigger actions
- [ ] Blink-Morse writes each decoded letter

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Board resets when servos move | Brown-out — servos on Blue Pill power or missing bulk caps | Servos on SMPS rail only; add the 1000 µF caps |
| Servo buzzes at end of travel | Pulse range too wide | Narrow with `C ch min max`; set deg limits in `config.h` |
| Garbage on serial | Baud mismatch or missing common GND | 115200-8N1; tie grounds |
| `BUSY` on `A`/`S` | Joystick mode active | Send `J 0` |
| Distance always 999 | ECHO wiring / divider wrong | Check PB6, TRIG on PB0, 5 V on sensor |
| Arm freezes randomly | Ultrasonic false trigger (sensor sees the arm) | Aim sensor away from arm's path or raise `OBSTACLE_CM` guard band |
| Letters distorted on paper | `ARM`/`PAPER` mm in `config.js` don't match reality | Re-measure; watch the compatibility panel |
| Letters too wobbly | Speed too high / slop in joints | `V 2`, tighten horns, MG996R on base+shoulder |
| Flash fails on clone board | Not a genuine F103 | "Connect under reset"; or replace with genuine/GD32 board |
| Hand/gesture tabs error | No camera permission or no internet (first model download) | Allow camera; connect internet once |

---

## 7. Wiring diagram (logical)

```
                          ┌──────────────────────────┐
        ST-Link V2 ──SWD──┤ STM32F103C8T6 (Blue Pill) │
                          │                          │
   Base servo sig ◄───────┤ PA0            PA9  ├────────► HC-05 RXD / CP2102 RX
   Gripper sig    ◄───────┤ PA1            PA10 ◄────────  HC-05 TXD / CP2102 TX
   Shoulder sig   ◄───────┤ PA2                       │
   Elbow sig      ◄───────┤ PA3            PB0  ├────────► HC-SR04 TRIG
   Joystick VRx   ────────► PA4            PB6  ◄────────  HC-SR04 ECHO (5V-tol.)
   Joystick VRy   ────────► PA5                       │
                          │ 5V ◄── SMPS 5V rail       │
   Joystick VCC   ◄───────┤ 3.3V                      │
                          │ GND ◄── COMMON GROUND ────┼── SMPS GND, all modules,
                          └──────────────────────────┘    all servo browns

   SMPS 5V rail (+2×1000µF) ──► servo reds ×4, HC-SR04 VCC, HC-05 VCC
```

Print section 3 and tick each wire as you connect it.
