import { addDays, dayOfWeek, monthKey, toDateOnly } from '../utils/dates.js';

// Australian STR channel commission rates (what the platform takes from gross)
const DEFAULT_FEE_RATES = {
  airbnb: 0.165,
  'booking.com': 0.165,
  booking: 0.165,
  vrbo: 0.12,
  direct: 0
};

export function normalizePlatform(platform = '') {
  const value = String(platform).trim().toLowerCase();
  if (value.includes('airbnb')) return 'airbnb';
  if (value.includes('booking')) return 'booking.com';
  if (value.includes('vrbo') || value.includes('homeaway')) return 'vrbo';
  if (value === 'direct' || value === 'website' || value.includes('direct')) return 'direct';
  return value || 'unknown';
}

export function calculateExpectedPayoutDate(reservation) {
  const platform = normalizePlatform(reservation.platform);

  if (platform === 'airbnb') {
    // Airbnb: 1 business day after check-in
    let payout = addDays(reservation.checkIn || reservation.check_in, 1);
    const dow = dayOfWeek(payout);
    if (dow === 6) payout = addDays(payout, 2); // Saturday -> Monday
    if (dow === 0) payout = addDays(payout, 1); // Sunday -> Monday
    return payout;
  }

  if (platform === 'booking.com') {
    // Booking.com: following Friday after checkout
    let payout = addDays(reservation.checkOut || reservation.check_out, 1);
    while (dayOfWeek(payout) !== 5) payout = addDays(payout, 1);
    return payout;
  }

  if (platform === 'vrbo') {
    // VRBO: day after checkout (spec §2.2)
    return addDays(reservation.checkOut || reservation.check_out, 1);
  }

  if (platform === 'direct') {
    // Direct/Stripe: same day or next business day
    let payout = toDateOnly(reservation.checkIn || reservation.check_in);
    const dow = dayOfWeek(payout);
    if (dow === 6) payout = addDays(payout, 2);
    if (dow === 0) payout = addDays(payout, 1);
    return payout;
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
  const cleaningFee = Number(reservation.cleaningFee ?? reservation.cleaning_fee ?? 0);

  return {
    platform,
    expectedPayoutDate,
    disbursementMonth: monthKey(expectedPayoutDate),
    grossAmount: roundCurrency(grossAmount),
    platformFee: roundCurrency(platformFee),
    netAfterPlatformFee,
    cleaningFee: roundCurrency(cleaningFee),
    channelPayout: netAfterPlatformFee
  };
}

export function processorForPlatform(platform) {
  const normalized = normalizePlatform(platform);
  if (normalized === 'airbnb') return 'Pionear / Airbnb Payments';
  if (normalized === 'booking.com') return 'Booking.com';
  if (normalized === 'vrbo') return 'Stripe';
  if (normalized === 'direct') return 'Stripe';
  return 'Unknown';
}

/**
 * Infer booking channel from a trust transaction description.
 * Returns { channel, processor } if this looks like a booking payout,
 * or { channel: null, processor: null } if it doesn't match any known pattern.
 *
 * Known payout patterns:
 * - Airbnb: "Airbnb", "Payoneer", "Pionear" in description
 * - Booking.com: "Booking.com", "Booking Com", "Booking" in description
 * - VRBO: "VRBO", "HomeAway" in description
 * - Stripe (VRBO/Direct): "Stripe" in description
 */
export function inferChannel(description = '') {
  const val = description.toLowerCase();
  // Airbnb payouts come via Payoneer or directly labelled Airbnb
  if (val.includes('airbnb') || val.includes('payoneer') || val.includes('pionear')) {
    return { channel: 'airbnb', processor: 'Payoneer / Airbnb Payments' };
  }
  // Booking.com payouts
  if (val.includes('booking.com') || val.includes('booking com') || val.includes('bookingcom')) {
    return { channel: 'booking.com', processor: 'Booking.com' };
  }
  // "booking" alone — but exclude generic words like "rebooking", "overbooking"
  if (/\bbooking\b/.test(val) && !val.includes('rebooking') && !val.includes('overbooking')) {
    return { channel: 'booking.com', processor: 'Booking.com' };
  }
  // VRBO / HomeAway payouts
  if (val.includes('vrbo') || val.includes('homeaway')) {
    return { channel: 'vrbo', processor: 'Stripe' };
  }
  // Stripe is often VRBO or direct bookings
  if (val.includes('stripe')) {
    return { channel: 'vrbo', processor: 'Stripe' };
  }
  // Not a recognisable booking payout
  return { channel: null, processor: null };
}

export function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Airbnb pays monthly installments for stays >= 28 nights.
 * First payout: ~1 biz day after check-in (covers first ~30 nights).
 * Subsequent payouts: every ~30 days from first payout.
 *
 * Returns the share (0–1) of the booking that is paid out in `targetMonth`.
 * For non-Airbnb or stays < 28 nights, returns 1.0.
 */
export function getInstallmentShare(reservation, targetMonth) {
  const platform = normalizePlatform(reservation.platform);
  const ci = toDateOnly(reservation.checkIn || reservation.check_in);
  const co = toDateOnly(reservation.checkOut || reservation.check_out);
  const totalNights = Math.max(0, Math.round(
    (new Date(`${co}T00:00:00Z`) - new Date(`${ci}T00:00:00Z`)) / 86400000
  ));

  if (platform !== 'airbnb' || totalNights < 28) {
    return 1.0;
  }

  // Calculate installment schedule
  const firstPayoutDate = calculateExpectedPayoutDate(reservation);
  let nightsAssigned = 0;
  let installmentNum = 0;
  let shareInMonth = 0;

  while (nightsAssigned < totalNights) {
    const payoutDate = installmentNum === 0
      ? firstPayoutDate
      : addDays(firstPayoutDate, installmentNum * 30);
    const nightsInChunk = Math.min(30, totalNights - nightsAssigned);
    const payoutMonth = monthKey(payoutDate);

    if (payoutMonth === targetMonth) {
      shareInMonth += nightsInChunk / totalNights;
    }

    nightsAssigned += nightsInChunk;
    installmentNum++;
  }

  return roundCurrency(shareInMonth * 1000000) / 1000000;
}

export function getDefaultFeeRates() {
  return { ...DEFAULT_FEE_RATES };
}

/**
 * Count how many sleeping nights fall within the disbursement period (spec §4.1).
 * A sleeping night is the date the guest occupies the property overnight.
 * Night dates: checkin, checkin+1, ..., checkout-1 (checkout is departure day).
 */
export function countPeriodNights(checkin, checkout, periodStart, periodEnd) {
  const ci = new Date(`${toDateOnly(checkin)}T00:00:00Z`);
  const co = new Date(`${toDateOnly(checkout)}T00:00:00Z`);
  const ps = new Date(`${toDateOnly(periodStart)}T00:00:00Z`);
  // period_end is inclusive, so effective upper bound for nights is period_end + 1 day
  const pe1 = new Date(`${toDateOnly(periodEnd)}T00:00:00Z`);
  pe1.setUTCDate(pe1.getUTCDate() + 1);

  const effectiveStart = ci > ps ? ci : ps;
  const effectiveEnd = co < pe1 ? co : pe1;

  const periodNights = Math.max(0, Math.round((effectiveEnd - effectiveStart) / 86400000));
  const totalNights = Math.max(0, Math.round((co - ci) / 86400000));

  return { periodNights, totalNights };
}

/**
 * Pro-rate a reservation's financial amounts for the disbursement period (spec §4.2).
 * Returns share, pro-rated gross, and pro-rated cleaning fee.
 */
export function proRateReservation(reservation, periodStart, periodEnd) {
  const checkin = reservation.checkIn || reservation.check_in;
  const checkout = reservation.checkOut || reservation.check_out;
  const { periodNights, totalNights } = countPeriodNights(checkin, checkout, periodStart, periodEnd);
  const share = totalNights === 0 ? 0 : periodNights / totalNights;
  const grossAmount = Number(reservation.grossAmount ?? reservation.gross_amount ?? 0);
  const cleaningFee = Number(reservation.cleaningFee ?? reservation.cleaning_fee ?? 0);

  return {
    periodNights,
    totalNights,
    share: roundCurrency(share * 1000000) / 1000000, // 6 decimal places
    periodGross: roundCurrency(grossAmount * share),
    periodCleaning: roundCurrency(cleaningFee * share)
  };
}
