export function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function addDays(dateLike, days) {
  const date = new Date(`${toDateOnly(dateLike)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

export function dayOfWeek(dateLike) {
  return new Date(`${toDateOnly(dateLike)}T00:00:00Z`).getUTCDay();
}

export function monthKey(dateLike) {
  return toDateOnly(dateLike).slice(0, 7);
}

export function startEndForMonth(month) {
  const start = `${month}-01`;
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return { start, end: toDateOnly(date) };
}
