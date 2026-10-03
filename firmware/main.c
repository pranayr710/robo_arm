/* ============================================================================
 *  HASTHA - Multi-mode assistive robotic arm
 *  Target: STM32F401CCU6 "Black Pill"   |   IDE: Keil uVision + CMSIS
 *  Clock : default HSI = 16 MHz (no PLL) -> all peripheral clocks = 16 MHz
 *
 *  Pick the task to build with ACTIVE_TASK below, then flash.
 *    TASK 2 : potentiometer (PA4/ADC) -> base servo angle          (start here)
 *    TASK 1 : IR detect -> LCD -> ultrasonic distance -> auto pick & place
 *    TASK 3 : receive letters/angles over UART (from PC webcam-Morse) -> write
 *
 *  PORT MAP (Black Pill):
 *    PA0..PA3  TIM2_CH1..4  -> Base / Shoulder / Elbow / Gripper servos (PWM)
 *    PA4       ADC1_IN4     -> Potentiometer wiper        (Task 2)
 *    PA9/PA10  USART1 TX/RX -> USB-serial to PC           (Task 3)
 *    PB0       GPIO out     -> HC-SR04 TRIG
 *    PB6       TIM4_CH1     -> HC-SR04 ECHO (input capture)
 *    PB7       GPIO in      -> IR sensor OUT
 *    PB8/PB9   I2C1 SCL/SDA -> 16x2 I2C LCD (PCF8574)
 *    PC13      GPIO out     -> onboard status LED
 *    (PA5      ADC1_IN5     -> optional solar-battery monitor, see BATT_MON)
 *
 *  NOTE: written for correctness against the F401 reference manual but NOT
 *  compiled/flashed here. Verify on hardware; tune the constants marked TUNE.
 * ==========================================================================*/

#include "stm32f4xx.h"
#include <math.h>

/* ----------------------------- SELECT TASK ------------------------------- */
#define ACTIVE_TASK   2          /* 1, 2 or 3 */

/* ------------------------------- config ---------------------------------- */
#define PI            3.14159265f
#define SERVO_US_MIN  500        /* pulse at 0 deg  */
#define SERVO_US_MAX  2500       /* pulse at 180 deg */
#define STEP_DEG      3          /* servo ramp speed (deg per 15 ms) */

/* servo channels (index into TIM2 CH1..4) */
enum { BASE = 0, SHOULDER = 1, ELBOW = 2, GRIPPER = 3 };

/* arm geometry in mm - TUNE to your Kit4Curious arm */
#define ARM_L1        105.0f
#define ARM_L2        95.0f
#define SHOULDER_H    95.0f

/* Task 1 poses / positions - TUNE */
#define BASE_FORWARD  90         /* base angle facing the object */
#define BASE_DROP     40         /* base angle of the drop zone  */
#define GRIP_OPEN     40
#define GRIP_CLOSE    150
#define PICK_Z_MM     (-70.0f)   /* gripper height at the table (below shoulder) */

#define LCD_ADDR      0x27       /* PCF8574 7-bit addr (try 0x3F if blank) */
#define IR_PRESENT    (((GPIOB->IDR >> 7) & 1u) == 0u)   /* active-low output */

/* #define BATT_MON  1 */        /* uncomment to enable solar-battery monitor on PA5 */

/* --------------------------- shared state -------------------------------- */
static volatile uint32_t ms_ticks = 0;
static volatile int16_t  cur_ang[4] = { 90, 90, 90, 90 };
static volatile int16_t  tgt_ang[4] = { 90, 90, 90, 90 };

/* Task 3 UART receive line buffer */
#define RXN 48
static volatile char     rxbuf[RXN];
static volatile uint8_t  rxlen = 0, rxready = 0;

/* ============================ low-level =============================== */
static uint16_t angle_to_us(int16_t a)
{
    if (a < 0) a = 0; if (a > 180) a = 180;
    return (uint16_t)(SERVO_US_MIN + ((int32_t)a * (SERVO_US_MAX - SERVO_US_MIN)) / 180);
}
static void pwm_write(uint8_t ch, int16_t ang)
{
    uint16_t us = angle_to_us(ang);
    switch (ch) {
        case 0: TIM2->CCR1 = us; break;
        case 1: TIM2->CCR2 = us; break;
        case 2: TIM2->CCR3 = us; break;
        case 3: TIM2->CCR4 = us; break;
    }
}

