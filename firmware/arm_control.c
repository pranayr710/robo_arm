/* ============================================================================
 *  arm_control.c — hardware-ready firmware for the STM32 4-DOF robotic arm.
 *  Target: STM32F103C8T6 (Blue Pill), bare-metal. All hardware specifics live
 *  in config.h — this file is generic.
 *
 *  Design:
 *    - Non-blocking: a 1 kHz control loop (TIM3) ramps each servo toward its
 *      target, so the CPU is always free to listen. No blocking delay loops.
 *    - Interrupt-driven serial command server on USART1 (USB-TTL or HC-05).
 *    - Per-servo calibration + safe angle limits (config.h or 'C' at runtime).
 *    - Joystick teleop (ADC), HC-SR04 emergency stop, link-loss failsafe.
 *    - Live telemetry so the host UI mirrors the true arm state.
 *
 *  Serial protocol — see PROTOCOL.md. One command per '\n'-terminated line.
 * ==========================================================================*/

#include "stm32f10x.h"
#include "config.h"

/* --------------------------- derived config ----------------------------- */
static const uint16_t CAL_MIN_DEFAULT[NUM_SERVOS] = SERVO_CAL_MIN_US;
static const uint16_t CAL_MAX_DEFAULT[NUM_SERVOS] = SERVO_CAL_MAX_US;
static const uint8_t  LIM_MIN[NUM_SERVOS]         = SERVO_MIN_DEG;
static const uint8_t  LIM_MAX[NUM_SERVOS]         = SERVO_MAX_DEG;
static const uint8_t  HOME[NUM_SERVOS]            = HOME_POSE;

/* runtime-tunable calibration (seeded from config, changed by 'C' command) */
static uint16_t cal_min[NUM_SERVOS];
static uint16_t cal_max[NUM_SERVOS];

enum { MODE_REMOTE = 0, MODE_JOYSTICK = 1 };

/* ------------------------------ state ----------------------------------- */
static volatile uint8_t  target_angle[NUM_SERVOS];
static volatile uint8_t  current_angle[NUM_SERVOS];
static volatile uint8_t  estop        = 0;
static volatile uint8_t  control_mode = MODE_REMOTE;
static volatile uint8_t  step_deg      = SERVO_STEP_DEG;
static volatile uint16_t distance_cm  = 999;
static volatile uint32_t ms_ticks     = 0;
static volatile uint32_t last_cmd_ms  = 0;

/* --------------------------- UART RX plumbing --------------------------- */
#define RX_LINE_MAX 64
static volatile char    rx_line[RX_LINE_MAX];
static volatile uint8_t rx_len = 0, rx_ready = 0;

/* forward decls */
static void     ultrasonic_trigger(void);
static uint16_t adc_read(uint8_t ch);
static int      obstacle_too_close(void);

/* ============================ servo output ============================== */
static uint16_t angle_to_us(uint8_t ch, uint8_t angle)
{
    if (angle < LIM_MIN[ch]) angle = LIM_MIN[ch];
    if (angle > LIM_MAX[ch]) angle = LIM_MAX[ch];
    return (uint16_t)(cal_min[ch] +
           ((uint32_t)angle * (cal_max[ch] - cal_min[ch])) / 180u);
}

static void servo_write_hw(uint8_t ch, uint8_t angle)
{
    uint16_t us = angle_to_us(ch, angle);
    switch (ch) {              /* TIM2 CH1..CH4 = PA0..PA3 */
        case 0: TIM2->CCR1 = us; break;
        case 1: TIM2->CCR2 = us; break;
        case 2: TIM2->CCR3 = us; break;
        case 3: TIM2->CCR4 = us; break;
        /* add case 4/5 -> TIM3->CCRx here if you enable more channels */
    }
}

static void servo_set_target(uint8_t ch, uint8_t angle)
{
    if (ch >= NUM_SERVOS) return;
    if (angle < LIM_MIN[ch]) angle = LIM_MIN[ch];
    if (angle > LIM_MAX[ch]) angle = LIM_MAX[ch];
    target_angle[ch] = angle;
}

/* =========================== peripheral init =========================== */
static void TIM2_PWM_Init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
    RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;
    /* PA0..PA3 = AF push-pull 50MHz; PA4..PA7 left analog-in (for ADC). */
    GPIOA->CRL = (GPIOA->CRL & 0xFFFF0000) | 0x0000BBBB;
    TIM2->PSC   = 72 - 1;
    TIM2->ARR   = 20000 - 1;                 /* 50 Hz */
    TIM2->CCMR1 = (6 << 4) | (6 << 12);
    TIM2->CCMR2 = (6 << 4) | (6 << 12);
    TIM2->CCER  = 0x1111;
    TIM2->CR1   = 1;
}

