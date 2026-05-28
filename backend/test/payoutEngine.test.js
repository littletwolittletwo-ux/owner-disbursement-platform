import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayout } from '../src/services/payoutEngine.js';

test('Airbnb pays day after check-in and rolls Saturday to Monday', () => {
  const result = calculatePayout({
    platform: 'Airbnb',
    checkIn: '2026-05-15',
    checkOut: '2026-05-18',
    bookingDate: '2026-04-01',
    grossAmount: 1000
  });
  assert.equal(result.expectedPayoutDate, '2026-05-18');
  assert.equal(result.disbursementMonth, '2026-05');
  assert.equal(result.platformFee, 30);
});

test('Airbnb rolls Sunday payout to Monday and month follows Monday', () => {
  const result = calculatePayout({
    platform: 'Airbnb',
    checkIn: '2026-05-30',
    checkOut: '2026-06-02',
    bookingDate: '2026-04-01',
    grossAmount: 800
  });
  assert.equal(result.expectedPayoutDate, '2026-06-01');
  assert.equal(result.disbursementMonth, '2026-06');
});

test('Booking.com assigns payout to Friday after checkout for month-straddling stay', () => {
  const result = calculatePayout({
    platform: 'Booking.com',
    checkIn: '2026-05-28',
    checkOut: '2026-06-02',
    bookingDate: '2026-03-11',
    grossAmount: 1200
  });
  assert.equal(result.expectedPayoutDate, '2026-06-05');
  assert.equal(result.disbursementMonth, '2026-06');
  assert.equal(result.platformFee, 180);
});

test('VRBO payout is based on booking date, not stay dates', () => {
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
  assert.equal(result.platformFee, 75);
});
