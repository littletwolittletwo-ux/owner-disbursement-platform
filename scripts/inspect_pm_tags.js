import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const res = await axios.post('https://api.hostaway.com/v1/accessTokens',
  new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.HOSTAWAY_ACCOUNT_ID,
    client_secret: process.env.HOSTAWAY_API_KEY,
  }).toString(),
  { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
);
const token = res.data.access_token;
const client = axios.create({
  baseURL: 'https://api.hostaway.com/v1',
  headers: { Authorization: `Bearer ${token}` },
});

const r = await client.get('/listings', { params: { limit: 200 } });
const listings = r.data.result || [];

// Collect all unique tags across all listings
const allTags = new Map();
const pmListings = [];
const nonPmListings = [];

listings.forEach(l => {
  const tags = l.listingTags || [];
  tags.forEach(t => allTags.set(t.name, (allTags.get(t.name) || 0) + 1));

  const hasPM = tags.some(t => t.name.toLowerCase().includes('property management'));
  if (hasPM) {
    pmListings.push(l);
  } else {
    nonPmListings.push(l);
  }
});

console.log('=== All unique tags ===');
for (const [name, count] of [...allTags.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  "${name}": ${count} listings`);
}

console.log(`\n=== Property Management tagged: ${pmListings.length} ===`);
pmListings.forEach(l => {
  const tags = (l.listingTags || []).map(t => t.name).join(', ');
  console.log(`  ${l.id} | ${l.internalListingName} | tags: [${tags}]`);
});

console.log(`\n=== NON Property Management: ${nonPmListings.length} ===`);
nonPmListings.forEach(l => {
  const tags = (l.listingTags || []).map(t => t.name).join(', ');
  console.log(`  ${l.id} | ${l.internalListingName} | tags: [${tags}]`);
});
