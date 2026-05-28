import { addDays, dayOfWeek, monthKey, toDateOnly } from '../utils/dates.js';

const DEFAULT_FEE_RATES = {
  airbnb: 0.03,
  'booking.com': 0.15,
  booking: 0.15,
  vrbo: 0.05
};

export function normalizePlatform(platform = '') {
  const value = String(platform).trim().toLowerCase();
  if (value.includes('airbnb')) return 'airbnb';
  if (value.includes('booking')) return 'booking.com';
  if (value.includes('vrbo') || value.includes('homeaway')) return 'vrbo';
  return value || 'unknown';
}

export function calculateExpectedPayoutDate(reservation) {
  const platform = normalizePlatform(reservation.platform);
  if (platform === 'airbnb') {
    let payout = addDays(reservation.checkIn || reservation.check_in, 1);
    const dow = dayOfWeek(payout);
    if (dow === 6) payout = addDays(payout, 2);
    if (dow === 0) payout = addDays(payout, 1);
    return payout;
  }
  if (platform === 'booking.com') {
    let payout = addDays(reservation.checkOut || reservation.check_out, 1);
    while (dayOfWeek(payout) !== 5) payout = addDays(payout, 1);
    return payout;
  }
  if (platform === 'vrbo') {
    const bookingDate = reservation.bookingDate || reservation.booking_date;
    return addDays(bookingDate, Number(reservation.vrboReleaseDays ?? 2));
  }
  return toDateOnly(reservation.checkOut || reservation.check_out);
}

export function calculatePayout(reservation, feeRates = {}) {
  const platform = normalizePlatform(reservation.platform);
  const grossAmount = Number(reservation.grossAmount ?? reservation.gross_amount ?? 0);
  const expectedPayoutDate = calculateExpectedPayoutDate(reservation);
  const explicitFee = reservation.platformFee ?? reservation.platform_fee;
  const feeRate = Number(feeRates[platform] ?? feeRates[reservation.platform] ?? DEFAULT_FEE_RATES[platform] ?? 0);
  const platformFee = explicitFee !== undefined && explicitFee !== null && explicitFee !== ''
    ? Number(explicitFee)
    : roundCurrency(grossAmount * feeRate);
  const netAfterPlatformFee = roundCurrency(grossAmount - platformFee);
  return {
    platform,
    expectedPayoutDate,
    disbursementMonth: monthKey(expectedPayoutDate),
    grossAmount: roundCurrency(grossAmount),
    platformFee: roundCurrency(platformFee),
    netAfterPlatformFee
  };
}

export function processorForPlatform(platform) {
  const normalized = normalizePlatform(platform);
  if (normalized === 'airbnb') return 'Pionear / Airbnb Payments';
  if (normalized === 'booking.com') return 'Booking.com';
  if (normalized === 'vrbo') return 'Stripe';
  return 'Unknown';
}

export function inferChannel(description = '') {
  const value = description.toLowerCase();
  if (value.includes('airbnb') || value.includes('pionear')) return { channel: 'airbnb', processor: 'Pionear / Airbnb Payments' };
  if (value.includes('booking.com') || value.includes('booking com') || value.includes('booking')) return { channel: 'booking.com', processor: 'Booking.com' };
  if (value.includes('stripe') || value.includes('vrbo')) return { channel: 'vrbo', processor: 'Stripe' };
  return { channel: null, processor: null };
}

export function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
