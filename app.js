// ============================================================================
// JIMPITAN DIGITAL — app.js
// Ganti bagian FIREBASE_CONFIG dan ORG_NAME di bawah dengan milik desa Anda.
// Lihat README.md untuk cara membuat project Firebase gratis.
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc,
  query, where, orderBy, Timestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------------------------------------------------------------------------
// 1) KONFIGURASI — ganti dengan config project Firebase Anda sendiri
// Your web app's Firebase configuration
// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAQMJ57S3RtUFTsCzvsXxap7NGrJAAp974",
  authDomain: "jimpitan-klumprit.firebaseapp.com",
  projectId: "jimpitan-klumprit",
  storageBucket: "jimpitan-klumprit.firebasestorage.app",
  messagingSenderId: "271373093472",
  appId: "1:271373093472:web:0471ad3900464664c55105"
};

const ORG_NAME = "Ngudi Kamulyan"; // nama karang taruna / RT-RW Anda

document.getElementById("orgNameLabel").textContent = ORG_NAME;
document.getElementById("screenSub").textContent = "Karang Taruna " + ORG_NAME;

// Initialize Firebase (sekali saja)
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
let currentUser = null;      // { uid, name, email }
let houses = [];             // cache dari koleksi 'houses'
let unsubHouses = null;
let currentDetailHouseId = null;
let detailMonthCursor = new Date();
let rekapMonthCursor = new Date();
let scannedHouseId = null;
let stepDays = 1;
let html5QrInstance = null;

const RP = (n) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const pad2 = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthLabel = (d) => d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2400);
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const loginError = document.getElementById("loginError");

document.getElementById("showRegister").addEventListener("click", () => {
  loginForm.classList.add("hidden");
  document.getElementById("showRegister").classList.add("hidden");
  registerForm.classList.remove("hidden");
  document.getElementById("showLogin").classList.remove("hidden");
});
document.getElementById("showLogin").addEventListener("click", () => {
  registerForm.classList.add("hidden");
  document.getElementById("showLogin").classList.add("hidden");
  loginForm.classList.remove("hidden");
  document.getElementById("showRegister").classList.remove("hidden");
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = pesanErrorAuth(err);
    loginError.classList.remove("hidden");
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      name, email, role: "petugas", createdAt: Timestamp.now()
    });
  } catch (err) {
    loginError.textContent = pesanErrorAuth(err);
    loginError.classList.remove("hidden");
  }
});

document.getElementById("btnLogout").addEventListener("click", () => signOut(auth));

function pesanErrorAuth(err) {
  const map = {
    "auth/invalid-email": "Format email tidak valid.",
    "auth/user-not-found": "Akun tidak ditemukan.",
    "auth/wrong-password": "Kata sandi salah.",
    "auth/invalid-credential": "Email atau kata sandi salah.",
    "auth/email-already-in-use": "Email sudah terdaftar.",
    "auth/weak-password": "Kata sandi minimal 6 karakter.",
  };
  return map[err.code] || "Terjadi kesalahan. Coba lagi.";
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    let name = user.displayName;
    if (!name) {
      const snap = await getDoc(doc(db, "users", user.uid));
      name = snap.exists() ? snap.data().name : (user.email || "Petugas");
    }
    currentUser = { uid: user.uid, name, email: user.email };
    document.getElementById("screen-login").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    startHousesListener();
    goScreen("dashboard");
  } else {
    currentUser = null;
    if (unsubHouses) unsubHouses();
    document.getElementById("app").classList.add("hidden");
    document.getElementById("screen-login").classList.remove("hidden");
  }
});

// ---------------------------------------------------------------------------
// ROUTING (antar layar dalam app shell)
// ---------------------------------------------------------------------------
const SCREEN_TITLES = {
  dashboard: ["Jimpitan", "Karang Taruna " + ORG_NAME],
  rumah: ["Daftar Rumah", "Semua rumah terdaftar"],
  "detail-rumah": ["Data Rumah", "Riwayat per hari"],
  "tambah-rumah": ["Tambah Rumah", "Daftarkan rumah baru"],
  qr: ["QR Rumah", "Tempel di depan rumah"],
  scan: ["Scan Jimpitan", "Pindai QR warga"],
  rekap: ["Rekap Petugas", "Ringkasan periode"],
};

function goScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
  const [title, sub] = SCREEN_TITLES[name] || ["Jimpitan", ""];
  document.getElementById("screenTitle").textContent = title;
  document.getElementById("screenSub").textContent = sub;

  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.screen === name)
  );

  if (name === "scan") startScanner(); else stopScanner();
  if (name === "dashboard") renderDashboard();
  if (name === "rumah") renderRumahList();
  if (name === "rekap") renderRekap();
}

document.querySelectorAll(".nav-btn").forEach((btn) =>
  btn.addEventListener("click", () => goScreen(btn.dataset.screen))
);
document.querySelectorAll("[data-back]").forEach((btn) =>
  btn.addEventListener("click", () => goScreen(btn.dataset.back))
);
document.getElementById("btnGoScan").addEventListener("click", () => goScreen("scan"));
document.getElementById("btnGoTambahRumah").addEventListener("click", () => goScreen("tambah-rumah"));

// ---------------------------------------------------------------------------
// DATA: RUMAH (houses) — live listener
// ---------------------------------------------------------------------------
function startHousesListener() {
  const q = query(collection(db, "houses"), orderBy("nama"));
  unsubHouses = onSnapshot(q, (snap) => {
    houses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (document.getElementById("screen-dashboard").classList.contains("active")) renderDashboard();
    if (document.getElementById("screen-rumah").classList.contains("active")) renderRumahList();
    if (document.getElementById("screen-rekap").classList.contains("active")) renderRekap();
    populateManualSelect();
  });
}

