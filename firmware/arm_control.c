/* ============================================================================
 *  arm_control.c  —  Phase 0 firmware base for the 4-DOF STM32 robotic arm
 *  Target: STM32F103C8T6 (Blue Pill), bare-metal register programming.
 *
 *  What changed vs. object.c / write.c:
 *    - No more blocking delayMs() sequences. The CPU is now ALWAYS free.
 *    - A 1 kHz control tick (TIM3) smoothly drives each servo from its
 *      current angle toward a target angle -> motion is smooth AND reactive.
 *    - USART1 (PA9/PA10) is interrupt-driven; the PC (or HC-05) sends simple
 *      text commands and the arm reacts in real time.
 *    - Live telemetry is pushed back so a UI can visualize the true state.
 *    - An emergency-stop state is built in from day one (goal 4c).
 *
 *  This single firmware replaces both old programs; behaviours (pick-place,
 *  write, hand-follow, morse) now live on the host PC and are expressed as
 *  streams of target-angle commands. See PROTOCOL.md.
 *
 *  Servo map (unchanged):  CH1=Base(PA0) CH2=Gripper(PA1)
 *                          CH3=Shoulder(PA2) CH4=Elbow(PA3)   via TIM2 @ 50 Hz
 *  Serial: USART1 TX=PA9, RX=PA10 @ 115200 8N1 (USB-TTL or HC-05)
 * ==========================================================================*/

#include "stm32f10x.h"

/* ----------------------------- Configuration ---------------------------- */
#define NUM_SERVOS        4
#define SERVO_MIN_US      500u        /* pulse width at   0 deg              */
#define SERVO_MAX_US      2500u       /* pulse width at 180 deg              */
#define ANGLE_MAX         180u

/* Motion speed: every SERVO_STEP_MS the current angle moves up to
 * SERVO_STEP_DEG toward the target. 3 deg / 15 ms ~= 200 deg/s (smooth,
 * still snappy enough for real-time hand-follow). Tune to taste. */
#define SERVO_STEP_MS     15u
#define SERVO_STEP_DEG    3u

#define TELEMETRY_MS      100u        /* auto-push "STATE ..." every 100 ms  */

/* Phase 3 safety/teleop */
#define OBSTACLE_CM       10u         /* e-stop if something is closer than this */
#define MODE_REMOTE       0u          /* targets come from serial (PC/HC-05)  */
#define MODE_JOYSTICK     1u          /* targets come from the analog joystick */

/* Home / safe pose (degrees), also used as the e-stop hold pose reference. */
static const uint8_t HOME_POSE[NUM_SERVOS] = { 90, 60, 90, 90 };

/* forward declarations (used by ISRs before their definitions) */
static void     ultrasonic_trigger(void);
static uint16_t adc_read(uint8_t ch);
int             obstacle_too_close(void);

/* ------------------------------ Servo state ------------------------------ */
static volatile uint8_t  target_angle[NUM_SERVOS];   /* where we want to be  */
static volatile uint8_t  current_angle[NUM_SERVOS];  /* where we are         */
static volatile uint8_t  estop = 0;                  /* 1 = frozen           */
static volatile uint8_t  control_mode = MODE_REMOTE; /* remote vs joystick   */
static volatile uint16_t distance_cm = 999;          /* last ultrasonic read  */

/* ---------------------------- UART RX plumbing --------------------------- */
#define RX_LINE_MAX  64
static volatile char     rx_line[RX_LINE_MAX];       /* assembled line       */
static volatile uint8_t  rx_len = 0;
static volatile uint8_t  rx_ready = 0;               /* 1 = full line waiting */

/* ---------------------------- Tick counters ------------------------------ */
static volatile uint32_t ms_ticks = 0;               /* 1 kHz from TIM3       */

/* ============================ Low-level output =========================== */

/* Convert 0..180 deg -> microseconds; CCRx counts in us (1 us timer tick). */
static uint16_t angle_to_us(uint8_t angle)
{
    if (angle > ANGLE_MAX) angle = ANGLE_MAX;
    return (uint16_t)(SERVO_MIN_US +
           ((uint32_t)angle * (SERVO_MAX_US - SERVO_MIN_US)) / ANGLE_MAX);
}

static void servo_write_hw(uint8_t ch, uint8_t angle)
{
    uint16_t us = angle_to_us(angle);
    switch (ch) {
        case 0: TIM2->CCR1 = us; break;   /* Base     */
        case 1: TIM2->CCR2 = us; break;   /* Gripper  */
        case 2: TIM2->CCR3 = us; break;   /* Shoulder */
        case 3: TIM2->CCR4 = us; break;   /* Elbow    */
    }
}

