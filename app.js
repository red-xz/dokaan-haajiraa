// Shop Attendance — main app (Firebase + Firestore)
// Firebase v10 modular SDK, loaded from CDN (when configured).
// Data model:
//   shops/{shopCode}                                  — shop (name, location)
//   shops/{shopCode}/employees/{empId}                — employee (name, phone, monthly salary)
//   shops/{shopCode}/attendance/{empId_YYYY-MM-DD}    — attendance (present/absent/leave)
//   shops/{shopCode}/advances/{advId}                 — advance (employee, money, date)

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';
import {
  toBn, toBnMoney, haversineMeters, generateShopCode,
  dateStr, monthStr, daysInMonth, computeMonthlySummary, fmtTime,
  CHECKIN_RADIUS_METERS
} from './utils.js';

let db = null;      // Firestore
let auth = null;    // Firebase Auth
let user = null;    // anonymous user
let fb = null;      // Firebase modules (loaded when configured)

const state = {
  role: null, shopCode: null, shop: null,
  empId: null, employee: null, employees: []
};

const $ = id => document.getElementById(id);
const screens = ['home', 'admin-start', 'admin-create', 'admin-open', 'admin-dash', 'emp-join', 'emp-dash'];
const DEFAULT_HEADER_NAME = 'Employee Attendance & Salary';

// Show the shop name in the header — the shop's own name when one is open,
// otherwise the generic text (each shop owner sees their own shop's name)
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

// No data work is possible without Firebase — say so clearly
function needFirebase() {
  if (!isFirebaseConfigured) {
    toast('Firebase is not set up yet — ask the admin to add the config.', true);
    return false;
  }
  if (!user) {
    toast('Logging in, please wait…', true);
    return false;
  }
  return true;
}

// ---------- Firebase init ----------

async function initFirebase() {
  // Only load the SDK when configured (initializeApp would fail with placeholders)
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

// ---------- Firestore references ----------

const shopRef = code => fb.doc(db, 'shops', code);
const empsCol = code => fb.collection(db, 'shops', code, 'employees');
const attCol = code => fb.collection(db, 'shops', code, 'attendance');
const advCol = code => fb.collection(db, 'shops', code, 'advances');
const attDoc = (code, empId, date) => fb.doc(db, 'shops', code, 'attendance', `${empId}_${date}`);

// ---------- Location ----------

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('This browser does not support location.'));
    }
    navigator.geolocation.getCurrentPosition(resolve, err => {
      if (err.code === 1) reject(new Error('Location permission was not granted — allow it in your browser settings.'));
      else reject(new Error('Could not get your location — try again.'));
    }, { enableHighAccuracy: true, timeout: 15000 });
  });
}

// ---------- Admin: open shop ----------

async function createShop() {
  if (!needFirebase()) return;
  const name = $('input-shop-name').value.trim();
  if (!name) return toast('Please enter the shop name.', true);
  // Generate a unique code (retry if it already exists)
  let code, exists = true, tries = 0;
  while (exists && tries < 10) {
    code = generateShopCode();
    const snap = await fb.getDoc(shopRef(code));
    exists = snap.exists();
    tries++;
  }
  if (exists) return toast('Could not generate a code — try again.', true);
  await fb.setDoc(shopRef(code), { name, location: null, createdAt: fb.serverTimestamp() });
  state.shopCode = code;
  state.shop = { name, location: null };
  updateHeaderName();
  localStorage.setItem('dh_admin_shop', code);
  $('shop-code-display').textContent = code;
  $('shop-code-box').classList.remove('hidden');
  $('location-box').classList.remove('hidden');
  $('btn-goto-admin-dash').classList.remove('hidden');
  toast('Shop opened! Now set the shop location.');
}

async function openShop() {
  if (!needFirebase()) return;
  const code = $('input-open-code').value.trim().toUpperCase();
  if (!code) return toast('Please enter the shop code.', true);
  const snap = await fb.getDoc(shopRef(code));
  if (!snap.exists()) return toast('No shop found with this code.', true);
  state.shopCode = code;
  state.shop = snap.data();
  localStorage.setItem('dh_admin_shop', code);
  await loadAdminDash();
}

