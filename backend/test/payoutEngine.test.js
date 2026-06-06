import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayout, countPeriodNights, proRateReservation } from '../src/services/payoutEngine.js';

// === Airbnb Tests (16.5% channel fee) ===

test('Airbnb pays day after check-in, 16.5% channel fee', () => {
  // May 11 2026 is Monday, day after = May 12 (Tuesday, business day)
  const result = calculatePayout({
    platform: 'Airbnb',
    checkIn: '2026-05-11',
    checkOut: '2026-05-14',
    bookingDate: '2026-04-01',
    grossAmount: 1000
  });
  assert.equal(result.expectedPayoutDate, '2026-05-12');
  assert.equal(result.disbursementMonth, '2026-05');
  assert.equal(result.platformFee, 165); // 16.5% of 1000
  assert.equal(result.netAfterPlatformFee, 835);
});

test('Airbnb rolls Saturday payout to Monday', () => {
  const result = calculatePayout({
    platform: 'Airbnb',
    checkIn: '2026-05-15',
    checkOut: '2026-05-18',
    bookingDate: '2026-04-01',
    grossAmount: 1000
  });
  // May 15 2026 is a Friday, day after is May 16 Saturday
  // dow=6 -> addDays(2) = May 18 (Monday)
  assert.equal(result.expectedPayoutDate, '2026-05-18');
  assert.equal(result.disbursementMonth, '2026-05');
});

test('Airbnb rolls Sunday payout to Monday, crossing month boundary', () => {
  // May 30 2026 is Saturday, day after = May 31 (Sunday) -> rolls to June 1 (Monday)
  const result = calculatePayout({
    platform: 'Airbnb',
    checkIn: '2026-05-30',
    checkOut: '2026-06-02',
    bookingDate: '2026-04-01',
    grossAmount: 800
  });
  assert.equal(result.expectedPayoutDate, '2026-06-01');
  assert.equal(result.disbursementMonth, '2026-06');
  assert.equal(result.platformFee, 132); // 16.5% of 800
});

// === Booking.com Tests (16.5% channel fee) ===

test('Booking.com pays Friday after checkout, month-straddling stay', () => {
  // Checkout June 2 (Tue), next Friday = June 5
  const result = calculatePayout({
    platform: 'Booking.com',
    checkIn: '2026-05-28',
    checkOut: '2026-06-02',
    bookingDate: '2026-03-11',
    grossAmount: 1200
  });
  assert.equal(result.expectedPayoutDate, '2026-06-05');
  assert.equal(result.disbursementMonth, '2026-06');
  assert.equal(result.platformFee, 198); // 16.5% of 1200
  assert.equal(result.netAfterPlatformFee, 1002);
});

test('Booking.com checkout on Thursday, pays next Friday', () => {
  const result = calculatePayout({
    platform: 'Booking.com',
    checkIn: '2026-05-18',
    checkOut: '2026-05-21', // Thursday
    grossAmount: 600
  });
  assert.equal(result.expectedPayoutDate, '2026-05-22'); // Friday
  assert.equal(result.platformFee, 99); // 16.5% of 600
});

test('Booking.com checkout on Friday gets 7-day gap to following Friday', () => {
  // May 29 2026 is a Friday -> payout is FOLLOWING Friday June 5 (strictly after checkout)
  const result = calculatePayout({
    platform: 'Booking.com',
    checkIn: '2026-05-25',
    checkOut: '2026-05-29', // Friday
    grossAmount: 800
  });
  assert.equal(result.expectedPayoutDate, '2026-06-05');
  assert.equal(result.disbursementMonth, '2026-06');
  assert.equal(result.platformFee, 132); // 16.5% of 800
});

// === VRBO Tests (12% channel fee) ===

test('VRBO payout is day after checkout, 12% channel fee', () => {
  // Spec §2.2: VRBO releases payout the day after checkout
  const result = calculatePayout({
    platform: 'VRBO',
    checkIn: '2026-08-10',
    checkOut: '2026-08-15',
    bookingDate: '2026-05-28',
    grossAmount: 1500,
    vrboReleaseDays: 2  // ignored now
  });
  assert.equal(result.expectedPayoutDate, '2026-08-16'); // checkout + 1 day
  assert.equal(result.disbursementMonth, '2026-08');
  assert.equal(result.platformFee, 180); // 12% of 1500
  assert.equal(result.netAfterPlatformFee, 1320);
});

// === Direct Booking Tests (0% channel fee) ===

test('Direct booking has 0% channel fee', () => {
  const result = calculatePayout({
    platform: 'Direct',
    checkIn: '2026-05-15',
    checkOut: '2026-05-18',
    grossAmount: 500
  });
  assert.equal(result.platformFee, 0);
  assert.equal(result.netAfterPlatformFee, 500);
});

// === Disbursement Calculation Order Test (incGST model) ===