/* Public API used by the command parser: just set a goal, never block. */
static void servo_set_target(uint8_t ch, uint8_t angle)
{
    if (ch >= NUM_SERVOS) return;
    if (angle > ANGLE_MAX) angle = ANGLE_MAX;
    target_angle[ch] = angle;
}

/* =========================== Peripheral setup ============================ */

/* TIM2 -> 50 Hz PWM on PA0..PA3 (unchanged from the original design). */
static void TIM2_PWM_Init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
    RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;

    /* PA0..PA3 = AF push-pull 50 MHz (0xB). PA4..PA7 left as analog-in (0x0)
     * so PA4/PA5 are free for the joystick ADC later (Phase 3). */
    GPIOA->CRL = (GPIOA->CRL & 0xFFFF0000) | 0x0000BBBB;

    TIM2->PSC   = 72 - 1;                       /* 1 us tick @ 72 MHz         */
    TIM2->ARR   = 20000 - 1;                    /* 20 ms period -> 50 Hz      */
    TIM2->CCMR1 = (6 << 4) | (6 << 12);         /* CH1,CH2 PWM mode 1         */
    TIM2->CCMR2 = (6 << 4) | (6 << 12);         /* CH3,CH4 PWM mode 1         */
    TIM2->CCER  = 0x1111;                        /* enable CH1..CH4 outputs    */
    TIM2->CCR1  = TIM2->CCR2 = TIM2->CCR3 = TIM2->CCR4 = angle_to_us(90);
    TIM2->CR1   = 1;                             /* enable timer               */
}

/* TIM3 -> 1 kHz update interrupt: the heartbeat of the non-blocking engine. */
static void TIM3_Tick_Init(void)
{
    RCC->APB1ENR |= RCC_APB1ENR_TIM3EN;
    TIM3->PSC  = 72 - 1;                         /* 1 us tick                  */
    TIM3->ARR  = 1000 - 1;                       /* 1 ms period -> 1 kHz       */
    TIM3->DIER |= TIM_DIER_UIE;                  /* update interrupt enable    */
    TIM3->CR1  |= TIM_CR1_CEN;
    NVIC_EnableIRQ(TIM3_IRQn);
}

/* USART1 @ 115200 8N1, RX interrupt. TX=PA9 (AF PP), RX=PA10 (input). */
static void USART1_Init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_IOPAEN | RCC_APB2ENR_USART1EN | RCC_APB2ENR_AFIOEN;

    /* PA9 = AF push-pull 50 MHz (0xB); PA10 = floating input (0x4). */
    GPIOA->CRH = (GPIOA->CRH & 0xFFFFF00F) | 0x000004B0;

    USART1->BRR = 625;                           /* 72 MHz / 115200 = 625      */
    USART1->CR1 = USART_CR1_TE | USART_CR1_RE |  /* TX, RX enable              */
                  USART_CR1_RXNEIE;              /* RX-not-empty interrupt     */
    USART1->CR1 |= USART_CR1_UE;                 /* enable USART               */
    NVIC_EnableIRQ(USART1_IRQn);
}

/* ---------------------- ADC1 for the analog joystick --------------------- *
 * Joystick VRx -> PA4 (ADC ch4), VRy -> PA5 (ADC ch5). PA0..PA3 are the servo
 * PWM pins (also ADC0..3) so the joystick MUST use PA4/PA5. Pins were already
 * left as analog inputs in TIM2_PWM_Init(). */
static void adc_init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;
    RCC->CFGR    |= (2u << 14);                 /* ADC prescaler /6 -> 12 MHz  */

    ADC1->SQR1 = 0;                             /* 1 conversion in the sequence */
    ADC1->SMPR2 = (5u << 12) | (5u << 15);      /* ch4,ch5 = 55.5-cycle sample  */
    ADC1->CR2  = (7u << 17) | ADC_CR2_EXTTRIG;  /* SWSTART as trigger source    */
    ADC1->CR2 |= ADC_CR2_ADON;                  /* power up                     */
    for (volatile int i = 0; i < 10000; i++);   /* tADC stabilisation           */
    ADC1->CR2 |= ADC_CR2_RSTCAL; while (ADC1->CR2 & ADC_CR2_RSTCAL);
    ADC1->CR2 |= ADC_CR2_CAL;    while (ADC1->CR2 & ADC_CR2_CAL);
}

static uint16_t adc_read(uint8_t ch)
{
    ADC1->SQR3 = ch;                            /* single channel to convert    */
    ADC1->CR2 |= ADC_CR2_SWSTART;               /* start conversion             */
    while (!(ADC1->SR & ADC_SR_EOC));           /* wait ~1 us                   */
    return (uint16_t)ADC1->DR;                  /* 0..4095                      */
}

