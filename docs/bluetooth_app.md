# Phone control over Bluetooth (HC-05)

The HC-05 is a transparent serial bridge — anything the phone sends over
Bluetooth arrives on USART1 exactly like the USB-TTL. So the phone speaks the
**same protocol** (see `../PROTOCOL.md`).

## Fastest path: a generic Serial Bluetooth Terminal

1. Pair the HC-05 (PIN usually `1234` or `0000`).
2. Install any "Serial Bluetooth Terminal" app.
3. Connect, then send text lines (append newline):
   - `H` — home
   - `A 90 60 90 90` — set all angles
   - `S 0 120` — one servo
   - `E` / `R` — stop / release
   - `J 1` / `J 0` — joystick mode on/off

That already gives you full wireless control with zero app-building.

## Nicer: MIT App Inventor custom app

Build a button/slider UI that sends the same strings.

**Components:** `BluetoothClient`, a `ListPicker` (to pick the HC-05), buttons
(Home / Stop / Release), and sliders for each servo.

**Blocks (essence):**

- ListPicker.AfterPicking → `BluetoothClient.Connect(address)`
- Home button `.Click` → `BluetoothClient.SendText("H\n")`
- Stop button `.Click` → `SendText("E\n")`, Release → `SendText("R\n")`
- Base slider `.PositionChanged(thumbPosition)` →
  `SendText(join("S 0 ", round(thumbPosition), "\n"))`
  (repeat for ch 1/2/3 with sliders set to range 0–180)
- A "joystick" pair of sliders can send `A <b> <g> <s> <e>\n` on change.

Set every slider's Min=0, Max=180. Always append `"\n"` — the firmware parses
one command per line.

## Note

The web UI (`server.py`) and the phone app are independent control surfaces
that speak the same protocol; you can use either. Camera features (hand-follow,
blink-Morse) need the PC, since the STM32 can't run vision.