/* ---- SysTick: 1 ms tick + non-blocking servo ramp (uses NVIC) ---- */
void SysTick_Handler(void)
{
    static uint8_t d = 0;
    ms_ticks++;
    if (++d >= 15) {                       /* step servos every 15 ms */
        d = 0;
        for (uint8_t ch = 0; ch < 4; ch++) {
            int16_t diff = tgt_ang[ch] - cur_ang[ch];
            if (diff > STEP_DEG)       cur_ang[ch] += STEP_DEG;
            else if (diff < -STEP_DEG) cur_ang[ch] -= STEP_DEG;
            else                       cur_ang[ch]  = tgt_ang[ch];
            pwm_write(ch, cur_ang[ch]);
        }
    }
}
static void delay_ms(uint32_t ms) { uint32_t s = ms_ticks; while (ms_ticks - s < ms) __NOP(); }
static void delay_us(uint32_t us) { TIM3->CNT = 0; while (TIM3->CNT < us) __NOP(); }

static void set_angle(uint8_t ch, int16_t a) { if (a < 0) a = 0; if (a > 180) a = 180; tgt_ang[ch] = a; }
static void move_settle(uint32_t ms) { delay_ms(ms); }

/* ============================ init: GPIO ============================== */
static void gpio_init(void)
{
    RCC->AHB1ENR |= (1u<<0) | (1u<<1) | (1u<<2);   /* GPIOA, GPIOB, GPIOC */

    /* PA0..PA3 = AF1 (TIM2), PA4 = analog, PA9/PA10 = AF7 (USART1) */
    GPIOA->MODER &= ~((3u<<0)|(3u<<2)|(3u<<4)|(3u<<6)|(3u<<8)|(3u<<18)|(3u<<20));
    GPIOA->MODER |=  ((2u<<0)|(2u<<2)|(2u<<4)|(2u<<6)|(3u<<8)|(2u<<18)|(2u<<20));
    GPIOA->AFR[0] &= ~((0xFu<<0)|(0xFu<<4)|(0xFu<<8)|(0xFu<<12));
    GPIOA->AFR[0] |=  ((1u<<0)|(1u<<4)|(1u<<8)|(1u<<12));       /* AF1 PA0-3 */
    GPIOA->AFR[1] &= ~((0xFu<<4)|(0xFu<<8));
    GPIOA->AFR[1] |=  ((7u<<4)|(7u<<8));                         /* AF7 PA9/10 */
#ifdef BATT_MON
    GPIOA->MODER |= (3u<<10);                                    /* PA5 analog */
#endif

    /* PB0 out, PB6 AF2(TIM4), PB7 in(pull-up), PB8/PB9 AF4(I2C1, open-drain) */
    GPIOB->MODER &= ~((3u<<0)|(3u<<12)|(3u<<14)|(3u<<16)|(3u<<18));
    GPIOB->MODER |=  ((1u<<0)|(2u<<12)|(2u<<16)|(2u<<18));
    GPIOB->OTYPER |= (1u<<8)|(1u<<9);
    GPIOB->PUPDR  &= ~((3u<<14)|(3u<<16)|(3u<<18));
    GPIOB->PUPDR  |=  ((1u<<14)|(1u<<16)|(1u<<18));              /* pull-ups */
    GPIOB->AFR[0] &= ~(0xFu<<24); GPIOB->AFR[0] |= (2u<<24);    /* PB6 AF2 */
    GPIOB->AFR[1] &= ~((0xFu<<0)|(0xFu<<4)); GPIOB->AFR[1] |= (4u<<0)|(4u<<4); /* PB8/9 AF4 */

    /* PC13 output (LED) */
    GPIOC->MODER &= ~(3u<<26); GPIOC->MODER |= (1u<<26);
}

