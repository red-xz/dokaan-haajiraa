// Shop Attendance — helper functions (calculation only, no Firebase)
// These functions run in the browser and can also be tested in node.

// Maximum distance from the shop for check-in (metres)
export const CHECKIN_RADIUS_METERS = 100;

// Numbers are shown in Latin digits (0-9).
// Kept as a function (same name as before) so call sites stay unchanged.
export function toBn(value) {
  return String(value);
}

// Money with thousands separators in Latin digits: 15000 -> "15,000"
export function toBnMoney(n) {
  const rounded = Math.round(n);
  const withCommas = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (rounded < 0 ? '-' : '') + toBn(withCommas);
}

// Distance between two places (metres) — haversine formula
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius (metres)
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 6-character unique shop code (easy-to-read letters — 0/O, 1/I/L excluded)
export function generateShopCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Date in YYYY-MM-DD format
export function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Month in YYYY-MM format
export function monthStr(d) {
  return dateStr(d).slice(0, 7);
}

export function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

// Monthly salary calculation
// Rules: daily wage = salary ÷ 30; Friday is a paid holiday;
// absent and leave days are unpaid; advances are deducted.
export function computeMonthlySummary({ salary, records, advances, year, monthIndex0, today }) {
  const dailyWage = salary / 30;
  const totalDays = daysInMonth(year, monthIndex0);
  // Current month: up to today; past month: the whole month; future month: 0 days
  const thisMonth = today.getFullYear() === year && today.getMonth() === monthIndex0;
  const futureMonth = year > today.getFullYear() ||
    (year === today.getFullYear() && monthIndex0 > today.getMonth());
  let elapsed = totalDays;
  if (thisMonth) elapsed = today.getDate();
  if (futureMonth) elapsed = 0;

  // How many Fridays in the days that have passed
  let fridays = 0;
  for (let d = 1; d <= elapsed; d++) {
    if (new Date(year, monthIndex0, d).getDay() === 5) fridays++; // 5 = Friday
  }

  // Count only this month's records for days that have passed (do not count future leave)
  const inMonth = records.filter(r => {
    const parts = r.date.split('-').map(Number);
    return parts[0] === year && parts[1] === monthIndex0 + 1 && parts[2] <= elapsed;
  });
  const present = inMonth.filter(r => r.status === 'present').length;
  const leave = inMonth.filter(r => r.status === 'leave').length;
  // Past days with no record (except Fridays) = absent
  const absent = Math.max(0, elapsed - fridays - present - leave);
  const advanceTotal = advances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const deduction = (absent + leave) * dailyWage;
  const rawPayable = salary - deduction - advanceTotal;
  return {
    daysElapsed: elapsed, totalDays, fridays, present, leave, absent,
    dailyWage, deduction, advanceTotal,
    payable: Math.max(0, Math.round(rawPayable)),
    overAdvance: rawPayable < 0 ? Math.round(-rawPayable) : 0
  };
}

// Time in HH:MM format (Latin digits)
export function fmtTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return toBn(`${h}:${m}`);
}