// Set the shop location (must be done standing at the shop)
async function setLocation() {
  if (!needFirebase()) return;
  toast('Getting location…');
  try {
    const pos = await getPosition();
    const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    await fb.updateDoc(shopRef(state.shopCode), { location: loc });
    state.shop.location = loc;
    $('location-status').textContent = `Location set: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
    updateAdminHeader();
    toast('Shop location set.');
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- Admin: dashboard ----------

function updateAdminHeader() {
  $('admin-shop-title').textContent = state.shop ? state.shop.name : '';
  $('admin-shop-code').textContent = state.shopCode || '';
  $('admin-location-status').textContent =
    state.shop && state.shop.location ? 'Location set ✓' : 'Location not set';
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

// Today's attendance + notices (who came when)
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
      html += `<div class="row"><span>${emp.name}</span><span class="badge ok">Present • ${t}</span></div>`;
      notices.push({ name: emp.name, time: rec.checkIn && rec.checkIn.toDate ? rec.checkIn.toDate() : null });
    } else if (rec && rec.status === 'leave') {
      html += `<div class="row"><span>${emp.name}</span><span class="badge warn">Leave</span></div>`;
    } else {
      html += `<div class="row"><span>${emp.name}</span><span class="badge bad">Not here yet</span></div>`;
    }
  }
  $('today-list').innerHTML = html || '<p class="muted">No employee has joined yet.</p>';
  notices.sort((a, b) => (a.time || 0) - (b.time || 0));
  $('notice-list').innerHTML = notices.length
    ? notices.map(n => `<div class="row"><span>🔔 ${n.name} arrived at the shop</span><span class="muted">${n.time ? fmtTime(n.time) : ''}</span></div>`).join('')
    : '<p class="muted">Nobody has marked attendance today yet.</p>';
}

// Employee list + set salary
function renderEmployees() {
  $('employee-list').innerHTML = state.employees.length
    ? state.employees.map(emp => `
      <div class="emp-card">
        <div><b>${emp.name}</b><br><span class="muted">${toBn(emp.phone || '')}</span></div>
        <div class="salary-edit">
          <label>Monthly salary (Taka)</label>
          <input type="number" min="0" value="${emp.monthlySalary || 0}" data-salary-for="${emp.id}">
          <button class="btn small" data-save-salary="${emp.id}">Save</button>
        </div>
      </div>`).join('')
    : '<p class="muted">No employee has joined yet.</p>';

  document.querySelectorAll('[data-save-salary]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-save-salary');
      const input = document.querySelector(`[data-salary-for="${id}"]`);
      const salary = Number(input.value) || 0;
      await fb.updateDoc(fb.doc(db, 'shops', state.shopCode, 'employees', id), { monthlySalary: salary });
      const emp = state.employees.find(e => e.id === id);
      if (emp) emp.monthlySalary = salary;
      toast(`Salary for ${emp ? emp.name : ''} set to ${toBnMoney(salary)} Taka.`);
      await renderSalary();
    });
  });
}

// Monthly salary table (everyone)
async function renderSalary() {
  const ym = $('salary-month').value;
  if (!ym) return;
  const [year, month1] = ym.split('-').map(Number);
  const monthIndex0 = month1 - 1;
  const start = `${ym}-01`;
  const end = `${ym}-${String(daysInMonth(year, monthIndex0)).padStart(2, '0')}`;
  // Fetch one month's attendance/advances in one go and split per employee in JS
  // (so no Firestore composite index is needed)
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
        <span>Monthly salary</span><b>${toBnMoney(emp.monthlySalary || 0)} Taka</b>
        <span>Daily wage</span><span>${toBnMoney(s.dailyWage)} Taka</span>
        <span>Present</span><span>${toBn(s.present)} days</span>
        <span>Fridays (paid holiday)</span><span>${toBn(s.fridays)} days</span>
        <span>Leave</span><span>${toBn(s.leave)} days</span>
        <span>Absent</span><span>${toBn(s.absent)} days</span>
        <span>Deduction</span><span>${toBnMoney(s.deduction)} Taka</span>
        <span>Advances taken</span><span>${toBnMoney(s.advanceTotal)} Taka</span>
        <span><b>Payable (due)</b></span><b class="payable">${toBnMoney(s.payable)} Taka</b>
      </div>
      ${s.overAdvance ? `<p class="muted small">Advance taken in excess: ${toBnMoney(s.overAdvance)} Taka</p>` : ''}
    </div>`;
  }
  $('salary-table').innerHTML = rows || '<p class="muted">No employees.</p>';
}

function fillAdvanceSelects() {
  const opts = state.employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  $('advance-emp').innerHTML = opts;
  $('leave-emp').innerHTML = opts;
}

// Add an advance
async function addAdvance() {
  if (!needFirebase()) return;
  const empId = $('advance-emp').value;
  const amount = Number($('advance-amount').value);
  const note = $('advance-note').value.trim();
  if (!empId) return toast('Please choose an employee.', true);
  if (!amount || amount <= 0) return toast('Please enter a valid amount.', true);
  await fb.addDoc(advCol(state.shopCode), {
    empId, amount, note, date: dateStr(new Date()), createdAt: fb.serverTimestamp()
  });
  toast('Advance added.');
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
    ? '<h4>Advances this month</h4>' + items.map(a => {
      const emp = state.employees.find(e => e.id === a.empId);
      return `<div class="row"><span>${emp ? emp.name : ''} — ${toBn(a.date)}</span><b>${toBnMoney(a.amount)} Taka</b></div>`;
    }).join('')
    : '<p class="muted">No advances this month.</p>';
}