test('Full disbursement math: gross -> channel fee -> mgmt (incGST) -> cleaning -> expenses', () => {
  // Simulate an Airbnb booking: guest pays $1000
  const result = calculatePayout({
    platform: 'Airbnb',
    checkIn: '2026-05-15',
    checkOut: '2026-05-18',
    grossAmount: 1000,
    cleaningFee: 120
  });

  // Step 1: Gross = $1000
  assert.equal(result.grossAmount, 1000);

  // Step 2: Channel commission = 16.5% = $165
  assert.equal(result.platformFee, 165);

  // Step 3: Net payout (channel payout) = $835
  const netPayout = result.netAfterPlatformFee;
  assert.equal(netPayout, 835);

  // Step 4: Management fee (incGST) = 19.8% of net payout = $835 * 0.198 = $165.33
  //   (19.8% incGST = 18% base + 10% GST, combined into single rate)
  const mgmtFee = Math.round((netPayout * 0.198 + Number.EPSILON) * 100) / 100;
  assert.equal(mgmtFee, 165.33);

  // Step 5: After management = $835 - $165.33 = $669.67
  const afterMgmt = Math.round((netPayout - mgmtFee + Number.EPSILON) * 100) / 100;
  assert.equal(afterMgmt, 669.67);

  // Step 6: Cleaning = $120
  assert.equal(result.cleaningFee, 120);

  // Step 7: After cleaning = $669.67 - $120 = $549.67
  const afterCleaning = Math.round((afterMgmt - result.cleaningFee + Number.EPSILON) * 100) / 100;
  assert.equal(afterCleaning, 549.67);

  // Step 8: Sample expense = $50
  // Final = $549.67 - $50 = $499.67  (no software fee in real reports)
  const finalPayout = Math.round((afterCleaning - 50 + Number.EPSILON) * 100) / 100;
  assert.equal(finalPayout, 499.67);
});

// === Management Fee Discount Test ===

test('Management fee with 55% waiver and boost reduces effective fee', () => {
  // Property with 22% incGST rate, 55% waiver, $0 boost
  const netPayout = 3447.23; // sample channel payout
  const mgmtRate = 0.22;
  const waiverPct = 0.55;
  const boost = 0;

  const fullFee = Math.round((netPayout * mgmtRate + Number.EPSILON) * 100) / 100;
  assert.equal(fullFee, 758.39);

  const waiverAmt = Math.round((fullFee * waiverPct + Number.EPSILON) * 100) / 100;
  assert.equal(waiverAmt, 417.11);

  const effectiveFee = Math.round((fullFee - waiverAmt - boost + Number.EPSILON) * 100) / 100;
  assert.equal(effectiveFee, 341.28);
});

test('Management fee with 100% waiver + boost gives credit to owner', () => {
  const netPayout = 2777.38;
  const mgmtRate = 0.209;
  const waiverPct = 1.0;
  const boost = 228.53;

  const fullFee = Math.round((netPayout * mgmtRate + Number.EPSILON) * 100) / 100;
  assert.equal(fullFee, 580.47);

  const waiverAmt = Math.round((fullFee * waiverPct + Number.EPSILON) * 100) / 100;
  const discount = waiverAmt + boost;
  const effectiveFee = Math.round((fullFee - discount + Number.EPSILON) * 100) / 100;
  // Full fee waived + $228.53 boost = owner gets $228.53 credit
  assert.equal(effectiveFee, -228.53);
});

// === Pro-Rating Tests (spec §4) ===

test('countPeriodNights: straddling booking Apr 30 → May 3 in May period', () => {
  // Total nights: 3 (Apr 30, May 1, May 2)
  // May nights: 2 (May 1, May 2)
  const { periodNights, totalNights } = countPeriodNights('2026-04-30', '2026-05-03', '2026-05-01', '2026-05-31');
  assert.equal(totalNights, 3);
  assert.equal(periodNights, 2);
});

test('countPeriodNights: zero-night straddler (checkout May 1, only night is Apr 30)', () => {
  // Total nights: 1 (Apr 30)
  // May nights: 0 (the only night is Apr 30, before period)
  const { periodNights, totalNights } = countPeriodNights('2026-04-30', '2026-05-01', '2026-05-01', '2026-05-31');
  assert.equal(totalNights, 1);
  assert.equal(periodNights, 0);
});

test('countPeriodNights: full month booking (no pro-rating needed)', () => {
  const { periodNights, totalNights } = countPeriodNights('2026-05-05', '2026-05-10', '2026-05-01', '2026-05-31');
  assert.equal(totalNights, 5);
  assert.equal(periodNights, 5);
});

test('proRateReservation: straddling 2/3 nights', () => {
  const result = proRateReservation({
    checkIn: '2026-04-30',
    checkOut: '2026-05-03',
    grossAmount: 468.40,
    cleaningFee: 90
  }, '2026-05-01', '2026-05-31');
  assert.equal(result.periodNights, 2);
  assert.equal(result.totalNights, 3);
  assert.equal(result.periodGross, 312.27); // 468.40 * 2/3
  assert.equal(result.periodCleaning, 60); // 90 * 2/3
});

test('proRateReservation: zero-night straddler returns $0', () => {
  const result = proRateReservation({
    checkIn: '2026-04-30',
    checkOut: '2026-05-01',
    grossAmount: 200,
    cleaningFee: 50
  }, '2026-05-01', '2026-05-31');
  assert.equal(result.periodNights, 0);
  assert.equal(result.totalNights, 1);
  assert.equal(result.periodGross, 0);
  assert.equal(result.periodCleaning, 0);
});

test('proRateReservation: full stay within period (no pro-rating)', () => {
  const result = proRateReservation({
    checkIn: '2026-05-10',
    checkOut: '2026-05-15',
    grossAmount: 1000,
    cleaningFee: 120
  }, '2026-05-01', '2026-05-31');
  assert.equal(result.periodNights, 5);
  assert.equal(result.totalNights, 5);
  assert.equal(result.periodGross, 1000);
  assert.equal(result.periodCleaning, 120);
});