async function getEntriesForHouse(houseId, fromDate, toDate) {
  const q = query(
    collection(db, "entries"),
    where("houseId", "==", houseId),
    where("dateKey", ">=", dateKey(fromDate)),
    where("dateKey", "<=", dateKey(toDate))
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getEntriesForRange(fromDate, toDate) {
  const q = query(
    collection(db, "entries"),
    where("dateKey", ">=", dateKey(fromDate)),
    where("dateKey", "<=", dateKey(toDate))
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// status rumah: Lancar jika kemarin ada entri, Terlewat jika tidak
async function computeStatus(houseId) {
  try {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const entries = await getEntriesForHouse(houseId, y, y);
    return entries.length > 0 ? "Lancar" : "Terlewat";
  } catch (err) {
    console.warn("computeStatus error untuk rumah", houseId, err);
    return "—";
  }
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------
async function renderDashboard() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEntries = await getEntriesForRange(first, now);
  const todayEntries = monthEntries.filter((e) => e.dateKey === dateKey(now));

  const totalBulan = monthEntries.reduce((s, e) => s + (e.nominal || 0), 0);
  const totalHariIni = todayEntries.reduce((s, e) => s + (e.nominal || 0), 0);

  document.getElementById("dashTotalBulan").textContent = RP(totalBulan);
  document.getElementById("dashHariIni").textContent = RP(totalHariIni);
  document.getElementById("dashRumahCount").textContent = houses.length;

  let terlewat = 0;
  for (const h of houses) {
    const st = await computeStatus(h.id);
    if (st === "Terlewat") terlewat++;
  }
  document.getElementById("dashTerlewat").textContent = terlewat;

  const recent = [...monthEntries]
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 8);
  const list = document.getElementById("dashRecentList");
  const empty = document.getElementById("dashEmptyState");
  list.innerHTML = "";
  empty.classList.toggle("hidden", recent.length > 0);
  recent.forEach((e) => {
    const house = houses.find((h) => h.id === e.houseId);
    const li = document.createElement("li");
    li.className = "ledger-row";
    li.innerHTML = `
      <span class="ledger-icon">✓</span>
      <span class="ledger-main">
        <strong>${escapeHtml(house ? house.nama : "Rumah")}</strong>
        <small>${e.petugasNama || "—"} · ${e.dateKey}</small>
      </span>
      <span class="badge badge-good">${RP(e.nominal)}</span>`;
    list.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// DAFTAR RUMAH
// ---------------------------------------------------------------------------
document.getElementById("searchRumah").addEventListener("input", renderRumahList);

async function renderRumahList() {
  try {
    const term = document.getElementById("searchRumah").value.trim().toLowerCase();
    const filtered = houses.filter((h) => (h.nama || "").toLowerCase().includes(term));
    document.getElementById("rumahCountLabel").textContent = `${houses.length} rumah`;

    const list = document.getElementById("rumahList");
    const empty = document.getElementById("rumahEmptyState");
    list.innerHTML = "";
    empty.classList.toggle("hidden", filtered.length > 0);

    // Render dulu semua rumah tanpa status (agar langsung muncul)
    const rows = [];
    for (const h of filtered) {
      const li = document.createElement("li");
      li.className = "ledger-row";
      li.innerHTML = `
        <span class="ledger-icon">⌂</span>
        <span class="ledger-main">
          <strong>${escapeHtml(h.nama)}</strong>
          <small>RT ${escapeHtml(h.rt || "—")} / RW ${escapeHtml(h.rw || "—")} · ${RP(h.tarif)}/hari</small>
        </span>
        <span class="badge badge-neutral" data-house-status="${h.id}">…</span>`;
      li.addEventListener("click", () => openDetailRumah(h.id));
      list.appendChild(li);
      rows.push(h);
    }

    // Kemudian update status secara async (tidak blocking tampilan)
    for (const h of rows) {
      computeStatus(h.id).then((status) => {
        const badge = list.querySelector(`[data-house-status="${h.id}"]`);
        if (badge) {
          badge.textContent = status;
          badge.className = `badge ${status === "Lancar" ? "badge-good" : status === "Terlewat" ? "badge-bad" : "badge-neutral"}`;
        }
      });
    }
  } catch (err) {
    console.error("renderRumahList error:", err);
  }
}

// ---------------------------------------------------------------------------
// TAMBAH RUMAH
// ---------------------------------------------------------------------------
document.getElementById("tambahRumahForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nama = document.getElementById("frNama").value.trim();
  const rt = document.getElementById("frRT").value.trim();
  const rw = document.getElementById("frRW").value.trim();
  const tarif = Number(document.getElementById("frTarif").value);

  const ref = await addDoc(collection(db, "houses"), {
    nama, rt, rw, tarif, createdAt: Timestamp.now()
  });
  toast("Rumah tersimpan");
  document.getElementById("tambahRumahForm").reset();
  document.getElementById("frTarif").value = 1000;
  openQR(ref.id, nama, `RT ${rt} / RW ${rw}`);
});

// ---------------------------------------------------------------------------
// DETAIL RUMAH (kalender per bulan)
// ---------------------------------------------------------------------------
async function openDetailRumah(houseId) {
  currentDetailHouseId = houseId;
  detailMonthCursor = new Date();
  goScreen("detail-rumah");
  const h = houses.find((x) => x.id === houseId);
  document.getElementById("detailNama").textContent = h ? h.nama : "—";
  document.getElementById("detailMeta").textContent = h ? `RT ${h.rt} / RW ${h.rw} · ${RP(h.tarif)}/hari` : "—";
  await renderDetailMonth();
}

document.getElementById("btnLihatQR").addEventListener("click", () => {
  const h = houses.find((x) => x.id === currentDetailHouseId);
  if (h) openQR(h.id, h.nama, `RT ${h.rt} / RW ${h.rw}`);
});
document.getElementById("detailPrevMonth").addEventListener("click", () => {
  detailMonthCursor.setMonth(detailMonthCursor.getMonth() - 1);
  renderDetailMonth();
});
document.getElementById("detailNextMonth").addEventListener("click", () => {
  detailMonthCursor.setMonth(detailMonthCursor.getMonth() + 1);
  renderDetailMonth();
});

async function renderDetailMonth() {
  document.getElementById("detailMonthLabel").textContent = monthLabel(detailMonthCursor);
  const y = detailMonthCursor.getFullYear();
  const m = detailMonthCursor.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const today = new Date();
  const lastToShow = (y === today.getFullYear() && m === today.getMonth()) ? today : last;

  const entries = await getEntriesForHouse(currentDetailHouseId, first, last);
  const byDate = {};
  entries.forEach((e) => (byDate[e.dateKey] = e));

  const list = document.getElementById("detailDayList");
  list.innerHTML = "";
  for (let d = new Date(first); d <= lastToShow; d.setDate(d.getDate() + 1)) {
    const key = dateKey(d);
    const entry = byDate[key];
    const li = document.createElement("li");
    li.className = "ledger-row";
    const tgl = d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
    if (entry) {
      li.innerHTML = `
        <span class="ledger-icon">✓</span>
        <span class="ledger-main"><strong>${tgl}</strong><small>Petugas: ${escapeHtml(entry.petugasNama || "—")}</small></span>
        <span class="badge badge-good">${RP(entry.nominal)}</span>`;
    } else {
      li.innerHTML = `
        <span class="ledger-icon">·</span>
        <span class="ledger-main"><strong>${tgl}</strong><small>Belum diambil</small></span>
        <span class="badge badge-bad">Belum diambil</span>`;
    }
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// QR RUMAH — generate & unduh
// ---------------------------------------------------------------------------
function openQR(houseId, nama, meta) {
  goScreen("qr");
  document.getElementById("qrNama").textContent = nama;
  document.getElementById("qrMeta").textContent = meta;
  const wrap = document.getElementById("qrCanvasWrap");
  wrap.innerHTML = "";
  // eslint-disable-next-line no-undef
  new QRCode(wrap, {
    text: houseId,
    width: 200,
    height: 200,
    colorDark: "#123B2C",
    colorLight: "#FFFFFF",
  });
  document.getElementById("btnUnduhQR").onclick = () => {
    const canvas = wrap.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `qr-${nama.replace(/\s+/g, "-")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };
  document.getElementById("btnCetakQR").onclick = () => window.print();
}

// ---------------------------------------------------------------------------
// SCAN QR
// ---------------------------------------------------------------------------
function populateManualSelect() {
  const sel = document.getElementById("manualHouseSelect");
  sel.innerHTML = houses.map((h) => `<option value="${h.id}">${escapeHtml(h.nama)}</option>`).join("");
}

async function startScanner() {
  const readerEl = document.getElementById("qrReader");
  const fallback = document.getElementById("scanFallback");
  // eslint-disable-next-line no-undef
  if (typeof Html5Qrcode === "undefined") {
    fallback.classList.remove("hidden");
    return;
  }
  try {
    // eslint-disable-next-line no-undef
    html5QrInstance = new Html5Qrcode("qrReader");
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) throw new Error("no-camera");
    await html5QrInstance.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 230 },
      (decodedText) => onScanSuccess(decodedText),
      () => { }
    );
  } catch (err) {
    fallback.classList.remove("hidden");
  }
}

function stopScanner() {
  if (html5QrInstance) {
    html5QrInstance.stop().then(() => html5QrInstance.clear()).catch(() => { });
    html5QrInstance = null;
  }
}

async function onScanSuccess(houseId) {
  stopScanner();
  openKonfirmasi(houseId);
}

document.getElementById("btnManualConfirm").addEventListener("click", () => {
  const id = document.getElementById("manualHouseSelect").value;
  if (id) openKonfirmasi(id);
});

// ---------------------------------------------------------------------------
// MODAL KONFIRMASI PENGAMBILAN
// ---------------------------------------------------------------------------
const modal = document.getElementById("modalKonfirmasi");

function openKonfirmasi(houseId) {
  const h = houses.find((x) => x.id === houseId);
  if (!h) { toast("Rumah tidak ditemukan"); return; }
  scannedHouseId = houseId;
  stepDays = 1;
  document.getElementById("modalHouseName").textContent = h.nama;
  document.getElementById("modalHouseMeta").textContent = `RT ${h.rt} / RW ${h.rw} · Pastikan nama rumah sudah benar`;
  updateStepUI();
  modal.classList.remove("hidden");
}

function updateStepUI() {
  document.getElementById("stepValue").textContent = stepDays;
  const h = houses.find((x) => x.id === scannedHouseId);
  const total = h ? h.tarif * stepDays : 0;
  document.getElementById("modalTotal").textContent = RP(total);
}

document.getElementById("stepMinus").addEventListener("click", () => {
  if (stepDays > 1) { stepDays--; updateStepUI(); }
});
document.getElementById("stepPlus").addEventListener("click", () => {
  if (stepDays < 14) { stepDays++; updateStepUI(); }
});
document.getElementById("btnCloseModal").addEventListener("click", closeModal);
document.getElementById("btnBatalModal").addEventListener("click", closeModal);
function closeModal() {
  modal.classList.add("hidden");
  if (document.getElementById("screen-scan").classList.contains("active")) startScanner();
}

document.getElementById("btnSimpanModal").addEventListener("click", async () => {
  const h = houses.find((x) => x.id === scannedHouseId);
  if (!h) return;
  const btn = document.getElementById("btnSimpanModal");
  btn.disabled = true;
  try {
    for (let i = 0; i < stepDays; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      await setDoc(doc(db, "entries", `${h.id}_${key}`), {
        houseId: h.id,
        dateKey: key,
        nominal: h.tarif,
        petugasId: currentUser.uid,
        petugasNama: currentUser.name,
        createdAt: Timestamp.now(),
      });
    }
    toast(`Tersimpan · ${RP(h.tarif * stepDays)}`);
    modal.classList.add("hidden");
    goScreen("dashboard");
  } catch (err) {
    toast("Gagal menyimpan. Coba lagi.");
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// REKAP PETUGAS
// ---------------------------------------------------------------------------
document.getElementById("rekapPrevMonth").addEventListener("click", () => {
  rekapMonthCursor.setMonth(rekapMonthCursor.getMonth() - 1);
  renderRekap();
});
document.getElementById("rekapNextMonth").addEventListener("click", () => {
  rekapMonthCursor.setMonth(rekapMonthCursor.getMonth() + 1);
  renderRekap();
});

async function renderRekap() {
  document.getElementById("rekapMonthLabel").textContent = monthLabel(rekapMonthCursor);
  const y = rekapMonthCursor.getFullYear();
  const m = rekapMonthCursor.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const entries = await getEntriesForRange(first, last);

  const totalNominal = entries.reduce((s, e) => s + (e.nominal || 0), 0);
  const rumahUnik = new Set(entries.map((e) => e.houseId));
  document.getElementById("rekapTransaksi").textContent = entries.length;
  document.getElementById("rekapRumah").textContent = rumahUnik.size;
  document.getElementById("rekapNominal").textContent = RP(totalNominal);

  const byPetugas = {};
  entries.forEach((e) => {
    const key = e.petugasId || "?";
    if (!byPetugas[key]) byPetugas[key] = { nama: e.petugasNama || "—", transaksi: 0, rumah: new Set(), nominal: 0 };
    byPetugas[key].transaksi++;
    byPetugas[key].rumah.add(e.houseId);
    byPetugas[key].nominal += e.nominal || 0;
  });

  const list = document.getElementById("rekapPetugasList");
  const empty = document.getElementById("rekapEmptyState");
  list.innerHTML = "";
  const rows = Object.values(byPetugas).sort((a, b) => b.nominal - a.nominal);
  empty.classList.toggle("hidden", rows.length > 0);
  rows.forEach((p) => {
    const li = document.createElement("li");
    li.className = "ledger-row";
    li.innerHTML = `
      <span class="ledger-icon">${escapeHtml(p.nama[0] || "?").toUpperCase()}</span>
      <span class="ledger-main">
        <strong>${escapeHtml(p.nama)}</strong>
        <small>${p.transaksi} transaksi · ${p.rumah.size} rumah</small>
      </span>
      <span class="badge badge-neutral">${RP(p.nominal)}</span>`;
    list.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// UTIL
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
