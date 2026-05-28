import { query, withTransaction } from '../db.js';
import { calculatePayout, inferChannel, normalizePlatform, roundCurrency } from './payoutEngine.js';
import { date, money, value } from './parser.js';

export async function insertReservations(rows, sourceDocument = 'manual-upload') {
  const inserted = [];
  for (const row of rows) {
    const listingRef = value(row, ['listing id', 'listing', 'listing name', 'hostaway listing id']);
    const listing = await findListing(listingRef);
    const platform = normalizePlatform(value(row, ['platform', 'channel']));
    const payout = calculatePayout({
      platform,
      checkIn: date(value(row, ['check in', 'check-in', 'arrival'])),
      checkOut: date(value(row, ['check out', 'check-out', 'departure'])),
      bookingDate: date(value(row, ['booking date', 'created at', 'reservation date'])),
      grossAmount: money(value(row, ['gross payout', 'gross amount', 'gross'])),
      platformFee: value(row, ['platform fee', 'fee'])
    }, listing?.platform_fee_rates || {});
    const result = await query(
      `INSERT INTO reservations
       (listing_id, external_id, source, guest_name, platform, check_in, check_out, booking_date, gross_amount, platform_fee, net_amount, expected_payout_date, disbursement_month, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (source, external_id) DO UPDATE SET
       listing_id=EXCLUDED.listing_id, gross_amount=EXCLUDED.gross_amount, platform_fee=EXCLUDED.platform_fee, net_amount=EXCLUDED.net_amount,
       expected_payout_date=EXCLUDED.expected_payout_date, disbursement_month=EXCLUDED.disbursement_month, raw_payload=EXCLUDED.raw_payload
       RETURNING *`,
      [
        listing?.id || null,
        String(value(row, ['reservation id', 'external id', 'id']) || `${sourceDocument}-${inserted.length}`),
        sourceDocument,
        value(row, ['guest name', 'guest']),
        platform,
        payout.expectedPayoutDate ? date(value(row, ['check in', 'check-in', 'arrival'])) : null,
        date(value(row, ['check out', 'check-out', 'departure'])),
        date(value(row, ['booking date', 'created at', 'reservation date'])),
        payout.grossAmount,
        payout.platformFee,
        payout.netAfterPlatformFee,
        payout.expectedPayoutDate,
        payout.disbursementMonth,
        row
      ]
    );
    inserted.push(result.rows[0]);
  }
  await autoMatch();
  return inserted;
}

