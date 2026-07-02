# Demo runbook

A click-by-click order for showing every feature. Two tracks: **software-only**
(works today, no hardware) and **full hardware**.

---

## A. Software-only demo (no arm needed)

Great for a dry run or if hardware isn't ready.

1. `cd host && pip install -r requirements.txt`
2. `python server.py` → open **http://localhost:8000**
3. Badge shows **MOCK**. Drag the sliders → the 2D arm animates smoothly.
4. Click **STOP** (arm freezes, red banner) → **Release**.
5. Type `HELLO` in the Morse box → **Write** → arm sweeps out the dot/dash marks.
6. `python blink_morse.py` (needs `pip install mediapipe`) → blink short/long →
   watch dots/dashes decode on screen → pause to write.

---

## B. Full hardware demo — recommended order

Build tension from "safe + solid" → "wow". Keep the external 5V/3A supply on a
switch you can cut.

### 0. Setup (before the audience)
- Flash `firmware/arm_control.c`. Power servos from external 5V (common ground).
- Wire per `docs/wiring.md`. Tune `writer.py` `CALIB` and tape a pen in the gripper.
- `python server.py --port COM5` → open the web UI. Badge should read **LIVE**.

### 1. Manual control + visualization  (proves the base works)
- Drag sliders; point out the on-screen arm mirrors the real arm 1:1 via live
  telemetry. Click **Home**.

### 2. Emergency stop  (the safety feature profs love)
- Start a motion, then wave your hand in front of the HC-SR04 → arm **freezes**
  instantly, banner turns red, obstacle distance shows on screen.
- Say the line: *"cutting the control loop the instant a human is detected."*
- Click **Release** to resume.

### 3. Wired joystick teleop
- Click **Joystick**. Move the stick → base + shoulder follow live. Note the
  sliders grey out (the stick owns the arm now). Click **Manual** to hand back.

### 4. Bluetooth / phone control
- Unplug USB-TTL, plug in HC-05, `python server.py --port COM6` (the BT COM
  port) — OR drive it straight from the phone app (Section D). Send `H`, move a
  slider from the phone.

### 5. Real-time hand-follow  (the live "wow")
- Click **Hand-follow**. A camera window opens; move your hand → arm mirrors
  wrist position; pinch → gripper closes. Click **Manual** to stop.

### 6. Eye-blink Morse writing  (the accessibility showcase — end on this)
- `python blink_morse.py --port COM5`
- Blink **short = dot**, **long = dash**; pause to end a letter, pause longer to
  trigger writing. The arm writes your message in Morse on paper.
- Frame it: *"for a fully paralysed person who can only blink, this is a way to
  physically write on paper."*

---

## C. If something fails mid-demo
- Arm jitters in hand mode → lower `alpha` in `hand_tracker.py`.
- Servo buzzing/browning out → power supply too weak; that's why we use external 5V/3A.
- Blink mis-detected → adjust `EAR_THRESH` / `DOT_MAX_S` in `blink_morse.py`.
- Anything unsafe → hit **STOP** in the UI or cut the servo supply switch.

---

## D. Finish the MIT App Inventor app (`ArmControl.aia`)

Import `docs/ArmControl.aia` at **ai2.appinventor.mit.edu** (Projects → Import).
The screen (Connect button, Status, Home/STOP/Release, 4 sliders, BluetoothClient)
is already laid out. Add these blocks in the **Blocks** editor:

> If the import ever complains, the layout takes ~5 min to rebuild by hand from
> `docs/bluetooth_app.md`; the blocks below are the same either way.

1. **PickBT.BeforePicking** → set `PickBT.Elements` to `BT.AddressesAndNames`
2. **PickBT.AfterPicking**:
   - `set Status.Text` to `BT.Connect(PickBT.Selection)` result label, e.g.
     if `call BT.Connect` → then `set Status.Text = "Connected"`.
3. **BtnHome.Click** → `call BT.SendText text ("H" + \n)`
   (use a `join` block with `"H"` and a text block containing a newline)
4. **BtnStop.Click** → `BT.SendText "E\n"`
5. **BtnRelease.Click** → `BT.SendText "R\n"`
6. For each slider **`.PositionChanged(thumbPosition)`** →
   `BT.SendText join("S ", <ch>, " ", round(thumbPosition), "\n")`
   with ch = 0/1/2/3 for Base/Grip/Shoulder/Elbow.

Every command line **must end in `\n`** — the firmware parses one command per line.
Then **Build → APK** and install on the phone. It talks the exact same protocol
as the web UI (`../PROTOCOL.md`).