/* ------------------ HC-SR04 ultrasonic (emergency stop) ------------------ *
 * Trigger = PB0 (output). Echo = PB6 (TIM4_CH1) captured in PWM-input mode:
 * TIM4 resets on the echo's rising edge and latches the high-pulse width into
 * CCR2. With a 1 us timer tick, CCR2 (us) / 58 = distance in cm. Fully
 * interrupt-free from the CPU's view — no blocking echo polling. */
static void micro_delay(uint32_t us)            /* short blocking wait, ~us     */
{
    volatile uint32_t n = us * 12u;             /* ~12 cycles/us at 72 MHz      */
    while (n--) __NOP();
}

static void ultrasonic_init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
    RCC->APB1ENR |= RCC_APB1ENR_TIM4EN;

    /* PB0 = output push-pull 2 MHz (trigger); PB6 = floating input (echo). */
    GPIOB->CRL = (GPIOB->CRL & 0xF0FFFFF0) | 0x04000002;

    TIM4->PSC   = 72 - 1;                        /* 1 us tick                    */
    TIM4->ARR   = 0xFFFF;                        /* ~65 ms max window            */
    TIM4->CCMR1 = (1u << 0) | (2u << 8);         /* IC1=TI1 rising, IC2=TI1 fall */
    TIM4->CCER  = (1u << 0) | (1u << 4) | (1u << 5); /* CC1E, CC2E, CC2 falling  */
    TIM4->SMCR  = (5u << 4) | (4u << 0);         /* TS=TI1FP1, SMS=reset on edge */
    TIM4->CR1  |= TIM_CR1_CEN;
}

static void ultrasonic_trigger(void)
{
    GPIOB->BSRR = (1u << 0);                     /* PB0 high                     */
    micro_delay(12);                            /* >=10 us trigger pulse        */
    GPIOB->BRR  = (1u << 0);                     /* PB0 low                      */
}

/* Real obstacle check (replaces the Phase-0 stub). Safe default: if the sensor
 * is absent/unwired, CCR2 stays 0 -> reported far -> never false-triggers. */
int obstacle_too_close(void)
{
    uint16_t us = TIM4->CCR2;
    if (us == 0) { distance_cm = 999; return 0; }
    distance_cm = us / 58u;
    return (distance_cm > 0 && distance_cm < OBSTACLE_CM);
}

/* ------------------------------ UART TX ---------------------------------- */
static void uart_putc(char c)
{
    while (!(USART1->SR & USART_SR_TXE));
    USART1->DR = (uint16_t)c;
}
static void uart_puts(const char *s) { while (*s) uart_putc(*s++); }

/* tiny unsigned int -> decimal print (avoids pulling in printf) */
static void uart_putu(uint32_t v)
{
    char buf[10]; int i = 0;
    if (v == 0) { uart_putc('0'); return; }
    while (v) { buf[i++] = (char)('0' + v % 10); v /= 10; }
    while (i) uart_putc(buf[--i]);
}

/* ======================= Interrupt service routines ====================== */

/* 1 kHz: advance each servo toward its target unless we're in e-stop. */
void TIM3_IRQHandler(void)
{
    if (TIM3->SR & TIM_SR_UIF) {
        TIM3->SR &= ~TIM_SR_UIF;
        ms_ticks++;

        /* HC-SR04 safety: fire trigger every 60 ms, latch distance, auto-stop. */
        if ((ms_ticks % 60) == 0) ultrasonic_trigger();
        if (obstacle_too_close()) estop = 1;

        /* Joystick teleop: ADC drives base + shoulder targets while in that mode. */
        if (control_mode == MODE_JOYSTICK && (ms_ticks % 30) == 0 && !estop) {
            target_angle[0] = (uint8_t)((uint32_t)adc_read(4) * 180u / 4095u); /* base     */
            target_angle[2] = (uint8_t)((uint32_t)adc_read(5) * 180u / 4095u); /* shoulder */
        }

        if ((ms_ticks % SERVO_STEP_MS) == 0 && !estop) {
            for (uint8_t ch = 0; ch < NUM_SERVOS; ch++) {
                int16_t cur = current_angle[ch];
                int16_t tgt = target_angle[ch];
                int16_t diff = tgt - cur;
                if (diff > SERVO_STEP_DEG)       cur += SERVO_STEP_DEG;
                else if (diff < -SERVO_STEP_DEG) cur -= SERVO_STEP_DEG;
                else                             cur = tgt;
                current_angle[ch] = (uint8_t)cur;
                servo_write_hw(ch, (uint8_t)cur);
            }
        }
        /* In e-stop we simply stop updating CCRx: PWM keeps holding the last
         * position (arm freezes in place rather than going limp). */
    }
}

