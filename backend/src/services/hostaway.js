import axios from 'axios';
import { insertReservations } from './reconciliation.js';

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

export async function syncHostaway() {
  if (!process.env.HOSTAWAY_API_KEY || !process.env.HOSTAWAY_ACCOUNT_ID) {
    return { skipped: true, reason: 'HOSTAWAY_API_KEY or HOSTAWAY_ACCOUNT_ID is not configured' };
  }

  const token = await getAccessToken();
  const client = axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Cache-control': 'no-cache'
    }
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
