import fs from 'fs';
import { parse } from 'csv-parse/sync';
import xlsx from 'xlsx';
import pdf from 'pdf-parse';
import { toDateOnly } from '../utils/dates.js';

export async function parseUploadedFile(filePath, originalName) {
  const lower = originalName.toLowerCase();
  if (lower.endsWith('.csv')) {
    return parse(fs.readFileSync(filePath), { columns: true, skip_empty_lines: true, trim: true });
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return xlsx.utils.sheet_to_json(sheet, { defval: '' });
  }
  if (lower.endsWith('.pdf')) {
    const data = await pdf(fs.readFileSync(filePath));
    return parseLoosePdfTable(data.text);
  }
  throw new Error('Unsupported file type');
}

function parseLoosePdfTable(text) {
  return text.split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const amount = line.match(/(-?\$?\d[\d,]*\.?\d{0,2})\s*$/)?.[1] || '';
      const date = line.match(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}/)?.[0] || '';
      return { date, description: line.replace(amount, '').trim(), amount };
    });
}

export function value(row, names) {
  const keys = Object.keys(row);
  for (const name of names) {
    const found = keys.find((key) => key.toLowerCase().replace(/\s|_/g, '') === name.toLowerCase().replace(/\s|_/g, ''));
    if (found) return row[found];
  }
  return '';
}

export function money(input) {
  if (input === null || input === undefined || input === '') return 0;
  return Number(String(input).replace(/[$,]/g, '')) || 0;
}

export function date(input) {
  return toDateOnly(input) || toDateOnly(new Date());
}
