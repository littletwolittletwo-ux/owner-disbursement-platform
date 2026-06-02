import axios from 'axios';
import { insertReservations } from './reconciliation.js';

const baseURL = 'https://api.hostaway.com/v1';

export async function syncHostaway() {
  if (!process.env.HOSTAWAY_API_KEY || !process.env.HOSTAWAY_ACCOUNT_ID) {
    return { skipped: true, reason: 'HOSTAWAY_API_KEY or HOSTAWAY_ACCOUNT_ID is not configured' };
  }

  const client = axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${process.env.HOSTAWAY_API_KEY}`,
      'Cache-control': 'no-cache'
    },
    params: { accountId: process.env.HOSTAWAY_ACCOUNT_ID }
  });

  // Fetch listings
  const listingRes = await client.get('/listings', { params: { limit: 200 } });
  const listings = listingRes.data?.result || [];

  // Fetch reservations with pagination
  let allReservations = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await client.get('/reservations', { params: { limit, offset } });
    const batch = res.data?.result || [];
    allReservations.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  // Map to internal format with cleaning fees
  const reservations = allReservations.map((item) => ({
    'reservation id': item.id,
    'listing id': item.listingMapId || item.listingId,
    'guest name': item.guestName || item.guestFirstName || `${item.guestFirstName || ''} ${item.guestLastName || ''}`.trim(),
    platform: item.channelName || item.source || 'hostaway',
    'check in': item.arrivalDate,
    'check out': item.departureDate,
    'booking date': item.reservationDate || item.insertedOn,
    'gross payout': item.totalPrice || item.hostPayout || item.price,
    'platform fee': item.channelCommissionAmount || '',
    'cleaning fee': item.cleaningFee || 0
  }));

  const inserted = await insertReservations(reservations, 'hostaway');
  return { skipped: false, listings: listings.length, reservations: inserted.length };
}
