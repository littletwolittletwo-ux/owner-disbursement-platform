import dotenv from 'dotenv';
import { query, pool } from './db.js';

dotenv.config();

// Owner data from LiveLuxe Dashboard - one primary owner per listing
const OWNERS = [
  // Managed Properties
  { name: 'Vincent', email: 'vincentkhloh@yahoo.com', phone: null, listings: [
    { hostawayId: '442421', name: '610/17 Singers Lane', address: '17 Singers Lane 610' },
    { hostawayId: '421013', name: '702/17 Singers Ln', address: '702/17 Singers Lane' }
  ]},
  { name: 'Karen', email: 'lohaiquan@gmail.com', phone: null, listings: [
    { hostawayId: '472415', name: '1024/43 Therry Street', address: 'Therry Street #1024' }
  ]},
  { name: 'Dr Ram Nair', email: 'maniramu18@gmail.com', phone: null, listings: [
    { hostawayId: '458162', name: '3707E/888 Collins Street', address: '888 Collins Street 3707E' }
  ]},
  { name: 'Dharyl Ighwan', email: 'dharyl.ighwan@hotmail.com', phone: null, listings: [
    { hostawayId: '437035', name: '1310/65 Dudley St', address: '1310/65 Dudley Street' }
  ]},
  { name: 'Cathy & Matt Johnston', email: 'mattcathy7@gmail.com', phone: null, listings: [
    { hostawayId: '485212', name: '2107/11 Bale Circuit', address: '11 Bale Circuit 2107' }
  ]},
  { name: 'Francis Goh', email: 'francisgoh7@gmail.com', phone: null, listings: [
    { hostawayId: '398565', name: '1213/43 Therry St', address: '1213/43 Therry Street' },
    { hostawayId: '413321', name: '1105/241 City Road', address: '241 City Rd, Southbank VIC 3006' }
  ]},
  { name: 'Simon Osborn', email: 'sjosborn5067@gmail.com', phone: null, listings: [
    { hostawayId: '485810', name: '147/83 Whiteman Street', address: '83 Whiteman Street 147' }
  ]},

  // New Owner Listings
  { name: 'Uros Brkic', email: 'urosh_brkich@hotmail.com', phone: '+61 0421 389 185', listings: [
    { hostawayId: '522208', name: '6/90 Kavanagh St', address: '6/90 Kavanagh St, Southbank VIC 3006' }
  ]},
  { name: 'Wayne Banks-Smith', email: 'wbs@financementors.com.au', phone: '+61 0412 558 611', listings: [
    { hostawayId: '522214', name: '10/105 Beach St', address: '10/105 Beach St, Port Melbourne VIC 3207' }
  ]},
  { name: 'Alison Dilena', email: 'alibeach@hotmail.com', phone: '+61 0419 188 880', listings: [
    { hostawayId: '522215', name: '214/181 Exhibition St', address: '181 Exhibition Street 214' }
  ]},
  { name: 'Jack Kagan', email: 'jack@kinetickonstructions.com.au', phone: '+61 0499 036 903', listings: [
    { hostawayId: '522216', name: '516/99 Dow St', address: '99 Dow St, Port Melbourne VIC 3207' }
  ]},
  { name: 'Richard Supler', email: 'dino@austens.com.au', phone: '+61 0402 310 170', listings: [
    { hostawayId: '522217', name: '1620/474 Flinders St', address: '1620/474 Flinders St, Melbourne VIC 3000' }
  ]},
  { name: 'Stuart Lee', email: 'torresleefamily@gmail.com', phone: '+64 272 978 999', listings: [
    { hostawayId: '522219', name: '1738/474 Flinders St', address: '474 Flinders St, Melbourne VIC 3000' }
  ]},
  { name: 'Krishneel Maharaj', email: 'krishneelmaharaj77@gmail.com', phone: '+61 0411 125 214', listings: [
    { hostawayId: '522220', name: '1624/474 Flinders St', address: '474 Flinders St, Melbourne VIC 3000' }
  ]},
  { name: 'Amanda Isherwood', email: 'amanda@amamus.com.au', phone: '+61 0404 481 03', listings: [
    { hostawayId: '522221', name: '206/181 Exhibition St', address: '206/181 Exhibition St, Melbourne VIC 3000' }
  ]},
  { name: 'Jake Frost', email: 'jkalfrost@hotmail.com', phone: null, listings: [
    { hostawayId: '522224', name: '102/1 Graham St', address: '1 Graham St, Port Melbourne VIC 3207' }
  ]},
  { name: 'Matt & Amy Leiper', email: 'amymleiper@gmail.com', phone: null, listings: [
    { hostawayId: '522225', name: '512/471 Little Bourke St', address: '512/471 Little Bourke St, Melbourne VIC 3000' }
  ]},
  { name: 'Alen Damjanovic', email: 'alen@almanegroup.com.au', phone: '+61 0405 202 493', listings: [
    { hostawayId: '522226', name: '2003/43 Hancock St', address: '2003/43 Hancock St, Southbank VIC 3006' },
    { hostawayId: '522227', name: '811/43 Hancock St', address: 'Hancock Street' },
    { hostawayId: '522228', name: '3018/70 Southbank Blvd', address: '3018/70 Southbank Blvd, Southbank VIC 3006' },
    { hostawayId: '522229', name: '1404/43 Hancock St', address: '1404/43 Hancock St, Southbank VIC 3006' }
  ]},
  { name: 'Ben Willson', email: 'ben@awtco.org.au', phone: null, listings: [
    { hostawayId: '522230', name: '2/104 Coventry St', address: '2/104 Coventry St, South Melbourne VIC 3205' }
  ]},
  { name: 'North Port Hotel', email: 'contact@northporthotel.com.au', phone: null, listings: [
    { hostawayId: '522231', name: 'North Port Hotel', address: '146 Evans St, Port Melbourne VIC 3207' }
  ]},
  { name: 'Georgia & Nathan', email: 'georgiaknudsen@hotmail.com', phone: null, listings: [
    { hostawayId: '522235', name: '2412/27 Little Collins St', address: '2412/27 Little Collins St, Melbourne VIC 3000' }
  ]},
  { name: 'Michael Gavin', email: 'michaeligavin@gmail.com', phone: null, listings: [
    { hostawayId: '522236', name: '1403/172 William St', address: '172 William St, Melbourne VIC 3000' },
    { hostawayId: '522237', name: '1406/172 William St', address: '172 William St, Melbourne VIC 3000' }
  ]},
  { name: 'Russ Butler', email: 'rfrbutler@outlook.com', phone: '+61 0438 048 864', listings: [
    { hostawayId: '522239', name: '405/232-242 Rouse St', address: '405/232-242 Rouse St, Port Melbourne VIC 3207' }
  ]},
];

