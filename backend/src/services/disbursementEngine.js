import PDFDocument from 'pdfkit';
import postmark from 'postmark';
import { query, withTransaction } from '../db.js';
import { startEndForMonth } from '../utils/dates.js';
import { normalizePlatform, roundCurrency } from './payoutEngine.js';

// Management fee rates (Australian STR)
const DEFAULT_MGMT_RATE = 0.18; // 18%
const GST_RATE = 0.10;           // 10% GST on management fee
const DEFAULT_SOFTWARE_FEE = 65.99; // per property per month

/**
 * Calculate owner disbursement for a given month.
 *
 * Calculation order:
 * 1. Gross booking (what guest paid)
 * 2. - Channel commission (Airbnb 16.5%, Booking.com 16.5%, VRBO 12%)
 * 3. = Channel payout (what enters trust)
 * 4. - Cleaning fee
 * 5. = Net income (shown on owner report)
 * 6. - Management fee (18% of net income)
 * 7. - GST on management fee (10% of management fee)
 * 8. = Owner gross after management
 * 9. - Software fee ($65.99/month per property)
 * 10. - One-off expenses
 * 11. = Final owner payout
 */
export async function calculateOwnerDisbursement(ownerId, month) {
  const { start, end } = startEndForMonth(month);
  return withTransaction(async (client) => {
    const owner = (await client.query(`SELECT * FROM owners WHERE id=$1`, [ownerId])).rows[0];
    if (!owner) throw new Error('Owner not found');

    // Get reservations where BOTH conditions are met:
    // 1. Booking has elapsed (checkout <= end of month)
    // 2. Payout received in trust account during that month
    const reservations = (await client.query(
      `SELECT r.*, l.name listing_name, l.address, l.monthly_software_fee,
              l.platform_fee_rates, l.id as lid,
              cr.type commission_type, cr.rate commission_rate, cr.flat_amount, cr.tiers
       FROM reservations r
       JOIN listings l ON l.id = r.listing_id
       LEFT JOIN commission_rules cr ON cr.owner_id = l.owner_id
         AND (cr.listing_id = l.id OR cr.listing_id IS NULL)
         AND (cr.platform = r.platform OR cr.platform = 'all')
       LEFT JOIN transaction_reservation_matches m ON m.reservation_id = r.id
       LEFT JOIN trust_transactions t ON t.id = m.trust_transaction_id
       WHERE l.owner_id = $1
         AND r.check_out <= $3
         AND t.transaction_date BETWEEN $2 AND $3`,
      [ownerId, start, end]
    )).rows;

    // Get expenses for the month
    const expenses = (await client.query(
      `SELECT e.* FROM owner_expenses e JOIN listings l ON l.id=e.listing_id WHERE l.owner_id=$1 AND e.expense_date BETWEEN $2 AND $3`,
      [ownerId, start, end]
    )).rows;

    const utilities = (await client.query(
      `SELECT u.* FROM utility_records u JOIN listings l ON l.id=u.listing_id WHERE l.owner_id=$1 AND u.utility_date BETWEEN $2 AND $3`,
      [ownerId, start, end]
    )).rows;

    // Calculate per-reservation
    let totalGross = 0;
    let totalChannelCommission = 0;
    let totalChannelPayout = 0;
    let totalCleaning = 0;
    let totalNetIncome = 0;
    let totalMgmtFeeBase = 0;
    let totalMgmtFeeGst = 0;
    let totalMgmtFeeTotal = 0;
    const listingsWithBookings = new Set();

    const reservationDetails = reservations.map(r => {
      const gross = Number(r.gross_amount);
      const platformFee = Number(r.platform_fee);
      const channelPayout = roundCurrency(gross - platformFee);
      const cleaningFee = Number(r.cleaning_fee || 0);
      const netIncome = roundCurrency(channelPayout - cleaningFee);

      // Management fee calculation
      const { base: mgmtBase, gst: mgmtGst, total: mgmtTotal } = commissionForReservation(r, netIncome);

      totalGross += gross;
      totalChannelCommission += platformFee;
      totalChannelPayout += channelPayout;
      totalCleaning += cleaningFee;
      totalNetIncome += netIncome;
      totalMgmtFeeBase += mgmtBase;
      totalMgmtFeeGst += mgmtGst;
      totalMgmtFeeTotal += mgmtTotal;
      listingsWithBookings.add(r.lid);

      return {
        ...r,
        calc_channel_payout: channelPayout,
        calc_cleaning: cleaningFee,
        calc_net_income: netIncome,
        calc_mgmt_base: mgmtBase,
        calc_mgmt_gst: mgmtGst,
        calc_mgmt_total: mgmtTotal
      };
    });

    // Round all totals
    totalGross = roundCurrency(totalGross);
    totalChannelCommission = roundCurrency(totalChannelCommission);
    totalChannelPayout = roundCurrency(totalChannelPayout);
    totalCleaning = roundCurrency(totalCleaning);
    totalNetIncome = roundCurrency(totalNetIncome);
    totalMgmtFeeBase = roundCurrency(totalMgmtFeeBase);
    totalMgmtFeeGst = roundCurrency(totalMgmtFeeGst);
    totalMgmtFeeTotal = roundCurrency(totalMgmtFeeTotal);

    // Software fees: $65.99 per listing with bookings this month
    const softwareFeePerListing = DEFAULT_SOFTWARE_FEE;
    const softwareFeeTotal = roundCurrency(listingsWithBookings.size * softwareFeePerListing);

    // One-off expenses
    const expenseTotal = roundCurrency(expenses.reduce((sum, e) => sum + Number(e.amount), 0));
    const utilityTotal = roundCurrency(utilities.reduce((sum, u) => sum + Number(u.amount), 0));

    // Final payout
    const ownerGrossAfterMgmt = roundCurrency(totalNetIncome - totalMgmtFeeTotal);
    const finalPayout = roundCurrency(ownerGrossAfterMgmt - softwareFeeTotal - expenseTotal - utilityTotal);

    // Upsert disbursement record
    const disbursement = (await client.query(
      `INSERT INTO disbursements
       (owner_id, month, gross_channel_payout, platform_fees, net_channel_revenue,
        net_income, management_fee_base, management_fee_gst, management_commission,
        cleaning_costs, software_fees, owner_expenses, utilities, final_owner_payout)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (owner_id, month) DO UPDATE SET
       gross_channel_payout=EXCLUDED.gross_channel_payout, platform_fees=EXCLUDED.platform_fees,
       net_channel_revenue=EXCLUDED.net_channel_revenue, net_income=EXCLUDED.net_income,
       management_fee_base=EXCLUDED.management_fee_base, management_fee_gst=EXCLUDED.management_fee_gst,
       management_commission=EXCLUDED.management_commission, cleaning_costs=EXCLUDED.cleaning_costs,
       software_fees=EXCLUDED.software_fees, owner_expenses=EXCLUDED.owner_expenses,
       utilities=EXCLUDED.utilities, final_owner_payout=EXCLUDED.final_owner_payout, generated_at=now()
       RETURNING *`,
      [ownerId, month, totalGross, totalChannelCommission, totalChannelPayout,
       totalNetIncome, totalMgmtFeeBase, totalMgmtFeeGst, totalMgmtFeeTotal,
       totalCleaning, softwareFeeTotal, expenseTotal, utilityTotal, finalPayout]
    )).rows[0];

    // Rebuild audit trail
    await client.query(`DELETE FROM disbursement_line_items WHERE disbursement_id=$1`, [disbursement.id]);

    // Line items per reservation
    for (const r of reservationDetails) {
      await insertLine(client, disbursement.id, 'gross_booking',
        `${r.platform} - ${r.guest_name || 'Guest'} @ ${r.listing_name} (${r.check_in} to ${r.check_out})`,
        Number(r.gross_amount), 'reservations', r.id, { reservation_id: r.id });
      await insertLine(client, disbursement.id, 'channel_commission',
        `${r.platform} channel fee (${(Number(r.platform_fee) / Number(r.gross_amount) * 100).toFixed(1)}%)`,
        -Number(r.platform_fee), 'reservations', r.id, {});
      if (r.calc_cleaning > 0) {
        await insertLine(client, disbursement.id, 'cleaning',
          `Cleaning - ${r.listing_name}`,
          -r.calc_cleaning, 'reservations', r.id, {});
      }
      await insertLine(client, disbursement.id, 'management_fee',
        `Management fee 18% on $${r.calc_net_income.toFixed(2)} net income`,
        -r.calc_mgmt_base, 'commission_rules', null, { net_income: r.calc_net_income });
      await insertLine(client, disbursement.id, 'management_fee_gst',
        `GST on management fee (10%)`,
        -r.calc_mgmt_gst, 'commission_rules', null, {});
    }

    // Software fees per listing
    for (const listingId of listingsWithBookings) {
      const listing = reservationDetails.find(r => r.lid === listingId);
      await insertLine(client, disbursement.id, 'software_fee',
        `Software fee - ${listing?.listing_name || 'Property'} (KeyNest + PriceLabs + Enzo)`,
        -softwareFeePerListing, 'listings', listingId, {});
    }

    // Expenses
    for (const e of expenses) {
      await insertLine(client, disbursement.id, 'expense', e.description, -Number(e.amount), 'owner_expenses', e.id, e);
    }
    for (const u of utilities) {
      await insertLine(client, disbursement.id, 'utility', `${u.utility_type} ${u.billing_period || ''}`.trim(), -Number(u.amount), 'utility_records', u.id, u);
    }

    return { ...disbursement, owner, reservations: reservationDetails, expenses, utilities };
  });
}

