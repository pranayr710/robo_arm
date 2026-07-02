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

\* **HC-05 RX is 5V-logic** — put a divider on PA9→HC-05 RX (1kΩ series + 2kΩ
to GND) to drop 3.3V… actually STM32 3.3V TX is fine into HC-05 RX; the divider
matters the other way isn't needed. Keep HC-05 VCC at 5V, its TX (3.3V) → PA10.

\*\* **HC-SR04 ECHO is 5V** — divide it down to 3.3V before PB6
(e.g. 1kΩ series + 2kΩ to GND) or you can damage the pin.

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
