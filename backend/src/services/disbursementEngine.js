import PDFDocument from 'pdfkit';
import postmark from 'postmark';
import { query, withTransaction } from '../db.js';
import { startEndForMonth } from '../utils/dates.js';
import { normalizePlatform, roundCurrency } from './payoutEngine.js';

export async function calculateOwnerDisbursement(ownerId, month) {
  const { start, end } = startEndForMonth(month);
  return withTransaction(async (client) => {
    const owner = (await client.query(`SELECT * FROM owners WHERE id=$1`, [ownerId])).rows[0];
    if (!owner) throw new Error('Owner not found');

    const reservations = (await client.query(
      `SELECT r.*, l.name listing_name, l.address, cr.type commission_type, cr.rate commission_rate, cr.flat_amount, cr.tiers
       FROM reservations r
       JOIN listings l ON l.id=r.listing_id
       LEFT JOIN commission_rules cr ON cr.owner_id=l.owner_id AND (cr.listing_id=l.id OR cr.listing_id IS NULL) AND cr.platform=r.platform
       LEFT JOIN transaction_reservation_matches m ON m.reservation_id=r.id
       LEFT JOIN trust_transactions t ON t.id=m.trust_transaction_id
       WHERE l.owner_id=$1
         AND ((r.platform='vrbo' AND t.transaction_date BETWEEN $2 AND $3) OR (r.platform <> 'vrbo' AND r.disbursement_month=$4))`,
      [ownerId, start, end, month]
    )).rows;

    const expenses = (await client.query(
      `SELECT e.* FROM owner_expenses e JOIN listings l ON l.id=e.listing_id WHERE l.owner_id=$1 AND e.expense_date BETWEEN $2 AND $3`,
      [ownerId, start, end]
    )).rows;
    const cleaning = (await client.query(
      `SELECT c.* FROM cleaning_records c JOIN listings l ON l.id=c.listing_id WHERE l.owner_id=$1 AND c.cleaning_date BETWEEN $2 AND $3`,
      [ownerId, start, end]
    )).rows;
    const utilities = (await client.query(
      `SELECT u.* FROM utility_records u JOIN listings l ON l.id=u.listing_id WHERE l.owner_id=$1 AND u.utility_date BETWEEN $2 AND $3`,
      [ownerId, start, end]
    )).rows;

    const gross = roundCurrency(reservations.reduce((sum, r) => sum + Number(r.gross_amount), 0));
    const platformFees = roundCurrency(reservations.reduce((sum, r) => sum + Number(r.platform_fee), 0));
    const net = roundCurrency(gross - platformFees);
    const commission = roundCurrency(reservations.reduce((sum, r) => sum + commissionForReservation(r), 0));
    const expenseTotal = roundCurrency(expenses.reduce((sum, e) => sum + Number(e.amount), 0));
    const cleaningTotal = roundCurrency(cleaning.reduce((sum, c) => sum + Number(c.amount), 0));
    const utilityTotal = roundCurrency(utilities.reduce((sum, u) => sum + Number(u.amount), 0));
    const finalPayout = roundCurrency(net - commission - expenseTotal - cleaningTotal - utilityTotal);

    const disbursement = (await client.query(
      `INSERT INTO disbursements
       (owner_id, month, gross_channel_payout, platform_fees, net_channel_revenue, management_commission, owner_expenses, cleaning_costs, utilities, final_owner_payout)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (owner_id, month) DO UPDATE SET
       gross_channel_payout=EXCLUDED.gross_channel_payout, platform_fees=EXCLUDED.platform_fees, net_channel_revenue=EXCLUDED.net_channel_revenue,
       management_commission=EXCLUDED.management_commission, owner_expenses=EXCLUDED.owner_expenses, cleaning_costs=EXCLUDED.cleaning_costs,
       utilities=EXCLUDED.utilities, final_owner_payout=EXCLUDED.final_owner_payout, generated_at=now()
       RETURNING *`,
      [ownerId, month, gross, platformFees, net, commission, expenseTotal, cleaningTotal, utilityTotal, finalPayout]
    )).rows[0];

    await client.query(`DELETE FROM disbursement_line_items WHERE disbursement_id=$1`, [disbursement.id]);
    for (const r of reservations) {
      await insertLine(client, disbursement.id, 'reservation', `${r.platform} ${r.guest_name || 'reservation'} - ${r.listing_name}`, Number(r.net_amount), 'reservations', r.id, r);
      await insertLine(client, disbursement.id, 'platform_fee', `${r.platform} platform fee`, -Number(r.platform_fee), 'reservations', r.id, r);
    }
    if (commission) await insertLine(client, disbursement.id, 'commission', 'Management commission', -commission, 'commission_rules', null, {});
    for (const e of expenses) await insertLine(client, disbursement.id, 'expense', e.description, -Number(e.amount), 'owner_expenses', e.id, e);
    for (const c of cleaning) await insertLine(client, disbursement.id, 'cleaning', c.description || 'Cleaning', -Number(c.amount), 'cleaning_records', c.id, c);
    for (const u of utilities) await insertLine(client, disbursement.id, 'utility', `${u.utility_type} ${u.billing_period || ''}`.trim(), -Number(u.amount), 'utility_records', u.id, u);

    return { ...disbursement, owner, reservations, expenses, cleaning, utilities };
  });
}

