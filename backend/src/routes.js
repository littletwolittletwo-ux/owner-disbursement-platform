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
  autoMatch,
  getUnmatchedCandidates
} from './services/reconciliation.js';
import { calculatePayout } from './services/payoutEngine.js';
import { calculateOwnerDisbursement, generateDisbursementPdf, bulkSend } from './services/disbursementEngine.js';
import { generateReportHtml, generateEmailBodyHtml } from './services/reportGenerator.js';
import { renderHtmlToPdf } from './services/pdfRenderer.js';
import { syncHostaway, syncHostawayDateRange, syncHostawayMonth, queryReservations, getStraddlingBookings, reservationsToCSV } from './services/hostaway.js';
import { generateMonthlyAba } from './services/abaGenerator.js';
import { createExpense, getExpenses, getExpense, deleteExpense, importExpenseCsv, uploadReceipt } from './services/expenseService.js';

const upload = multer({ dest: process.env.VERCEL ? '/tmp/uploads' : 'uploads/' });
export const router = express.Router();

function requireValid(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

router.get('/health', (_req, res) => res.json({ ok: true }));

// ── Auth ──
router.post('/auth/login', [body('email').isEmail(), body('password').isString()], requireValid, async (req, res) => {
  const user = (await query(`SELECT * FROM users WHERE email=$1`, [req.body.email])).rows[0];
  if (!user || !await bcrypt.compare(req.body.password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET || 'dev-secret-change-me', { expiresIn: '12h' });
  res.json({ token });
});

// ── Owners ──
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

// ── Listings ──
router.get('/listings', async (_req, res) => {
  const rows = await query(`SELECT l.*, o.name owner_name FROM listings l LEFT JOIN owners o ON o.id=l.owner_id ORDER BY l.name`);
  res.json(rows.rows);
});

router.post('/listings', [body('name').notEmpty(), body('owner_id').notEmpty()], requireValid, async (req, res) => {
  const result = await query(
    `INSERT INTO listings
     (owner_id, name, address, airbnb_listing_id, booking_property_id, vrbo_id, hostaway_listing_id, cleaning_fee_baseline, utility_cap, platform_fee_rates, monthly_software_fee)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
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
      req.body.platform_fee_rates || { airbnb: 0.165, 'booking.com': 0.165, vrbo: 0.12, direct: 0 },
      req.body.monthly_software_fee ?? 65.99
    ]
  );
  res.status(201).json(result.rows[0]);
});

// ── Property Deals (per-listing management fees) ──
// IMPORTANT: /deals routes registered BEFORE /:id to avoid route conflicts
router.get('/listings/deals', async (_req, res) => {
  const rows = await query(
    `SELECT l.id, l.name, l.address, l.hostaway_listing_id, l.cleaning_fee_baseline,
            l.management_fee_pct, l.owner_id,
            COALESCE(l.mgmt_fee_waiver_pct, 0) as mgmt_fee_waiver_pct,
            COALESCE(l.mgmt_fee_boost, 0) as mgmt_fee_boost,
            o.name owner_name,
            COALESCE(l.management_fee_pct, cr.rate, 0.198) as effective_mgmt_rate,
            CASE
              WHEN l.management_fee_pct IS NOT NULL THEN 'custom'
              WHEN cr.rate IS NOT NULL THEN 'rule'
              ELSE 'default'
            END as rate_source
     FROM listings l
     LEFT JOIN owners o ON o.id = l.owner_id
     LEFT JOIN commission_rules cr ON cr.owner_id = l.owner_id
       AND (cr.listing_id = l.id OR cr.listing_id IS NULL)
       AND cr.platform = 'all'
     ORDER BY o.name, l.name`
  );
  res.json(rows.rows);
});

router.put('/listings/deals/bulk', async (req, res) => {
  const { updates } = req.body; // [{ listing_id, management_fee_pct, mgmt_fee_waiver_pct, mgmt_fee_boost }]
  if (!Array.isArray(updates)) return res.status(400).json({ error: 'updates must be an array' });
  const results = [];
  for (const u of updates) {
    const sets = ['management_fee_pct = $2'];
    const vals = [u.listing_id, u.management_fee_pct ?? null];
    let idx = 3;
    if ('mgmt_fee_waiver_pct' in u) { sets.push(`mgmt_fee_waiver_pct = $${idx++}`); vals.push(u.mgmt_fee_waiver_pct ?? 0); }
    if ('mgmt_fee_boost' in u) { sets.push(`mgmt_fee_boost = $${idx++}`); vals.push(u.mgmt_fee_boost ?? 0); }
    const result = await query(
      `UPDATE listings SET ${sets.join(', ')} WHERE id = $1 RETURNING id, name, management_fee_pct, mgmt_fee_waiver_pct, mgmt_fee_boost`,
      vals
    );
    if (result.rows[0]) results.push(result.rows[0]);
  }
  res.json(results);
});

router.put('/listings/:id', async (req, res) => {
  const fields = req.body;
  const sets = [];
  const values = [req.params.id];
  let idx = 2;
  const allowed = ['name', 'address', 'owner_id', 'airbnb_listing_id', 'booking_property_id',
    'vrbo_id', 'hostaway_listing_id', 'cleaning_fee_baseline', 'utility_cap',
    'platform_fee_rates', 'monthly_software_fee', 'management_fee_pct',
    'mgmt_fee_waiver_pct', 'mgmt_fee_boost'];
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key}=$${idx++}`);
      values.push(fields[key]);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
  const result = await query(`UPDATE listings SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, values);
  if (!result.rows[0]) return res.status(404).json({ error: 'Listing not found' });
  res.json(result.rows[0]);
});

// ── Commission Rules ──
router.get('/commission-rules', async (req, res) => {
  const rows = await query(
    `SELECT cr.*, o.name owner_name, l.name listing_name
     FROM commission_rules cr
     JOIN owners o ON o.id = cr.owner_id
     LEFT JOIN listings l ON l.id = cr.listing_id
     ORDER BY o.name`
  );
  res.json(rows.rows);
});

router.post('/commission-rules', async (req, res) => {
  const result = await query(
    `INSERT INTO commission_rules (owner_id, listing_id, platform, type, rate, flat_amount, tiers)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.body.owner_id, req.body.listing_id || null, req.body.platform || 'all', req.body.type || 'au_management', req.body.rate || 0.18, req.body.flat_amount || 0, req.body.tiers || []]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/commission-rules/:id', async (req, res) => {
  const result = await query(
    `UPDATE commission_rules SET platform=$2, type=$3, rate=$4, flat_amount=$5, tiers=$6 WHERE id=$1 RETURNING *`,
    [req.params.id, req.body.platform, req.body.type, req.body.rate, req.body.flat_amount || 0, req.body.tiers || []]
  );
  res.json(result.rows[0]);
});

router.delete('/commission-rules/:id', async (req, res) => {
  await query(`DELETE FROM commission_rules WHERE id=$1`, [req.params.id]);
  res.status(204).end();
});

// ── Reservations ──
router.get('/reservations', async (_req, res) => {
  const rows = await query(`SELECT r.*, l.name listing_name FROM reservations r LEFT JOIN listings l ON l.id=r.listing_id ORDER BY check_in DESC`);
  res.json(rows.rows);
});

// ── Payout Calculation ──
router.post('/payout/calculate', (req, res) => res.json(calculatePayout(req.body.reservation || req.body, req.body.feeRates || {})));

// ── File Uploads ──
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

// ── Reconciliation ──
router.post('/reconcile/auto-match', async (_req, res) => res.json({ matched: await autoMatch() }));

router.post('/reconcile/manual-match', async (req, res) => {
  const result = await query(
    `INSERT INTO transaction_reservation_matches (trust_transaction_id, reservation_id, match_type, confidence)
     VALUES ($1,$2,'manual',1.0) ON CONFLICT DO NOTHING RETURNING *`,
    [req.body.trust_transaction_id, req.body.reservation_id]
  );
  await query(`UPDATE trust_transactions SET status='matched' WHERE id=$1`, [req.body.trust_transaction_id]);
  await query(`UPDATE reservations SET payout_received=true, payout_received_date=(SELECT transaction_date FROM trust_transactions WHERE id=$1) WHERE id=$2`,
    [req.body.trust_transaction_id, req.body.reservation_id]);
  res.status(201).json(result.rows[0]);
});

router.get('/reconcile/unmatched-candidates/:transactionId', async (req, res, next) => {
  try {
    const candidates = await getUnmatchedCandidates(req.params.transactionId);
    res.json(candidates);
  } catch (error) {
    next(error);
  }
});

// ── Dashboard ──
router.get('/dashboard/:month', async (req, res) => res.json(await reconciliationSummary(req.params.month)));

// ── Disbursements ──
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
    res.setHeader('Content-Disposition', `inline; filename="LiveLuxe-Disbursement-${req.params.id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

// ── Report Preview & PDF ──
router.get('/disbursements/:id/report', async (req, res, next) => {
  try {
    const html = await generateReportHtml(req.params.id);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    next(error);
  }
});

router.get('/disbursements/:id/report/pdf', async (req, res, next) => {
  try {
    const html = await generateReportHtml(req.params.id);
    const pdf = await renderHtmlToPdf(html);
    if (!pdf) {
      // Fallback: serve HTML if Chrome unavailable
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="LiveLuxe-Report-${req.params.id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

router.get('/disbursements/:id/email-preview', async (req, res, next) => {
  try {
    const html = await generateEmailBodyHtml(req.params.id);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    next(error);
  }
});

// ── Emails ──
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

// ── ABA Export ──
router.get('/aba/:month', async (req, res, next) => {
  try {
    const result = await generateMonthlyAba(req.params.month);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="owner-payouts-${req.params.month}.aba"`);
    res.send(result.content);
  } catch (error) {
    next(error);
  }
});

