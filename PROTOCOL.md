# Arm serial protocol (Phase 0)

Line-based ASCII, `\n`-terminated, 115200 8N1 on USART1 (PA9 TX / PA10 RX).
Works identically over USB-TTL now and over HC-05 Bluetooth later.

## Host → Arm

| Command      | Meaning                                   | Example      |
|--------------|-------------------------------------------|--------------|
| `A b g s e`  | Set all 4 target angles (0–180)           | `A 90 60 90 90` |
| `S ch a`     | Set one servo (ch 0=base 1=grip 2=shldr 3=elbow) | `S 0 120` |
| `H`          | Go to home/safe pose                      | `H`          |
| `E`          | Emergency stop — freeze in place          | `E`          |
| `R`          | Release e-stop                            | `R`          |
| `J n`        | Control mode: `J 1` = joystick, `J 0` = remote/serial | `J 1` |
| `V step`     | Motion speed = degrees per step (1–20)    | `V 5`        |
| `C ch a b`   | Calibrate servo `ch`: pulse µs at 0° (`a`) and 180° (`b`) | `C 0 500 2500` |
| `P`          | Ping → replies `PONG`                     | `P`          |
| `I`          | Info → replies `INFO v3.0 servos 4`       | `I`          |
| `?`          | Request one telemetry line                | `?`          |

In joystick mode the arm's base/shoulder follow the analog stick, and `A`/`S`
commands are rejected with `BUSY` (the stick owns the arm). `E`/`R`/`J`/`?`
still work.

Angles are **targets**. The firmware smoothly ramps toward them, so streaming
new `A ...` lines at 20–30 Hz (hand-follow) produces fluid motion.

## Arm → Host

| Message              | Meaning                                            |
|----------------------|----------------------------------------------------|
| `READY`                       | Firmware booted                           |
| `OK` / `ERR` / `BUSY`         | Command accepted / rejected / arm in joystick mode |
| `STATE b g s e mode dist`     | Live state: 4 current angles, e-stop (0/1), mode (0=remote 1=joystick), ultrasonic distance (cm). Pushed every 100 ms and on `?`. |

Example: `STATE 90 60 90 90 0 0 999`  (dist 999 = no/absent sensor)
