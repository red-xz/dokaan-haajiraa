// দোকান হাজিরা — মূল অ্যাপ (Firebase + Firestore)
// Firebase v10 মডুলার SDK, CDN থেকে লোড হয় (কনফিগ বসানো থাকলে)।
// ডেটা মডেল:
//   shops/{shopCode}                                  — দোকান (নাম, লোকেশন)
//   shops/{shopCode}/employees/{empId}                — কর্মচারী (নাম, ফোন, মাসিক বেতন)
//   shops/{shopCode}/attendance/{empId_YYYY-MM-DD}    — হাজিরা (present/absent/leave)
//   shops/{shopCode}/advances/{advId}                 — অগ্রিম (কর্মচারী, টাকা, তারিখ)

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';
import {
  toBn, toBnMoney, haversineMeters, generateShopCode,
  dateStr, monthStr, daysInMonth, computeMonthlySummary, fmtTime,
  CHECKIN_RADIUS_METERS
} from './utils.js';

let db = null;      // Firestore
let auth = null;    // Firebase Auth
let user = null;    // অ্যানোনিমাস ব্যবহারকারী
let fb = null;      // Firebase মডিউলগুলো (config থাকলে লোড হবে)

const state = {
  role: null, shopCode: null, shop: null,
  empId: null, employee: null, employees: []
};

const $ = id => document.getElementById(id);
const screens = ['home', 'admin-start', 'admin-create', 'admin-open', 'admin-dash', 'emp-join', 'emp-dash'];
const DEFAULT_HEADER_NAME = 'কর্মচারীর হাজিরা ও বেতন';

// হেডারে দোকানের নাম দেখান — কোনো দোকান খোলা থাকলে তার নিজের নাম,
// না থাকলে সাধারণ লেখা (প্রত্যেক দোকানদার নিজের দোকানের নাম দেখবে)
function updateHeaderName() {
  $('header-shop-name').textContent = state.shop ? state.shop.name : DEFAULT_HEADER_NAME;
}

function showScreen(name) {
  screens.forEach(s => $('screen-' + s).classList.toggle('active', s === name));
  window.scrollTo(0, 0);
}

function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.toggle('error', isError);
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 5000);
}

// Firebase ছাড়া কোনো ডেটা কাজ চলবে না — পরিষ্কার বার্তা দিন
function needFirebase() {
  if (!isFirebaseConfigured) {
    toast('Firebase এখনো সেট করা হয়নি — অ্যাডমিনকে বলুন কনফিগ বসাতে।', true);
    return false;
  }
  if (!user) {
    toast('লগইন হচ্ছে, একটু অপেক্ষা করুন…', true);
    return false;
  }
  return true;
}

// ---------- Firebase চালু ----------

async function initFirebase() {
  // SDK শুধু কনফিগ থাকলেই লোড করুন (প্লেসহোল্ডার দিয়ে initializeApp ফেল করবে)
  const appMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const authMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
  const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  fb = { ...appMod, ...authMod, ...fsMod };
  const app = fb.initializeApp(firebaseConfig);
  auth = fb.getAuth(app);
  db = fb.getFirestore(app);
  const cred = await fb.signInAnonymously(auth);
  user = cred.user;
}

// ---------- Firestore রেফারেন্স ----------

const shopRef = code => fb.doc(db, 'shops', code);
const empsCol = code => fb.collection(db, 'shops', code, 'employees');
const attCol = code => fb.collection(db, 'shops', code, 'attendance');
const advCol = code => fb.collection(db, 'shops', code, 'advances');
const attDoc = (code, empId, date) => fb.doc(db, 'shops', code, 'attendance', `${empId}_${date}`);

// ---------- লোকেশন ----------

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('এই ব্রাউজারে লোকেশন সাপোর্ট করে না।'));
    }
    navigator.geolocation.getCurrentPosition(resolve, err => {
      if (err.code === 1) reject(new Error('লোকেশনের অনুমতি দেওয়া হয়নি — ব্রাউজারের সেটিংস থেকে অনুমতি দিন।'));
      else reject(new Error('লোকেশন পাওয়া যায়নি — আবার চেষ্টা করুন।'));
    }, { enableHighAccuracy: true, timeout: 15000 });
  });
}

// ---------- অ্যাডমিন: দোকান খোলা ----------

