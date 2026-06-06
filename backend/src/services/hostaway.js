import axios from 'axios';
import { insertReservations } from './reconciliation.js';
import { query } from '../db.js';
import { startEndForMonth } from '../utils/dates.js';

const baseURL = 'https://api.hostaway.com/v1';

async function getAccessToken() {
  const res = await axios.post(
    `${baseURL}/accessTokens`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.HOSTAWAY_ACCOUNT_ID,
      client_secret: process.env.HOSTAWAY_API_KEY
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data.access_token;
}

function createClient(token) {
  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Cache-control': 'no-cache'
    },
    timeout: 15000
  });
}

const PM_TAG = 'Property Management Deals';

/**
 * Fetch all Hostaway listings and return a Set of listingMapIds
 * that have the "Property Management Deals" tag.
 */
async function fetchPMListingIds(client) {
  const res = await client.get('/listings', { params: { limit: 200 } });
  const listings = res.data?.result || [];
  const pmIds = new Set();
  const pmListings = [];
  for (const l of listings) {
    const tags = l.listingTags || [];
    if (tags.some(t => t.name === PM_TAG)) {
      pmIds.add(String(l.id));
      pmListings.push(l);
    }
  }
  return { pmIds, pmListings, totalListings: listings.length };
}

/**
 * Filter out non-booking entries (blocks, cancelled, declined, iCal blocks).
 */
function isRealBooking(item) {
  // Skip cancelled/declined
  if (item.status === 'cancelled' || item.status === 'declined') return false;
  // Skip iCal calendar blocks
  if (item.channelName === 'customIcal') return false;
  // Skip zero-price entries (usually blocks)
  if (!item.totalPrice || item.totalPrice <= 0) return false;
  // Skip guest names that indicate blocks
  const name = (item.guestName || '').toLowerCase();
  if (name.includes('not available') || name.includes('blocked') || name.includes('block')) return false;
  return true;
}

/**
 * Resolve platform fee from channel-specific fields.
 * Airbnb: channelCommissionAmount is null — use airbnbListingHostFee instead.
 * Booking.com: channelCommissionAmount is populated.
 */
function resolvePlatformFee(item) {
  if (item.channelCommissionAmount != null && item.channelCommissionAmount > 0) {
    return item.channelCommissionAmount;
  }
  // Airbnb-specific: host fee is the platform commission
  if (item.airbnbListingHostFee != null && item.airbnbListingHostFee > 0) {
    return item.airbnbListingHostFee;
  }
  return '';
}

/**
 * Map Hostaway reservation to internal format.
 */
function mapReservation(item) {
  return {
    'reservation id': item.id,
    'listing id': item.listingMapId || item.listingId,
    'guest name': item.guestName || item.guestFirstName || `${item.guestFirstName || ''} ${item.guestLastName || ''}`.trim(),
    platform: item.channelName || item.source || 'hostaway',
    'check in': item.arrivalDate,
    'check out': item.departureDate,
    'booking date': item.reservationDate || item.insertedOn,
    'gross payout': item.totalPrice || item.hostPayout || item.price,
    'platform fee': resolvePlatformFee(item),
    'cleaning fee': item.cleaningFee || 0
  };
}

/**
 * Auto-create listings from Hostaway PM listing data if they don't exist in the DB.
 * Uses internalListingName (unit/address) for better identification.
 */
async function ensureListingsExist(pmListings) {
  for (const l of pmListings) {
    const hwId = String(l.id);
    const existing = await query(
      `SELECT id FROM listings WHERE hostaway_listing_id = $1 LIMIT 1`,
      [hwId]
    );
    if (existing.rows.length === 0) {
      // Use internalListingName (e.g., "[ACTIVE] 6/90 Kavanagh Street") — clean up prefix
      const name = (l.internalListingName || l.name || `Hostaway ${hwId}`)
        .replace(/^\[ACTIVE\]\s*/i, '')
        .replace(/^\[DISCARDED\]\s*/i, '')
        .replace(/^NEW\s*-\s*/i, '')
        .replace(/^\[ACTIVE\]\s*/i, '')
        .replace(/\s*-\s*[A-Z\s&]+$/i, '') // Remove trailing owner name like " - UROS"
        .trim();
      await query(
        `INSERT INTO listings (name, hostaway_listing_id, platform_fee_rates)
         VALUES ($1, $2, '{"airbnb":0.165,"booking.com":0.165,"vrbo":0.12,"direct":0}')
         ON CONFLICT DO NOTHING`,
        [name, hwId]
      );
    }
  }
}

/**
 * Fetch reservations from Hostaway API with pagination.
 * @param {object} client - Axios client with auth
 * @param {object} params - Query params (arrivalStartDate, arrivalEndDate, etc.)
 * @returns {Array} All fetched reservations
 */
