import { put as blobPut, del as blobDel } from '@vercel/blob';
import { query } from '../db.js';
import { findListing } from './reconciliation.js';
import { parse } from 'csv-parse/sync';
import fs from 'fs';

/**
 * Upload a receipt file to Vercel Blob storage.
 * @param {Buffer} buffer - File contents
 * @param {string} filename - Original filename
 * @returns {{ url: string, filename: string }}
 */
export async function uploadReceipt(buffer, filename) {
  const blob = await blobPut(`receipts/${Date.now()}-${filename}`, buffer, {
    access: 'public',
    contentType: inferContentType(filename),
  });
  return { url: blob.url, filename };
}

/**
 * Delete a receipt from Vercel Blob storage.
 */
export async function deleteReceipt(url) {
  if (!url) return;
  try {
    await blobDel(url);
  } catch (err) {
    console.warn('Failed to delete blob:', err.message);
  }
}

/**
 * Create a single expense with optional receipt.
 */
export async function createExpense({ listingId, expenseDate, description, category, amount, receiptUrl, receiptFilename }) {
  const result = await query(
    `INSERT INTO owner_expenses (listing_id, source_document, expense_date, description, category, amount, receipt_url, receipt_filename, raw_payload)
     VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7, '{}') RETURNING *`,
    [listingId, expenseDate, description, category || 'miscellaneous', amount, receiptUrl || null, receiptFilename || null]
  );
  return result.rows[0];
}

/**
 * List expenses with optional filters.
 */
export async function getExpenses({ ownerId, listingId, month, category } = {}) {
  let sql = `SELECT e.*, l.name listing_name, o.name owner_name
    FROM owner_expenses e
    LEFT JOIN listings l ON l.id = e.listing_id
    LEFT JOIN owners o ON o.id = l.owner_id
    WHERE 1=1`;
  const params = [];
  let idx = 1;

  if (ownerId) {
    sql += ` AND l.owner_id = $${idx++}`;
    params.push(ownerId);
  }
  if (listingId) {
    sql += ` AND e.listing_id = $${idx++}`;
    params.push(listingId);
  }
  if (month) {
    sql += ` AND to_char(e.expense_date, 'YYYY-MM') = $${idx++}`;
    params.push(month);
  }
  if (category) {
    sql += ` AND e.category = $${idx++}`;
    params.push(category);
  }

  sql += ` ORDER BY e.expense_date DESC, e.created_at DESC`;

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Get a single expense by ID.
 */
export async function getExpense(id) {
  const result = await query(
    `SELECT e.*, l.name listing_name, o.name owner_name
     FROM owner_expenses e
     LEFT JOIN listings l ON l.id = e.listing_id
     LEFT JOIN owners o ON o.id = l.owner_id
     WHERE e.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Delete an expense and its associated receipt blob.
 */
export async function deleteExpense(id) {
  const expense = await getExpense(id);
  if (!expense) throw new Error('Expense not found');
  if (expense.receipt_url) {
    await deleteReceipt(expense.receipt_url);
  }
  await query(`DELETE FROM owner_expenses WHERE id = $1`, [id]);
  return expense;
}

/**
 * Import expenses from a CSV file buffer.
 * Expected columns: listing_id or listing_name, expense_date, description, category, amount
 */
export async function importExpenseCsv(buffer) {
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  const results = { success: 0, errors: [] };

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    try {
      const listingRef = row.listing_id || row.listing_name || row.listing || row.hostaway_listing_id || '';
      const listing = await findListing(listingRef);
      if (!listing) {
        results.errors.push({ row: i + 1, error: `Listing not found: ${listingRef}` });
        continue;
      }

      const expenseDate = row.expense_date || row.date || '';
      const description = row.description || row.memo || '';
      const category = row.category || 'miscellaneous';
      const amount = parseFloat(row.amount || row.cost || '0');

      if (!expenseDate || !description || isNaN(amount) || amount <= 0) {
        results.errors.push({ row: i + 1, error: 'Missing required fields (date, description, amount)' });
        continue;
      }

      await createExpense({
        listingId: listing.id,
        expenseDate,
        description,
        category,
        amount,
      });
      results.success++;
    } catch (err) {
      results.errors.push({ row: i + 1, error: err.message });
    }
  }

  return results;
}

function inferContentType(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const types = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return types[ext] || 'application/octet-stream';
}