static void TIM3_Tick_Init(void)
{
    RCC->APB1ENR |= RCC_APB1ENR_TIM3EN;
    TIM3->PSC  = 72 - 1;
    TIM3->ARR  = 1000 - 1;                    /* 1 kHz */
    TIM3->DIER |= TIM_DIER_UIE;
    TIM3->CR1  |= TIM_CR1_CEN;
    NVIC_EnableIRQ(TIM3_IRQn);
}

static void USART1_Init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_IOPAEN | RCC_APB2ENR_USART1EN | RCC_APB2ENR_AFIOEN;
    GPIOA->CRH = (GPIOA->CRH & 0xFFFFF00F) | 0x000004B0;   /* PA9 AF PP, PA10 in */
    USART1->BRR = 72000000u / UART_BAUD;
    USART1->CR1 = USART_CR1_TE | USART_CR1_RE | USART_CR1_RXNEIE;
    USART1->CR1 |= USART_CR1_UE;
    NVIC_EnableIRQ(USART1_IRQn);
}

#if FEATURE_JOYSTICK
static void adc_init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;
    RCC->CFGR    |= (2u << 14);               /* ADC clock /6 = 12 MHz */
    ADC1->SQR1  = 0;
    ADC1->SMPR2 = (5u << 12) | (5u << 15);    /* ch4,ch5 55.5-cycle sample */
    ADC1->CR2   = (7u << 17) | ADC_CR2_EXTTRIG;
    ADC1->CR2  |= ADC_CR2_ADON;
    for (volatile int i = 0; i < 10000; i++);
    ADC1->CR2  |= ADC_CR2_RSTCAL; while (ADC1->CR2 & ADC_CR2_RSTCAL);
    ADC1->CR2  |= ADC_CR2_CAL;    while (ADC1->CR2 & ADC_CR2_CAL);
}
static uint16_t adc_read(uint8_t ch)
{
    ADC1->SQR3 = ch;
    ADC1->CR2 |= ADC_CR2_SWSTART;
    while (!(ADC1->SR & ADC_SR_EOC));
    return (uint16_t)ADC1->DR;
}
#else
static void adc_init(void) {}
static uint16_t adc_read(uint8_t ch) { (void)ch; return 2048; }
#endif

#if FEATURE_ULTRASONIC
static void micro_delay(uint32_t us) { volatile uint32_t n = us * 12u; while (n--) __NOP(); }
static void ultrasonic_init(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
    RCC->APB1ENR |= RCC_APB1ENR_TIM4EN;
    GPIOB->CRL = (GPIOB->CRL & 0xF0FFFFF0) | 0x04000002;  /* PB0 out, PB6 in */
    TIM4->PSC   = 72 - 1;
    TIM4->ARR   = 0xFFFF;
    TIM4->CCMR1 = (1u << 0) | (2u << 8);
    TIM4->CCER  = (1u << 0) | (1u << 4) | (1u << 5);
    TIM4->SMCR  = (5u << 4) | (4u << 0);
    TIM4->CR1  |= TIM_CR1_CEN;
}
static void ultrasonic_trigger(void)
{
    GPIOB->BSRR = (1u << 0); micro_delay(12); GPIOB->BRR = (1u << 0);
}
static int obstacle_too_close(void)
{
    uint16_t us = TIM4->CCR2;
    if (us == 0) { distance_cm = 999; return 0; }
    distance_cm = us / 58u;
    return (distance_cm > 0 && distance_cm < OBSTACLE_CM);
}
#else
static void ultrasonic_init(void) {}
static void ultrasonic_trigger(void) {}
static int  obstacle_too_close(void) { return 0; }
#endif

/* ------------------------------ UART TX --------------------------------- */
static void uart_putc(char c) { while (!(USART1->SR & USART_SR_TXE)); USART1->DR = (uint16_t)c; }
static void uart_puts(const char *s) { while (*s) uart_putc(*s++); }
static void uart_putu(uint32_t v)
{
    char b[10]; int i = 0;
    if (!v) { uart_putc('0'); return; }
    while (v) { b[i++] = (char)('0' + v % 10); v /= 10; }
    while (i) uart_putc(b[--i]);
}

/* ======================= interrupt service routines ===================== */
void TIM3_IRQHandler(void)
{
    if (!(TIM3->SR & TIM_SR_UIF)) return;
    TIM3->SR &= ~TIM_SR_UIF;
    ms_ticks++;

#if FEATURE_ULTRASONIC
    if ((ms_ticks % 60) == 0) ultrasonic_trigger();
    if (obstacle_too_close()) estop = 1;
#endif
    if (FAILSAFE_MS && !estop && control_mode == MODE_REMOTE &&
        (ms_ticks - last_cmd_ms) > FAILSAFE_MS) estop = 1;   /* link-loss guard */

#if FEATURE_JOYSTICK
    if (control_mode == MODE_JOYSTICK && (ms_ticks % 30) == 0 && !estop) {
        target_angle[0] = (uint8_t)((uint32_t)adc_read(4) * 180u / 4095u);
        if (NUM_SERVOS > 2)
            target_angle[2] = (uint8_t)((uint32_t)adc_read(5) * 180u / 4095u);
    }
#endif

    if ((ms_ticks % SERVO_STEP_MS) == 0 && !estop) {
        for (uint8_t ch = 0; ch < NUM_SERVOS; ch++) {
            int16_t cur = current_angle[ch], tgt = target_angle[ch];
            int16_t d = tgt - cur;
            if (d >  step_deg)      cur += step_deg;
            else if (d < -step_deg) cur -= step_deg;
            else                    cur = tgt;
            current_angle[ch] = (uint8_t)cur;
            servo_write_hw(ch, (uint8_t)cur);
        }
    }
}