export async function insertTrustTransactions(rows, sourceDocument = 'trust-upload') {
  const inserted = [];
  for (const row of rows) {
    const description = String(value(row, ['description', 'memo', 'details']) || '');
    const inferred = inferChannel(description);
    const result = await query(
      `INSERT INTO trust_transactions (source_document, transaction_date, description, amount, processor, channel, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [sourceDocument, date(value(row, ['date', 'transaction date', 'posted date'])), description, money(value(row, ['amount', 'credit', 'deposit'])), inferred.processor, inferred.channel, row]
    );
    inserted.push(result.rows[0]);
  }
  await autoMatch();
  return inserted;
}

export async function insertExpenses(rows, sourceDocument = 'expense-upload') {
  return insertLineItems(rows, sourceDocument, 'owner_expenses');
}

export async function insertCleaningUtilities(rows, sourceDocument = 'cleaning-utilities-upload') {
  const cleaning = [];
  const utilities = [];
  for (const row of rows) {
    const type = String(value(row, ['utility type', 'type', 'category'])).toLowerCase();
    if (type.includes('electric') || type.includes('water') || type.includes('gas') || type.includes('utility')) utilities.push(row);
    else cleaning.push(row);
  }
  return {
    cleaning: await insertLineItems(cleaning, sourceDocument, 'cleaning_records'),
    utilities: await insertLineItems(utilities, sourceDocument, 'utility_records')
  };
}

async function insertLineItems(rows, sourceDocument, table) {
  const inserted = [];
  for (const row of rows) {
    const listing = await findListing(value(row, ['listing id', 'listing', 'listing name']));
    if (table === 'owner_expenses') {
      const result = await query(
        `INSERT INTO owner_expenses (listing_id, source_document, expense_date, description, category, amount, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [listing?.id || null, sourceDocument, date(value(row, ['date', 'expense date'])), value(row, ['description', 'memo']), value(row, ['category']) || 'miscellaneous', money(value(row, ['amount', 'cost'])), row]
      );
      inserted.push(result.rows[0]);
    } else if (table === 'cleaning_records') {
      const result = await query(
        `INSERT INTO cleaning_records (listing_id, source_document, cleaning_date, description, amount, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [listing?.id || null, sourceDocument, date(value(row, ['cleaning date', 'date', 'turnover'])), value(row, ['description', 'memo']), money(value(row, ['amount', 'cost', 'cleaning cost'])), row]
      );
      inserted.push(result.rows[0]);
    } else {
      const result = await query(
        `INSERT INTO utility_records (listing_id, source_document, utility_type, billing_period, utility_date, amount, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [listing?.id || null, sourceDocument, value(row, ['utility type', 'type']) || 'utility', value(row, ['billing period', 'period']), date(value(row, ['date', 'utility date'])), money(value(row, ['amount', 'utility amount', 'cost'])), row]
      );
      inserted.push(result.rows[0]);
    }
  }
  return inserted;
}

export async function autoMatch() {
  return withTransaction(async (client) => {
    const reservations = await client.query(
      `SELECT r.* FROM reservations r
       LEFT JOIN transaction_reservation_matches m ON m.reservation_id = r.id
       WHERE m.id IS NULL`
    );
    const transactions = await client.query(
      `SELECT t.* FROM trust_transactions t
       LEFT JOIN transaction_reservation_matches m ON m.trust_transaction_id = t.id
       WHERE m.id IS NULL AND t.channel IS NOT NULL`
    );
    let count = 0;
    for (const tx of transactions.rows) {
      const match = reservations.rows.find((res) => {
        const amountClose = Math.abs(Number(tx.amount) - Number(res.net_amount || res.gross_amount)) <= 2;
        const channelMatch = normalizePlatform(tx.channel) === normalizePlatform(res.platform);
        const dateClose = Math.abs((new Date(tx.transaction_date) - new Date(res.expected_payout_date)) / 86400000) <= 5;
        return amountClose && channelMatch && dateClose;
      });
      if (match) {
        await client.query(
          `INSERT INTO transaction_reservation_matches (trust_transaction_id, reservation_id, match_type, confidence)
           VALUES ($1,$2,'auto',$3) ON CONFLICT DO NOTHING`,
          [tx.id, match.id, 0.92]
        );
        await client.query(`UPDATE trust_transactions SET status='matched' WHERE id=$1`, [tx.id]);
        count += 1;
      }
    }
    return count;
  });
}

export async function findListing(ref) {
  if (!ref) return null;
  const result = await query(
    `SELECT * FROM listings WHERE id::text=$1 OR name ILIKE $2 OR airbnb_listing_id=$1 OR booking_property_id=$1 OR vrbo_id=$1 OR hostaway_listing_id=$1 LIMIT 1`,
    [String(ref), String(ref)]
  );
  return result.rows[0] || null;
}

export async function reconciliationSummary(month) {
  const [trust, reservations, owners, unmatched, pending] = await Promise.all([
    query(`SELECT channel, COALESCE(SUM(amount),0)::float total FROM trust_transactions WHERE to_char(transaction_date,'YYYY-MM')=$1 GROUP BY channel`, [month]),
    query(`SELECT r.*, l.name listing_name, o.name owner_name, m.trust_transaction_id, t.amount actual_payout
           FROM reservations r
           LEFT JOIN listings l ON l.id=r.listing_id
           LEFT JOIN owners o ON o.id=l.owner_id
           LEFT JOIN transaction_reservation_matches m ON m.reservation_id=r.id
           LEFT JOIN trust_transactions t ON t.id=m.trust_transaction_id
           WHERE r.disbursement_month=$1 ORDER BY r.expected_payout_date`, [month]),
    query(`SELECT d.*, o.name owner_name FROM disbursements d JOIN owners o ON o.id=d.owner_id WHERE d.month=$1 ORDER BY o.name`, [month]),
    query(`SELECT * FROM trust_transactions WHERE status='unmatched' AND to_char(transaction_date,'YYYY-MM')=$1 ORDER BY transaction_date`, [month]),
    query(`SELECT r.*, l.name listing_name FROM reservations r LEFT JOIN listings l ON l.id=r.listing_id
           LEFT JOIN transaction_reservation_matches m ON m.reservation_id=r.id
           WHERE r.disbursement_month=$1 AND m.id IS NULL ORDER BY r.expected_payout_date`, [month])
  ]);
  return {
    trustSummary: trust.rows,
    reservationLedger: reservations.rows,
    ownerSummaries: owners.rows,
    unmatchedPayments: unmatched.rows,
    pendingPayouts: pending.rows,
    totals: {
      trustReceived: roundCurrency(trust.rows.reduce((sum, row) => sum + Number(row.total), 0)),
      reservations: reservations.rows.length,
      unmatched: unmatched.rows.length,
      pending: pending.rows.length
    }
  };
}
