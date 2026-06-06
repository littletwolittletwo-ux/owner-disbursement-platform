/**
 * Populate all owners from the LiveLuxe Owner Master Directory spreadsheet.
 * Creates owners with bank details, emails, phones, and assigns listings.
 *
 * Data source: LiveLuxe_Owner_Master_Directory (1).xlsx
 * - Sheet 1: New LiveLuxe Owners (20 listings, 20 unique owners)
 * - Sheet 2: Existing LiveLuxe Owners (11 listings, ~9 unique owners)
 */
import dotenv from 'dotenv';
dotenv.config();

import { query } from '../backend/src/db.js';

// ── Owner data from spreadsheet ──
// Each entry: { name, email, secondaryEmail, phone, emergencyPhone, bsb, accountNumber, notes, listings: [hostawayId, ...] }
const ownerData = [
  // ── New LiveLuxe Owners ──
  {
    name: 'Uros Brkich',
    email: 'urosh_brkich@hotmail.com',
    phone: '+61 421 389 185',
    bsb: '013-148', accountNumber: '526068704',
    notes: '',
    listings: ['522208']
  },
  {
    name: 'Wayne Banks-Smith',
    email: 'wbs@financementors.com.au',
    phone: '+61 412 558 611',
    bsb: '013-395', accountNumber: '187802774',
    notes: '',
    listings: ['522214']
  },
  {
    name: 'Alison Dilena',
    email: 'alibeach@hotmail.com',
    phone: '+61 419 188 880',
    bsb: '067-872', accountNumber: '30627564',
    notes: 'SHARES bank account with Jake Frost - verify',
    listings: ['522215']
  },
  {
    name: 'Jack Kagan',
    email: 'jack@kinetickonstructions.com.au',
    phone: '+61 499 036 903',
    bsb: '013-231', accountNumber: '590627291',
    notes: 'Not included in May disbursement run',
    listings: ['522216']
  },
  {
    name: 'Richard Supler',
    email: 'dino@austens.com.au',
    secondaryEmail: 'rsulper@bigpond.net.au',
    phone: '+61 402 310 170',
    bsb: '083-453', accountNumber: '473784773',
    notes: 'Confirm surname spelling (Supler vs Sulper)',
    listings: ['522217']
  },
  {
    name: 'Stuart Lee',
    email: 'torresleefamily@gmail.com',
    phone: '+64 27 297 8999',
    bsb: '063-464', accountNumber: '10774541',
    notes: '',
    listings: ['522219']
  },
  {
    name: 'Krishneel Maharaj',
    email: 'krishneelmaharaj77@gmail.com',
    phone: '+61 411 125 214',
    bsb: '193-879', accountNumber: '432832038',
    notes: '',
    listings: ['522220']
  },
  {
    name: 'Amanda Mortensen',
    email: 'amanda@amamus.com.au',
    secondaryEmail: 'amandajmortensen@gmail.com',
    phone: '+61 404 481 03?',
    bsb: '193-879', accountNumber: '494986518',
    notes: 'Surname differs (Isherwood in Hostaway, Mortensen on bank); phone truncated',
    listings: ['522221']
  },
  {
    name: 'Jake Frost',
    email: 'jkalfrost@hotmail.com',
    bsb: '067-872', accountNumber: '30627564',
    notes: 'SHARES bank account with Alison Dilena - verify',
    listings: ['522224']
  },
  {
    name: 'Matt & Amy Leiper',
    email: 'amymleiper@gmail.com',
    secondaryEmail: 'mattleipertv@gmail.com',
    bsb: '182-512', accountNumber: '963830559',
    notes: 'Also has access to 604/172 William St (not in PM listings)',
    listings: ['522225']
  },
  {
    name: 'Walter & Rosa Rodriguez',
    email: 'wjrodriguez1964@gmail.com',
    secondaryEmail: 'wjrodriguez@yahoo.com',
    bsb: '182-512', accountNumber: '971749155',
    notes: 'Alen Damjanovic co-access',
    listings: ['522226']
  },
  {
    name: 'Sutha Sutharsan',
    email: 'info@aasktherapy.com.au',
    secondaryEmail: 'sutharsan.suntharamoorthy@health.nsw.gov.au',
    bsb: '182-512', accountNumber: '971959325',
    notes: 'Two access users (Sutha; Kavith & Sutha). Alen co-access.',
    listings: ['522227']
  },
  {
    name: 'Dillon & Shannon Saunders',
    email: 'dillonsaunders571@gmail.com',
    secondaryEmail: 'shannonturner874@gmail.com',
    bsb: '182-512', accountNumber: '972359392',
    notes: 'Hostaway email differs from bank-block contact email. Alen co-access.',
    listings: ['522228']
  },
  {
    name: 'Stephanie Lewis',
    email: 'sm.lewis@bigpond.net.au',
    bsb: '182-512', accountNumber: '972378020',
    notes: 'Alen co-access',
    listings: ['522229']
  },
  {
    name: 'Ben & Jessica Wilson',
    email: 'ben@awtco.org.au',
    secondaryEmail: 'jswilson119@gmail.com',
    bsb: '732-736', accountNumber: '534412',
    notes: '',
    listings: ['522230']
  },
  {
    name: 'North Port Hotel',
    email: 'contact@northporthotel.com.au',
    bsb: '083-004', accountNumber: '609567664',
    notes: '',
    listings: ['522231']
  },
  {
    name: 'Georgia & Nathan Knudsen',
    email: 'georgiaknudsen@hotmail.com',
    bsb: '062-254', accountNumber: '10004968',
    notes: '',
    listings: ['522235']
  },
  {
    name: 'Michael Gavin & Michelle Lien',
    email: 'michaeligavin@gmail.com',
    secondaryEmail: 'mlbooks20@gmail.com',
    bsb: '484-799', accountNumber: '120411094',
    notes: 'Two William St listings with different account numbers. 1403: 120411094, 1406: 120402141',
    listings: ['522236', '522237'],
    // Per-listing bank overrides
    listingBankOverrides: {
      '522237': { bsb: '484-799', accountNumber: '120402141' }
    }
  },
  {
    name: 'Russell Butler',
    email: 'rfrbutler@outlook.com',
    phone: '+61 438 048 864',
    bsb: '063-237', accountNumber: '10012483',
    notes: '',
    listings: ['522239']
  },

  // ── Existing LiveLuxe Owners ──
  {
    name: 'Karen',
    email: 'lohaiquan@gmail.com',
    bsb: '342-250', accountNumber: '058492090',
    notes: '',
    listings: ['472415']
  },
  {
    name: 'Francis Goh',
    email: 'francisgoh7@gmail.com',
    bsb: '193-879', accountNumber: '493017281',
    notes: '',
    listings: ['413321', '398565']
  },
  {
    name: 'Dharyl Ighwan & Khalisea',
    email: 'dharyl.ighwan@hotmail.com',
    secondaryEmail: 'khalisea@gmail.com',
    bsb: '013-128', accountNumber: '212382039',
    notes: 'Bank owner listed as "D. Ighwan"',
    listings: ['437035']
  },
  {
    name: 'Simon Osborn',
    email: 'sjosborn5067@gmail.com',
    bsb: '067-873', accountNumber: '18685814',
    notes: '',
    listings: ['485810']
  },
  {
    name: 'Herlina Dihardjo',
    email: 'Hdihardjo@gmail.com',
    bsb: '343-001', accountNumber: '499581118',
    notes: 'NOT SIGNED - follow up on agreement + payment',
    listings: ['471676']
  },
  {
    name: 'John Ly',
    email: 'john@kproperty.com.au',
    bsb: '033-018', accountNumber: '408216',
    notes: 'Bank owner "J. Ly"; K Property contact',
    listings: ['342755']
  },
  {
    name: 'Cathy & Matt Johnston',
    email: 'mattcathy7@gmail.com',
    bsb: '063-791', accountNumber: '12715667',
    notes: 'Bank owner "Catherine" matched to Cathy Johnston - confirm',
    listings: ['485212']
  },
  {
    name: 'Dr Ram Nair',
    email: 'maniramu18@gmail.com',
    bsb: '064-000', accountNumber: '14815019',
    notes: 'Bank owner "C. Thuthikkattuparampil" matched by elimination - CONFIRM',
    listings: ['458162']
  },
  {
    name: 'Vincent',
    email: 'vincentkhloh@yahoo.com',
    bsb: '343-002', accountNumber: '018778118',
    notes: 'Bank owner "V. Kwong Hon" - confirm',
    listings: ['442421', '421013']
  },
];

