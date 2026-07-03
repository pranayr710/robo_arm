# Build plan — hardware bring-up & bill of materials

Everything is written so that when the parts arrive you flash once, calibrate,
and every feature works. The software is hardware-agnostic: all hardware
specifics live in `firmware/config.h` and `host/web/js/config.js`.

## 1. Bill of materials (target ₹8–10k)

| # | Part | Qty | ~₹ | Notes |
|---|------|-----|----|-------|
| 1 | STM32F103C8T6 "Blue Pill" | 1 | 250 | you have one; keep a spare |
| 2 | 4-DOF robot-arm kit (acrylic/metal) | 1 | 1200 | base, shoulder, elbow, gripper |
| 3 | MG996R servo (base + shoulder) | 2 | 500 | higher torque for the heavy joints |
| 4 | MG90S / SG90 servo (elbow + gripper) | 2 | 300 | lighter joints |
| 5 | 5V 5A SMPS + LM2596 buck | 1 | 500 | **servo power — not the Blue Pill 5V pin** |
| 6 | HC-05 Bluetooth module | 1 | 300 | wireless + phone control |
| 7 | USB–TTL (CP2102/CH340) | 1 | 150 | PC serial for dev + camera features |
| 8 | Analog joystick module | 1 | 90 | wired teleop |
| 9 | HC-SR04 ultrasonic | 1 | 90 | emergency-stop sensor |
| 10 | USB webcam 720p | 1 | 900 | hand-follow / gesture / blink (skip if laptop has one) |
| 11 | ST-Link V2 | 1 | 350 | flashing |
| 12 | Breadboard, jumpers, resistors (dividers) | — | 400 | wiring + 5V→3.3V dividers |
| | **Total** | | **≈4,730** | buffer left for a sturdier arm/extra servos |

## 2. Wiring
Follow `docs/wiring.md`. Two dividers matter (5V → 3.3V): **HC-SR04 ECHO → PB6**
and (optionally) **STM32 TX → HC-05 RX**. Common ground everywhere. Servos on
the external 5V rail only.

## 3. Firmware bring-up
1. Open `firmware/` in STM32CubeIDE (or your ARM-GCC setup). Add `config.h` +
   `arm_control.c`. It relies on the standard CMSIS 72 MHz `SystemInit()`.
2. **Edit `config.h`** for your arm: `NUM_SERVOS`, feature toggles, and the
   `SERVO_MIN_DEG`/`SERVO_MAX_DEG` limits so a joint can't over-drive.
3. Flash via ST-Link. On boot the board sends `READY v3.0`.
4. Sanity check over USB-TTL (115200): send `P` → `PONG`, `I` → `INFO v3.0 …`,
   `H` → arm goes to home.

## 4. Calibrate each servo (no reflashing)
With the arm powered, per servo `ch` (0..3):
- Send `S ch 90` — should sit mid-travel. If not, adjust with `C ch <minUs> <maxUs>`
  (e.g. `C 0 500 2500`) until `S ch 0` and `S ch 180` hit the real end-stops.
- Set safe limits in `config.h` once you know the mechanical range, then reflash.
Speed: `V 2` (gentle) … `V 8` (fast).

## 5. Run the app
```
cd host && pip install -r requirements.txt      # add mediapipe not needed (browser does vision)
python server.py --port COM5                    # real arm; omit --port for simulation
```
Open http://localhost:8000. Badge shows **STM32 LIVE** when the board is attached.
Every browser action (sliders, trackpad, hand-follow, gesture, blink-Morse,
voice, AI console, routines) streams the same `A base grip shoulder elbow`
commands, so the on-screen arm and the real arm move together.

## 6. Feature test order (matches `docs/demo_runbook.md`)
Manual → Trackpad → Emergency-stop (wave hand at HC-SR04) → Joystick →
Bluetooth (phone) → Hand-Follow → Gesture → Blink-Morse writing →
Voice + AI console.

## 7. AI layer
All in-browser, free, no API key:
- **Gesture** (MediaPipe GestureRecognizer): ✊ close grip · ✋ home · 👍 write ·
  ✌️ wave · ☝️ scan · 🤟 nod.
- **Voice** (Web Speech API): "home", "write hello world", "open gripper",
  "wave", "faster", "stop".
- **AI console** (`js/nlp.js`): free-text intents → arm actions.
- **Routines** (`js/routines.js`): wave / pick / nod / scan / home choreography.

### Optional: Claude-powered planner
For complex free-form requests ("tidy the three blocks left to right"), add a
`/api/plan` endpoint in `server.py` that sends the request to Claude and returns
a list of routine/command steps; `js/nlp.js` can try it first and fall back to
local rules. This needs an `ANTHROPIC_API_KEY` and internet — kept optional so
the system is fully functional offline.
