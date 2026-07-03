# Wiring & pin map (STM32F103C8T6 Blue Pill)

All grounds must be common. Servos run off an **external 5V / 3A** supply —
**never** off the Blue Pill's regulator.

## Pin map

| Function            | STM32 pin | Peripheral        | Notes |
|---------------------|-----------|-------------------|-------|
| Servo 0 — Base      | PA0       | TIM2_CH1 (PWM)    | to servo signal |
| Servo 1 — Gripper   | PA1       | TIM2_CH2 (PWM)    | |
| Servo 2 — Shoulder  | PA2       | TIM2_CH3 (PWM)    | |
| Servo 3 — Elbow     | PA3       | TIM2_CH4 (PWM)    | |
| Serial TX           | PA9       | USART1_TX         | → USB-TTL RX **or** HC-05 RX* |
| Serial RX           | PA10      | USART1_RX         | ← USB-TTL TX **or** HC-05 TX |
| Joystick VRx        | PA4       | ADC1_IN4          | X axis |
| Joystick VRy        | PA5       | ADC1_IN5          | Y axis |
| Ultrasonic Trigger  | PB0       | GPIO out          | HC-SR04 TRIG |
| Ultrasonic Echo     | PB6       | TIM4_CH1 (input)  | HC-SR04 ECHO** |

\* **HC-05:** VCC at 5V (the ZS-040 carrier regulates internally). Its RX and
TX are 3.3V logic — connect **directly** to PA9/PA10, no divider needed in
either direction.

\*\* **HC-SR04 ECHO outputs 5V**, but **PB6 is 5V-tolerant** on the F103, so a
direct connection is safe. A 1kΩ series + 2kΩ-to-GND divider is optional
belt-and-braces. **Joystick VCC must be 3.3V** (PA4/PA5 are NOT 5V-tolerant).

> The complete, authoritative build guide with exact part models and
> step-by-step assembly is **[HARDWARE.md](HARDWARE.md)**.

## Why PA4/PA5 for the joystick

PA0–PA3 are the servo PWM outputs *and* ADC channels 0–3 — they can't be both.
The firmware leaves PA4/PA5 as analog inputs (ADC ch4/ch5) specifically for the
joystick.

## Serial: USB-TTL vs HC-05

Both talk the identical protocol on USART1 @ 115200. Use the USB-TTL for
development on the PC; swap in the HC-05 for wireless/phone control. Only one at
a time on PA9/PA10.

## Emergency stop behaviour

The firmware freezes the arm (holds PWM at the last position) when the HC-SR04
reads closer than `OBSTACLE_CM` (default 10 cm) or on an `E` command. Release
with `R`. If the sensor is absent, echo stays 0 → distance reports 999 → never
false-triggers, so the arm works fine before you wire the sensor.
