import { query } from '../db.js';

/**
 * ABA (Australian Banking Association) file generator for NavConnect batch payments.
 * Fixed-width text format: 120 characters per line, CRLF line endings.
 */

function padRight(str, len, char = ' ') {
  return String(str || '').slice(0, len).padEnd(len, char);
}

function padLeft(val, len, char = ' ') {
  return String(val || '').slice(0, len).padStart(len, char);
}

function formatDateDDMMYY(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

function formatBsb(bsb) {
  // Ensure BSB is in XXX-XXX format (7 chars)
  const clean = String(bsb).replace(/[^0-9]/g, '');
  if (clean.length === 6) return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  return padRight(bsb, 7);
}

function amountToCents(amount) {
  return Math.round(Math.abs(Number(amount)) * 100);
}

/**
 * Generate ABA header record (Type 0)
 * Total: 120 characters
 */
function formatHeaderRecord(trust, processingDate, description) {
  let r = '';
  r += '0';                                              // pos 1: record type
  r += ' '.repeat(17);                                   // pos 2-18: blank
  r += '01';                                             // pos 19-20: reel sequence
  r += padRight(trust.financial_institution_code, 3);    // pos 21-23: FI code
  r += ' '.repeat(7);                                    // pos 24-30: blank
  r += padRight(trust.account_name.toUpperCase(), 26);   // pos 31-56: user name
  r += padLeft(trust.apca_user_id, 6, '0');              // pos 57-62: APCA user ID
  r += padRight(description.toUpperCase(), 12);          // pos 63-74: description
  r += formatDateDDMMYY(processingDate);                 // pos 75-80: processing date
  r += ' '.repeat(40);                                   // pos 81-120: blank
  return r;
}

/**
 * Generate ABA detail record (Type 1)
 * Total: 120 characters
 */
function formatDetailRecord(payment, trust) {
  let r = '';
  r += '1';                                                          // pos 1: record type
  r += formatBsb(payment.bsb);                                      // pos 2-8: payee BSB
  r += padLeft(payment.account_number, 9);                           // pos 9-17: payee account
  r += ' ';                                                          // pos 18: indicator (externally initiated)
  r += '53';                                                         // pos 19-20: transaction code (credit)
  r += padLeft(amountToCents(payment.amount), 10, '0');              // pos 21-30: amount in cents
  r += padRight(payment.account_name.toUpperCase(), 32);             // pos 31-62: payee name
  r += padRight(payment.reference.toUpperCase(), 18);                // pos 63-80: lodgement reference
  r += formatBsb(trust.bsb);                                        // pos 81-87: trace BSB
  r += padLeft(trust.account_number, 9);                             // pos 88-96: trace account
  r += padRight(trust.account_name.toUpperCase(), 16);               // pos 97-112: remitter name
  r += '00000000';                                                   // pos 113-120: withholding tax
  return r;
}

/**
 * Generate ABA footer record (Type 7)
 * Total: 120 characters
 */
function formatFooterRecord(payments) {
  const creditTotal = payments.reduce((sum, p) => sum + amountToCents(p.amount), 0);
  let r = '';
  r += '7';                                              // pos 1: record type
  r += '999-999';                                        // pos 2-8: BSB format filler
  r += ' '.repeat(12);                                   // pos 9-20: blank
  r += padLeft(creditTotal, 10, '0');                    // pos 21-30: net total
  r += padLeft(creditTotal, 10, '0');                    // pos 31-40: credit total
  r += padLeft(0, 10, '0');                              // pos 41-50: debit total
  r += ' '.repeat(24);                                   // pos 51-74: blank
  r += padLeft(payments.length, 6, '0');                 // pos 75-80: record count
  r += ' '.repeat(40);                                   // pos 81-120: blank
  return r;
}

/**
 * Generate full ABA file content.
 */
export function generateAbaFile({ trustAccount, payments, processingDate, description = 'OWNER PAYOUT' }) {
  const lines = [];
  lines.push(formatHeaderRecord(trustAccount, processingDate, description));
  for (const payment of payments) {
    if (payment.amount > 0 && payment.bsb && payment.account_number) {
      lines.push(formatDetailRecord(payment, trustAccount));
    }
  }
  lines.push(formatFooterRecord(payments.filter(p => p.amount > 0 && p.bsb && p.account_number)));
  return lines.join('\r\n');
}

/**
 * Generate ABA file for all approved disbursements in a given month.
 */
export async function generateMonthlyAba(month) {
  // Get trust account config
  const trustConfig = (await query(`SELECT * FROM trust_account_config WHERE is_active=true LIMIT 1`)).rows[0];
  if (!trustConfig) throw new Error('Trust account not configured. Please set up BSB and account number first.');
  if (!trustConfig.bsb || !trustConfig.account_number) throw new Error('Trust account BSB and account number are required for ABA export.');

  // Get all disbursements for the month with owner banking details
  const disbursements = (await query(
    `SELECT d.*, o.name owner_name, o.email, o.banking_details
     FROM disbursements d
     JOIN owners o ON o.id = d.owner_id
     WHERE d.month = $1 AND d.final_owner_payout > 0`,
    [month]
  )).rows;

  if (!disbursements.length) throw new Error(`No disbursements found for ${month}`);

  const payments = [];
  const skipped = [];

  for (const d of disbursements) {
    const banking = d.banking_details || {};
    if (!banking.bsb || !banking.accountNumber) {
      skipped.push({ owner: d.owner_name, reason: 'Missing banking details' });
      continue;
    }
    payments.push({
      bsb: banking.bsb,
      account_number: banking.accountNumber,
      account_name: banking.accountName || d.owner_name,
      amount: Number(d.final_owner_payout),
      reference: `LIVELUXE ${month}`
    });
  }

  const abaContent = generateAbaFile({
    trustAccount: trustConfig,
    payments,
    processingDate: new Date(),
    description: 'OWNER PAYOUT'
  });

  // Log the export
  const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  await query(
    `INSERT INTO aba_exports (month, filename, total_amount, record_count)
     VALUES ($1, $2, $3, $4)`,
    [month, `owner-payouts-${month}.aba`, totalAmount, payments.length]
  );

  return { content: abaContent, payments: payments.length, skipped, totalAmount };
}
