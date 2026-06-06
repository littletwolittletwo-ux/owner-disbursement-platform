/**
 * Full data reset — wipe all transactional data, keep schema and users.
 * Then re-sync PM listings + reservations from Hostaway.
 */
import dotenv from 'dotenv';
dotenv.config();

import { query } from '../backend/src/db.js';
import { syncHostaway } from '../backend/src/services/hostaway.js';

async function run() {
  console.log('=== Wiping all transactional data ===');

  // Order matters due to foreign keys
  const tables = [
    ['email_log', 'Email logs'],
    ['aba_exports', 'ABA exports'],
    ['disbursement_line_items', 'Disbursement line items'],
    ['disbursements', 'Disbursements'],
    ['transaction_reservation_matches', 'Transaction matches'],
    ['trust_transactions', 'Trust transactions'],
    ['owner_expenses', 'Owner expenses'],
    ['cleaning_records', 'Cleaning records'],
    ['utility_records', 'Utility records'],
    ['reservations', 'Reservations'],
    ['commission_rules', 'Commission rules'],
    ['listings', 'Listings'],
    ['owners', 'Owners'],
  ];

  for (const [table, label] of tables) {
    const result = await query(`DELETE FROM ${table}`);
    console.log(`  ${label}: deleted ${result.rowCount} rows`);
  }

  console.log('\n=== Re-syncing from Hostaway (PM listings only, 6 months) ===');
  const sync = await syncHostaway(6);
  console.log(`  PM listings created: ${sync.pmListings}`);
  console.log(`  Reservations synced: ${sync.reservations}`);
  console.log(`  Non-PM/cancelled filtered: ${sync.filtered}`);

  console.log('\n=== Adding owner contacts ===');
  await query(`INSERT INTO owners (name, email) VALUES ($1, $2)`, ['H Dihardjo', 'Hdihardjo@gmail.com']);
  await query(`INSERT INTO owners (name, email) VALUES ($1, $2)`, ['John (K Property)', 'john@kproperty.com.au']);
  console.log('  Added: Hdihardjo@gmail.com, john@kproperty.com.au');

  console.log('\n=== Done — fresh start ===');

  // Quick summary
  const counts = {};
  for (const [table] of [['owners'], ['listings'], ['reservations']]) {
    const r = await query(`SELECT count(*) FROM ${table}`);
    counts[table] = r.rows[0].count;
  }
  console.log(`  Owners: ${counts.owners}, Listings: ${counts.listings}, Reservations: ${counts.reservations}`);

  process.exit(0);
}

run().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
