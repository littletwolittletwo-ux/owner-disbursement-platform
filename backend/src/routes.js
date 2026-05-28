import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { query } from './db.js';
import { parseUploadedFile } from './services/parser.js';
import {
  insertReservations,
  insertTrustTransactions,
  insertExpenses,
  insertCleaningUtilities,
  reconciliationSummary,
  autoMatch
} from './services/reconciliation.js';
import { calculatePayout } from './services/payoutEngine.js';
import { calculateOwnerDisbursement, generateDisbursementPdf, bulkSend } from './services/disbursementEngine.js';
import { syncHostaway } from './services/hostaway.js';

const upload = multer({ dest: 'uploads/' });
export const router = express.Router();

function requireValid(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

router.get('/health', (_req, res) => res.json({ ok: true }));

router.post('/auth/login', [body('email').isEmail(), body('password').isString()], requireValid, async (req, res) => {
  const user = (await query(`SELECT * FROM users WHERE email=$1`, [req.body.email])).rows[0];
  if (!user || !await bcrypt.compare(req.body.password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET || 'dev-secret-change-me', { expiresIn: '12h' });
  res.json({ token });
});

router.get('/owners', async (_req, res) => {
  const owners = await query(`SELECT * FROM owners ORDER BY name`);
  res.json(owners.rows);
});

router.post('/owners', [body('name').notEmpty()], requireValid, async (req, res) => {
  const { name, email, phone, banking_details = {} } = req.body;
  const result = await query(
    `INSERT INTO owners (name, email, phone, banking_details) VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, email, phone, banking_details]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/owners/:id', async (req, res) => {
  const { name, email, phone, banking_details = {} } = req.body;
  const result = await query(
    `UPDATE owners SET name=$2, email=$3, phone=$4, banking_details=$5 WHERE id=$1 RETURNING *`,
    [req.params.id, name, email, phone, banking_details]
  );
  res.json(result.rows[0]);
});

router.delete('/owners/:id', async (req, res) => {
  await query(`DELETE FROM owners WHERE id=$1`, [req.params.id]);
  res.status(204).end();
});

router.get('/listings', async (_req, res) => {
  const rows = await query(`SELECT l.*, o.name owner_name FROM listings l LEFT JOIN owners o ON o.id=l.owner_id ORDER BY l.name`);
  res.json(rows.rows);
});

router.post('/listings', [body('name').notEmpty(), body('owner_id').notEmpty()], requireValid, async (req, res) => {
  const result = await query(
    `INSERT INTO listings
     (owner_id, name, address, airbnb_listing_id, booking_property_id, vrbo_id, hostaway_listing_id, cleaning_fee_baseline, utility_cap, platform_fee_rates)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      req.body.owner_id,
      req.body.name,
      req.body.address,
      req.body.airbnb_listing_id,
      req.body.booking_property_id,
      req.body.vrbo_id,
      req.body.hostaway_listing_id,
      req.body.cleaning_fee_baseline || 0,
      req.body.utility_cap || null,
      req.body.platform_fee_rates || { airbnb: 0.03, 'booking.com': 0.15, vrbo: 0.05 }
    ]
  );
  res.status(201).json(result.rows[0]);
});

router.post('/commission-rules', async (req, res) => {
  const result = await query(
    `INSERT INTO commission_rules (owner_id, listing_id, platform, type, rate, flat_amount, tiers)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.body.owner_id, req.body.listing_id || null, req.body.platform, req.body.type, req.body.rate || 0, req.body.flat_amount || 0, req.body.tiers || []]
  );
  res.status(201).json(result.rows[0]);
});

router.get('/reservations', async (_req, res) => {
  const rows = await query(`SELECT r.*, l.name listing_name FROM reservations r LEFT JOIN listings l ON l.id=r.listing_id ORDER BY check_in DESC`);
  res.json(rows.rows);
});

router.post('/payout/calculate', (req, res) => res.json(calculatePayout(req.body.reservation || req.body, req.body.feeRates || {})));

router.post('/uploads/:type', upload.single('file'), async (req, res, next) => {
  try {
    const rows = await parseUploadedFile(req.file.path, req.file.originalname);
    let inserted;
    if (req.params.type === 'trust') inserted = await insertTrustTransactions(rows, req.file.originalname);
    else if (req.params.type === 'reservations') inserted = await insertReservations(rows, req.file.originalname);
    else if (req.params.type === 'expenses') inserted = await insertExpenses(rows, req.file.originalname);
    else if (req.params.type === 'cleaning-utilities') inserted = await insertCleaningUtilities(rows, req.file.originalname);
    else return res.status(400).json({ error: 'Unknown upload type' });
    res.json({ rows: rows.length, inserted });
  } catch (error) {
    next(error);
  }
});

router.post('/reconcile/auto-match', async (_req, res) => res.json({ matched: await autoMatch() }));

router.post('/reconcile/manual-match', async (req, res) => {
  const result = await query(
    `INSERT INTO transaction_reservation_matches (trust_transaction_id, reservation_id, match_type, confidence)
     VALUES ($1,$2,'manual',1.0) ON CONFLICT DO NOTHING RETURNING *`,
    [req.body.trust_transaction_id, req.body.reservation_id]
  );
  await query(`UPDATE trust_transactions SET status='matched' WHERE id=$1`, [req.body.trust_transaction_id]);
  res.status(201).json(result.rows[0]);
});

router.get('/dashboard/:month', async (req, res) => res.json(await reconciliationSummary(req.params.month)));

router.post('/disbursements/:month/:ownerId/calculate', async (req, res, next) => {
  try {
    res.json(await calculateOwnerDisbursement(req.params.ownerId, req.params.month));
  } catch (error) {
    next(error);
  }
});

router.get('/disbursements/:id/pdf', async (req, res, next) => {
  try {
    const pdf = await generateDisbursementPdf(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="disbursement-${req.params.id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

router.post('/emails/:month/send', async (req, res, next) => {
  try {
    res.json(await bulkSend(req.params.month));
  } catch (error) {
    next(error);
  }
});

router.get('/email-log', async (_req, res) => {
  const rows = await query(`SELECT * FROM email_log ORDER BY sent_at DESC LIMIT 100`);
  res.json(rows.rows);
});

router.post('/hostaway/sync', async (_req, res, next) => {
  try {
    res.json(await syncHostaway());
  } catch (error) {
    next(error);
  }
});