/* Assemble incoming bytes into a line; flag when '\n' arrives. */
void USART1_IRQHandler(void)
{
    if (USART1->SR & USART_SR_RXNE) {
        char c = (char)(USART1->DR & 0xFF);
        if (c == '\n' || c == '\r') {
            if (rx_len > 0 && !rx_ready) {
                rx_line[rx_len] = '\0';
                rx_ready = 1;                    /* main loop will parse it    */
            }
        } else if (rx_len < RX_LINE_MAX - 1 && !rx_ready) {
            rx_line[rx_len++] = c;
        }
    }
}

/* ============================ Command parser ============================= */
/* Line grammar (see PROTOCOL.md):
 *   A b g s e   set all 4 target angles
 *   S <ch> <a>  set one servo target
 *   H           go to home pose
 *   E           emergency stop (freeze)
 *   R           release e-stop
 *   ?           request one telemetry line
 */
static const char *skip_spaces(const char *p) { while (*p == ' ') p++; return p; }

/* parse a non-negative int, advance *pp past it; returns -1 if no digits */
static int parse_int(const char **pp)
{
    const char *p = skip_spaces(*pp);
    if (*p < '0' || *p > '9') return -1;
    int v = 0;
    while (*p >= '0' && *p <= '9') { v = v * 10 + (*p - '0'); p++; }
    *pp = p;
    return v;
}

static void send_state(void)
{
    uart_puts("STATE ");
    for (uint8_t i = 0; i < NUM_SERVOS; i++) { uart_putu(current_angle[i]); uart_putc(' '); }
    uart_putu(estop);        uart_putc(' ');
    uart_putu(control_mode); uart_putc(' ');
    uart_putu(distance_cm);  uart_putc('\n');
}

static void handle_line(const char *line)
{
    char cmd = line[0];
    const char *args = line + 1;

    switch (cmd) {
        case 'A': {
            int a[NUM_SERVOS];
            for (int i = 0; i < NUM_SERVOS; i++) {
                a[i] = parse_int(&args);
                if (a[i] < 0) { uart_puts("ERR\n"); return; }
            }
            if (control_mode == MODE_JOYSTICK) { uart_puts("BUSY\n"); return; }
            for (int i = 0; i < NUM_SERVOS; i++) servo_set_target(i, (uint8_t)a[i]);
            uart_puts("OK\n");
            break;
        }
        case 'S': {
            int ch = parse_int(&args);
            int an = parse_int(&args);
            if (ch < 0 || an < 0 || ch >= NUM_SERVOS) { uart_puts("ERR\n"); return; }
            if (control_mode == MODE_JOYSTICK) { uart_puts("BUSY\n"); return; }
            servo_set_target((uint8_t)ch, (uint8_t)an);
            uart_puts("OK\n");
            break;
        }
        case 'J': {                              /* J 1 = joystick, J 0 = remote */
            int m = parse_int(&args);
            control_mode = (m == 1) ? MODE_JOYSTICK : MODE_REMOTE;
            uart_puts("OK\n");
            break;
        }
        case 'H':
            for (int i = 0; i < NUM_SERVOS; i++) servo_set_target(i, HOME_POSE[i]);
            uart_puts("OK\n");
            break;
        case 'E': estop = 1; uart_puts("OK\n"); break;
        case 'R': estop = 0; uart_puts("OK\n"); break;
        case '?': send_state(); break;
        default:  uart_puts("ERR\n"); break;
    }
}

/* ================================= main ================================== */
int main(void)
{
    /* initialize angle state to home before enabling motion */
    for (uint8_t i = 0; i < NUM_SERVOS; i++) {
        current_angle[i] = HOME_POSE[i];
        target_angle[i]  = HOME_POSE[i];
    }

    TIM2_PWM_Init();
    for (uint8_t i = 0; i < NUM_SERVOS; i++) servo_write_hw(i, HOME_POSE[i]);
    USART1_Init();
    adc_init();                 /* joystick (Phase 3)  */
    ultrasonic_init();          /* HC-SR04  (Phase 3)  */
    TIM3_Tick_Init();           /* start the control loop last */

    uart_puts("READY\n");

    uint32_t last_tel = 0;
    while (1) {
        /* 1) process any complete command line */
        if (rx_ready) {
            handle_line((const char *)rx_line);
            rx_len = 0;
            rx_ready = 0;
        }
        /* 2) push telemetry so the UI sees the live arm state */
        if (ms_ticks - last_tel >= TELEMETRY_MS) {
            last_tel = ms_ticks;
            send_state();
        }
    }
}