// Mark leave
async function markLeave() {
  if (!needFirebase()) return;
  const empId = $('leave-emp').value;
  const date = $('leave-date').value;
  if (!empId || !date) return toast('Please choose an employee and a date.', true);
  await fb.setDoc(attDoc(state.shopCode, empId, date), { empId, date, status: 'leave' }, { merge: true });
  toast('Leave marked.');
  await renderToday();
  await renderSalary();
}

// ---------- Salesman: join ----------

async function joinShop() {
  if (!needFirebase()) return;
  const code = $('input-join-code').value.trim().toUpperCase();
  const name = $('input-join-name').value.trim();
  const phone = $('input-join-phone').value.trim();
  if (!code || !name || !phone) return toast('Please enter the code, name and mobile number — all of them.', true);
  const snap = await fb.getDoc(shopRef(code));
  if (!snap.exists()) return toast('No shop found with this code.', true);
  const ref = await fb.addDoc(empsCol(code), {
    name, phone, monthlySalary: 0, joinedAt: fb.serverTimestamp()
  });
  state.shopCode = code;
  state.shop = snap.data();
  state.empId = ref.id;
  state.employee = { id: ref.id, name, phone, monthlySalary: 0 };
  localStorage.setItem('dh_emp', JSON.stringify({ shopCode: code, empId: ref.id }));
  await loadEmpDash();
  toast('You have joined the shop!');
}

// ---------- Salesman: dashboard ----------

async function loadEmpDash() {
  $('emp-greeting').textContent = `Hello, ${state.employee.name}!`;
  $('emp-shop-line').textContent = `${state.shop.name} • Code: ${state.shopCode}`;
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
    box.innerHTML = `<b>Today:</b> Attendance marked (${inT})` +
      (outT ? `<br>Checked out (${outT})` : '<br>Not checked out yet.');
  } else if (snap.exists() && snap.data().status === 'leave') {
    box.innerHTML = '<b>Today:</b> You are on leave today.';
  } else {
    box.innerHTML = '<b>Today:</b> Attendance not marked yet.';
  }
}

// Check in / check out with GPS verification
async function doCheckInOut(kind) {
  if (!needFirebase()) return;
  if (!state.shop.location) {
    return toast('The shop location is not set yet — ask the shop owner to set the location.', true);
  }
  toast('Verifying location…');
  try {
    const pos = await getPosition();
    const dist = haversineMeters(
      pos.coords.latitude, pos.coords.longitude,
      state.shop.location.lat, state.shop.location.lng
    );
    if (dist > CHECKIN_RADIUS_METERS) {
      $('emp-location-msg').textContent = `You are ${toBn(Math.round(dist))} metres from the shop.`;
      return toast(`You are ${toBn(Math.round(dist))} metres from the shop. Come within ${toBn(CHECKIN_RADIUS_METERS)} metres and try again.`, true);
    }
    $('emp-location-msg').textContent = `Distance from shop: ${toBn(Math.round(dist))} metres.`;
    const today = dateStr(new Date());
    const ref = attDoc(state.shopCode, state.empId, today);
    if (kind === 'in') {
      await fb.setDoc(ref, {
        empId: state.empId, date: today, status: 'present',
        checkIn: fb.serverTimestamp(),
        checkInLat: pos.coords.latitude, checkInLng: pos.coords.longitude
      }, { merge: true });
      toast('Attendance marked. Have a good day!');
    } else {
      const snap = await fb.getDoc(ref);
      if (!snap.exists() || snap.data().status !== 'present') {
        return toast('Mark your attendance first, then you can check out.', true);
      }
      await fb.setDoc(ref, { checkOut: fb.serverTimestamp() }, { merge: true });
      toast('Checked out. Goodbye!');
    }
    await refreshEmpToday();
  } catch (e) {
    toast(e.message, true);
  }
}

// Salesman's own account for this month
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
      <span>Monthly salary</span><b>${toBnMoney(state.employee.monthlySalary || 0)} Taka</b>
      <span>Present</span><span>${toBn(s.present)} days</span>
      <span>Absent</span><span>${toBn(s.absent)} days</span>
      <span>Leave</span><span>${toBn(s.leave)} days</span>
      <span>Advances taken</span><span>${toBnMoney(s.advanceTotal)} Taka</span>
      <span><b>You will get this month</b></span><b class="payable">${toBnMoney(s.payable)} Taka</b>
    </div>`;
}

// ---------- Restore previous session ----------

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
    } catch (e) { /* stay quietly on home */ }
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
    } catch (e) { /* stay quietly on home */ }
  }
  showScreen('home');
}

// ---------- Events ----------

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
      toast('Code copied.');
    } catch (e) {
      toast('Could not copy — write the code down: ' + code, true);
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

// ---------- Start ----------

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
    toast('Could not connect to Firebase — check your internet.', true);
    showScreen('home');
  }
}
init();
