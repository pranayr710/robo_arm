#include "stm32f10x.h"

// ---------- Function Prototypes ----------
void TIM2_PWM_Init(void);
void Servo_SetAngle(uint8_t ch, uint8_t angle);
void Servo_SmoothMove(uint8_t ch, uint8_t from, uint8_t to, uint8_t stepDelay);
void delayMs(uint32_t ms);

// ---------- Main ----------
int main(void)
{
    TIM2_PWM_Init();

    // ===== Initialize all servos to neutral (no early motion) =====
    TIM2->CCR1 = 1500; // Base
    TIM2->CCR2 = 1500; // Gripper
    TIM2->CCR3 = 1500; // Shoulder
    TIM2->CCR4 = 1500; // Elbow
    delayMs(1000);

    // ===== Step 1: Rotate base to right =====
    Servo_SmoothMove(0, 90, 150, 10);  // Base rotate right
    delayMs(500);

    // ===== Step 2: Move shoulder & elbow down =====
    Servo_SmoothMove(2, 90, 160, 10);  // Shoulder down
    Servo_SmoothMove(3, 90, 130, 10);  // Elbow bend
    delayMs(1000);

    // ===== Step 3: Open gripper =====
    Servo_SmoothMove(1, 90, 30, 8);    // Open gripper
    delayMs(1000);

    // ===== Step 4: Close gripper to pick object =====
    Servo_SmoothMove(1, 30, 160, 8);   // Close gripper tightly
    delayMs(1500);

    // ===== Step 5: Lift object up =====
    Servo_SmoothMove(2, 160, 70, 10);  // Shoulder up
    Servo_SmoothMove(3, 130, 80, 10);  // Elbow up
    delayMs(1000);

    // ===== Step 6: Rotate base to left =====
    Servo_SmoothMove(0, 150, 40, 10);  // Base rotate left
    delayMs(1000);

    // ===== Step 7: Open gripper to release =====
    Servo_SmoothMove(1, 160, 30, 8);   // Open gripper fully
    delayMs(1000);    
		Servo_SmoothMove(1, 30, 160, 8);   // Close gripper tightly
    delayMs(1500);
		

    // ===== Step 8: Return to home position =====
    Servo_SmoothMove(2, 70, 90, 10);   // Shoulder neutral
    Servo_SmoothMove(3, 80, 90, 10);   // Elbow neutral
    Servo_SmoothMove(0, 40, 90, 10);   // Base center
               // Gripper neutral
    delayMs(1000);

    while(1);
}

// ---------- PWM Init (TIM2 on PA0–PA3) ----------
void TIM2_PWM_Init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
    RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;

    // Configure PA0–PA3 as Alternate Function Push-Pull (50 MHz)
    GPIOA->CRL = 0xBBBBBBBB;  // Each pin AF output, push-pull

    // Timer2 setup: 50 Hz PWM (20 ms period)
    TIM2->PSC = 72 - 1;        // 1 µs tick
    TIM2->ARR = 20000 - 1;     // 20 ms period (50 Hz)

    // PWM Mode 1 for all channels
    TIM2->CCMR1 = (6 << 4) | (6 << 12); // CH1, CH2
    TIM2->CCMR2 = (6 << 4) | (6 << 12); // CH3, CH4
    TIM2->CCER  = 0x1111;               // Enable CH1–CH4 outputs

    // Start neutral
    TIM2->CCR1 = TIM2->CCR2 = TIM2->CCR3 = TIM2->CCR4 = 1500;

    TIM2->CR1 = 1;  // Enable Timer
}

// ---------- Servo Angle Function ----------
void Servo_SetAngle(uint8_t ch, uint8_t angle)
{
    // Extended range: 0° = 0.4 ms, 180° = 2.6 ms
    uint16_t pulse = 400 + ((angle * 2200) / 180);

    switch (ch)
    {
        case 0: TIM2->CCR1 = pulse; break;  // Base (PA0)
        case 1: TIM2->CCR2 = pulse; break;  // Gripper (PA1)
        case 2: TIM2->CCR3 = pulse; break;  // Shoulder (PA2)
        case 3: TIM2->CCR4 = pulse; break;  // Elbow (PA3)
    }
}

// ---------- Smooth Servo Movement ----------
void Servo_SmoothMove(uint8_t ch, uint8_t from, uint8_t to, uint8_t stepDelay)
{
    if (from < to)
        for (uint8_t i = from; i <= to; i++) { Servo_SetAngle(ch, i); delayMs(stepDelay); }
    else
        for (int i = from; i >= to; i--) { Servo_SetAngle(ch, i); delayMs(stepDelay); }
}

// ---------- Delay Function ----------
void delayMs(uint32_t ms)
{
    SysTick->LOAD = 72000 - 1;
    SysTick->VAL  = 0;
    SysTick->CTRL = 5;
    for (uint32_t i = 0; i < ms; i++)
        while (!(SysTick->CTRL & (1 << 16)));
    SysTick->CTRL = 0;
}