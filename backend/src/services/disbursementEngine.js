import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, withTransaction } from '../db.js';
import { startEndForMonth } from '../utils/dates.js';
import { normalizePlatform, roundCurrency, calculateExpectedPayoutDate } from './payoutEngine.js';
import { generateReportHtml, generateEmailBodyHtml } from './reportGenerator.js';
import { renderHtmlToPdf } from './pdfRenderer.js';
import { createGmailDraft, sendGmailDraft, deleteGmailDraft } from './gmailService.js';

// Management fee rates (Australian STR) — all rates are incGST
const DEFAULT_MGMT_RATE = 0.198; // 19.8% incGST (= 18% + 10% GST)
const TECH_FEE_PER_LISTING = 64.99; // $64.99/month per listing tech fee

/**
 * Calculate owner disbursement for a given month.
 *
 * Calculation order (matches real disbursement reports):
 * 1. Gross booking (what guest paid)
 * 2. - Channel commission (Airbnb 16.5%, Booking.com 16.5%, VRBO 12%, Direct 0%)
 * 3. = Net payout (channel payout)
 * 4. - Management fee (incGST rate applied to net payout)
 * 5. + Management fee discount (waiver % + boost)
 * 6. - Cleaning fee (per-booking, separate line item)
 * 7. - One-off expenses
 * 8. = Final owner payout
 */