/* ============================ init: timers =========================== */
static void tim2_pwm_init(void)                 /* 50 Hz servo PWM, 1 us tick */
{
    RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;
    TIM2->PSC = 16 - 1;  TIM2->ARR = 20000 - 1;
    TIM2->CCMR1 = (6u<<4)|(1u<<3)|(6u<<12)|(1u<<11);
    TIM2->CCMR2 = (6u<<4)|(1u<<3)|(6u<<12)|(1u<<11);
    TIM2->CCER  = (1u<<0)|(1u<<4)|(1u<<8)|(1u<<12);
    TIM2->CR1  |= (1u<<7);  TIM2->EGR = 1;  TIM2->CR1 |= 1;
    TIM2->CCR1 = TIM2->CCR2 = TIM2->CCR3 = TIM2->CCR4 = angle_to_us(90);
}
static void tim3_us_init(void)                  /* free-running 1 us counter */
{
    RCC->APB1ENR |= RCC_APB1ENR_TIM3EN;
    TIM3->PSC = 16 - 1;  TIM3->ARR = 0xFFFF;  TIM3->EGR = 1;  TIM3->CR1 |= 1;
}
static void tim4_echo_init(void)                /* HC-SR04 echo, PWM input mode */
{
    RCC->APB1ENR |= RCC_APB1ENR_TIM4EN;
    TIM4->PSC = 16 - 1;  TIM4->ARR = 0xFFFF;
    TIM4->CCMR1 = (1u<<0) | (2u<<8);            /* IC1=TI1(rising), IC2=TI1(fall) */
    TIM4->CCER  = (1u<<0) | (1u<<4) | (1u<<5);  /* CC1E, CC2E, CC2 falling */
    TIM4->SMCR  = (5u<<4) | (4u<<0);            /* TS=TI1FP1, SMS=reset */
    TIM4->CR1  |= 1;
}
static uint16_t ultrasonic_cm(void)
{
    GPIOB->BSRR = (1u<<0);  delay_us(12);  GPIOB->BSRR = (1u<<16);  /* 12us trigger */
    delay_ms(40);                                                    /* wait for echo */
    uint16_t us = (uint16_t)TIM4->CCR2;
    return (us == 0) ? 999 : (uint16_t)(us / 58u);                   /* cm */
}

/* ============================ init: ADC ============================== */
static void adc_init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;
    ADC1->SQR1  = 0;                          /* 1 conversion */
    ADC1->SMPR2 = (4u<<12) | (4u<<15);        /* ch4, ch5 = 84-cycle sample */
    ADC1->CR2  |= (1u<<0);                     /* ADON */
    for (volatile int i = 0; i < 10000; i++);
}
static uint16_t adc_read(uint8_t ch)
{
    ADC1->SQR3 = ch;
    ADC1->CR2 |= (1u<<30);                     /* SWSTART */
    while (!(ADC1->SR & (1u<<1)));             /* EOC */
    return (uint16_t)ADC1->DR;
}

/* ============================ init: USART1 =========================== */
static void usart1_init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_USART1EN;
    USART1->BRR = 139;                         /* 16 MHz / 115200 */
    USART1->CR1 = (1u<<2)|(1u<<3)|(1u<<5);     /* RE, TE, RXNEIE */
    USART1->CR1 |= (1u<<13);                   /* UE */
    NVIC_EnableIRQ(USART1_IRQn);
}
static void uart_putc(char c){ while(!(USART1->SR & (1u<<7))); USART1->DR = (uint8_t)c; }
static void uart_puts(const char*s){ while(*s) uart_putc(*s++); }
void USART1_IRQHandler(void)
{
    if (USART1->SR & (1u<<5)) {                 /* RXNE */
        char c = (char)(USART1->DR & 0xFF);
        if (c=='\n' || c=='\r') { if (rxlen && !rxready){ rxbuf[rxlen]=0; rxready=1; } }
        else if (rxlen < RXN-1 && !rxready) rxbuf[rxlen++]=c;
    }
}

