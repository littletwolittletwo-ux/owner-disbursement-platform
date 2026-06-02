import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayout } from '../src/services/payoutEngine.js';

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
  // May 15 Fri, May 16 Sat -> rolls to May 18 Mon
  const result = calculatePayout({
    platform: 'Airbnb',
    checkIn: '2026-05-15',
    checkOut: '2026-05-18',
    bookingDate: '2026-04-01',
    grossAmount: 1000
  });
  // May 15 2026 is a Friday, day after is May 16 Saturday
  // Actually let me check: May 15 2026 is a Friday
  // Day after = May 16 = Saturday -> rolls to Monday May 18
  // Wait, the function does: addDays(checkIn, 1) = May 16
  // dayOfWeek(May 16) - need to check what day May 16 2026 is
  // May 1 2026 is Friday, May 15 is Friday, May 16 is Saturday
  // So dow=6 -> addDays(2) = May 18 (Monday)
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

// === VRBO Tests (12% channel fee) ===

test('VRBO payout based on booking date, 12% channel fee', () => {
  const result = calculatePayout({
    platform: 'VRBO',
    checkIn: '2026-08-10',
    checkOut: '2026-08-15',
    bookingDate: '2026-05-28',
    grossAmount: 1500,
    vrboReleaseDays: 2
  });
  assert.equal(result.expectedPayoutDate, '2026-05-30');
  assert.equal(result.disbursementMonth, '2026-05');
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

// === Disbursement Calculation Order Test ===

test('Full disbursement math: gross -> channel fee -> cleaning -> mgmt+GST -> software -> expenses', () => {
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

  // Step 3: Channel payout = $835
  assert.equal(result.netAfterPlatformFee, 835);

  // Step 4: Cleaning = $120 (tracked)
  assert.equal(result.cleaningFee, 120);

  // Step 5: Net income = $835 - $120 = $715
  const netIncome = result.netAfterPlatformFee - result.cleaningFee;
  assert.equal(netIncome, 715);

  // Step 6: Management fee = 18% of $715 = $128.70
  const mgmtBase = Math.round((netIncome * 0.18 + Number.EPSILON) * 100) / 100;
  assert.equal(mgmtBase, 128.70);

  // Step 7: GST on mgmt = 10% of $128.70 = $12.87
  const mgmtGst = Math.round((mgmtBase * 0.10 + Number.EPSILON) * 100) / 100;
  assert.equal(mgmtGst, 12.87);

  // Step 8: Total mgmt = $128.70 + $12.87 = $141.57
  const mgmtTotal = Math.round((mgmtBase + mgmtGst + Number.EPSILON) * 100) / 100;
  assert.equal(mgmtTotal, 141.57);

  // Step 9: After management = $715 - $141.57 = $573.43
  const afterMgmt = Math.round((netIncome - mgmtTotal + Number.EPSILON) * 100) / 100;
  assert.equal(afterMgmt, 573.43);

  // Step 10: Software fee = $65.99 (per property)
  // Step 11: Sample expense = $50
  // Final = $573.43 - $65.99 - $50 = $457.44
  const finalPayout = Math.round((afterMgmt - 65.99 - 50 + Number.EPSILON) * 100) / 100;
  assert.equal(finalPayout, 457.44);
});