async function fetchReservations(client, params = {}) {
  let allReservations = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await client.get('/reservations', {
      params: { limit, offset, sortOrder: 'desc', ...params }
    });
    const batch = res.data?.result || [];
    allReservations.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return allReservations;
}

/**
 * Original sync: fetch all reservations from last N months and upsert.
 */
export async function syncHostaway(months = 3) {
  if (!process.env.HOSTAWAY_API_KEY || !process.env.HOSTAWAY_ACCOUNT_ID) {
    return { skipped: true, reason: 'HOSTAWAY_API_KEY or HOSTAWAY_ACCOUNT_ID is not configured' };
  }

  const token = await getAccessToken();
  const client = createClient(token);

  // Fetch PM-tagged listings only
  const { pmIds, pmListings, totalListings } = await fetchPMListingIds(client);
  await ensureListingsExist(pmListings);

  // Only fetch reservations from the last N months
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const arrivalStartDate = startDate.toISOString().slice(0, 10);

  const allReservations = await fetchReservations(client, { arrivalStartDate });
  // Filter: real bookings + PM-tagged listings only
  const realBookings = allReservations.filter(r =>
    isRealBooking(r) && pmIds.has(String(r.listingMapId))
  );
  const reservations = realBookings.map(mapReservation);
  const inserted = await insertReservations(reservations, 'hostaway');
  return {
    skipped: false,
    pmListings: pmIds.size,
    totalListings,
    reservations: inserted.length,
    filtered: allReservations.length - realBookings.length
  };
}

/**
 * Sync reservations for a specific date range.
 * Includes straddling bookings: any reservation where check-in < endDate AND check-out > startDate.
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {string} [hostawayListingId] - Optional: filter to a single listing
 * @returns {{ reservations: number, straddlers: number, total: number }}
 */
export async function syncHostawayDateRange(startDate, endDate, hostawayListingId = null) {
  if (!process.env.HOSTAWAY_API_KEY || !process.env.HOSTAWAY_ACCOUNT_ID) {
    return { skipped: true, reason: 'HOSTAWAY_API_KEY or HOSTAWAY_ACCOUNT_ID is not configured' };
  }

  const token = await getAccessToken();
  const client = createClient(token);

  // Fetch PM-tagged listings only
  const { pmIds, pmListings } = await fetchPMListingIds(client);
  await ensureListingsExist(pmListings);

  // Fetch with a wider window to catch straddlers
  const bufferStart = new Date(startDate);
  bufferStart.setDate(bufferStart.getDate() - 60);

  const params = {
    arrivalStartDate: bufferStart.toISOString().slice(0, 10),
    arrivalEndDate: endDate
  };
  if (hostawayListingId) {
    params.listingId = hostawayListingId;
  }

  const allReservations = await fetchReservations(client, params);

  // Filter: real bookings + PM-tagged + overlapping [startDate, endDate]
  const overlapping = allReservations.filter(r => {
    if (!isRealBooking(r)) return false;
    if (!pmIds.has(String(r.listingMapId))) return false;
    return r.arrivalDate < endDate && r.departureDate > startDate;
  });

  // Count straddlers (check-in before startDate OR check-out after endDate)
  const straddlers = overlapping.filter(r => {
    return r.arrivalDate < startDate || r.departureDate > endDate;
  });

  // Insert into DB
  const mapped = overlapping.map(mapReservation);
  const inserted = await insertReservations(mapped, 'hostaway');

  return {
    skipped: false,
    reservations: inserted.length,
    straddlers: straddlers.length,
    total: overlapping.length,
    filtered: allReservations.length - overlapping.length
  };
}

/**
 * Sync reservations for a specific month, including straddling bookings
 * from the prior month that roll into this month.
 */
export async function syncHostawayMonth(month) {
  const { start, end } = startEndForMonth(month);
  return syncHostawayDateRange(start, end);
}

/**
 * Get reservations from DB with filtering (no Hostaway API call).
 * For querying already-synced data.
 */
