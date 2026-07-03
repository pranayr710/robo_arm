/* ============================================================================
 *  config.h — hardware configuration for the STM32 robotic arm firmware.
 *
 *  EDIT THIS FILE to match your physical hardware. The rest of the firmware
 *  (arm_control.c) is generic and does not need changing for a different arm,
 *  different servos, or enabling/disabling peripherals.
 * ==========================================================================*/
#ifndef ARM_CONFIG_H
#define ARM_CONFIG_H

#define FW_VERSION   "3.0"

/* ---- Feature toggles: set to 0 to disable (frees the pins) --------------- */
#define FEATURE_JOYSTICK    1      /* analog joystick teleop (ADC PA4/PA5)   */
#define FEATURE_ULTRASONIC  1      /* HC-SR04 emergency stop (PB0/PB6)       */
/* Bluetooth (HC-05) shares USART1 with the USB-TTL — nothing to toggle.     */

/* ---- Servos ------------------------------------------------------------- *
 * Up to 4 servos on TIM2 CH1..CH4 = PA0..PA3. To add a 5th/6th, enable TIM3
 * channels (PA6/PA7) — see the notes in arm_control.c. Index order is the
 * order used by the 'A' command: [0]=base [1]=gripper [2]=shoulder [3]=elbow */
#define NUM_SERVOS   4

/* Per-servo pulse-width calibration in microseconds at 0deg and 180deg.
 * Different servo brands need different values — tune each, or use the 'C'
 * serial command at runtime (no reflash). Order matches the servo index.   */
#define SERVO_CAL_MIN_US   { 500,  500,  500,  500 }
#define SERVO_CAL_MAX_US   { 2500, 2500, 2500, 2500 }

/* Safe travel limits (degrees) to protect the mechanism from over-driving. */
#define SERVO_MIN_DEG      {   0,   0,   0,   0 }
#define SERVO_MAX_DEG      { 180, 180, 180, 180 }

/* Rest / safe pose (degrees), also the e-stop hold reference.               */
#define HOME_POSE          {  90,  70,  90,  90 }

/* ---- Motion smoothing --------------------------------------------------- */
#define SERVO_STEP_MS      15u     /* how often a step is taken              */
#define SERVO_STEP_DEG     3u      /* degrees per step (speed) — also 'V' cmd */

/* ---- Serial ------------------------------------------------------------- */
#define UART_BAUD          115200u

/* ---- Safety ------------------------------------------------------------- */
#define OBSTACLE_CM        10u     /* auto e-stop closer than this (HC-SR04) */
#define FAILSAFE_MS        0u      /* 0 = off; else e-stop if no command for
                                     this many ms (guards a dropped link)    */

#endif /* ARM_CONFIG_H */
