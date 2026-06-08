import { query } from '../db.js';
import { getDisbursementDetail, channelLabel } from './disbursementEngine.js';
import { normalizePlatform } from './payoutEngine.js';
import { startEndForMonth } from '../utils/dates.js';

// ── Colors ──
const NAVY = '#14213d';
const GOLD = '#C8A97E';
const GREEN = '#16a34a';
const PURPLE = '#7c3aed';
const BLUE = '#2563eb';

function formatMoney(value) {
  const num = Number(value);
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${num < 0 ? '-' : ''}$${formatted}`;
}

function monthLabel(month) {
  const [y, m] = month.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString('en-AU', { month: 'long', year: 'numeric' });
}

function shortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Get reservations detail for a disbursement (for the reservation table).
 * Hybrid approach: include bookings where checkout is in month AND payout is in month,
 * plus bookings where payout is in month but checkout is after month end.
 * Uses full booking amounts (no pro-rating).
 */
async function getReservationDetails(disbursementId) {
  const { disbursement } = await getDisbursementDetail(disbursementId);
  const { start, end } = startEndForMonth(disbursement.month);

  const allRes = (await query(
    `SELECT r.*, l.name listing_name, l.address
     FROM reservations r
     JOIN listings l ON l.id = r.listing_id
     WHERE l.owner_id = $1
       AND (
         (r.check_out >= $2 AND r.check_out <= $3 AND r.disbursement_month = $4)
         OR
         (r.disbursement_month = $4 AND r.check_out > $3)
       )
     ORDER BY r.check_in`,
    [disbursement.owner_id, start, end, disbursement.month]
  )).rows;

  return allRes.map(r => {
    const totalNights = Math.max(0, Math.round(
      (new Date(r.check_out) - new Date(r.check_in)) / 86400000
    ));
    return { ...r, periodNights: totalNights, totalNights, share: 1.0, periodGross: Number(r.gross_amount) };
  });
}

/**
 * Get bookings deferred to next month — check-in during/before this month
 * but payout (disbursement_month) is after this month.
 */
async function getExcludedBookings(ownerId, month) {
  const { end } = startEndForMonth(month);

  const rows = (await query(
    `SELECT r.*, l.name listing_name, l.address
     FROM reservations r
     JOIN listings l ON l.id = r.listing_id
     WHERE l.owner_id = $1
       AND r.check_in <= $2
       AND r.disbursement_month > $3
     ORDER BY r.check_in`,
    [ownerId, end, month]
  )).rows;

  return rows;
}

/**
 * Get listing addresses for an owner.
 */
async function getOwnerListings(ownerId) {
  return (await query(
    `SELECT l.*, o.name owner_name FROM listings l JOIN owners o ON o.id = l.owner_id WHERE l.owner_id = $1 ORDER BY l.name`,
    [ownerId]
  )).rows;
}

// ── HTML Report ──

export async function generateReportHtml(disbursementId) {
  const { disbursement, lines } = await getDisbursementDetail(disbursementId);
  const reservations = await getReservationDetails(disbursementId);
  const excluded = await getExcludedBookings(disbursement.owner_id, disbursement.month);
  const listings = await getOwnerListings(disbursement.owner_id);

  const label = monthLabel(disbursement.month);
  const ownerFirst = (disbursement.owner_name || '').split(' ')[0] || 'Owner';
  const { start, end } = startEndForMonth(disbursement.month);
  const propertyAddress = listings.length === 1 ? listings[0].address || listings[0].name : `${listings.length} Properties`;

  // Group line items
  const grossLines = lines.filter(l => l.type === 'gross_booking');
  const channelLines = lines.filter(l => l.type === 'channel_commission');
  const mgmtLines = lines.filter(l => l.type === 'management_fee');
  const discountLines = lines.filter(l => l.type === 'mgmt_discount');
  const cleaningLines = lines.filter(l => l.type === 'cleaning');
  const techFeeLines = lines.filter(l => l.type === 'tech_fee');
  const expenseLines = lines.filter(l => l.type === 'expense');
  const utilityLines = lines.filter(l => l.type === 'utility');

  const paidReservations = reservations.filter(r => r.share > 0);
  const totalGross = Number(disbursement.gross_channel_payout);
  const platformFees = Number(disbursement.platform_fees);
  const channelPayout = Number(disbursement.net_channel_revenue);
  const mgmtFeeBase = Number(disbursement.management_fee_base);
  const mgmtDiscount = Number(disbursement.mgmt_fee_discount);
  const mgmtEffective = Number(disbursement.management_commission);
  const cleaningCosts = Number(disbursement.cleaning_costs);
  const techFees = Number(disbursement.software_fees);
  const expenses = Number(disbursement.owner_expenses);
  const utilities = Number(disbursement.utilities);
  const finalPayout = Number(disbursement.final_owner_payout);

  // Determine effective mgmt rate
  const effectiveMgmtRate = channelPayout > 0 ? (mgmtEffective / channelPayout * 100).toFixed(1) : '19.8';
  const standardMgmtRate = channelPayout > 0 ? (mgmtFeeBase / channelPayout * 100).toFixed(1) : '19.8';

  // Channel breakdown for commission description
  const channelBreakdown = [];
  const platforms = [...new Set(reservations.map(r => normalizePlatform(r.platform)))];
  for (const p of platforms) {
    const rates = { airbnb: '16.5%', 'booking.com': '16.5%', vrbo: '12%', direct: '0%' };
    channelBreakdown.push(`${channelLabel(p)} ${rates[p] || '0%'}`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LiveLuxe ${label} Disbursement Statement</title>
<style>
  @page { size: A4; margin: 20mm 15mm; }
  @media print {
    .page-break { page-break-before: always; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #333; font-size: 11px; line-height: 1.5; }
  .container { max-width: 800px; margin: 0 auto; }

  /* Header */
  .header { background: ${NAVY}; color: white; padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; }
  .header .logo { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
  .header .logo span { color: ${GOLD}; }
  .header .subtitle { color: ${GOLD}; font-size: 11px; margin-top: 2px; }
  .header .statement-title { text-align: right; }
  .header .statement-title h2 { font-size: 14px; font-weight: 600; color: white; }
  .header .statement-title p { color: rgba(255,255,255,0.7); font-size: 10px; }

  .body { padding: 28px 32px; }

  /* Greeting */
  .greeting { font-size: 13px; color: ${NAVY}; margin-bottom: 6px; font-weight: 600; }
  .intro { font-size: 11px; color: #555; margin-bottom: 20px; line-height: 1.6; }

  /* Financial Statement Table */
  .fin-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  .fin-table th { background: ${NAVY}; color: white; padding: 8px 12px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fin-table td { padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 11px; vertical-align: top; }
  .fin-table tr:nth-child(even) { background: #f8fafc; }
  .fin-table .amount { text-align: right; font-weight: 600; white-space: nowrap; min-width: 100px; }
  .fin-table .description { color: #666; font-size: 10px; }
  .fin-table .label { font-weight: 500; color: ${NAVY}; }
  .fin-table .negative { color: #dc2626; }
  .fin-table .positive { color: ${GREEN}; }
  .fin-table .final-row { background: ${NAVY} !important; }
  .fin-table .final-row td { color: white; font-size: 13px; font-weight: 700; padding: 12px; border: none; }
  .fin-table .final-row .amount { color: ${GREEN}; font-size: 15px; }
  .fin-table .discount-row td { background: #f0fdf4; }
  .fin-table .discount-row .label { color: ${GREEN}; }

  /* Section header */
  .section-title { font-size: 13px; font-weight: 700; color: ${NAVY}; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 2px solid ${GOLD}; text-transform: uppercase; letter-spacing: 0.5px; }

  /* Reservation Detail Table */
  .res-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 10px; }
  .res-table th { background: #f1f5f9; color: ${NAVY}; padding: 6px 8px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid ${GOLD}; }
  .res-table td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; }
  .res-table tr:nth-child(even) { background: #fafbfc; }
  .res-table .amount { text-align: right; font-weight: 600; }

  /* Info boxes */
  .info-box { border-radius: 6px; padding: 14px 16px; margin-bottom: 16px; font-size: 11px; line-height: 1.6; }
  .info-box h4 { font-size: 12px; font-weight: 700; margin-bottom: 6px; }
  .info-box-green { border: 2px solid ${GREEN}; background: #f0fdf4; }
  .info-box-green h4 { color: ${GREEN}; }
  .info-box-purple { border: 2px solid ${PURPLE}; background: #faf5ff; }
  .info-box-purple h4 { color: ${PURPLE}; }
  .info-box-blue { border: 2px solid ${BLUE}; background: #eff6ff; }
  .info-box-blue h4 { color: ${BLUE}; }
  .info-box-gold { border: 2px solid ${GOLD}; background: #fffbeb; }
  .info-box-gold h4 { color: #92400e; }

  /* Deferred table */
  .deferred-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10px; }
  .deferred-table th { background: #f0fdf4; color: ${GREEN}; padding: 5px 8px; text-align: left; font-size: 9px; text-transform: uppercase; }
  .deferred-table td { padding: 4px 8px; border-bottom: 1px solid #ecfdf5; }

  /* Steps */
  .steps { counter-reset: step; padding-left: 0; list-style: none; }
  .steps li { counter-increment: step; margin-bottom: 6px; padding-left: 28px; position: relative; font-size: 11px; }
  .steps li::before { content: counter(step); position: absolute; left: 0; top: 0; width: 20px; height: 20px; border-radius: 50%; background: ${BLUE}; color: white; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; line-height: 20px; text-align: center; }

  /* Sign off */
  .signoff { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
  .signoff p { font-size: 11px; color: #555; margin-bottom: 4px; }

  /* Footer */
  .footer { background: ${NAVY}; color: rgba(255,255,255,0.6); padding: 12px 32px; font-size: 9px; text-align: center; margin-top: 30px; }
</style>
</head>
<body>

<div class="container">
  <!-- PAGE 1 -->
  <div class="header">
    <div>
      <div class="logo">Live<span>Luxe</span></div>
      <div class="subtitle">Property Management</div>
    </div>
    <div class="statement-title">
      <h2>${label} Disbursement Statement</h2>
      <p>${propertyAddress}</p>
    </div>
  </div>

  <div class="body">
    <p class="greeting">Dear ${ownerFirst},</p>
    <p class="intro">
      Please find below your disbursement statement for <strong>${label}</strong>.
      This statement covers all completed and reconciled bookings for the period
      ${shortDate(start)} to ${shortDate(end)}.
    </p>

    <!-- Financial Statement Table -->
    <div class="section-title">Financial Statement</div>
    <table class="fin-table">
      <thead>
        <tr>
          <th style="width:45%">Item</th>
          <th style="width:20%" class="amount">Amount</th>
          <th style="width:35%">Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="label">Gross Booking Revenue</td>
          <td class="amount">${formatMoney(totalGross)}</td>
          <td class="description">${paidReservations.length} reservation${paidReservations.length !== 1 ? 's' : ''}, ${shortDate(start)}\u2013${shortDate(end)} (completed and paid)</td>
        </tr>
        <tr>
          <td class="label negative">Platform Commissions</td>
          <td class="amount negative">${formatMoney(-platformFees)}</td>
          <td class="description">${channelBreakdown.join(' / ') || 'Channel fees'}</td>
        </tr>
        <tr style="background:#f0f9ff;">
          <td class="label" style="font-weight:700;">Channel Payout</td>
          <td class="amount" style="font-weight:700;">${formatMoney(channelPayout)}</td>
          <td class="description">Net amount received from platforms</td>
        </tr>
        <tr>
          <td class="label negative">Management Fee (${standardMgmtRate}% incl GST)</td>
          <td class="amount negative">${formatMoney(-mgmtFeeBase)}</td>
          <td class="description">Per your signed Management Authority agreement</td>
        </tr>
${mgmtDiscount > 0 ? `        <tr class="discount-row">
          <td class="label positive">Commission Reduction</td>
          <td class="amount positive">+${formatMoney(mgmtDiscount)}</td>
          <td class="description" style="color:${GREEN}">Applied to all owners this month</td>
        </tr>` : ''}
${cleaningCosts > 0 ? `        <tr>
          <td class="label negative">Cleaning / Guest Fees</td>
          <td class="amount negative">${formatMoney(-cleaningCosts)}</td>
          <td class="description">${cleaningLines.length} x cleaning fee per reservation</td>
        </tr>` : ''}
        <tr>
          <td class="label negative">Technology & Software Fee</td>
          <td class="amount negative">${formatMoney(-techFees)}</td>
          <td class="description">Monthly platform & channel management</td>
        </tr>
${expenses > 0 ? `        <tr>
          <td class="label negative">One-off Expenses</td>
          <td class="amount negative">${formatMoney(-expenses)}</td>
          <td class="description">${expenseLines.map(l => l.description).join(', ')}</td>
        </tr>` : ''}
${utilities > 0 ? `        <tr>
          <td class="label negative">Utilities</td>
          <td class="amount negative">${formatMoney(-utilities)}</td>
          <td class="description">${utilityLines.map(l => l.description).join(', ')}</td>
        </tr>` : ''}
        <tr class="final-row">
          <td>Your ${label} Disbursement</td>
          <td class="amount">${formatMoney(finalPayout)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>

    <!-- Reservation Detail Table -->
    <div class="section-title">Reservation Detail</div>
    <table class="res-table">
      <thead>
        <tr>
          <th>Guest</th>
          <th>Check-in</th>
          <th>Check-out</th>
          <th>Nights</th>
          <th>Channel</th>
          <th class="amount">Gross Revenue</th>
        </tr>
      </thead>
      <tbody>
${paidReservations.map(r => `        <tr>
          <td>${r.guest_name || 'Guest'}</td>
          <td>${shortDate(r.check_in)}</td>
          <td>${shortDate(r.check_out)}</td>
          <td>${r.periodNights}${r.share < 1 ? `/${r.totalNights}` : ''}</td>
          <td>${channelLabel(r.platform)}</td>
          <td class="amount">${formatMoney(r.periodGross)}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>

    <!-- PAGE 2 -->
    <div class="page-break"></div>

${excluded.length > 0 ? `
    <!-- Deferred Revenue Box -->
    <div class="info-box info-box-green">
      <h4>Deferred Revenue &mdash; Rolling to Next Month</h4>
      <p>The following bookings have payout dates beyond ${shortDate(end)} and will be included in a future statement:</p>
      <table class="deferred-table">
        <thead>
          <tr><th>Guest</th><th>Check-in</th><th>Check-out</th><th>Channel</th><th>Reason</th></tr>
        </thead>
        <tbody>
${excluded.map(r => `          <tr>
            <td>${r.guest_name || 'Guest'}</td>
            <td>${shortDate(r.check_in)}</td>
            <td>${shortDate(r.check_out)}</td>
            <td>${channelLabel(r.platform)}</td>
            <td>Checkout after ${shortDate(end)}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>
    </div>
` : ''}

${mgmtDiscount > 0 ? `
    <!-- Goodwill Explanation Box -->
    <div class="info-box info-box-purple">
      <h4>Goodwill Commission Reduction</h4>
      <p>As part of our commitment to building long-term partnerships with our property owners, we have applied a commission reduction this month:</p>
      <ul style="padding-left:18px; margin: 8px 0;">
        <li><strong>Standard Fee:</strong> ${standardMgmtRate}% (incl GST) of channel payout</li>
        <li><strong>Reduction Applied:</strong> ${formatMoney(mgmtDiscount)}</li>
        <li><strong>Effective Fee:</strong> ${effectiveMgmtRate}% of channel payout (${formatMoney(mgmtEffective)})</li>
      </ul>
      <p>This reduction is applied automatically and reflects our appreciation for your ongoing trust in LiveLuxe.</p>
    </div>
` : ''}

    <!-- How Disbursement Is Calculated -->
    <div class="info-box info-box-blue">
      <h4>How Your Disbursement Is Calculated</h4>
      <p>Each monthly statement follows a transparent 5-step methodology:</p>
      <ol class="steps" style="margin-top:10px;">
        <li><strong>Booking Revenue:</strong> We total all completed guest bookings where the platform payout was received during the statement period.</li>
        <li><strong>Platform Commissions:</strong> Channel fees (Airbnb 16.5%, Booking.com 16.5%, VRBO 12%, Direct 0%) are deducted as they are retained by the platforms.</li>
        <li><strong>Management Fee:</strong> Our management fee (incl GST) is calculated on the net channel payout amount, per your Management Authority agreement.</li>
        <li><strong>Operating Costs:</strong> Cleaning fees, technology fees, and any one-off expenses are deducted.</li>
        <li><strong>Your Payout:</strong> The remaining balance is your disbursement, paid directly to your nominated bank account.</li>
      </ol>
    </div>

    <!-- PAGE 3 -->
    <div class="page-break"></div>

    <!-- Platform Transition Note -->
    <div class="info-box info-box-gold">
      <h4>Platform Transition</h4>
      <p>Please note that any funds held in a prior property manager's account will be reconciled and transferred as they are received. LiveLuxe is committed to ensuring complete transparency during this transition period. If you have any questions about outstanding payments, please don't hesitate to reach out.</p>
    </div>

    <!-- Winter Season Outlook -->
    <div class="info-box info-box-blue">
      <h4>Winter Season Outlook</h4>
      <p>As we move into the winter months, our revenue management team is actively optimising your pricing strategy to maintain strong occupancy. This includes:</p>
      <ul style="padding-left:18px; margin: 8px 0;">
        <li>Dynamic rate adjustments based on demand patterns</li>
        <li>Enhanced promotion visibility across all booking platforms</li>
        <li>Strategic minimum-stay adjustments for peak winter events</li>
        <li>Last-minute booking incentives to fill gap nights</li>
      </ul>
      <p>We'll continue monitoring market conditions and adjusting strategies to maximise your returns throughout the season.</p>
    </div>

    <!-- Sign-off -->
    <div class="signoff">
      <p>Warm regards,</p>
      <p style="font-weight:700; color:${NAVY}; margin-top:8px;">The LiveLuxe Team</p>
      <p style="color:${GOLD}; font-size:10px; margin-top:4px;">LiveLuxe Property Management</p>
    </div>
  </div>

  <div class="footer">
    LiveLuxe Property Management &bull; Melbourne, Australia &bull; contact@liveluxeau.com<br>
    Statement Period: ${shortDate(start)} &ndash; ${shortDate(end)} &bull; Generated ${new Date().toLocaleDateString('en-AU')}
  </div>
</div>

</body>
</html>`;
}


// ── Email Body HTML ──

export async function generateEmailBodyHtml(disbursementId) {
  const { disbursement, lines } = await getDisbursementDetail(disbursementId);
  const excluded = await getExcludedBookings(disbursement.owner_id, disbursement.month);
  const listings = await getOwnerListings(disbursement.owner_id);

  const label = monthLabel(disbursement.month);
  const ownerFirst = (disbursement.owner_name || '').split(' ')[0] || 'Owner';
  const propertyAddress = listings.length === 1 ? listings[0].address || listings[0].name : `${listings.length} properties`;
  const finalPayout = Number(disbursement.final_owner_payout);
  const mgmtDiscount = Number(disbursement.mgmt_fee_discount);
  const discountLines = lines.filter(l => l.type === 'mgmt_discount');

  const excludedTotal = excluded.reduce((sum, r) => sum + Number(r.gross_amount || 0), 0);
  const nextMonthLabel = (() => {
    const [y, m] = disbursement.month.split('-').map(Number);
    const next = m === 12 ? new Date(y + 1, 0, 1) : new Date(y, m, 1);
    return next.toLocaleString('en-AU', { month: 'long' });
  })();

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif; color:#333; font-size:14px; line-height:1.7; max-width:600px; margin:0 auto; padding:20px;">

  <!-- Header -->
  <div style="background:${NAVY}; padding:20px 24px; border-radius:8px 8px 0 0;">
    <div style="font-size:24px; font-weight:700; color:white;">Live<span style="color:${GOLD};">Luxe</span></div>
    <div style="color:${GOLD}; font-size:11px; margin-top:2px;">Property Management</div>
  </div>

  <div style="padding:24px; border:1px solid #e5e7eb; border-top:none; border-radius:0 0 8px 8px;">

    <!-- Greeting -->
    <p style="font-size:15px; color:${NAVY}; font-weight:600; margin-bottom:4px;">Dear ${ownerFirst},</p>

    <!-- Property highlight -->
    <p>We hope you're doing well. Here is your ${label} disbursement summary for <strong>${propertyAddress}</strong>.</p>

    <!-- Financial summary -->
    <div style="background:${NAVY}; border-radius:8px; padding:20px; text-align:center; margin:20px 0;">
      <div style="color:rgba(255,255,255,0.7); font-size:12px; text-transform:uppercase; letter-spacing:1px;">Your ${label} Disbursement</div>
      <div style="color:${GREEN}; font-size:32px; font-weight:700; margin-top:6px;">${formatMoney(finalPayout)}</div>
      <div style="color:rgba(255,255,255,0.5); font-size:11px; margin-top:4px;">AUD &bull; Paid to your nominated account</div>
    </div>

    <!-- Winter context -->
    <p>As we move through the winter season, our team continues to actively manage your pricing and occupancy strategy to ensure the best possible returns during the quieter months.</p>

${mgmtDiscount > 0 ? `
    <!-- Goodwill mention -->
    <div style="border-left:4px solid ${PURPLE}; padding:10px 14px; margin:16px 0; background:#faf5ff; border-radius:0 6px 6px 0;">
      <strong style="color:${PURPLE};">Goodwill Commission Reduction Applied</strong><br>
      <span style="font-size:13px;">A commission reduction of <strong>${formatMoney(mgmtDiscount)}</strong> has been applied to your account this month as part of our commitment to building a long-term partnership.</span>
    </div>
` : ''}

    <!-- Platform transition note -->
    <p style="font-size:13px; color:#666;">Any funds currently held in a prior vendor's account will be reconciled and transferred to you as they are received. We are paying upfront where possible to ensure continuity of your payments.</p>

${excluded.length > 0 ? `
    <!-- Deferred revenue preview -->
    <div style="border-left:4px solid ${GREEN}; padding:10px 14px; margin:16px 0; background:#f0fdf4; border-radius:0 6px 6px 0;">
      <strong style="color:${GREEN};">Upcoming Revenue</strong><br>
      <span style="font-size:13px;">${excluded.length} booking${excluded.length !== 1 ? 's' : ''} (${formatMoney(excludedTotal)} gross) will roll into your ${nextMonthLabel} statement.</span>
    </div>
` : ''}

    <!-- Attachment reference -->
    <p>Please find your <strong>full detailed statement attached</strong> as a PDF. It includes a complete breakdown of all bookings, fees, and calculations for the period.</p>

    <p style="font-size:13px; color:#555;">We've also attached the <strong>LiveLuxe Disbursement Guide</strong> for your reference — it explains our fee structure, calculation methodology, and answers common questions.</p>

    <!-- Payment confirmation -->
    <p style="font-size:13px; background:#f0fdf4; padding:10px 14px; border-radius:6px; border:1px solid #bbf7d0;">
      Your payment of <strong style="color:${GREEN};">${formatMoney(finalPayout)}</strong> has been processed to your nominated bank account.
    </p>

    <!-- Signature -->
    <div style="margin-top:24px; padding-top:16px; border-top:1px solid #e5e7eb;">
      <p style="margin:0;">Warm regards,</p>
      <p style="margin:4px 0 0; font-weight:700; color:${NAVY};">David Wang</p>
      <p style="margin:0; font-size:12px; color:#888;">Head of Growth, LiveLuxe Property Management</p>
      <p style="margin:2px 0 0; font-size:11px; color:${GOLD};">contact@liveluxeau.com</p>
    </div>
  </div>

</body>
</html>`;
}