export async function calculateOwnerDisbursement(ownerId, month) {
  const { start, end } = startEndForMonth(month);
  return withTransaction(async (client) => {
    const owner = (await client.query(`SELECT * FROM owners WHERE id=$1`, [ownerId])).rows[0];
    if (!owner) throw new Error('Owner not found');

    // Booking selection — include if:
    //  A) Payout (disbursement_month) is in this month — full amount
    //  B) Checkout is in this month but payout is later (e.g. Booking.com) — full amount
    // This excludes straddlers whose payout was in a prior month.
    const reservationCols = `r.*, l.name listing_name, l.address,
              l.platform_fee_rates, l.id as lid,
              l.management_fee_pct as listing_mgmt_fee_pct,
              l.cleaning_fee_baseline,
              COALESCE(l.mgmt_fee_waiver_pct, 0) as listing_waiver_pct,
              COALESCE(l.mgmt_fee_boost, 0) as listing_boost,
              cr.type commission_type, cr.rate commission_rate, cr.flat_amount, cr.tiers`;
    const reservationJoins = `FROM reservations r
       JOIN listings l ON l.id = r.listing_id
       LEFT JOIN commission_rules cr ON cr.owner_id = l.owner_id
         AND (cr.listing_id = l.id OR cr.listing_id IS NULL)
         AND (cr.platform = r.platform OR cr.platform = 'all')`;

    const reservations = (await client.query(
      `SELECT ${reservationCols} ${reservationJoins}
       WHERE l.owner_id = $1
         AND (
           r.disbursement_month = $2
           OR (r.check_out >= $3 AND r.check_out <= $4 AND r.disbursement_month > $2)
         )
       ORDER BY r.check_in`,
      [ownerId, month, start, end]
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

    // Calculate per-reservation using full booking amounts.
    // All included bookings use full amounts (no pro-rating) — the query already
    // filters to the correct set of bookings for this month.
    let totalGross = 0;
    let totalChannelCommission = 0;
    let totalChannelPayout = 0;
    let totalCleaning = 0;
    let totalNetIncome = 0;
    let totalMgmtFeeFull = 0;
    let totalMgmtDiscount = 0;
    let totalMgmtEffective = 0;
    const listingsWithBookings = new Set();

    const reservationDetails = reservations.map(r => {
      const gross = roundCurrency(Number(r.gross_amount));
      const cleaningFee = roundCurrency(resolveCleaningFee(r));
      const platformFee = roundCurrency(Number(r.platform_fee));
      const channelPayout = roundCurrency(gross - platformFee);

      // Management fee calculated on channel payout (incGST rate, BEFORE cleaning)
      const mgmtFee = commissionForReservation(r, channelPayout);

      // Net to owner = channel payout - management - cleaning
      const netToOwner = roundCurrency(channelPayout - mgmtFee - cleaningFee);

      const expectedPayoutDate = calculateExpectedPayoutDate(r);
      const totalNights = Math.max(0, Math.round(
        (new Date(r.check_out) - new Date(r.check_in)) / 86400000
      ));

      totalGross += gross;
      totalChannelCommission += platformFee;
      totalChannelPayout += channelPayout;
      totalCleaning += cleaningFee;
      totalNetIncome += channelPayout;
      totalMgmtFeeFull += mgmtFee;
      listingsWithBookings.add(r.lid);

      return {
        ...r,
        calc_period_nights: totalNights,
        calc_total_nights: totalNights,
        calc_prorate_share: 1.0,
        calc_channel_payout: channelPayout,
        calc_cleaning: cleaningFee,
        calc_net_income: channelPayout,
        calc_mgmt_fee: mgmtFee,
        calc_net_to_owner: netToOwner,
        calc_is_paid: true,
        calc_expected_payout_date: expectedPayoutDate,
        calc_period_gross: gross,
        calc_platform_fee: platformFee,
        calc_waiver_pct: Number(r.listing_waiver_pct || 0),
        calc_boost: Number(r.listing_boost || 0)
      };
    });

    // Round all totals
    totalGross = roundCurrency(totalGross);
    totalChannelCommission = roundCurrency(totalChannelCommission);
    totalChannelPayout = roundCurrency(totalChannelPayout);
    totalCleaning = roundCurrency(totalCleaning);
    totalNetIncome = roundCurrency(totalNetIncome);
    totalMgmtFeeFull = roundCurrency(totalMgmtFeeFull);

    // Calculate management fee discounts (waiver + boost) per listing
    for (const listingId of listingsWithBookings) {
      const sample = reservationDetails.find(r => r.lid === listingId && r.calc_is_paid);
      if (!sample) continue;
      const waiverPct = Number(sample.listing_waiver_pct || 0);
      const boost = Number(sample.listing_boost || 0);
      // Sum mgmt fees for this listing
      const listingMgmt = roundCurrency(
        reservationDetails.filter(r => r.lid === listingId && r.calc_is_paid)
          .reduce((sum, r) => sum + r.calc_mgmt_fee, 0)
      );
      const waiverAmt = roundCurrency(listingMgmt * waiverPct);
      totalMgmtDiscount += waiverAmt + boost;
    }
    totalMgmtDiscount = roundCurrency(totalMgmtDiscount);
    totalMgmtEffective = roundCurrency(totalMgmtFeeFull - totalMgmtDiscount);

    // One-off expenses
    const expenseTotal = roundCurrency(expenses.reduce((sum, e) => sum + Number(e.amount), 0));
    const utilityTotal = roundCurrency(utilities.reduce((sum, u) => sum + Number(u.amount), 0));

    // Tech fee: $69 per listing with paid bookings this month
    const techFeeTotal = roundCurrency(listingsWithBookings.size * TECH_FEE_PER_LISTING);

    // Final payout: channel payout - effective management - cleaning - tech fees - expenses
    const afterMgmt = roundCurrency(totalChannelPayout - totalMgmtEffective);
    const afterCleaning = roundCurrency(afterMgmt - totalCleaning);
    const afterTechFee = roundCurrency(afterCleaning - techFeeTotal);
    const finalPayout = roundCurrency(afterTechFee - expenseTotal - utilityTotal);

    // Upsert disbursement record
    const disbursement = (await client.query(
      `INSERT INTO disbursements
       (owner_id, month, gross_channel_payout, platform_fees, net_channel_revenue,
        net_income, management_fee_base, management_fee_gst, management_commission,
        mgmt_fee_discount, cleaning_costs, software_fees, owner_expenses, utilities, final_owner_payout)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (owner_id, month) DO UPDATE SET
       gross_channel_payout=EXCLUDED.gross_channel_payout, platform_fees=EXCLUDED.platform_fees,
       net_channel_revenue=EXCLUDED.net_channel_revenue, net_income=EXCLUDED.net_income,
       management_fee_base=EXCLUDED.management_fee_base, management_fee_gst=EXCLUDED.management_fee_gst,
       management_commission=EXCLUDED.management_commission, mgmt_fee_discount=EXCLUDED.mgmt_fee_discount,
       cleaning_costs=EXCLUDED.cleaning_costs, software_fees=EXCLUDED.software_fees,
       owner_expenses=EXCLUDED.owner_expenses, utilities=EXCLUDED.utilities,
       final_owner_payout=EXCLUDED.final_owner_payout, generated_at=now()
       RETURNING *`,
      [ownerId, month, totalGross, totalChannelCommission, totalChannelPayout,
       totalNetIncome, totalMgmtFeeFull, 0, totalMgmtEffective,
       totalMgmtDiscount, totalCleaning, techFeeTotal, expenseTotal, utilityTotal, finalPayout]
    )).rows[0];

    // Rebuild audit trail
    await client.query(`DELETE FROM disbursement_line_items WHERE disbursement_id=$1`, [disbursement.id]);

    // Line items per reservation (including unpaid, flagged)
    for (const r of reservationDetails) {
      const unpaidTag = '';
      const proRateNote = '';

      await insertLine(client, disbursement.id, 'gross_booking',
        `${r.platform} - ${r.guest_name || 'Guest'} @ ${r.listing_name} (${r.check_in} to ${r.check_out})${proRateNote}${unpaidTag}`,
        r.calc_period_gross, 'reservations', r.id,
        { reservation_id: r.id, period_nights: r.calc_period_nights, total_nights: r.calc_total_nights, prorate_share: r.calc_prorate_share },
        r.calc_period_nights, r.calc_total_nights, r.calc_prorate_share);
      await insertLine(client, disbursement.id, 'channel_commission',
        `${r.platform} channel fee (${(Number(r.platform_fee) / Number(r.gross_amount) * 100).toFixed(1)}%)${proRateNote}${unpaidTag}`,
        -r.calc_platform_fee, 'reservations', r.id, {},
        r.calc_period_nights, r.calc_total_nights, r.calc_prorate_share);
      await insertLine(client, disbursement.id, 'management_fee',
        `Management fee (incGST) on $${r.calc_channel_payout.toFixed(2)} net payout${proRateNote}${unpaidTag}`,
        -r.calc_mgmt_fee, 'commission_rules', null,
        { channel_payout: r.calc_channel_payout },
        r.calc_period_nights, r.calc_total_nights, r.calc_prorate_share);
      if (r.calc_cleaning > 0) {
        await insertLine(client, disbursement.id, 'cleaning',
          `Cleaning - ${r.listing_name}${proRateNote}${unpaidTag}`,
          -r.calc_cleaning, 'reservations', r.id, {},
          r.calc_period_nights, r.calc_total_nights, r.calc_prorate_share);
      }
    }

    // Management fee discounts per listing (waiver + boost)
    for (const listingId of listingsWithBookings) {
      const sample = reservationDetails.find(r => r.lid === listingId && r.calc_is_paid);
      if (!sample) continue;
      const waiverPct = Number(sample.listing_waiver_pct || 0);
      const boost = Number(sample.listing_boost || 0);
      if (waiverPct > 0 || boost > 0) {
        const listingMgmt = roundCurrency(
          reservationDetails.filter(r => r.lid === listingId && r.calc_is_paid)
            .reduce((sum, r) => sum + r.calc_mgmt_fee, 0)
        );
        if (waiverPct > 0) {
          const waiverAmt = roundCurrency(listingMgmt * waiverPct);
          await insertLine(client, disbursement.id, 'mgmt_discount',
            `Mgmt fee waiver (${(waiverPct * 100).toFixed(0)}%) - ${sample.listing_name}`,
            waiverAmt, 'listings', listingId, { waiver_pct: waiverPct });
        }
        if (boost > 0) {
          await insertLine(client, disbursement.id, 'mgmt_discount',
            `Mgmt fee boost credit - ${sample.listing_name}`,
            boost, 'listings', listingId, { boost });
        }
      }
    }

    // Tech fee per listing
    for (const listingId of listingsWithBookings) {
      const sample = reservationDetails.find(r => r.lid === listingId && r.calc_is_paid);
      if (sample) {
        await insertLine(client, disbursement.id, 'tech_fee',
          `Tech fee - ${sample.listing_name}`,
          -TECH_FEE_PER_LISTING, 'listings', listingId, { per_listing: TECH_FEE_PER_LISTING });
      }
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

/**
 * Resolve cleaning fee: reservation value first, then listing default (spec §6).
 */
function resolveCleaningFee(reservation) {
  const resCleaning = Number(reservation.cleaning_fee || 0);
  if (resCleaning > 0) return resCleaning;
  return Number(reservation.cleaning_fee_baseline || 0);
}

/**
 * Calculate management fee for a reservation.
 * All rates are incGST — returns a single total amount (no base/gst split).
 * Per-listing management_fee_pct takes precedence over commission_rules.
 */
function commissionForReservation(reservation, netIncome) {
  // Per-listing management_fee_pct (incGST) takes precedence
  if (reservation.listing_mgmt_fee_pct != null && reservation.listing_mgmt_fee_pct !== '') {
    return roundCurrency(netIncome * Number(reservation.listing_mgmt_fee_pct));
  }

  const type = reservation.commission_type || 'au_management';
  const rate = Number(reservation.commission_rate || DEFAULT_MGMT_RATE);

  // au_management: rate is already incGST after migration 004
  // percentage_net: rate applied directly to net income
  if (type === 'au_management' || type === 'percentage_net') {
    return roundCurrency(netIncome * rate);
  }
  if (type === 'percentage_gross') {
    return roundCurrency(Number(reservation.gross_amount || 0) * rate);
  }
  if (type === 'flat_fee') {
    return Number(reservation.flat_amount || 0);
  }
  if (type === 'tiered') {
    const parsed = typeof reservation.tiers === 'string' ? JSON.parse(reservation.tiers || '[]') : (reservation.tiers || []);
    const tier = [...parsed].sort((a, b) => Number(b.min || 0) - Number(a.min || 0)).find((item) => netIncome >= Number(item.min || 0));
    return roundCurrency(netIncome * Number(tier?.rate || 0));
  }
  return 0;
}

async function insertLine(client, disbursementId, type, description, amount, sourceTable, sourceId, metadata, periodNights, totalNights, prorateShare) {
  await client.query(
    `INSERT INTO disbursement_line_items (disbursement_id, type, description, amount, source_table, source_id, metadata, period_nights, total_nights, prorate_share)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [disbursementId, type, description, roundCurrency(amount), sourceTable, sourceId, metadata,
     periodNights ?? null, totalNights ?? null, prorateShare ?? null]
  );
}

export async function getDisbursementDetail(id) {
  const disbursement = (await query(`SELECT d.*, o.name owner_name, o.email FROM disbursements d JOIN owners o ON o.id=d.owner_id WHERE d.id=$1`, [id])).rows[0];
  if (!disbursement) throw new Error('Disbursement not found');
  const lines = (await query(`SELECT * FROM disbursement_line_items WHERE disbursement_id=$1 ORDER BY created_at`, [id])).rows;
  return { disbursement, lines };
}

export async function generateDisbursementPdf(id) {
  // Try new HTML-to-PDF pipeline first
  try {
    const html = await generateReportHtml(id);
    const pdf = await renderHtmlToPdf(html);
    if (pdf) return pdf;
  } catch (err) {
    console.warn('HTML-to-PDF failed, falling back to pdfkit:', err.message);
  }

  // Fallback: original pdfkit generation
  return generateDisbursementPdfLegacy(id);
}

async function generateDisbursementPdfLegacy(id) {
  const { disbursement, lines } = await getDisbursementDetail(id);

  const grossLines = lines.filter(l => l.type === 'gross_booking');
  const channelLines = lines.filter(l => l.type === 'channel_commission');
  const cleaningLines = lines.filter(l => l.type === 'cleaning');
  const discountLines = lines.filter(l => l.type === 'mgmt_discount');
  const techFeeLines = lines.filter(l => l.type === 'tech_fee');
  const expenseLines = lines.filter(l => l.type === 'expense');
  const utilityLines = lines.filter(l => l.type === 'utility');

  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

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

  doc.fontSize(12).fillColor('#14213d').text('MANAGEMENT FEE');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#c59b36').stroke();
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#333');
  doc.text(`Management Fee (incGST): ${formatMoney(-Number(disbursement.management_fee_base))}`);
  if (Number(disbursement.mgmt_fee_discount) > 0) {
    for (const line of discountLines) {
      doc.fillColor('#16a34a').text(`${line.description}: +${formatMoney(line.amount)}`);
    }
    doc.fillColor('#333');
  }
  doc.fontSize(10).text(`Effective Management Fee: ${formatMoney(-Number(disbursement.management_commission))}`);
  doc.moveDown(0.5);

  if (cleaningLines.length > 0) {
    doc.fontSize(12).fillColor('#14213d').text('CLEANING FEES');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#c59b36').stroke();
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#333');
    for (const line of cleaningLines) { doc.text(`${line.description}: ${formatMoney(line.amount)}`); }
    doc.moveDown(0.3);
  }

  if (techFeeLines.length > 0) {
    doc.fontSize(12).fillColor('#14213d').text('TECH FEE');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#c59b36').stroke();
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#333');
    for (const line of techFeeLines) { doc.text(`${line.description}: ${formatMoney(line.amount)}`); }
    doc.moveDown(0.3);
  }

  if (expenseLines.length > 0 || utilityLines.length > 0) {
    doc.fontSize(12).fillColor('#14213d').text('EXPENSES');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#c59b36').stroke();
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#333');
    for (const line of [...expenseLines, ...utilityLines]) { doc.text(`${line.description}: ${formatMoney(line.amount)}`); }
    doc.moveDown(0.5);
  }

  doc.moveDown(0.5);
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#14213d').lineWidth(2).stroke();
  doc.moveDown(0.5);
  doc.fontSize(16).fillColor('#14213d');
  doc.text(`FINAL OWNER PAYOUT: ${formatMoney(disbursement.final_owner_payout)} AUD`, { align: 'center' });
  doc.moveDown(1);
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

/**
 * Create a draft email for a disbursement — creates a Gmail draft with PDF attachments
 * and records it in email_log for tracking.
 */
export async function createDraftEmail(id) {
  const { disbursement } = await getDisbursementDetail(id);
  const emailHtml = await generateEmailBodyHtml(id);

  // Determine property address for subject line
  const listings = (await query(
    `SELECT l.address, l.name FROM listings l WHERE l.owner_id = $1 ORDER BY l.name LIMIT 1`,
    [disbursement.owner_id]
  )).rows;
  const propertyRef = listings[0]?.address || listings[0]?.name || '';
  const subjectSuffix = propertyRef ? ` - ${propertyRef}` : '';

  const subject = `LiveLuxe ${monthLabelForEmail(disbursement.month)} Statement${subjectSuffix}`;
  const textBody = `Hi ${disbursement.owner_name},\n\nPlease find attached your disbursement statement for ${disbursement.month}.\n\nFinal Payout: $${Number(disbursement.final_owner_payout).toFixed(2)} AUD\n\nIf you have any questions, please contact us at contact@liveluxeau.com.\n\nBest regards,\nLiveLuxe Property Management`;

  const attachmentNames = [
    `LiveLuxe-Disbursement-${disbursement.month}.pdf`,
    'LiveLuxe-Owner-Disbursement-Guide.pdf'
  ];

  const recipient = disbursement.email || 'missing-recipient';

  // Generate statement PDF + guide PDF for Gmail attachment
  const statementPdf = await generateDisbursementPdf(id);
  const guideAttachments = getGuideAttachment();

  const gmailAttachments = [
    { filename: attachmentNames[0], content: statementPdf.toString('base64'), contentType: 'application/pdf' },
  ];
  if (guideAttachments.length > 0) {
    gmailAttachments.push({
      filename: 'LiveLuxe-Owner-Disbursement-Guide.pdf',
      content: guideAttachments[0].Content,
      contentType: 'application/pdf',
    });
  }

  // Delete existing Gmail draft if we have one for this disbursement
  const existing = await query(
    `SELECT id, provider_message_id FROM email_log WHERE disbursement_id = $1 AND status = 'draft' LIMIT 1`,
    [id]
  );
  if (existing.rows.length > 0 && existing.rows[0].provider_message_id) {
    try { await deleteGmailDraft(existing.rows[0].provider_message_id); } catch (_) {}
  }

  // Create Gmail draft
  const gmailDraft = await createGmailDraft({
    to: recipient,
    subject,
    htmlBody: emailHtml,
    textBody,
    attachments: gmailAttachments,
  });

  // Upsert email_log record
  let result;
  if (existing.rows.length > 0) {
    result = await query(
      `UPDATE email_log SET subject = $1, html_body = $2, text_body = $3, attachment_names = $4,
       recipient = $5, provider_message_id = $6, sent_at = now()
       WHERE id = $7 RETURNING *`,
      [subject, emailHtml, textBody, JSON.stringify(attachmentNames),
       recipient, gmailDraft.id, existing.rows[0].id]
    );
  } else {
    result = await query(
      `INSERT INTO email_log (owner_id, disbursement_id, recipient, statement_month, status, subject, html_body, text_body, attachment_names, provider_message_id)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9) RETURNING *`,
      [disbursement.owner_id, id, recipient, disbursement.month,
       subject, emailHtml, textBody, JSON.stringify(attachmentNames), gmailDraft.id]
    );
  }
  return result.rows[0];
}

/**
 * Create drafts for all disbursements in a month.
 */
export async function bulkCreateDrafts(month) {
  const rows = (await query(`SELECT id FROM disbursements WHERE month=$1`, [month])).rows;
  const results = [];
  for (const row of rows) results.push(await createDraftEmail(row.id));
  return results;
}

/**
 * Send a specific draft email by email_log ID.
 * Sends the Gmail draft that was created during createDraftEmail.
 */
export async function sendDraftEmail(emailLogId) {
  const draft = (await query(`SELECT * FROM email_log WHERE id = $1`, [emailLogId])).rows[0];
  if (!draft) throw new Error('Draft not found');
  if (draft.status === 'sent') throw new Error('Email already sent');

  if (!draft.provider_message_id) {
    await query(
      `UPDATE email_log SET status = 'error', error = 'No Gmail draft ID — recreate the draft first' WHERE id = $1`,
      [emailLogId]
    );
    return (await query(`SELECT * FROM email_log WHERE id = $1`, [emailLogId])).rows[0];
  }

  try {
    const result = await sendGmailDraft(draft.provider_message_id);

    await query(
      `UPDATE email_log SET status = 'sent', provider_message_id = $1, sent_at = now(), error = NULL WHERE id = $2`,
      [result.messageId, emailLogId]
    );
    return (await query(`SELECT * FROM email_log WHERE id = $1`, [emailLogId])).rows[0];
  } catch (error) {
    await query(
      `UPDATE email_log SET status = 'error', error = $1 WHERE id = $2`,
      [error.message, emailLogId]
    );
    return (await query(`SELECT * FROM email_log WHERE id = $1`, [emailLogId])).rows[0];
  }
}

/**
 * Send all draft emails for a month.
 */
export async function bulkSendDrafts(month) {
  const drafts = (await query(
    `SELECT id FROM email_log WHERE statement_month = $1 AND status = 'draft'`, [month]
  )).rows;
  const results = [];
  for (const draft of drafts) results.push(await sendDraftEmail(draft.id));
  return results;
}

// Legacy: direct send (kept for backwards compatibility)
export async function sendDisbursementEmail(id) {
  const draft = await createDraftEmail(id);
  return sendDraftEmail(draft.id);
}

export async function bulkSend(month) {
  await bulkCreateDrafts(month);
  return bulkSendDrafts(month);
}

function getGuideAttachment() {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    // Try backend/ first (Vercel bundle), then repo root (local dev)
    let guidePath = path.join(__dirname, '../../LiveLuxe-Owner-Disbursement-Guide.pdf');
    if (!fs.existsSync(guidePath)) {
      guidePath = path.join(__dirname, '../../../LiveLuxe-Owner-Disbursement-Guide.pdf');
    }
    const guideBuffer = fs.readFileSync(guidePath);
    return [{
      Name: 'LiveLuxe-Owner-Disbursement-Guide.pdf',
      Content: guideBuffer.toString('base64'),
      ContentType: 'application/pdf'
    }];
  } catch (err) {
    console.warn('Guide PDF not found, skipping attachment:', err.message);
    return [];
  }
}

function monthLabelForEmail(month) {
  const [y, m] = month.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString('en-AU', { month: 'long', year: 'numeric' });
}

export function channelLabel(platform) {
  const normalized = normalizePlatform(platform);
  if (normalized === 'booking.com') return 'Booking.com';
  if (normalized === 'direct') return 'Direct';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
