/* ============================================================================
 *  servo_90_test.c — minimal test: all 4 servos go to 0 deg, then rotate to
 *  90 deg and stop. Standalone; does not touch main.c / arm_control.c.
 *
 *  Target: STM32F401CCU6 "Black Pill"  |  IDE: Keil uVision + CMSIS
 *  Clock : default HSI = 16 MHz (no PLL), same as main.c
 *
 *  PIN CONFIG (same as main.c):
 *    PA0  TIM2_CH1  -> Base     servo signal
 *    PA1  TIM2_CH2  -> Shoulder servo signal
 *    PA2  TIM2_CH3  -> Elbow    servo signal
 *    PA3  TIM2_CH4  -> Gripper  servo signal
 *    PC13           -> onboard LED (blinks when the test is finished)
 *
 *  POWER: servos on an external 5V supply (NOT the Black Pill 5V pin).
 *         Servo GND must be joined to the Black Pill GND.
 *
 *  PWM: 50 Hz (20 ms period). 0.5 ms = 0 deg, 1.5 ms = 90 deg, 2.5 ms = 180 deg.
 *
 *  NOTE: not compiled/flashed here — verify on hardware.
 * ==========================================================================*/

#include "stm32f4xx.h"

#define SERVO_US_MIN   500u      /* pulse at 0 deg   */
#define SERVO_US_MAX   2500u     /* pulse at 180 deg */

/* 1 = after reaching 90 deg, switch the PWM off (servos go limp, no hold).
 * 0 = keep the 90 deg pulse running so the servos hold their position.     */
#define RELEASE_AFTER  0

static void delay_ms(uint32_t ms)
{
    /* crude busy-wait, ~16 MHz core clock */
    while (ms--) {
        for (volatile uint32_t i = 0; i < 1600u; i++) { __NOP(); }
    }
}

static uint32_t angle_to_us(uint32_t deg)
{
    return SERVO_US_MIN + (deg * (SERVO_US_MAX - SERVO_US_MIN)) / 180u;
}

static void servos_set(uint32_t deg)
{
    uint32_t us = angle_to_us(deg);      /* timer tick = 1 us */
    TIM2->CCR1 = us;                     /* base     */
    TIM2->CCR2 = us;                     /* shoulder */
    TIM2->CCR3 = us;                     /* elbow    */
    TIM2->CCR4 = us;                     /* gripper  */
}

static void pwm_init(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN | RCC_AHB1ENR_GPIOCEN;
    RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;

    /* PA0..PA3 -> alternate function AF1 (TIM2 CH1..CH4) */
    GPIOA->MODER &= ~((3u<<0)|(3u<<2)|(3u<<4)|(3u<<6));
    GPIOA->MODER |=  ((2u<<0)|(2u<<2)|(2u<<4)|(2u<<6));
    GPIOA->AFR[0] &= ~((0xFu<<0)|(0xFu<<4)|(0xFu<<8)|(0xFu<<12));
    GPIOA->AFR[0] |=  ((1u<<0)|(1u<<4)|(1u<<8)|(1u<<12));

    /* PC13 -> output (status LED) */
    GPIOC->MODER &= ~(3u<<26);
    GPIOC->MODER |=  (1u<<26);

    /* TIM2: 16 MHz / 16 = 1 MHz tick (1 us); ARR 20000 -> 50 Hz */
    TIM2->PSC = 16 - 1;
    TIM2->ARR = 20000 - 1;
    TIM2->CCMR1 = (6u<<4)|(1u<<3)|(6u<<12)|(1u<<11);   /* CH1,CH2 PWM mode 1 + preload */
    TIM2->CCMR2 = (6u<<4)|(1u<<3)|(6u<<12)|(1u<<11);   /* CH3,CH4 PWM mode 1 + preload */
    TIM2->CCER  = (1u<<0)|(1u<<4)|(1u<<8)|(1u<<12);    /* enable CH1..CH4 outputs */

    servos_set(0);                                     /* start position */
    TIM2->CR1 |= (1u<<7);                              /* ARPE */
    TIM2->EGR  = 1;                                    /* load registers */
    TIM2->CR1 |= 1;                                    /* start timer */
}

int main(void)
{
    pwm_init();
    delay_ms(1500);            /* let servos settle at 0 deg */

    servos_set(90);            /* rotate all four servos to 90 deg */
    delay_ms(1500);            /* give them time to arrive */

#if RELEASE_AFTER
    TIM2->CCER = 0;            /* PWM off: servos stop driving */
#endif

    while (1) {                /* done: blink LED, servos stay at 90 deg */
        GPIOC->ODR ^= (1u<<13);
        delay_ms(500);
    }
}