function commissionForReservation(reservation) {
  const type = reservation.commission_type || 'percentage_net';
  const rate = Number(reservation.commission_rate || 0);
  const gross = Number(reservation.gross_amount || 0);
  const net = Number(reservation.net_amount || 0);
  if (type === 'percentage_gross') return gross * rate;
  if (type === 'percentage_net') return net * rate;
  if (type === 'flat_fee') return Number(reservation.flat_amount || 0);
  if (type === 'tiered') return tieredCommission(net, reservation.tiers || []);
  return 0;
}

function tieredCommission(amount, tiers) {
  const parsed = typeof tiers === 'string' ? JSON.parse(tiers || '[]') : tiers;
  const tier = [...parsed].sort((a, b) => Number(b.min || 0) - Number(a.min || 0)).find((item) => amount >= Number(item.min || 0));
  return amount * Number(tier?.rate || 0);
}

async function insertLine(client, disbursementId, type, description, amount, sourceTable, sourceId, metadata) {
  await client.query(
    `INSERT INTO disbursement_line_items (disbursement_id, type, description, amount, source_table, source_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [disbursementId, type, description, roundCurrency(amount), sourceTable, sourceId, metadata]
  );
}

export async function getDisbursementDetail(id) {
  const disbursement = (await query(`SELECT d.*, o.name owner_name, o.email FROM disbursements d JOIN owners o ON o.id=d.owner_id WHERE d.id=$1`, [id])).rows[0];
  if (!disbursement) throw new Error('Disbursement not found');
  const lines = (await query(`SELECT * FROM disbursement_line_items WHERE disbursement_id=$1 ORDER BY created_at`, [id])).rows;
  return { disbursement, lines };
}

export async function generateDisbursementPdf(id) {
  const { disbursement, lines } = await getDisbursementDetail(id);
  const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.fontSize(18).text('Owner Disbursement Statement');
  doc.fontSize(10).text('Company Logo Placeholder').moveDown();
  doc.fontSize(12).text(`Owner: ${disbursement.owner_name}`);
  doc.text(`Month: ${disbursement.month}`);
  doc.text(`Generated: ${new Date(disbursement.generated_at).toLocaleDateString()}`).moveDown();
  doc.fontSize(14).text(`Final Owner Payout: $${Number(disbursement.final_owner_payout).toFixed(2)}`).moveDown();
  doc.fontSize(11);
  for (const line of lines) {
    doc.text(`${line.type.padEnd(14)} ${line.description} ${formatMoney(line.amount)}`);
  }
  doc.moveDown().fontSize(10).text('All line items are linked to source records in the platform audit trail.');
  doc.end();
  return done;
}

function formatMoney(value) {
  const num = Number(value);
  return `${num < 0 ? '-' : ''}$${Math.abs(num).toFixed(2)}`;
}

export async function sendDisbursementEmail(id) {
  const { disbursement } = await getDisbursementDetail(id);
  if (!process.env.POSTMARK_API_KEY || !process.env.POSTMARK_FROM_EMAIL) {
    const result = await query(
      `INSERT INTO email_log (owner_id, disbursement_id, recipient, statement_month, status, error)
       VALUES ($1,$2,$3,$4,'skipped','POSTMARK_API_KEY or POSTMARK_FROM_EMAIL is not configured') RETURNING *`,
      [disbursement.owner_id, id, disbursement.email || 'missing-recipient', disbursement.month]
    );
    return result.rows[0];
  }
  const pdf = await generateDisbursementPdf(id);
  const client = new postmark.ServerClient(process.env.POSTMARK_API_KEY);
  const response = await client.sendEmail({
    From: process.env.POSTMARK_FROM_EMAIL,
    To: disbursement.email,
    Subject: `Disbursement statement ${disbursement.month}`,
    TextBody: `Your ${disbursement.month} disbursement statement is attached. Final payout: $${Number(disbursement.final_owner_payout).toFixed(2)}.`,
    Attachments: [{ Name: `disbursement-${disbursement.month}.pdf`, Content: pdf.toString('base64'), ContentType: 'application/pdf' }]
  });
  const result = await query(
    `INSERT INTO email_log (owner_id, disbursement_id, recipient, statement_month, status, provider_message_id)
     VALUES ($1,$2,$3,$4,'sent',$5) RETURNING *`,
    [disbursement.owner_id, id, disbursement.email, disbursement.month, response.MessageID]
  );
  return result.rows[0];
}

export async function bulkSend(month) {
  const rows = (await query(`SELECT id FROM disbursements WHERE month=$1`, [month])).rows;
  const results = [];
  for (const row of rows) results.push(await sendDisbursementEmail(row.id));
  return results;
}

export function channelLabel(platform) {
  const normalized = normalizePlatform(platform);
  if (normalized === 'booking.com') return 'Booking.com';
  return normalized.toUpperCase();
}