void USART1_IRQHandler(void)
{
    if (!(USART1->SR & USART_SR_RXNE)) return;
    char c = (char)(USART1->DR & 0xFF);
    if (c == '\n' || c == '\r') {
        if (rx_len && !rx_ready) { rx_line[rx_len] = '\0'; rx_ready = 1; }
    } else if (rx_len < RX_LINE_MAX - 1 && !rx_ready) {
        rx_line[rx_len++] = c;
    }
}

/* ============================ command parser =========================== */
static const char *skip_sp(const char *p) { while (*p == ' ') p++; return p; }
static int parse_int(const char **pp)
{
    const char *p = skip_sp(*pp);
    if (*p < '0' || *p > '9') return -1;
    int v = 0;
    while (*p >= '0' && *p <= '9') v = v * 10 + (*p++ - '0');
    *pp = p; return v;
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
    last_cmd_ms = ms_ticks;
    const char *a = line + 1;
    switch (line[0]) {
        case 'A': {
            int v[NUM_SERVOS];
            for (int i = 0; i < NUM_SERVOS; i++) { v[i] = parse_int(&a); if (v[i] < 0) { uart_puts("ERR\n"); return; } }
            if (control_mode == MODE_JOYSTICK) { uart_puts("BUSY\n"); return; }
            for (int i = 0; i < NUM_SERVOS; i++) servo_set_target(i, (uint8_t)v[i]);
            uart_puts("OK\n"); break;
        }
        case 'S': {
            int ch = parse_int(&a), an = parse_int(&a);
            if (ch < 0 || an < 0 || ch >= NUM_SERVOS) { uart_puts("ERR\n"); return; }
            if (control_mode == MODE_JOYSTICK) { uart_puts("BUSY\n"); return; }
            servo_set_target((uint8_t)ch, (uint8_t)an); uart_puts("OK\n"); break;
        }
        case 'C': {                              /* C ch minUs maxUs — calibrate */
            int ch = parse_int(&a), mn = parse_int(&a), mx = parse_int(&a);
            if (ch < 0 || ch >= NUM_SERVOS || mn < 0 || mx < 0) { uart_puts("ERR\n"); return; }
            cal_min[ch] = (uint16_t)mn; cal_max[ch] = (uint16_t)mx; uart_puts("OK\n"); break;
        }
        case 'V': {                              /* V step — motion speed (deg) */
            int s = parse_int(&a);
            if (s < 1) { uart_puts("ERR\n"); return; }
            step_deg = (uint8_t)(s > 20 ? 20 : s); uart_puts("OK\n"); break;
        }
        case 'J': { int m = parse_int(&a); control_mode = (m == 1) ? MODE_JOYSTICK : MODE_REMOTE; uart_puts("OK\n"); break; }
        case 'H': for (int i = 0; i < NUM_SERVOS; i++) servo_set_target(i, HOME[i]); uart_puts("OK\n"); break;
        case 'E': estop = 1; uart_puts("OK\n"); break;
        case 'R': estop = 0; last_cmd_ms = ms_ticks; uart_puts("OK\n"); break;
        case 'P': uart_puts("PONG\n"); break;
        case 'I': uart_puts("INFO v" FW_VERSION " servos "); uart_putu(NUM_SERVOS); uart_putc('\n'); break;
        case '?': send_state(); break;
        default:  uart_puts("ERR\n"); break;
    }
}

/* ================================= main ================================ */
int main(void)
{
    for (uint8_t i = 0; i < NUM_SERVOS; i++) {
        cal_min[i] = CAL_MIN_DEFAULT[i];
        cal_max[i] = CAL_MAX_DEFAULT[i];
        current_angle[i] = target_angle[i] = HOME[i];
    }

    TIM2_PWM_Init();
    for (uint8_t i = 0; i < NUM_SERVOS; i++) servo_write_hw(i, HOME[i]);
    USART1_Init();
    adc_init();
    ultrasonic_init();
    TIM3_Tick_Init();

    uart_puts("READY v" FW_VERSION "\n");

    uint32_t last_tel = 0;
    while (1) {
        if (rx_ready) { handle_line((const char *)rx_line); rx_len = 0; rx_ready = 0; }
        if (ms_ticks - last_tel >= 100) { last_tel = ms_ticks; send_state(); }
    }
}