function commissionForReservation(reservation, netIncome) {
  const type = reservation.commission_type || 'au_management';
  const rate = Number(reservation.commission_rate || DEFAULT_MGMT_RATE);

  if (type === 'au_management' || type === 'percentage_net') {
    const base = roundCurrency(netIncome * rate);
    const gst = roundCurrency(base * GST_RATE);
    return { base, gst, total: roundCurrency(base + gst) };
  }
  if (type === 'percentage_gross') {
    const gross = Number(reservation.gross_amount || 0);
    const base = roundCurrency(gross * rate);
    const gst = roundCurrency(base * GST_RATE);
    return { base, gst, total: roundCurrency(base + gst) };
  }
  if (type === 'flat_fee') {
    const base = Number(reservation.flat_amount || 0);
    return { base, gst: 0, total: base };
  }
  if (type === 'tiered') {
    const parsed = typeof reservation.tiers === 'string' ? JSON.parse(reservation.tiers || '[]') : (reservation.tiers || []);
    const tier = [...parsed].sort((a, b) => Number(b.min || 0) - Number(a.min || 0)).find((item) => netIncome >= Number(item.min || 0));
    const base = roundCurrency(netIncome * Number(tier?.rate || 0));
    const gst = roundCurrency(base * GST_RATE);
    return { base, gst, total: roundCurrency(base + gst) };
  }
  return { base: 0, gst: 0, total: 0 };
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

  // Group line items by reservation for cleaner display
  const grossLines = lines.filter(l => l.type === 'gross_booking');
  const channelLines = lines.filter(l => l.type === 'channel_commission');
  const cleaningLines = lines.filter(l => l.type === 'cleaning');
  const mgmtLines = lines.filter(l => l.type === 'management_fee');
  const gstLines = lines.filter(l => l.type === 'management_fee_gst');
  const softwareLines = lines.filter(l => l.type === 'software_fee');
  const expenseLines = lines.filter(l => l.type === 'expense');
  const utilityLines = lines.filter(l => l.type === 'utility');

  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Header
  doc.fontSize(20).fillColor('#14213d').text('LiveLuxe', { continued: true });
  doc.fontSize(10).fillColor('#c59b36').text('  Property Management');
  doc.moveDown(0.5);
  doc.fontSize(16).fillColor('#14213d').text('Owner Disbursement Statement');
  doc.moveDown(0.3);

  doc.fontSize(10).fillColor('#333');
  doc.text(`Owner: ${disbursement.owner_name}`);
  doc.text(`Period: ${disbursement.month}`);
  doc.text(`Statement Date: ${new Date().toLocaleDateString('en-AU')}`);
  doc.moveDown();

  // Booking Income Section
  doc.fontSize(12).fillColor('#14213d').text('BOOKING INCOME');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#c59b36').stroke();
  doc.moveDown(0.3);

  doc.fontSize(9).fillColor('#666');
  for (const line of grossLines) {
    doc.fillColor('#333').text(line.description, { continued: true });
    doc.fillColor('#14213d').text(`  ${formatMoney(line.amount)}`, { align: 'right' });
  }
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#14213d').text(`Total Gross Bookings: ${formatMoney(disbursement.gross_channel_payout)}`);
  doc.moveDown(0.5);

  // Channel Fees
  doc.fontSize(12).fillColor('#14213d').text('CHANNEL FEES');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#c59b36').stroke();
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#333');
  for (const line of channelLines) {
    doc.text(`${line.description}: ${formatMoney(line.amount)}`);
  }
  doc.fontSize(10).fillColor('#14213d');
  doc.text(`Channel Payout (received in trust): ${formatMoney(disbursement.net_channel_revenue)}`);
  doc.moveDown(0.5);

  // Cleaning
  if (cleaningLines.length > 0) {
    doc.fontSize(12).fillColor('#14213d').text('CLEANING FEES');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#c59b36').stroke();
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#333');
    for (const line of cleaningLines) {
      doc.text(`${line.description}: ${formatMoney(line.amount)}`);
    }
    doc.moveDown(0.3);
  }

  // Net Income
  doc.fontSize(11).fillColor('#14213d');
  doc.text(`NET INCOME: ${formatMoney(disbursement.net_income)}`);
  doc.moveDown(0.5);

  // Management Fee
  doc.fontSize(12).fillColor('#14213d').text('MANAGEMENT FEE');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#c59b36').stroke();
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#333');
  doc.text(`Management Fee (18%): ${formatMoney(-Number(disbursement.management_fee_base))}`);
  doc.text(`GST on Management Fee (10%): ${formatMoney(-Number(disbursement.management_fee_gst))}`);
  doc.fontSize(10).text(`Total Management Fee: ${formatMoney(-Number(disbursement.management_commission))}`);
  doc.moveDown(0.5);

  // Software Fees
  if (softwareLines.length > 0) {
    doc.fontSize(12).fillColor('#14213d').text('MONTHLY CHARGES');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#c59b36').stroke();
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#333');
    for (const line of softwareLines) {
      doc.text(`${line.description}: ${formatMoney(line.amount)}`);
    }
    doc.moveDown(0.5);
  }

  // Expenses
  if (expenseLines.length > 0 || utilityLines.length > 0) {
    doc.fontSize(12).fillColor('#14213d').text('EXPENSES');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#c59b36').stroke();
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#333');
    for (const line of [...expenseLines, ...utilityLines]) {
      doc.text(`${line.description}: ${formatMoney(line.amount)}`);
    }
    doc.moveDown(0.5);
  }

  // Final Payout
  doc.moveDown(0.5);
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#14213d').lineWidth(2).stroke();
  doc.moveDown(0.5);
  doc.fontSize(16).fillColor('#14213d');
  doc.text(`FINAL OWNER PAYOUT: ${formatMoney(disbursement.final_owner_payout)} AUD`, { align: 'center' });
  doc.moveDown(1);

  // Footer
  doc.fontSize(8).fillColor('#999');
  doc.text('This statement is generated by LiveLuxe Property Management. All line items are linked to source records in the platform audit trail.', { align: 'center' });

  doc.end();
  return done;
}

