// দোকান হাজিরা — সাহায্যকারী ফাংশন (শুধু হিসাব, Firebase ছাড়া)
// এই ফাংশনগুলো ব্রাউজারেও চলে, node-এও পরীক্ষা করা যায়।

// চেক-ইনের জন্য দোকান থেকে সর্বোচ্চ দূরত্ব (মিটার)
export const CHECKIN_RADIUS_METERS = 100;

// বাংলা সংখ্যা (০-৯)
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
export function toBn(value) {
  return String(value).replace(/[0-9]/g, d => BN_DIGITS[Number(d)]);
}

// টাকা হাজার ভাগ করে বাংলা সংখ্যায়: 15000 -> "১৫,০০০"
export function toBnMoney(n) {
  const rounded = Math.round(n);
  const withCommas = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (rounded < 0 ? '-' : '') + toBn(withCommas);
}

// দুই জায়গার দূরত্ব (মিটার) — haversine সূত্র
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // পৃথিবীর ব্যাসার্ধ (মিটার)
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ৬ অক্ষরের ইউনিক শপ কোড (সহজে পড়া যায় এমন অক্ষর দিয়ে — 0/O, 1/I/L বাদ)
export function generateShopCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// তারিখ YYYY-MM-DD আকারে
export function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// মাস YYYY-MM আকারে
export function monthStr(d) {
  return dateStr(d).slice(0, 7);
}

export function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

// মাসিক বেতনের হিসাব
// নিয়ম: দৈনিক মজুরি = বেতন ÷ ৩০; শুক্রবার বেতনসহ ছুটি;
// অনুপস্থিত ও ছুটির দিনের টাকা কাটা যায়; অগ্রিম বাদ যায়।
export function computeMonthlySummary({ salary, records, advances, year, monthIndex0, today }) {
  const dailyWage = salary / 30;
  const totalDays = daysInMonth(year, monthIndex0);
  // চলতি মাস হলে আজ পর্যন্ত, পুরোনো মাস হলে পুরো মাস, ভবিষ্যতের মাস হলে ০ দিন
  const thisMonth = today.getFullYear() === year && today.getMonth() === monthIndex0;
  const futureMonth = year > today.getFullYear() ||
    (year === today.getFullYear() && monthIndex0 > today.getMonth());
  let elapsed = totalDays;
  if (thisMonth) elapsed = today.getDate();
  if (futureMonth) elapsed = 0;

  // গত হয়ে যাওয়া দিনগুলোতে কয়টা শুক্রবার
  let fridays = 0;
  for (let d = 1; d <= elapsed; d++) {
    if (new Date(year, monthIndex0, d).getDay() === 5) fridays++; // ৫ = শুক্রবার
  }

  // শুধু এই মাসের, গত হয়ে যাওয়া দিনগুলোর রেকর্ড গুনুন (ভবিষ্যতের ছুটি গুনবেন না)
  const inMonth = records.filter(r => {
    const parts = r.date.split('-').map(Number);
    return parts[0] === year && parts[1] === monthIndex0 + 1 && parts[2] <= elapsed;
  });
  const present = inMonth.filter(r => r.status === 'present').length;
  const leave = inMonth.filter(r => r.status === 'leave').length;
  // রেকর্ড নেই এমন গত দিন (শুক্রবার বাদে) = অনুপস্থিত
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

// সময় HH:MM আকারে (বাংলা সংখ্যায়)
export function fmtTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return toBn(`${h}:${m}`);
}