/* ============================ init: I2C + LCD ======================== */
static void i2c1_init(void)
{
    RCC->APB1ENR |= RCC_APB1ENR_I2C1EN;
    I2C1->CR1 = (1u<<15); I2C1->CR1 = 0;       /* soft reset */
    I2C1->CR2   = 16;                          /* PCLK1 = 16 MHz */
    I2C1->CCR   = 80;                          /* 100 kHz standard */
    I2C1->TRISE = 17;
    I2C1->CR1  |= 1;                           /* PE */
}
static void i2c_write(uint8_t addr, uint8_t data)
{
    while (I2C1->SR2 & (1u<<1));               /* BUSY */
    I2C1->CR1 |= (1u<<8);                      /* START */
    while (!(I2C1->SR1 & (1u<<0)));            /* SB */
    I2C1->DR = (uint8_t)(addr << 1);
    while (!(I2C1->SR1 & (1u<<1)));            /* ADDR */
    (void)I2C1->SR2;
    while (!(I2C1->SR1 & (1u<<7)));            /* TXE */
    I2C1->DR = data;
    while (!(I2C1->SR1 & (1u<<2)));            /* BTF */
    I2C1->CR1 |= (1u<<9);                      /* STOP */
}
#define LCD_BL 0x08
static void lcd_nib(uint8_t nib, uint8_t rs)
{
    uint8_t b = (nib & 0xF0) | LCD_BL | (rs ? 1u : 0u);
    i2c_write(LCD_ADDR, b | 0x04); delay_us(2);       /* EN high */
    i2c_write(LCD_ADDR, b & ~0x04); delay_us(60);     /* EN low  */
}
static void lcd_send(uint8_t v, uint8_t rs){ lcd_nib(v & 0xF0, rs); lcd_nib((uint8_t)(v<<4), rs); }
static void lcd_cmd(uint8_t c){ lcd_send(c,0); if(c==1||c==2) delay_ms(2); }
static void lcd_ch(char c){ lcd_send((uint8_t)c,1); }
static void lcd_init(void)
{
    delay_ms(50);
    lcd_nib(0x30,0); delay_ms(5); lcd_nib(0x30,0); delay_us(150); lcd_nib(0x30,0);
    lcd_nib(0x20,0);                       /* 4-bit */
    lcd_cmd(0x28); lcd_cmd(0x0C); lcd_cmd(0x01); lcd_cmd(0x06);
}
static void lcd_at(uint8_t row, uint8_t col){ lcd_cmd(0x80 | (col + (row ? 0x40 : 0))); }
static void lcd_str(const char*s){ while(*s) lcd_ch(*s++); }
static void lcd_line(uint8_t row, const char*s){ lcd_at(row,0); lcd_str("                "); lcd_at(row,0); lcd_str(s); }
static void lcd_num(uint8_t row, const char*label, int v)
{
    char b[17]; int i=0; while(label[i]&&i<12){b[i]=label[i];i++;}
    if(v<0){b[i++]='-'; v=-v;}
    char d[6]; int n=0; if(v==0)d[n++]='0'; while(v){d[n++]=(char)('0'+v%10); v/=10;}
    while(n) b[i++]=d[--n]; b[i]=0; lcd_line(row,b);
}

/* ============================ SysTick start ========================== */
static void systick_init(void){ SysTick->LOAD=16000-1; SysTick->VAL=0; SysTick->CTRL=(1u<<0)|(1u<<1)|(1u<<2); }

/* ============================ arm helpers ============================ */
static void arm_home(void){ set_angle(BASE,90); set_angle(SHOULDER,90); set_angle(ELBOW,90); set_angle(GRIPPER,GRIP_OPEN); }

/* inverse kinematics: reach (r,z) mm from shoulder -> shoulder/elbow degrees.
 * returns 1 if reachable. Convention TUNE to your servo mounting. */
static int ik(float r, float z, int16_t* sh, int16_t* el)
{
    float dz = z; /* z already relative to shoulder */
    float D  = (r*r + dz*dz - ARM_L1*ARM_L1 - ARM_L2*ARM_L2) / (2*ARM_L1*ARM_L2);
    if (D > 1.f) D = 1.f; if (D < -1.f) D = -1.f;
    float e = acosf(D);                                   /* elbow interior */
    float s = atan2f(dz, r) - atan2f(ARM_L2*sinf(e), ARM_L1 + ARM_L2*cosf(e));
    float sd = s * 180.f / PI;
    float ed = e * 180.f / PI + 90.f;
    if (sd < 0.f) sd = 0.f; if (sd > 180.f) sd = 180.f;
    if (ed < 0.f) ed = 0.f; if (ed > 180.f) ed = 180.f;
    *sh = (int16_t)sd; *el = (int16_t)ed;
    return 1;
}

/* =============================== TASKS =============================== */

/* --- TASK 2: potentiometer -> base servo (ADC 0..4095 -> 0..180) --- */
static void task2(void)
{
    lcd_line(0, "TASK2 POT->BASE");
    while (1) {
        uint16_t v = adc_read(4);                 /* PA4 = ADC_IN4 */
        int16_t ang = (int16_t)(((int32_t)v * 180) / 4095);
        set_angle(BASE, ang);
        lcd_num(1, "Base:", ang);
        GPIOC->ODR ^= (1u<<13);
        delay_ms(60);
    }
}