export async function queryReservations({ startDate, endDate, listingId, hostawayListingId, platform, includeStraddlers = true }) {
  let sql = `
    SELECT r.*, l.name listing_name, l.hostaway_listing_id, l.address,
           o.name owner_name, o.id owner_id
    FROM reservations r
    LEFT JOIN listings l ON l.id = r.listing_id
    LEFT JOIN owners o ON o.id = l.owner_id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (startDate && endDate) {
    if (includeStraddlers) {
      // Overlapping: check_in < endDate AND check_out > startDate
      sql += ` AND r.check_in <= $${idx++} AND r.check_out >= $${idx++}`;
      params.push(endDate, startDate);
    } else {
      sql += ` AND r.check_in >= $${idx++} AND r.check_out <= $${idx++}`;
      params.push(startDate, endDate);
    }
  }

  if (listingId) {
    sql += ` AND r.listing_id = $${idx++}`;
    params.push(listingId);
  }

  if (hostawayListingId) {
    sql += ` AND l.hostaway_listing_id = $${idx++}`;
    params.push(hostawayListingId);
  }

  if (platform) {
    sql += ` AND r.platform ILIKE $${idx++}`;
    params.push(`%${platform}%`);
  }

  sql += ` ORDER BY r.check_in DESC`;

  const result = await query(sql, params);

  // Mark straddlers
  const rows = result.rows.map(r => {
    const isStraddler = startDate && endDate &&
      (r.check_in < startDate || r.check_out > endDate);
    return { ...r, is_straddler: isStraddler };
  });

  return rows;
}

/**
 * Get straddling bookings for a month — bookings that cross month boundaries.
 * These are bookings that started in a prior month and checked out in the given month,
 * or started in the given month and check out in the next month.
 */
export async function getStraddlingBookings(month) {
  const { start, end } = startEndForMonth(month);

  const result = await query(
    `SELECT r.*, l.name listing_name, l.hostaway_listing_id, l.address,
            o.name owner_name, o.id owner_id,
            CASE
              WHEN r.check_in < $1 THEN 'incoming'
              WHEN r.check_out > $2 THEN 'outgoing'
            END as straddle_direction,
            GREATEST(0, LEAST(r.check_out::date, $2::date) - GREATEST(r.check_in::date, $1::date)) as period_nights,
            (r.check_out::date - r.check_in::date) as total_nights
     FROM reservations r
     LEFT JOIN listings l ON l.id = r.listing_id
     LEFT JOIN owners o ON o.id = l.owner_id
     WHERE (r.check_in < $1 AND r.check_out > $1)
        OR (r.check_in <= $2 AND r.check_out > $2)
     ORDER BY r.check_in`,
    [start, end]
  );

  return result.rows;
}

/**
 * Remove all non-PM listings, their reservations, expenses, cleaning records,
 * utility records, and disbursement data from the DB.
 * Fetches PM listing IDs from Hostaway, then deletes everything else.
 */
export async function cleanupNonPMListings() {
  const token = await getAccessToken();
  const client = createClient(token);
  const { pmIds } = await fetchPMListingIds(client);

  // Get all listings in DB
  const allListings = await query(`SELECT id, hostaway_listing_id, name FROM listings`);

  const toDelete = allListings.rows.filter(l =>
    !l.hostaway_listing_id || !pmIds.has(String(l.hostaway_listing_id))
  );

  if (toDelete.length === 0) {
    return { deleted: 0, kept: allListings.rows.length, message: 'No non-PM listings found' };
  }

  const deleteIds = toDelete.map(l => l.id);

  // Delete reservations for these listings
  const reservationsResult = await query(
    `DELETE FROM reservations WHERE listing_id = ANY($1::uuid[])`,
    [deleteIds]
  );

  // Delete expenses
  await query(`DELETE FROM owner_expenses WHERE listing_id = ANY($1::uuid[])`, [deleteIds]);
  // Delete cleaning records
  await query(`DELETE FROM cleaning_records WHERE listing_id = ANY($1::uuid[])`, [deleteIds]);
  // Delete utility records
  await query(`DELETE FROM utility_records WHERE listing_id = ANY($1::uuid[])`, [deleteIds]);

  // Delete the listings themselves
  const listingsResult = await query(
    `DELETE FROM listings WHERE id = ANY($1::uuid[])`,
    [deleteIds]
  );

  return {
    deleted: listingsResult.rowCount,
    deletedReservations: reservationsResult.rowCount,
    kept: allListings.rows.length - toDelete.length,
    deletedNames: toDelete.map(l => l.name).slice(0, 20),
  };
}

/**
 * Generate CSV content from reservation data.
 */
export function reservationsToCSV(reservations) {
  const headers = [
    'Guest Name', 'Platform', 'Property', 'Owner', 'Hostaway ID',
    'Check In', 'Check Out', 'Nights', 'Gross Amount', 'Platform Fee',
    'Net Amount', 'Cleaning Fee', 'Straddler', 'Straddle Direction'
  ];

  const rows = reservations.map(r => [
    r.guest_name || '',
    r.platform || '',
    r.listing_name || '',
    r.owner_name || '',
    r.hostaway_listing_id || '',
    r.check_in || '',
    r.check_out || '',
    r.total_nights || '',
    r.gross_amount || '',
    r.platform_fee || '',
    r.net_amount || '',
    r.cleaning_fee || '',
    r.is_straddler ? 'Yes' : 'No',
    r.straddle_direction || ''
  ]);

  const csvEscape = (val) => {
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  return [
    headers.map(csvEscape).join(','),
    ...rows.map(row => row.map(csvEscape).join(','))
  ].join('\n');
}