function formatMoney(value) {
  const num = Number(value);
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${num < 0 ? '-' : ''}$${formatted}`;
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
  try {
    const pdf = await generateDisbursementPdf(id);
    const client = new postmark.ServerClient(process.env.POSTMARK_API_KEY);
    const response = await client.sendEmail({
      From: process.env.POSTMARK_FROM_EMAIL,
      To: disbursement.email,
      Subject: `LiveLuxe Disbursement Statement - ${disbursement.month}`,
      TextBody: `Hi ${disbursement.owner_name},\n\nPlease find attached your disbursement statement for ${disbursement.month}.\n\nFinal Payout: $${Number(disbursement.final_owner_payout).toFixed(2)} AUD\n\nIf you have any questions, please contact us at contact@liveluxeau.com.\n\nBest regards,\nLiveLuxe Property Management`,
      Attachments: [{ Name: `LiveLuxe-Disbursement-${disbursement.month}.pdf`, Content: pdf.toString('base64'), ContentType: 'application/pdf' }]
    });
    const result = await query(
      `INSERT INTO email_log (owner_id, disbursement_id, recipient, statement_month, status, provider_message_id)
       VALUES ($1,$2,$3,$4,'sent',$5) RETURNING *`,
      [disbursement.owner_id, id, disbursement.email, disbursement.month, response.MessageID]
    );
    return result.rows[0];
  } catch (error) {
    const result = await query(
      `INSERT INTO email_log (owner_id, disbursement_id, recipient, statement_month, status, error)
       VALUES ($1,$2,$3,$4,'error',$5) RETURNING *`,
      [disbursement.owner_id, id, disbursement.email || 'missing-recipient', disbursement.month, error.message]
    );
    return result.rows[0];
  }
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
  if (normalized === 'direct') return 'Direct';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