async function run() {
  console.log('=== Populating owners from Master Directory ===\n');

  // Step 1: Remove old placeholder owners that don't match real data
  const existingOwners = await query(`SELECT id, name, email FROM owners`);
  console.log(`Existing owners in DB: ${existingOwners.rows.length}`);
  for (const existing of existingOwners.rows) {
    // Check if this owner matches any in our data
    const match = ownerData.find(o =>
      o.email.toLowerCase() === (existing.email || '').toLowerCase()
    );
    if (!match) {
      // Remove old placeholder owner (will set listing owner_id to NULL via CASCADE)
      console.log(`  Removing old placeholder: ${existing.name} (${existing.email})`);
      await query(`UPDATE listings SET owner_id = NULL WHERE owner_id = $1`, [existing.id]);
      await query(`DELETE FROM owners WHERE id = $1`, [existing.id]);
    } else {
      console.log(`  Keeping existing: ${existing.name} (${existing.email})`);
    }
  }

  // Step 2: Create/update all owners
  console.log(`\n--- Creating/updating ${ownerData.length} owners ---`);
  const ownerIdMap = {}; // email -> owner UUID

  for (const owner of ownerData) {
    const bankingDetails = {
      bsb: owner.bsb,
      accountNumber: owner.accountNumber,
      secondaryEmail: owner.secondaryEmail || null,
      emergencyPhone: owner.emergencyPhone || null,
      notes: owner.notes || null,
    };
    if (owner.listingBankOverrides) {
      bankingDetails.listingBankOverrides = owner.listingBankOverrides;
    }

    // Check if owner already exists by email
    const existing = await query(
      `SELECT id FROM owners WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [owner.email]
    );

    let ownerId;
    if (existing.rows.length > 0) {
      // Update existing
      ownerId = existing.rows[0].id;
      await query(
        `UPDATE owners SET name = $1, phone = $2, banking_details = $3 WHERE id = $4`,
        [owner.name, owner.phone || null, JSON.stringify(bankingDetails), ownerId]
      );
      console.log(`  Updated: ${owner.name} (${owner.email})`);
    } else {
      // Insert new
      const result = await query(
        `INSERT INTO owners (name, email, phone, banking_details)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [owner.name, owner.email, owner.phone || null, JSON.stringify(bankingDetails)]
      );
      ownerId = result.rows[0].id;
      console.log(`  Created: ${owner.name} (${owner.email})`);
    }
    ownerIdMap[owner.email.toLowerCase()] = ownerId;

    // Step 3: Assign listings to this owner
    for (const hwId of owner.listings) {
      const listingResult = await query(
        `UPDATE listings SET owner_id = $1 WHERE hostaway_listing_id = $2 RETURNING id, name`,
        [ownerId, hwId]
      );
      if (listingResult.rows.length > 0) {
        console.log(`    → Assigned listing: ${listingResult.rows[0].name} (HW:${hwId})`);
      } else {
        console.log(`    ⚠ Listing HW:${hwId} not found in DB`);
      }
    }
  }

  // Step 4: Summary
  console.log('\n=== Summary ===');
  const ownerCount = await query(`SELECT count(*) FROM owners`);
  const assignedCount = await query(`SELECT count(*) FROM listings WHERE owner_id IS NOT NULL`);
  const unassignedCount = await query(`SELECT count(*) FROM listings WHERE owner_id IS NULL`);
  const totalListings = await query(`SELECT count(*) FROM listings`);
  const reservationCount = await query(`SELECT count(*) FROM reservations`);

  console.log(`  Owners: ${ownerCount.rows[0].count}`);
  console.log(`  Listings: ${totalListings.rows[0].count} (${assignedCount.rows[0].count} assigned, ${unassignedCount.rows[0].count} unassigned)`);
  console.log(`  Reservations: ${reservationCount.rows[0].count}`);

  // Show any unassigned listings
  const unassigned = await query(`SELECT name, hostaway_listing_id FROM listings WHERE owner_id IS NULL`);
  if (unassigned.rows.length > 0) {
    console.log('\n  Unassigned listings:');
    for (const l of unassigned.rows) {
      console.log(`    - ${l.name} (HW:${l.hostaway_listing_id})`);
    }
  }

  // Show owner → listing assignments
  console.log('\n=== Owner → Listing Assignments ===');
  const assignments = await query(`
    SELECT o.name owner_name, o.email, l.name listing_name, l.hostaway_listing_id,
           o.banking_details->>'bsb' as bsb, o.banking_details->>'accountNumber' as account
    FROM owners o
    LEFT JOIN listings l ON l.owner_id = o.id
    ORDER BY o.name, l.name
  `);
  let currentOwner = '';
  for (const row of assignments.rows) {
    if (row.owner_name !== currentOwner) {
      currentOwner = row.owner_name;
      console.log(`\n  ${row.owner_name} (${row.email}) [BSB:${row.bsb} Acct:${row.account}]`);
    }
    if (row.listing_name) {
      console.log(`    - ${row.listing_name} (HW:${row.hostaway_listing_id})`);
    } else {
      console.log(`    (no listings assigned)`);
    }
  }

  console.log('\n=== Done ===');
  process.exit(0);
}

run().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
