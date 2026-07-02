#include "stm32f10x.h"

void TIM2_PWM_Init(void);
void Servo_SetAngle(uint8_t ch, uint8_t angle);
void Servo_SmoothMove(uint8_t ch, uint8_t from, uint8_t to, uint8_t stepDelay);
void delayMs(uint32_t ms);

int main(void)
{
    TIM2_PWM_Init();

    Servo_SetAngle(0, 90);
    Servo_SetAngle(1, 60);
    Servo_SetAngle(2, 90);
    Servo_SetAngle(3, 90);
    delayMs(1000);

    Servo_SmoothMove(1, 60, 170, 5);
    delayMs(800);

    Servo_SmoothMove(2, 90, 140, 8);
    Servo_SmoothMove(3, 90, 130, 8);
    delayMs(800);

    for (int i = 0; i < 40; i++) {
        Servo_SetAngle(0, 90 - i/2);
        Servo_SetAngle(2, 140 - i/2);
        delayMs(25);
    }

    for (int i = 0; i < 40; i++) {
        Servo_SetAngle(0, 70 + i/2);
        Servo_SetAngle(2, 120 + i/2);
        delayMs(25);
    }

    Servo_SmoothMove(2, 160, 120, 10);
    Servo_SmoothMove(3, 130, 110, 10);
    delayMs(500);

    for (int i = 0; i < 30; i++) {
        Servo_SetAngle(0, 90 - i/2);
        delayMs(25);
    }

    Servo_SmoothMove(2, 120, 80, 10);
    Servo_SmoothMove(3, 110, 90, 10);
    Servo_SmoothMove(1, 170, 60, 6);
    delayMs(1000);

    Servo_SetAngle(0, 90);
    Servo_SetAngle(2, 90);
    Servo_SetAngle(3, 90);
    delayMs(1000);

    while (1);
}

void TIM2_PWM_Init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
    RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;
    GPIOA->CRL = 0xBBBBBBBB;
    TIM2->PSC = 72 - 1;
    TIM2->ARR = 20000 - 1;
    TIM2->CCMR1 = (6 << 4) | (6 << 12);
    TIM2->CCMR2 = (6 << 4) | (6 << 12);
    TIM2->CCER = 0x1111;
    TIM2->CCR1 = TIM2->CCR2 = TIM2->CCR3 = TIM2->CCR4 = 1500;
    TIM2->CR1 = 1;
}

void Servo_SetAngle(uint8_t ch, uint8_t angle)
{
    uint16_t pulse = 350 + ((angle * 2300) / 180);
    switch (ch)
    {
        case 0: TIM2->CCR1 = pulse; break;
        case 1: TIM2->CCR2 = pulse; break;
        case 2: TIM2->CCR3 = pulse; break;
        case 3: TIM2->CCR4 = pulse; break;
    }
}

void Servo_SmoothMove(uint8_t ch, uint8_t from, uint8_t to, uint8_t stepDelay)
{
    if (from < to)
        for (uint8_t i = from; i <= to; i++) { Servo_SetAngle(ch, i); delayMs(stepDelay); }
    else
        for (int i = from; i >= to; i--) { Servo_SetAngle(ch, i); delayMs(stepDelay); }
}

void delayMs(uint32_t ms)
{
    SysTick->LOAD = 72000 - 1;
    SysTick->VAL = 0;
    SysTick->CTRL = 5;
    for (uint32_t i = 0; i < ms; i++)
        while (!(SysTick->CTRL & (1 << 16)));
    SysTick->CTRL = 0;
}