async function createShop() {
  if (!needFirebase()) return;
  const name = $('input-shop-name').value.trim();
  if (!name) return toast('দোকানের নাম লিখুন।', true);
  // ইউনিক কোড বানান (আগে থেকে থাকলে আবার বানান)
  let code, exists = true, tries = 0;
  while (exists && tries < 10) {
    code = generateShopCode();
    const snap = await fb.getDoc(shopRef(code));
    exists = snap.exists();
    tries++;
  }
  if (exists) return toast('কোড বানাতে সমস্যা হয়েছে — আবার চেষ্টা করুন।', true);
  await fb.setDoc(shopRef(code), { name, location: null, createdAt: fb.serverTimestamp() });
  state.shopCode = code;
  state.shop = { name, location: null };
  updateHeaderName();
  localStorage.setItem('dh_admin_shop', code);
  $('shop-code-display').textContent = code;
  $('shop-code-box').classList.remove('hidden');
  $('location-box').classList.remove('hidden');
  $('btn-goto-admin-dash').classList.remove('hidden');
  toast('দোকান খোলা হয়েছে! এখন দোকানের লোকেশন সেট করুন।');
}

async function openShop() {
  if (!needFirebase()) return;
  const code = $('input-open-code').value.trim().toUpperCase();
  if (!code) return toast('দোকানের কোড লিখুন।', true);
  const snap = await fb.getDoc(shopRef(code));
  if (!snap.exists()) return toast('এই কোডের কোনো দোকান পাওয়া যায়নি।', true);
  state.shopCode = code;
  state.shop = snap.data();
  localStorage.setItem('dh_admin_shop', code);
  await loadAdminDash();
}

