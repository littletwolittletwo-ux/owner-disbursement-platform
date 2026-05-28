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
  const [reservationRes, listingRes] = await Promise.all([
    client.get('/reservations', { params: { limit: 100 } }),
    client.get('/listings', { params: { limit: 100 } })
  ]);
  const listings = listingRes.data?.result || [];
  const reservations = (reservationRes.data?.result || []).map((item) => ({
    'reservation id': item.id,
    'listing id': item.listingMapId || item.listingId,
    'guest name': item.guestName || item.guestFirstName,
    platform: item.channelName || item.source || 'hostaway',
    'check in': item.arrivalDate,
    'check out': item.departureDate,
    'booking date': item.reservationDate || item.insertedOn,
    'gross payout': item.totalPrice || item.hostPayout || item.price,
    'platform fee': item.channelCommissionAmount || ''
  }));
  const inserted = await insertReservations(reservations, 'hostaway');
  return { skipped: false, listings: listings.length, reservations: inserted.length };
}