/* --- TASK 1: IR detect -> LCD -> ultrasonic -> compute angle -> pick & place --- */
static void task1(void)
{
    arm_home(); move_settle(700);
    while (1) {
        lcd_line(0, "Waiting object..");
        lcd_line(1, "");
        while (!IR_PRESENT) { GPIOC->ODR ^= (1u<<13); delay_ms(120); }

        lcd_line(0, "Object detected");
        GPIOC->BSRR = (1u<<13); delay_ms(400);

        uint16_t d = ultrasonic_cm();             /* distance in cm */
        lcd_num(1, "Dist:", d);
        delay_ms(600);

        int16_t sh, el;
        float r = (float)d * 10.0f;               /* cm -> mm reach */
        ik(r, PICK_Z_MM, &sh, &el);
        lcd_line(0, "Angle computed");
        lcd_num(1, "Sh:", sh);
        delay_ms(700);

        /* ---- pick sequence (base fixed forward) ---- */
        set_angle(BASE, BASE_FORWARD); set_angle(GRIPPER, GRIP_OPEN); move_settle(700);
        set_angle(SHOULDER, sh); set_angle(ELBOW, el); move_settle(900);     /* reach down */
        set_angle(GRIPPER, GRIP_CLOSE); move_settle(700);                    /* grasp */
        set_angle(SHOULDER, 70); set_angle(ELBOW, 100); move_settle(800);    /* lift */

        /* ---- place at fixed drop angle ---- */
        set_angle(BASE, BASE_DROP); move_settle(900);
        set_angle(SHOULDER, sh); set_angle(ELBOW, el); move_settle(800);     /* lower */
        set_angle(GRIPPER, GRIP_OPEN); move_settle(600);                     /* release */
        arm_home(); move_settle(900);

        lcd_line(0, "Done. Reset obj");
        while (IR_PRESENT) delay_ms(150);         /* wait until object removed */
        delay_ms(400);
    }
}

/* --- TASK 3: receive "A base shoulder elbow gripper" over UART -> write ---
 * The PC (webcam + eye-blink Morse) decodes letters, computes stroke angles and
 * streams them here; this MCU applies them smoothly. Also accepts 'H' = home. */
static int rd_int(const char** p){ const char*s=*p; while(*s==' ')s++; if(*s<'0'||*s>'9')return -1;
    int v=0; while(*s>='0'&&*s<='9'){v=v*10+(*s-'0');s++;} *p=s; return v; }
static void task3(void)
{
    arm_home();
    lcd_line(0, "TASK3 WRITE");
    lcd_line(1, "Waiting PC...");
    uart_puts("READY\n");
    while (1) {
        if (rxready) {
            const char* p = (const char*)rxbuf + 1;
            if (rxbuf[0]=='A') {
                int b=rd_int(&p), s=rd_int(&p), e=rd_int(&p), g=rd_int(&p);
                if (b>=0&&s>=0&&e>=0&&g>=0){ set_angle(BASE,b); set_angle(SHOULDER,s);
                    set_angle(ELBOW,e); set_angle(GRIPPER,g); uart_puts("OK\n"); lcd_line(1,"Writing..."); }
                else uart_puts("ERR\n");
            } else if (rxbuf[0]=='H'){ arm_home(); uart_puts("OK\n"); }
            else uart_puts("ERR\n");
            rxlen=0; rxready=0;
        }
        GPIOC->ODR ^= (1u<<13); delay_ms(200);
    }
}

/* =============================== main =============================== */
int main(void)
{
    gpio_init();
    tim3_us_init();        /* 1 us counter for delay_us */
    systick_init();        /* 1 ms tick + servo ramp - must be before any delay_ms */
    tim2_pwm_init();
    adc_init();
    usart1_init();
    tim4_echo_init();
    i2c1_init();
    lcd_init();

    lcd_line(0, "HASTHA  F401");
    lcd_line(1, "Booting...");
    delay_ms(800);

#if   ACTIVE_TASK == 1
    task1();
#elif ACTIVE_TASK == 2
    task2();
#else
    task3();
#endif
    while (1) {}
}