// দোকানের লোকেশন সেট করা (দোকানে দাঁড়িয়ে করতে হবে)
async function setLocation() {
  if (!needFirebase()) return;
  toast('লোকেশন নেওয়া হচ্ছে…');
  try {
    const pos = await getPosition();
    const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    await fb.updateDoc(shopRef(state.shopCode), { location: loc });
    state.shop.location = loc;
    $('location-status').textContent = `লোকেশন সেট হয়েছে: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
    updateAdminHeader();
    toast('দোকানের লোকেশন সেট হয়েছে।');
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- অ্যাডমিন: ড্যাশবোর্ড ----------

function updateAdminHeader() {
  $('admin-shop-title').textContent = state.shop ? state.shop.name : '';
  $('admin-shop-code').textContent = state.shopCode || '';
  $('admin-location-status').textContent =
    state.shop && state.shop.location ? 'লোকেশন সেট আছে ✓' : 'লোকেশন সেট করা হয়নি';
  updateHeaderName();
}

async function loadAdminDash() {
  const empSnap = await fb.getDocs(empsCol(state.shopCode));
  state.employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  updateAdminHeader();
  $('salary-month').value = monthStr(new Date());
  $('leave-date').value = dateStr(new Date());
  await renderToday();
  renderEmployees();
  await renderSalary();
  fillAdvanceSelects();
  await renderAdvances();
  showScreen('admin-dash');
}

// আজকের হাজিরা + নোটিশ (কে কখন এসেছে)
async function renderToday() {
  const today = dateStr(new Date());
  const [y, m, d] = today.split('-');
  $('today-date-bn').textContent = toBn(`${d}/${m}/${y}`);
  const snap = await fb.getDocs(fb.query(attCol(state.shopCode), fb.where('date', '==', today)));
  const byEmp = {};
  snap.docs.forEach(docSnap => { byEmp[docSnap.data().empId] = docSnap.data(); });

  let html = '';
  const notices = [];
  for (const emp of state.employees) {
    const rec = byEmp[emp.id];
    if (rec && rec.status === 'present') {
      const t = rec.checkIn && rec.checkIn.toDate ? fmtTime(rec.checkIn.toDate()) : '—';
      html += `<div class="row"><span>${emp.name}</span><span class="badge ok">এসেছে • ${t}</span></div>`;
      notices.push({ name: emp.name, time: rec.checkIn && rec.checkIn.toDate ? rec.checkIn.toDate() : null });
    } else if (rec && rec.status === 'leave') {
      html += `<div class="row"><span>${emp.name}</span><span class="badge warn">ছুটি</span></div>`;
    } else {
      html += `<div class="row"><span>${emp.name}</span><span class="badge bad">এখনো আসেনি</span></div>`;
    }
  }
  $('today-list').innerHTML = html || '<p class="muted">কোনো কর্মচারী এখনো যোগ দেয়নি।</p>';
  notices.sort((a, b) => (a.time || 0) - (b.time || 0));
  $('notice-list').innerHTML = notices.length
    ? notices.map(n => `<div class="row"><span>🔔 ${n.name} দোকানে এসেছে</span><span class="muted">${n.time ? fmtTime(n.time) : ''}</span></div>`).join('')
    : '<p class="muted">আজ এখনো কেউ হাজিরা দেয়নি।</p>';
}

// কর্মচারী তালিকা + বেতন সেট করা
function renderEmployees() {
  $('employee-list').innerHTML = state.employees.length
    ? state.employees.map(emp => `
      <div class="emp-card">
        <div><b>${emp.name}</b><br><span class="muted">${toBn(emp.phone || '')}</span></div>
        <div class="salary-edit">
          <label>মাসিক বেতন (টাকা)</label>
          <input type="number" min="0" value="${emp.monthlySalary || 0}" data-salary-for="${emp.id}">
          <button class="btn small" data-save-salary="${emp.id}">সেভ করুন</button>
        </div>
      </div>`).join('')
    : '<p class="muted">কোনো কর্মচারী এখনো যোগ দেয়নি।</p>';

  document.querySelectorAll('[data-save-salary]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-save-salary');
      const input = document.querySelector(`[data-salary-for="${id}"]`);
      const salary = Number(input.value) || 0;
      await fb.updateDoc(fb.doc(db, 'shops', state.shopCode, 'employees', id), { monthlySalary: salary });
      const emp = state.employees.find(e => e.id === id);
      if (emp) emp.monthlySalary = salary;
      toast(`${emp ? emp.name : ''} এর বেতন ${toBnMoney(salary)} টাকা সেট হয়েছে।`);
      await renderSalary();
    });
  });
}

// মাসিক বেতনের টেবিল (সবার)
async function renderSalary() {
  const ym = $('salary-month').value;
  if (!ym) return;
  const [year, month1] = ym.split('-').map(Number);
  const monthIndex0 = month1 - 1;
  const start = `${ym}-01`;
  const end = `${ym}-${String(daysInMonth(year, monthIndex0)).padStart(2, '0')}`;
  // এক মাসের সব হাজিরা/অগ্রিম একবারে এনে JS-এ কর্মচারী অনুযায়ী ভাগ করুন
  // (এতে Firestore composite index লাগে না)
  const attSnap = await fb.getDocs(fb.query(attCol(state.shopCode), fb.where('date', '>=', start), fb.where('date', '<=', end)));
  const allRecords = attSnap.docs.map(d => d.data());
  const advSnap = await fb.getDocs(fb.query(advCol(state.shopCode), fb.where('date', '>=', start), fb.where('date', '<=', end)));
  const allAdvances = advSnap.docs.map(d => d.data());

  let rows = '';
  for (const emp of state.employees) {
    const records = allRecords.filter(r => r.empId === emp.id);
    const advances = allAdvances.filter(a => a.empId === emp.id);
    const s = computeMonthlySummary({
      salary: emp.monthlySalary || 0, records, advances,
      year, monthIndex0, today: new Date()
    });
    rows += `<div class="salary-card">
      <b>${emp.name}</b>
      <div class="grid2">
        <span>মাসিক বেতন</span><b>${toBnMoney(emp.monthlySalary || 0)} টাকা</b>
        <span>দৈনিক মজুরি</span><span>${toBnMoney(s.dailyWage)} টাকা</span>
        <span>উপস্থিত</span><span>${toBn(s.present)} দিন</span>
        <span>শুক্রবার (বেতনসহ ছুটি)</span><span>${toBn(s.fridays)} দিন</span>
        <span>ছুটি</span><span>${toBn(s.leave)} দিন</span>
        <span>অনুপস্থিত</span><span>${toBn(s.absent)} দিন</span>
        <span>কাটা যাবে</span><span>${toBnMoney(s.deduction)} টাকা</span>
        <span>অগ্রিম নেওয়া</span><span>${toBnMoney(s.advanceTotal)} টাকা</span>
        <span><b>পাওনা (বকেয়া)</b></span><b class="payable">${toBnMoney(s.payable)} টাকা</b>
      </div>
      ${s.overAdvance ? `<p class="muted small">অগ্রিম বেশি নেওয়া হয়েছে: ${toBnMoney(s.overAdvance)} টাকা</p>` : ''}
    </div>`;
  }
  $('salary-table').innerHTML = rows || '<p class="muted">কোনো কর্মচারী নেই।</p>';
}

function fillAdvanceSelects() {
  const opts = state.employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  $('advance-emp').innerHTML = opts;
  $('leave-emp').innerHTML = opts;
}

// অগ্রিম যোগ করা
async function addAdvance() {
  if (!needFirebase()) return;
  const empId = $('advance-emp').value;
  const amount = Number($('advance-amount').value);
  const note = $('advance-note').value.trim();
  if (!empId) return toast('কর্মচারী বাছুন।', true);
  if (!amount || amount <= 0) return toast('সঠিক পরিমাণ লিখুন।', true);
  await fb.addDoc(advCol(state.shopCode), {
    empId, amount, note, date: dateStr(new Date()), createdAt: fb.serverTimestamp()
  });
  toast('অগ্রিম যোগ হয়েছে।');
  $('advance-amount').value = '';
  $('advance-note').value = '';
  await renderAdvances();
  await renderSalary();
}

async function renderAdvances() {
  const ym = monthStr(new Date());
  const snap = await fb.getDocs(fb.query(
    advCol(state.shopCode), fb.where('date', '>=', `${ym}-01`), fb.where('date', '<=', `${ym}-31`)
  ));
  const items = snap.docs.map(d => d.data());
  $('advance-list').innerHTML = items.length
    ? '<h4>এই মাসের অগ্রিম</h4>' + items.map(a => {
      const emp = state.employees.find(e => e.id === a.empId);
      return `<div class="row"><span>${emp ? emp.name : ''} — ${toBn(a.date)}</span><b>${toBnMoney(a.amount)} টাকা</b></div>`;
    }).join('')
    : '<p class="muted">এই মাসে কোনো অগ্রিম নেই।</p>';
}

// ছুটি চিহ্নিত করা
async function markLeave() {
  if (!needFirebase()) return;
  const empId = $('leave-emp').value;
  const date = $('leave-date').value;
  if (!empId || !date) return toast('কর্মচারী ও তারিখ বাছুন।', true);
  await fb.setDoc(attDoc(state.shopCode, empId, date), { empId, date, status: 'leave' }, { merge: true });
  toast('ছুটি চিহ্নিত হয়েছে।');
  await renderToday();
  await renderSalary();
}

// ---------- সেলসম্যান: যোগদান ----------

async function joinShop() {
  if (!needFirebase()) return;
  const code = $('input-join-code').value.trim().toUpperCase();
  const name = $('input-join-name').value.trim();
  const phone = $('input-join-phone').value.trim();
  if (!code || !name || !phone) return toast('কোড, নাম ও মোবাইল নম্বর — সবগুলো লিখুন।', true);
  const snap = await fb.getDoc(shopRef(code));
  if (!snap.exists()) return toast('এই কোডের কোনো দোকান পাওয়া যায়নি।', true);
  const ref = await fb.addDoc(empsCol(code), {
    name, phone, monthlySalary: 0, joinedAt: fb.serverTimestamp()
  });
  state.shopCode = code;
  state.shop = snap.data();
  state.empId = ref.id;
  state.employee = { id: ref.id, name, phone, monthlySalary: 0 };
  localStorage.setItem('dh_emp', JSON.stringify({ shopCode: code, empId: ref.id }));
  await loadEmpDash();
  toast('দোকানে যোগ দেওয়া হয়েছে!');
}

// ---------- সেলসম্যান: ড্যাশবোর্ড ----------

async function loadEmpDash() {
  $('emp-greeting').textContent = `আসসালামু আলাইকুম, ${state.employee.name}!`;
  $('emp-shop-line').textContent = `${state.shop.name} • কোড: ${state.shopCode}`;
  updateHeaderName();
  await refreshEmpToday();
  await renderEmpSummary();
  showScreen('emp-dash');
}

async function refreshEmpToday() {
  const today = dateStr(new Date());
  const snap = await fb.getDoc(attDoc(state.shopCode, state.empId, today));
  const box = $('emp-today-status');
  if (snap.exists() && snap.data().status === 'present') {
    const d = snap.data();
    const inT = d.checkIn && d.checkIn.toDate ? fmtTime(d.checkIn.toDate()) : '—';
    const outT = d.checkOut && d.checkOut.toDate ? fmtTime(d.checkOut.toDate()) : null;
    box.innerHTML = `<b>আজকের অবস্থা:</b> হাজিরা দেওয়া হয়েছে (${inT})` +
      (outT ? `<br>ছুটি নেওয়া হয়েছে (${outT})` : '<br>এখনো ছুটি নেওয়া হয়নি।');
  } else if (snap.exists() && snap.data().status === 'leave') {
    box.innerHTML = '<b>আজকের অবস্থা:</b> আজ আপনার ছুটি।';
  } else {
    box.innerHTML = '<b>আজকের অবস্থা:</b> এখনো হাজিরা দেওয়া হয়নি।';
  }
}

// GPS যাচাই করে চেক-ইন / চেক-আউট
async function doCheckInOut(kind) {
  if (!needFirebase()) return;
  if (!state.shop.location) {
    return toast('দোকানের লোকেশন এখনো সেট করা হয়নি — দোকানদারকে বলুন লোকেশন সেট করতে।', true);
  }
  toast('লোকেশন যাচাই করা হচ্ছে…');
  try {
    const pos = await getPosition();
    const dist = haversineMeters(
      pos.coords.latitude, pos.coords.longitude,
      state.shop.location.lat, state.shop.location.lng
    );
    if (dist > CHECKIN_RADIUS_METERS) {
      $('emp-location-msg').textContent = `আপনি দোকান থেকে ${toBn(Math.round(dist))} মিটার দূরে আছেন।`;
      return toast(`আপনি দোকান থেকে ${toBn(Math.round(dist))} মিটার দূরে আছেন। ${toBn(CHECKIN_RADIUS_METERS)} মিটারের মধ্যে এসে চেষ্টা করুন।`, true);
    }
    $('emp-location-msg').textContent = `দোকান থেকে দূরত্ব: ${toBn(Math.round(dist))} মিটার।`;
    const today = dateStr(new Date());
    const ref = attDoc(state.shopCode, state.empId, today);
    if (kind === 'in') {
      await fb.setDoc(ref, {
        empId: state.empId, date: today, status: 'present',
        checkIn: fb.serverTimestamp(),
        checkInLat: pos.coords.latitude, checkInLng: pos.coords.longitude
      }, { merge: true });
      toast('হাজিরা দেওয়া হয়েছে। শুভ দিন!');
    } else {
      const snap = await fb.getDoc(ref);
      if (!snap.exists() || snap.data().status !== 'present') {
        return toast('আগে হাজিরা দিন, তারপর ছুটি নিতে পারবেন।', true);
      }
      await fb.setDoc(ref, { checkOut: fb.serverTimestamp() }, { merge: true });
      toast('ছুটি নেওয়া হয়েছে। আল্লাহ হাফেজ!');
    }
    await refreshEmpToday();
  } catch (e) {
    toast(e.message, true);
  }
}

// সেলসম্যানের নিজের এই মাসের হিসাব
async function renderEmpSummary() {
  const now = new Date();
  const ym = monthStr(now);
  const start = `${ym}-01`;
  const end = `${ym}-${String(daysInMonth(now.getFullYear(), now.getMonth())).padStart(2, '0')}`;
  const attSnap = await fb.getDocs(fb.query(attCol(state.shopCode), fb.where('date', '>=', start), fb.where('date', '<=', end)));
  const records = attSnap.docs.map(d => d.data()).filter(r => r.empId === state.empId);
  const advSnap = await fb.getDocs(fb.query(advCol(state.shopCode), fb.where('date', '>=', start), fb.where('date', '<=', end)));
  const advances = advSnap.docs.map(d => d.data()).filter(a => a.empId === state.empId);
  const s = computeMonthlySummary({
    salary: state.employee.monthlySalary || 0, records, advances,
    year: now.getFullYear(), monthIndex0: now.getMonth(), today: now
  });
  $('emp-summary').innerHTML = `
    <div class="grid2">
      <span>মাসিক বেতন</span><b>${toBnMoney(state.employee.monthlySalary || 0)} টাকা</b>
      <span>উপস্থিত</span><span>${toBn(s.present)} দিন</span>
      <span>অনুপস্থিত</span><span>${toBn(s.absent)} দিন</span>
      <span>ছুটি</span><span>${toBn(s.leave)} দিন</span>
      <span>অগ্রিম নেওয়া</span><span>${toBnMoney(s.advanceTotal)} টাকা</span>
      <span><b>এই মাসে পাবেন</b></span><b class="payable">${toBnMoney(s.payable)} টাকা</b>
    </div>`;
}

// ---------- আগের সেশন ফিরিয়ে আনা ----------

async function restoreSession() {
  const adminShop = localStorage.getItem('dh_admin_shop');
  const empRaw = localStorage.getItem('dh_emp');
  if (adminShop) {
    try {
      const snap = await fb.getDoc(shopRef(adminShop));
      if (snap.exists()) {
        state.shopCode = adminShop;
        state.shop = snap.data();
        await loadAdminDash();
        return;
      }
    } catch (e) { /* চুপচাপ হোমে থাকুন */ }
  }
  if (empRaw) {
    try {
      const { shopCode, empId } = JSON.parse(empRaw);
      const [shopSnap, empSnap] = await Promise.all([
        fb.getDoc(shopRef(shopCode)),
        fb.getDoc(fb.doc(db, 'shops', shopCode, 'employees', empId))
      ]);
      if (shopSnap.exists() && empSnap.exists()) {
        state.shopCode = shopCode;
        state.shop = shopSnap.data();
        state.empId = empId;
        state.employee = { id: empId, ...empSnap.data() };
        await loadEmpDash();
        return;
      }
    } catch (e) { /* চুপচাপ হোমে থাকুন */ }
  }
  showScreen('home');
}

// ---------- ইভেন্ট ----------

function bindEvents() {
  $('btn-role-admin').addEventListener('click', () => showScreen('admin-start'));
  $('btn-role-emp').addEventListener('click', () => showScreen('emp-join'));
  document.querySelectorAll('[data-nav]').forEach(b => {
    b.addEventListener('click', () => showScreen(b.getAttribute('data-nav')));
  });
  $('btn-new-shop').addEventListener('click', () => showScreen('admin-create'));
  $('btn-open-shop').addEventListener('click', () => showScreen('admin-open'));
  $('btn-create-shop').addEventListener('click', createShop);
  $('btn-copy-code').addEventListener('click', async () => {
    const code = $('shop-code-display').textContent;
    try {
      await navigator.clipboard.writeText(code);
      toast('কোড কপি হয়েছে।');
    } catch (e) {
      toast('কপি করা যায়নি — কোডটি লিখে রাখুন: ' + code, true);
    }
  });
  $('btn-set-location').addEventListener('click', setLocation);
  $('btn-set-location-2').addEventListener('click', setLocation);
  $('btn-goto-admin-dash').addEventListener('click', loadAdminDash);
  $('btn-open-shop-go').addEventListener('click', openShop);
  $('btn-join-shop').addEventListener('click', joinShop);
  $('btn-checkin').addEventListener('click', () => doCheckInOut('in'));
  $('btn-checkout').addEventListener('click', () => doCheckInOut('out'));
  $('btn-add-advance').addEventListener('click', addAdvance);
  $('btn-mark-leave').addEventListener('click', markLeave);
  $('salary-month').addEventListener('change', renderSalary);
  $('btn-admin-logout').addEventListener('click', () => {
    localStorage.removeItem('dh_admin_shop');
    state.shopCode = null;
    state.shop = null;
    updateHeaderName();
    showScreen('home');
  });
  $('btn-emp-logout').addEventListener('click', () => {
    localStorage.removeItem('dh_emp');
    state.empId = null;
    state.employee = null;
    state.shopCode = null;
    state.shop = null;
    updateHeaderName();
    showScreen('home');
  });
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $('tab-' + tab.getAttribute('data-tab')).classList.add('active');
    });
  });
}

// ---------- শুরু ----------

async function init() {
  bindEvents();
  if (!isFirebaseConfigured) {
    $('config-warning').classList.remove('hidden');
    showScreen('home');
    return;
  }
  try {
    await initFirebase();
    await restoreSession();
  } catch (e) {
    console.error(e);
    toast('Firebase-এ সংযোগ করা যায়নি — ইন্টারনেট চেক করুন।', true);
    showScreen('home');
  }
}
init();
