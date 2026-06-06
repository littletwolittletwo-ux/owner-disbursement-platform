/**
 * One-time setup script:
 * 1. Cleanup non-PM listings from DB
 * 2. Add owner emails
 * 3. Re-sync Hostaway with PM filter
 */
import dotenv from 'dotenv';
dotenv.config();

import { query } from '../backend/src/db.js';
import { cleanupNonPMListings, syncHostaway } from '../backend/src/services/hostaway.js';

async function run() {
  console.log('=== Step 1: Cleanup non-PM listings ===');
  const cleanup = await cleanupNonPMListings();
  console.log(`Deleted ${cleanup.deleted} listings, ${cleanup.deletedReservations} reservations`);
  console.log(`Kept ${cleanup.kept} PM listings`);
  if (cleanup.deletedNames?.length > 0) {
    console.log('Deleted:', cleanup.deletedNames.slice(0, 10).join(', '));
  }

  console.log('\n=== Step 2: Add/update owner emails ===');
  // Add Hdihardjo@gmail.com
  const existing1 = await query(`SELECT id FROM owners WHERE email = $1`, ['Hdihardjo@gmail.com']);
  if (existing1.rows.length === 0) {
    await query(
      `INSERT INTO owners (name, email) VALUES ($1, $2)`,
      ['H Dihardjo', 'Hdihardjo@gmail.com']
    );
    console.log('Added owner: H Dihardjo (Hdihardjo@gmail.com)');
  } else {
    console.log('Owner Hdihardjo@gmail.com already exists');
  }

  // Add john@kproperty.com.au
  const existing2 = await query(`SELECT id FROM owners WHERE email = $1`, ['john@kproperty.com.au']);
  if (existing2.rows.length === 0) {
    await query(
      `INSERT INTO owners (name, email) VALUES ($1, $2)`,
      ['John (K Property)', 'john@kproperty.com.au']
    );
    console.log('Added owner: John (john@kproperty.com.au)');
  } else {
    console.log('Owner john@kproperty.com.au already exists');
  }

  console.log('\n=== Step 3: Re-sync Hostaway (PM only) ===');
  const sync = await syncHostaway(6);
  console.log(`Synced ${sync.reservations} reservations from ${sync.pmListings} PM listings`);
  console.log(`Filtered out ${sync.filtered} non-PM/cancelled entries`);

  console.log('\n=== Done ===');
  process.exit(0);
}

run().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