async function seed() {
  console.log('Seeding LiveLuxe owners and listings...');

  // Track which listings are already created (for shared listings, first owner wins)
  const createdListings = new Set();
  let ownerCount = 0;
  let listingCount = 0;

  for (const ownerData of OWNERS) {
    // Upsert owner
    const ownerResult = await query(
      `INSERT INTO owners (name, email, phone, banking_details)
       VALUES ($1, $2, $3, '{}')
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [ownerData.name, ownerData.email, ownerData.phone]
    );

    let owner;
    if (ownerResult.rows.length > 0) {
      owner = ownerResult.rows[0];
      ownerCount++;
    } else {
      // Already exists, fetch it
      owner = (await query(`SELECT * FROM owners WHERE email=$1`, [ownerData.email])).rows[0];
    }

    if (!owner) {
      console.log(`  Skipped ${ownerData.name} (could not find/create)`);
      continue;
    }

    // Create listings for this owner (skip if already created by another owner)
    for (const listing of ownerData.listings) {
      if (createdListings.has(listing.hostawayId)) {
        console.log(`  Listing ${listing.hostawayId} (${listing.name}) already assigned to another owner, skipping`);
        continue;
      }

      const listingResult = await query(
        `INSERT INTO listings (owner_id, name, address, hostaway_listing_id, platform_fee_rates, monthly_software_fee)
         VALUES ($1, $2, $3, $4, '{"airbnb":0.165,"booking.com":0.165,"vrbo":0.12,"direct":0}', 65.99)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [owner.id, listing.name, listing.address, listing.hostawayId]
      );

      if (listingResult.rows.length > 0) {
        listingCount++;
        createdListings.add(listing.hostawayId);
      } else {
        // Check if listing exists with this hostaway ID
        const existing = (await query(`SELECT id FROM listings WHERE hostaway_listing_id=$1`, [listing.hostawayId])).rows[0];
        if (existing) createdListings.add(listing.hostawayId);
      }
    }

    // Create default commission rule: 18% au_management
    await query(
      `INSERT INTO commission_rules (owner_id, listing_id, platform, type, rate)
       VALUES ($1, NULL, 'all', 'au_management', 0.18)
       ON CONFLICT DO NOTHING`,
      [owner.id]
    );

    console.log(`  ${ownerData.name} - ${ownerData.listings.length} listing(s)`);
  }

  console.log(`\nSeed complete: ${ownerCount} new owners, ${listingCount} new listings`);
  console.log('All owners have default 18% + GST (au_management) commission rules');
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => pool.end());