router.get('/aba/:month/preview', async (req, res, next) => {
  try {
    const result = await generateMonthlyAba(req.params.month);
    res.json({ payments: result.payments, skipped: result.skipped, totalAmount: result.totalAmount });
  } catch (error) {
    next(error);
  }
});

// ── Trust Account Config ──
router.get('/trust-account-config', async (_req, res) => {
  const rows = await query(`SELECT * FROM trust_account_config WHERE is_active=true LIMIT 1`);
  res.json(rows.rows[0] || null);
});

router.put('/trust-account-config', async (req, res) => {
  const { bsb, account_number, account_name, bank_name, financial_institution_code, apca_user_id } = req.body;
  const existing = (await query(`SELECT id FROM trust_account_config WHERE is_active=true LIMIT 1`)).rows[0];
  if (existing) {
    const result = await query(
      `UPDATE trust_account_config SET bsb=$2, account_number=$3, account_name=$4, bank_name=$5, financial_institution_code=$6, apca_user_id=$7 WHERE id=$1 RETURNING *`,
      [existing.id, bsb, account_number, account_name, bank_name || 'NAB', financial_institution_code || 'NAB', apca_user_id || '000000']
    );
    return res.json(result.rows[0]);
  }
  const result = await query(
    `INSERT INTO trust_account_config (bsb, account_number, account_name, bank_name, financial_institution_code, apca_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [bsb, account_number, account_name, bank_name || 'NAB', financial_institution_code || 'NAB', apca_user_id || '000000']
  );
  res.status(201).json(result.rows[0]);
});

// ── Reservations Query & CSV ──
router.get('/reservations/query', async (req, res, next) => {
  try {
    const { startDate, endDate, listingId, hostawayListingId, platform, includeStraddlers } = req.query;
    const rows = await queryReservations({
      startDate, endDate, listingId, hostawayListingId, platform,
      includeStraddlers: includeStraddlers !== 'false'
    });
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/reservations/csv', async (req, res, next) => {
  try {
    const { startDate, endDate, listingId, hostawayListingId, platform } = req.query;
    const rows = await queryReservations({
      startDate, endDate, listingId, hostawayListingId, platform,
      includeStraddlers: true
    });
    const csv = reservationsToCSV(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="reservations-${startDate || 'all'}-to-${endDate || 'all'}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

router.get('/reservations/straddlers/:month', async (req, res, next) => {
  try {
    res.json(await getStraddlingBookings(req.params.month));
  } catch (error) {
    next(error);
  }
});

// ── Expenses (CRUD + receipts) ──
router.get('/expenses', async (req, res, next) => {
  try {
    const { owner_id, listing_id, month, category } = req.query;
    res.json(await getExpenses({ ownerId: owner_id, listingId: listing_id, month, category }));
  } catch (error) { next(error); }
});

router.post('/expenses', upload.single('receipt'), async (req, res, next) => {
  try {
    let receiptUrl = null;
    let receiptFilename = null;
    if (req.file) {
      const { default: fs } = await import('fs');
      const buffer = fs.readFileSync(req.file.path);
      const result = await uploadReceipt(buffer, req.file.originalname);
      receiptUrl = result.url;
      receiptFilename = result.filename;
      fs.unlinkSync(req.file.path);
    }
    const expense = await createExpense({
      listingId: req.body.listing_id,
      expenseDate: req.body.expense_date,
      description: req.body.description,
      category: req.body.category,
      amount: Number(req.body.amount),
      receiptUrl,
      receiptFilename,
    });
    res.status(201).json(expense);
  } catch (error) { next(error); }
});

router.get('/expenses/:id', async (req, res, next) => {
  try {
    const expense = await getExpense(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json(expense);
  } catch (error) { next(error); }
});

router.delete('/expenses/:id', async (req, res, next) => {
  try {
    await deleteExpense(req.params.id);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.post('/expenses/import-csv', upload.single('file'), async (req, res, next) => {
  try {
    const { default: fs } = await import('fs');
    const buffer = fs.readFileSync(req.file.path);
    fs.unlinkSync(req.file.path);
    const result = await importExpenseCsv(buffer);
    res.json(result);
  } catch (error) { next(error); }
});

// ── Hostaway Sync ──
router.post('/hostaway/sync', async (req, res, next) => {
  try {
    const months = Number(req.query.months || req.body.months || 3);
    res.json(await syncHostaway(months));
  } catch (error) {
    next(error);
  }
});

router.post('/hostaway/sync-range', async (req, res, next) => {
  try {
    const { startDate, endDate, hostawayListingId } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });
    res.json(await syncHostawayDateRange(startDate, endDate, hostawayListingId));
  } catch (error) {
    next(error);
  }
});

router.post('/hostaway/sync-month/:month', async (req, res, next) => {
  try {
    res.json(await syncHostawayMonth(req.params.month));
  } catch (error) {
    next(error);
  }
});
