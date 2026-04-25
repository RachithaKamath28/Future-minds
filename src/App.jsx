import { useState, useEffect, useRef } from "react";
import QR from "qrcode";

// ══════════════════════════════════════════════════════════════════════════════
// BLOCKCHAIN LEDGER — persisted to localStorage, images excluded from chain
// ══════════════════════════════════════════════════════════════════════════════
const CHAIN_KEY = "ayurtrace_blockchain_v1";
const USERS_KEY = "ayurtrace_users_v1";

function djb2Hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return "0x" + (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function computeBlockHash(index, prevHash, timestamp, data) {
  return djb2Hash(`${index}|${prevHash}|${timestamp}|${JSON.stringify(data)}`);
}

const GENESIS_BLOCK = {
  index: 0,
  prevHash: "0x00000000",
  hash: "0xGENESIS0",
  timestamp: "2025-01-01T00:00:00.000Z",
  type: "GENESIS",
  data: { event: "AyurTrace Chain Initialized", actor: "System" },
};
GENESIS_BLOCK.hash = computeBlockHash(0, "0x00000000", GENESIS_BLOCK.timestamp, GENESIS_BLOCK.data);

// Strip image data before storing on chain
function sanitizeForChain(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForChain);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "imageDataUrl" || k === "imagePreviewUrl" || k === "imageName") continue;
    out[k] = sanitizeForChain(v);
  }
  return out;
}

const Blockchain = {
  _chain: null,
  _users: null,

  _loadChain() {
    if (this._chain) return this._chain;
    try {
      const raw = localStorage.getItem(CHAIN_KEY);
      if (raw) { const c = JSON.parse(raw); if (Array.isArray(c) && c.length) { this._chain = c; return c; } }
    } catch { /* ignore */ }
    this._chain = [GENESIS_BLOCK];
    this._save();
    return this._chain;
  },

  _loadUsers() {
    if (this._users) return this._users;
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (raw) { const u = JSON.parse(raw); if (u && typeof u === "object") { this._users = u; return u; } }
    } catch { /* ignore */ }
    this._users = {};
    return this._users;
  },

  _save() {
    try { localStorage.setItem(CHAIN_KEY, JSON.stringify(this._chain)); } catch { /* ignore */ }
  },
  _saveUsers() {
    try { localStorage.setItem(USERS_KEY, JSON.stringify(this._users)); } catch { /* ignore */ }
  },

  _addBlock(type, data, actor) {
    const chain = this._loadChain();
    const prev = chain[chain.length - 1];
    const timestamp = new Date().toISOString();
    const cleanData = sanitizeForChain({ ...data, type, actor });
    const index = chain.length;
    const hash = computeBlockHash(index, prev.hash, timestamp, cleanData);
    const block = { index, prevHash: prev.hash, hash, timestamp, type, actor, data: cleanData };
    chain.push(block);
    this._save();
    return block;
  },

  // ── Public API ──────────────────────────────────────────────────────────────

  registerUser(role, formData) {
    const users = this._loadUsers();
    const userId = `USR_${djb2Hash(`${role}|${formData.email || ""}|${Date.now()}|${Math.random()}`).slice(2)}`;
    const userData = sanitizeForChain({ userId, role, ...formData, registeredAt: new Date().toISOString() });
    users[userId] = userData;
    this._saveUsers();
    const block = this._addBlock("USER_REGISTRATION", userData, formData.name || role);
    return { userId, block };
  },

  addProduct(productData, actorName) {
    return this._addBlock("PRODUCT_ADDED", sanitizeForChain(productData), actorName || "Farmer");
  },

  updateProductStage(productId, productName, stage, stageDetails, actorName) {
    return this._addBlock("STAGE_UPDATE", sanitizeForChain({ productId, productName, stage, ...stageDetails }), actorName || "Merchant");
  },

  recordSupplyChainEvent(productId, herb, batch, stageName, actor, location, notes) {
    return this._addBlock("SUPPLY_CHAIN_EVENT", sanitizeForChain({ productId, herb, batch, stageName, actor, location, notes }), actor);
  },

  getChain() { return this._loadChain(); },

  getUsers() { return this._loadUsers(); },

  verifyChain() {
    const chain = this._loadChain();
    for (let i = 1; i < chain.length; i++) {
      const b = chain[i];
      const expected = computeBlockHash(b.index, b.prevHash, b.timestamp, b.data);
      if (b.hash !== expected) return { valid: false, failedAt: i };
      if (b.prevHash !== chain[i - 1].hash) return { valid: false, failedAt: i };
    }
    return { valid: true, blocks: chain.length };
  },

  getProductHistory(productId) {
    return this._loadChain().filter(b =>
      b.data?.productId === productId ||
      b.data?.id === productId
    );
  },
};

const C = {
  bg: "#0D1F0F", surface: "#132615", card: "#1A3320", border: "#2A5535",
  accent: "#5EBF7A", gold: "#C9A84C", teal: "#3EBFB0", text: "#D6EDD8",
  muted: "#7BA882", danger: "#E05C5C", deep: "#0A1A0C",
};

const STORAGE_KEY = "ayurtrace_products_v1";
const IMAGE_MAP_KEY = "ayurtrace_product_images_v1";

function uidFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = (h ^ str.charCodeAt(i)) * 16777619;
  return (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function makeProductId(seed = "") {
  const salt = `${seed}|${Date.now()}|${Math.random()}`;
  return `AYR_${uidFrom(salt)}`;
}

function seedToProductId(seed = "") {
  return `AYR_${uidFrom(seed)}`;
}

function loadStoredProducts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadImageMap() {
  try {
    const raw = localStorage.getItem(IMAGE_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveImageMap(map) {
  try {
    localStorage.setItem(IMAGE_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function saveStoredProducts(products) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
  } catch {
    // ignore
  }
}

function syncImageMapFromProducts(products) {
  if (!Array.isArray(products) || !products.length) return;
  const map = loadImageMap();
  let changed = false;
  const next = { ...map };
  for (const p of products) {
    if (!p?.productId || !p?.imageDataUrl) continue;
    const k = String(p.productId);
    if (next[k] !== p.imageDataUrl) {
      next[k] = p.imageDataUrl;
      changed = true;
    }
  }
  if (changed) saveImageMap(next);
}

function persistProductList(products) {
  saveStoredProducts(products);
  syncImageMapFromProducts(products);
}

function enrichProductImageFromMap(p) {
  if (!p?.productId) return p;
  if (p.imageDataUrl) return p;
  const map = loadImageMap();
  const fromMap = map[String(p.productId)];
  if (!fromMap) return p;
  return { ...p, imageDataUrl: fromMap };
}

function hashBlock(data, prev) {
  let h = 5381; const s = JSON.stringify(data) + prev;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return "0x" + (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
const GENESIS = { index: 0, hash: "0x00000000", prevHash: "GENESIS", timestamp: new Date("2025-01-01").toISOString(), data: { event: "Chain Initialized", actor: "System" } };

const SEED_PRODUCTS = [
  { id: "AYU-2025-001", productId: seedToProductId("AYU-2025-001"), herb: "Ashwagandha", batch: "ASH-B01", status: "In Transit", currentStage: 2, stages: [
    { name: "Herb Collection", actor: "Rajan Farms", role: "Farmer", location: { lat: 24.58, lng: 73.68, label: "Udaipur, Rajasthan" }, timestamp: "2025-02-10T06:30:00", verified: true, notes: "Wildcrafted at 600m elevation, organic certified" },
    { name: "Processing & Drying", actor: "AyurProcess Ltd", role: "Processor", location: { lat: 22.72, lng: 75.86, label: "Indore, MP" }, timestamp: "2025-02-18T09:00:00", verified: true, notes: "Sun-dried, moisture < 8%, heavy metal tested" },
    { name: "Quality Testing", actor: "HerbalLab QA", role: "Lab", location: { lat: 18.52, lng: 73.86, label: "Pune, Maharashtra" }, timestamp: "2025-02-25T11:00:00", verified: true, notes: "HPLC: Withanolide 4.2%, microbiological PASS" },
    { name: "Manufacturing", actor: "Vaidya Pharma", role: "Manufacturer", location: { lat: 12.97, lng: 77.59, label: "Bengaluru, Karnataka" }, timestamp: "2025-03-05T08:00:00", verified: false, notes: "GMP facility, batch encapsulated" },
  ]},
  { id: "AYU-2025-002", productId: seedToProductId("AYU-2025-002"), herb: "Brahmi", batch: "BRM-B03", status: "Delivered", currentStage: 3, stages: [
    { name: "Herb Collection", actor: "Kerala Wildcraft Co.", role: "Collector", location: { lat: 9.94, lng: 76.27, label: "Kottayam, Kerala" }, timestamp: "2025-01-05T07:00:00", verified: true, notes: "Riparian harvest, GPS-tagged patch #KL-047" },
    { name: "Processing & Drying", actor: "SouthHerb Process", role: "Processor", location: { lat: 10.53, lng: 76.21, label: "Thrissur, Kerala" }, timestamp: "2025-01-14T10:00:00", verified: true, notes: "Shade-dried 5 days, cleaned & sorted" },
    { name: "Quality Testing", actor: "HerbalLab QA", role: "Lab", location: { lat: 13.08, lng: 80.27, label: "Chennai, Tamil Nadu" }, timestamp: "2025-01-20T14:00:00", verified: true, notes: "Bacosides A+B: 22.3%, aflatoxin negative" },
    { name: "Manufacturing", actor: "NaturaVed Inc.", role: "Manufacturer", location: { lat: 19.07, lng: 72.87, label: "Mumbai, Maharashtra" }, timestamp: "2025-02-01T09:00:00", verified: true, notes: "Syrup formulation, bottled & labelled" },
  ]},
  { id: "AYU-2025-003", productId: seedToProductId("AYU-2025-003"), herb: "Turmeric", batch: "TUR-C02", status: "Pending QA", currentStage: 1, stages: [
    { name: "Herb Collection", actor: "Erode Spice Collective", role: "Farmer", location: { lat: 11.34, lng: 77.72, label: "Erode, Tamil Nadu" }, timestamp: "2025-03-01T07:30:00", verified: true, notes: "Certified organic, Lakadong variety" },
    { name: "Processing & Drying", actor: "SpiceForm Mills", role: "Processor", location: { lat: 11.00, lng: 77.01, label: "Coimbatore, Tamil Nadu" }, timestamp: "2025-03-10T08:00:00", verified: false, notes: "Boiled, dried, polished – curcumin assay pending" },
  ]},
];

function buildChain(products) {
  const chain = [GENESIS];
  products.forEach(p => p.stages.forEach(s => {
    const prev = chain[chain.length - 1].hash;
    const data = { productId: p.id, batch: p.batch, stage: s.name, actor: s.actor, location: s.location.label, ts: s.timestamp };
    chain.push({ index: chain.length, prevHash: prev, hash: hashBlock(data, prev), timestamp: s.timestamp, data });
  }));
  return chain;
}

// Seed demo supply chain events into Blockchain once (idempotent — checks first block)
(function seedBlockchainOnce() {
  const chain = Blockchain.getChain();
  if (chain.length > 1) return; // already seeded
  SEED_PRODUCTS.forEach(p => {
    Blockchain.addProduct({ id: p.id, productId: p.productId, herb: p.herb, batch: p.batch, status: p.status }, "System");
    p.stages.forEach(s => {
      Blockchain.recordSupplyChainEvent(p.id, p.herb, p.batch, s.name, s.actor, s.location.label, s.notes);
    });
  });
})();

const roleColor = r => ({ Farmer: "#5EBF7A", Collector: "#3EBFB0", Processor: "#C9A84C", Lab: "#A37FE8", Manufacturer: "#E0895C" }[r] || "#7BA882");
const stageIcon = n => n.includes("Collection") ? "🌿" : n.includes("Process") ? "⚙️" : (n.includes("Quality") || n.includes("Test")) ? "🔬" : n.includes("Manufactur") ? "🏭" : "📦";
const statusBadge = s => ({ "Delivered": { bg: "#1A3D25", color: C.accent, label: "✓ Delivered" }, "In Transit": { bg: "#2A3020", color: C.gold, label: "⟳ In Transit" }, "Pending QA": { bg: "#2A2020", color: "#E08860", label: "⚠ Pending QA" } }[s] || { bg: C.card, color: C.muted, label: s });

function MiniMap({ stages }) {
  const W = 300, H = 150;
  const lats = stages.map(s => s.location.lat), lngs = stages.map(s => s.location.lng);
  const minLat = Math.min(...lats) - 1, maxLat = Math.max(...lats) + 1, minLng = Math.min(...lngs) - 1, maxLng = Math.max(...lngs) + 1;
  const px = lng => ((lng - minLng) / (maxLng - minLng)) * (W - 30) + 15;
  const py = lat => (1 - (lat - minLat) / (maxLat - minLat)) * (H - 30) + 15;
  const pts = stages.map(s => ({ x: px(s.location.lng), y: py(s.location.lat), ...s }));
  return (
    <svg width={W} height={H} style={{ background: C.deep, borderRadius: 8, border: `1px solid ${C.border}` }}>
      {[...Array(5)].map((_, i) => <line key={i} x1={0} y1={i * H / 4} x2={W} y2={i * H / 4} stroke="#1A3320" strokeWidth={1} />)}
      {pts.map((p, i) => i > 0 && <line key={i} x1={pts[i-1].x} y1={pts[i-1].y} x2={p.x} y2={p.y} stroke={C.accent} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.6} />)}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={7} fill={p.verified ? C.accent : C.gold} opacity={0.9} />
          <circle cx={p.x} cy={p.y} r={12} fill="none" stroke={p.verified ? C.accent : C.gold} strokeWidth={1} opacity={0.3} />
          <text x={p.x} y={p.y - 14} textAnchor="middle" fill={C.text} fontSize={9} fontFamily="monospace">{p.location.label.split(",")[0]}</text>
        </g>
      ))}
    </svg>
  );
}

function QRCode({ value, size = 140, showValue = false }) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const url = await QR.toDataURL(String(value || ""), {
          width: size,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#0D1F0F", light: "#ffffff" },
        });
        if (alive) setDataUrl(url);
      } catch {
        if (alive) setDataUrl("");
      }
    })();
    return () => { alive = false; };
  }, [value, size]);

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ width: size, height: size, background: "#fff", borderRadius: 6, border: "1px solid #e6e7e3", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {dataUrl ? (
          <img src={dataUrl} alt="QR" style={{ width: size, height: size, display: "block" }} />
        ) : (
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#6b746a" }}>Generating…</div>
        )}
      </div>
      {showValue && (
        <div style={{ fontFamily: "monospace", fontSize: 12, color: "#223322" }}>
          {String(value || "")}
        </div>
      )}
    </div>
  );
}

function BlockCard({ block }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontFamily: "monospace", fontSize: 11, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ color: C.accent }}>#{block.index.toString().padStart(3, "0")}</span>
        <span style={{ color: C.muted }}>{new Date(block.timestamp).toLocaleDateString()}</span>
      </div>
      <div style={{ color: C.gold, marginBottom: 2 }}>{block.hash}</div>
      <div style={{ color: C.muted, fontSize: 10 }}>prev: {block.prevHash}</div>
      <div style={{ color: C.text, marginTop: 4 }}>{block.data.event ? block.data.event : `${block.data.productId} · ${block.data.stage}`}</div>
    </div>
  );
}

function Field({ label, type = "text", placeholder, value, onChange }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 10, color: C.muted, fontFamily: "monospace", letterSpacing: "1.5px", marginBottom: 5 }}>{label}</label>
      <input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        style={{ width: "100%", background: C.deep, border: `1px solid ${C.border}`, color: C.text, padding: "9px 13px", borderRadius: 6, fontSize: 13, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }}
        onFocus={e => e.target.style.borderColor = C.accent}
        onBlur={e => e.target.style.borderColor = C.border} />
    </div>
  );
}

// ── LANDING PAGE ─────────────────────────────────────────────────────────────
function LandingPage({ onNavigate }) {
  const [hov, setHov] = useState(null);
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Crimson Pro', Georgia, serif", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes pulse { 0%,100%{opacity:.15} 50%{opacity:.35} }
      `}</style>

      {/* Floating particles */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {[...Array(18)].map((_, i) => (
          <div key={i} style={{ position: "absolute", borderRadius: "50%", width: (i % 3) + 2, height: (i % 3) + 2, background: i % 2 === 0 ? C.accent : C.teal, left: `${(i * 53 + 11) % 100}%`, top: `${(i * 37 + 5) % 100}%`, animation: `pulse ${3 + i % 3}s ease-in-out ${i * 0.3}s infinite` }} />
        ))}
      </div>

      {/* Header */}
      <header style={{ position: "relative", zIndex: 2, padding: "18px 48px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}`, background: `${C.surface}dd`, backdropFilter: "blur(8px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 34 }}>🌿</span>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, color: C.accent, letterSpacing: "-1px" }}>AyurTrace</div>
            <div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace", letterSpacing: "3px" }}>BLOCKCHAIN SUPPLY CHAIN</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => onNavigate("login")} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.text, padding: "9px 24px", borderRadius: 7, cursor: "pointer", fontSize: 14, fontFamily: "'Crimson Pro', serif", transition: "all .2s" }}
            onMouseEnter={e => { e.target.style.borderColor = C.accent; e.target.style.color = C.accent; }}
            onMouseLeave={e => { e.target.style.borderColor = C.border; e.target.style.color = C.text; }}>
            Sign In
          </button>
          <button onClick={() => onNavigate("signup")} style={{ background: C.accent, border: "none", color: C.bg, padding: "9px 24px", borderRadius: 7, cursor: "pointer", fontSize: 14, fontFamily: "'Crimson Pro', serif", fontWeight: 700 }}>
            Get Started
          </button>
        </div>
      </header>

      {/* Hero */}
      <section style={{ position: "relative", zIndex: 1, padding: "90px 48px 70px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontSize: 11, fontFamily: "monospace", color: C.teal, letterSpacing: "4px", marginBottom: 22, padding: "6px 18px", border: `1px solid ${C.teal}44`, borderRadius: 20, display: "inline-block" }}>
          TRANSPARENT · IMMUTABLE · TRUSTED
        </div>
        <h1 style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.08, marginBottom: 22, maxWidth: 780 }}>
          Trace Every Herb<br /><span style={{ color: C.accent }}>From Root to Remedy</span>
        </h1>
        <p style={{ fontSize: 19, color: C.muted, maxWidth: 520, lineHeight: 1.65, marginBottom: 44 }}>
          Blockchain-powered transparency for the Ayurvedic supply chain — connecting farmers, merchants and consumers through immutable trust.
        </p>
        <div style={{ display: "flex", gap: 16 }}>
          <button onClick={() => onNavigate("signup")} style={{ background: C.accent, color: C.bg, border: "none", padding: "14px 38px", borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 700, fontFamily: "'Crimson Pro', serif" }}>
            Join the Network →
          </button>
          <button onClick={() => onNavigate("login")} style={{ background: "transparent", color: C.accent, border: `1px solid ${C.accent}`, padding: "14px 38px", borderRadius: 8, cursor: "pointer", fontSize: 16, fontFamily: "'Crimson Pro', serif" }}>
            Sign In
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 0, marginTop: 64, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          {[["11", "Chain Blocks"], ["3", "Products"], ["9", "Verified Events"], ["100%", "Transparent"]].map(([n, l], i) => (
            <div key={l} style={{ padding: "22px 36px", textAlign: "center", borderRight: i < 3 ? `1px solid ${C.border}` : "none" }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: C.accent, fontFamily: "monospace" }}>{n}</div>
              <div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace", letterSpacing: "1px", marginTop: 4 }}>{l.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Roles */}
      <section style={{ position: "relative", zIndex: 1, padding: "50px 48px", background: C.surface, borderTop: `1px solid ${C.border}` }}>
        <div style={{ textAlign: "center", marginBottom: 44 }}>
          <div style={{ fontSize: 34, fontWeight: 700 }}>Who is AyurTrace for?</div>
          <div style={{ fontSize: 12, color: C.muted, fontFamily: "monospace", letterSpacing: "2px", marginTop: 8 }}>EVERY LINK IN THE CHAIN MATTERS</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, maxWidth: 900, margin: "0 auto" }}>
          {[
            { icon: "🌾", role: "Farmers", color: C.accent, desc: "Log GPS-verified harvests, certifications and batch details directly on-chain. Build trust with every crop." },
            { icon: "🏪", role: "Merchants", color: C.gold, desc: "Verify sourcing authenticity, manage inventory and maintain compliant, traceable business records." },
            { icon: "🧘", role: "Consumers", color: C.teal, desc: "Scan any product to see its complete journey from farm to shelf. Know exactly what you're buying." },
          ].map(({ icon, role, color, desc }, i) => (
            <div key={role} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
              style={{ background: hov === i ? C.card : C.bg, border: `1px solid ${hov === i ? color : C.border}`, borderTop: `3px solid ${color}`, borderRadius: 14, padding: 28, textAlign: "center", transition: "all .2s", cursor: "default" }}>
              <div style={{ fontSize: 44, marginBottom: 14 }}>{icon}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color, marginBottom: 10 }}>{role}</div>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, marginBottom: 20 }}>{desc}</div>
              <button onClick={() => onNavigate("signup")} style={{ background: "transparent", border: `1px solid ${color}`, color, padding: "8px 20px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>
                Join as {role.slice(0, -1)} →
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={{ position: "relative", zIndex: 1, padding: "50px 48px", borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18, maxWidth: 960, margin: "0 auto" }}>
          {[["🌿","Farm to Shelf","Every herb tracked from GPS-verified harvest to final product"],["🔗","Immutable Ledger","Blockchain-secured records that cannot be tampered with"],["🔬","Lab Verified"],["📱","Instant Verify","Consumers verify product authenticity in seconds by scanning"]].map(([icon, title, desc]) => (
            <div key={title} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 22 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>{icon}</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{title}</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>{desc}</div>
            </div>
          ))}
        </div>
      </section>

      <footer style={{ position: "relative", zIndex: 1, borderTop: `1px solid ${C.border}`, padding: "14px 48px", background: C.surface, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, color: C.muted, fontFamily: "monospace" }}>🌿 AyurTrace · Immutable Ayurvedic Supply Chain</div>
        <div style={{ fontSize: 12, color: C.muted, fontFamily: "monospace" }}>© 2025 · All rights reserved</div>
      </footer>
    </div>
  );
}

// ── AUTH PAGE ─────────────────────────────────────────────────────────────────
function AuthPage({ mode, onNavigate, onLogin }) {
  const [tab, setTab] = useState(mode);
  const [role, setRole] = useState("Consumer");
  const [loginRole, setLoginRole] = useState("Farmer");
  const [form, setForm] = useState({});
  const [done, setDone] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const ROLES = [
    { id: "Farmer", icon: "🌾", color: C.accent },
    { id: "Merchant", icon: "🏪", color: C.gold },
    { id: "Consumer", icon: "🧘", color: C.teal },
  ];

  if (done) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Crimson Pro', Georgia, serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 72, marginBottom: 20 }}>✅</div>
        <div style={{ fontSize: 30, fontWeight: 700, color: C.accent }}>Account Created!</div>
        <div style={{ fontSize: 14, color: C.muted, fontFamily: "monospace", marginTop: 10 }}>Redirecting to your dashboard…</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", fontFamily: "'Crimson Pro', Georgia, serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&display=swap'); *{box-sizing:border-box;margin:0;padding:0}`}</style>

      {/* Left branding panel */}
      <div style={{ width: 420, background: C.surface, borderRight: `1px solid ${C.border}`, padding: "48px 40px", display: "flex", flexDirection: "column", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <button onClick={() => onNavigate("landing")} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 13, fontFamily: "monospace", display: "flex", alignItems: "center", gap: 6, marginBottom: 48 }}>
            ← Back to home
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <span style={{ fontSize: 40 }}>🌿</span>
            <div>
              <div style={{ fontSize: 30, fontWeight: 700, color: C.accent }}>AyurTrace</div>
              <div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace", letterSpacing: "3px" }}>BLOCKCHAIN SUPPLY CHAIN</div>
            </div>
          </div>
          <p style={{ fontSize: 16, color: C.muted, lineHeight: 1.7, marginBottom: 36 }}>
            Join the transparent Ayurvedic supply chain. Track, verify, and trust every herb from root to remedy.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {["🔗  Immutable blockchain records", "🌍  GPS-tagged origin verification", "📱  Consumer scan & verify"].map(f => (
              <div key={f} style={{ fontSize: 12, color: C.muted, fontFamily: "monospace", padding: "9px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 6 }}>{f}</div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.border, fontFamily: "monospace" }}>© 2025 AyurTrace · All rights reserved</div>
      </div>

      {/* Right form panel */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 40px", overflowY: "auto" }}>
        <div style={{ width: "100%", maxWidth: 460 }}>
          {/* Toggle */}
          <div style={{ display: "flex", background: C.deep, border: `1px solid ${C.border}`, borderRadius: 9, padding: 4, marginBottom: 30 }}>
            {["login", "signup"].map(m => (
              <button key={m} onClick={() => setTab(m)} style={{ flex: 1, padding: "10px", borderRadius: 6, border: "none", background: tab === m ? C.card : "transparent", color: tab === m ? C.accent : C.muted, cursor: "pointer", fontSize: 12, fontFamily: "monospace", fontWeight: tab === m ? 700 : 400, letterSpacing: "1px", transition: "all .2s" }}>
                {m === "login" ? "SIGN IN" : "SIGN UP"}
              </button>
            ))}
          </div>

          {tab === "login" ? (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "32px 36px" }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 4 }}>Welcome back</div>
              <div style={{ fontSize: 13, color: C.muted, fontFamily: "monospace", marginBottom: 28 }}>Sign in to your AyurTrace account</div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 10, color: C.muted, fontFamily: "monospace", letterSpacing: "1.5px", marginBottom: 5 }}>LOGIN AS</label>
                <select
                  value={loginRole}
                  onChange={e => setLoginRole(e.target.value)}
                  style={{ width: "100%", background: C.deep, border: `1px solid ${C.border}`, color: C.text, padding: "9px 13px", borderRadius: 6, fontSize: 13, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }}
                >
                  {ROLES.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}
                </select>
              </div>
              <Field label="EMAIL ADDRESS" type="email" placeholder="you@example.com" value={loginEmail} onChange={setLoginEmail} />
              <Field label="PASSWORD" type="password" placeholder="••••••••" value={loginPass} onChange={setLoginPass} />
              <button onClick={() => {
                // Record login user on chain if they haven't signed up (demo login)
                const users = Blockchain.getUsers();
                const alreadyExists = Object.values(users).some(u => u.role === loginRole && u.email === loginEmail);
                if (!alreadyExists) {
                  Blockchain.registerUser(loginRole, { name: loginEmail || loginRole, email: loginEmail, role: loginRole, loginAt: new Date().toISOString() });
                }
                onLogin(loginRole);
              }} style={{ width: "100%", background: C.accent, color: C.bg, border: "none", padding: "13px", borderRadius: 8, cursor: "pointer", fontSize: 15, fontFamily: "'Crimson Pro', serif", fontWeight: 700, marginTop: 6 }}>
                Sign In →
              </button>
              <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: C.muted }}>
                No account? <span onClick={() => setTab("signup")} style={{ color: C.accent, cursor: "pointer" }}>Create one</span>
              </div>
            </div>
          ) : (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "32px 36px" }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 4 }}>Create account</div>
              <div style={{ fontSize: 13, color: C.muted, fontFamily: "monospace", marginBottom: 22 }}>Choose your role to get started</div>

              {/* Role buttons */}
              <div style={{ display: "flex", gap: 8, marginBottom: 26 }}>
                {ROLES.map(r => (
                  <button key={r.id} onClick={() => { setRole(r.id); setForm({}); }}
                    style={{ flex: 1, padding: "12px 6px", borderRadius: 8, border: `1.5px solid ${role === r.id ? r.color : C.border}`, background: role === r.id ? `${r.color}18` : C.deep, color: role === r.id ? r.color : C.muted, cursor: "pointer", fontSize: 11, fontFamily: "monospace", fontWeight: role === r.id ? 700 : 400, transition: "all .2s", display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 22 }}>{r.icon}</span>
                    {r.id.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Role-specific divider */}
              <div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace", letterSpacing: "2px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                {role === "Farmer" ? "🌾 FARMER DETAILS" : role === "Merchant" ? "🏪 MERCHANT DETAILS" : "🧘 CONSUMER DETAILS"}
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              {role === "Farmer" && <>
                <Field label="FULL NAME" placeholder="e.g. Rajan Sharma" value={form.name || ""} onChange={v => sf("name", v)} />
                <Field label="EMAIL ADDRESS" type="email" placeholder="farmer@example.com" value={form.email || ""} onChange={v => sf("email", v)} />
                <Field label="PASSWORD" type="password" placeholder="Create a password" value={form.pass || ""} onChange={v => sf("pass", v)} />
                <Field label="FARM NAME" placeholder="e.g. Rajan Organic Farms" value={form.farmName || ""} onChange={v => sf("farmName", v)} />
                <Field label="FARM LOCATION" placeholder="e.g. Udaipur, Rajasthan" value={form.farmLoc || ""} onChange={v => sf("farmLoc", v)} />
              </>}

              {role === "Merchant" && <>
                <Field label="FULL NAME" placeholder="e.g. Priya Nair" value={form.name || ""} onChange={v => sf("name", v)} />
                <Field label="EMAIL ADDRESS" type="email" placeholder="merchant@example.com" value={form.email || ""} onChange={v => sf("email", v)} />
                <Field label="PASSWORD" type="password" placeholder="Create a password" value={form.pass || ""} onChange={v => sf("pass", v)} />
                <Field label="BUSINESS NAME" placeholder="e.g. AyurProcess Ltd" value={form.bizName || ""} onChange={v => sf("bizName", v)} />
                <Field label="LICENSE NUMBER" placeholder="e.g. LIC-MH-2024-00123" value={form.license || ""} onChange={v => sf("license", v)} />
              </>}

              {role === "Consumer" && <>
                <Field label="FULL NAME" placeholder="e.g. Ananya Menon" value={form.name || ""} onChange={v => sf("name", v)} />
                <Field label="EMAIL ADDRESS" type="email" placeholder="consumer@example.com" value={form.email || ""} onChange={v => sf("email", v)} />
                <Field label="PASSWORD" type="password" placeholder="Create a password" value={form.pass || ""} onChange={v => sf("pass", v)} />
              </>}

              <button onClick={() => {
                // Register user on blockchain (no images in chain)
                Blockchain.registerUser(role, { ...form, role });
                setDone(true);
                setTimeout(() => onLogin(role), 1800);
              }}
                style={{ width: "100%", background: C.accent, color: C.bg, border: "none", padding: "13px", borderRadius: 8, cursor: "pointer", fontSize: 15, fontFamily: "'Crimson Pro', serif", fontWeight: 700, marginTop: 6 }}>
                Create Account →
              </button>
              <div style={{ textAlign: "center", marginTop: 18, fontSize: 13, color: C.muted }}>
                Already have an account? <span onClick={() => setTab("login")} style={{ color: C.accent, cursor: "pointer" }}>Sign in</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FarmerDashboard({ onLogout }) {
  const [activeMenu, setActiveMenu] = useState("products");
  const [products, setProducts] = useState(() => {
    const stored = typeof window !== "undefined" ? loadStoredProducts() : null;
    if (stored?.length) return stored.map(enrichProductImageFromMap);
    const initial = [
      { id: "FARM-001", productId: seedToProductId("FARM-001"), name: "Triphala Churna", stage: "Harvested", place: "Jaipur, Rajasthan", stock: 191, cost: "₹420", desc: "Traditional blend of Amlaki, Bibhitaki, and Haritaki." },
      { id: "FARM-002", productId: seedToProductId("FARM-002"), name: "Tulsi (Holy Basil)", stage: "Manufacturing", place: "Bhopal, Madhya Pradesh", stock: 0, cost: "—", desc: "Sacred Ocimum sanctum leaves grown organically." },
      { id: "FARM-003", productId: seedToProductId("FARM-003"), name: "Ashwagandha Root", stage: "Packaging", place: "Pauri Garhwal, Uttarakhand", stock: 174, cost: "₹780", desc: "Premium Withania somnifera roots from high-altitude farms." },
    ];
    persistProductList(initial);
    return initial;
  });
  const [selected, setSelected] = useState(null);
  const [formError, setFormError] = useState("");
  const [newHerb, setNewHerb] = useState({
    name: "",
    description: "",
    imageName: "",
    imageDataUrl: "",
    imagePreviewUrl: "",
    latitude: "",
    longitude: "",
    address: "",
    harvestDate: "",
    cost: "",
    stock: "",
  });

  const stageChip = stage => ({
    Harvested: { bg: "#dff6e7", color: "#1a8b4c" },
    Manufacturing: { bg: "#fde8df", color: "#c16732" },
    Packaging: { bg: "#fbeec7", color: "#9e7d15" },
  }[stage] || { bg: "#e9ecef", color: "#495057" });

  const resetHerbForm = () => {
    setNewHerb({
      name: "",
      description: "",
      imageName: "",
      imageDataUrl: "",
      imagePreviewUrl: "",
      latitude: "",
      longitude: "",
      address: "",
      harvestDate: "",
      cost: "",
      stock: "",
    });
    setFormError("");
  };

  const addHerb = () => {
    if (!newHerb.name.trim() || !newHerb.address.trim() || !newHerb.harvestDate) {
      setFormError("Please fill Product Name, Address, and Harvest Date.");
      return;
    }
    const nameTrim = newHerb.name.trim();
    const productId = makeProductId(nameTrim);
    const newProduct = {
      id: `FARM-${String(products.length + 1).padStart(3, "0")}`,
      productId,
      name: nameTrim,
      stage: "Harvested",
      place: newHerb.address.trim(),
      stock: Number(newHerb.stock) || 0,
      cost: newHerb.cost.trim() || "—",
      desc: newHerb.description.trim() || "Recently added herb batch by farmer.",
      latitude: newHerb.latitude,
      longitude: newHerb.longitude,
      harvestDate: newHerb.harvestDate,
      // Persistable image (works after submit + reload). Prefer data URL over blob URL.
      imageDataUrl: newHerb.imageDataUrl || "",
    };
    // Record on blockchain (image excluded by sanitizeForChain)
    Blockchain.addProduct(newProduct, "Farmer");
    setProducts(prev => {
      const next = [newProduct, ...prev];
      persistProductList(next);
      return next;
    });
    resetHerbForm();
    setActiveMenu("products");
  };

  useEffect(() => {
    setProducts(prev => {
      const next = prev.map(enrichProductImageFromMap);
      let changed = false;
      for (let i = 0; i < prev.length; i++) {
        const a = prev[i]?.imageDataUrl || "";
        const b = next[i]?.imageDataUrl || "";
        if (a !== b) changed = true;
      }
      if (!changed) return prev;
      persistProductList(next);
      return next;
    });
  }, []);

  const totalProducts = products.length;
  const inSupply = products.filter(p => p.stage !== "Packaging").length;
  const distributed = products.filter(p => p.stage === "Packaging" && p.stock === 0).length;

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#f4f5ef", color: "#1f2a1f", fontFamily: "'Crimson Pro', Georgia, serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&display=swap'); *{box-sizing:border-box;margin:0;padding:0}`}</style>

      <aside style={{ width: 220, background: "#0e402f", color: "#d8f0dc", display: "flex", flexDirection: "column", borderRight: "1px solid #19513c" }}>
        <div style={{ padding: "24px 18px", borderBottom: "1px solid #1f5f47" }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>🧑‍🌾</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#d5efd8", textTransform: "lowercase" }}>farmer</div>
          <div style={{ fontSize: 11, opacity: 0.8, fontFamily: "monospace", letterSpacing: "1px", marginTop: 2 }}>FARMER</div>
          <div style={{ fontSize: 12, color: "#9fc9ab", marginTop: 8 }}>Green Valley Herbs</div>
        </div>

        <button onClick={() => setActiveMenu("products")} style={{ textAlign: "left", padding: "14px 18px", border: "none", background: activeMenu === "products" ? "#225a45" : "transparent", color: "#d8f0dc", cursor: "pointer", fontSize: 14 }}>
          🌿 My Products
        </button>
        <button onClick={() => setActiveMenu("add")} style={{ textAlign: "left", padding: "14px 18px", border: "none", background: activeMenu === "add" ? "#225a45" : "transparent", color: "#d8f0dc", cursor: "pointer", fontSize: 14 }}>
          ➕ Add New Herb
        </button>
        <button onClick={() => setActiveMenu("ledger")} style={{ textAlign: "left", padding: "14px 18px", border: "none", background: activeMenu === "ledger" ? "#225a45" : "transparent", color: "#d8f0dc", cursor: "pointer", fontSize: 14 }}>
          🔗 Blockchain Ledger
        </button>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header style={{ height: 58, background: "#0f4a35", borderBottom: "1px solid #2f6651", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 18px", color: "#e9f7eb" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>🌿</span>
            <span style={{ fontSize: 30, fontWeight: 600 }}>Ayur Trace</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setActiveMenu("products")} style={{ border: "1px solid #4f7f6c", background: "#14533c", color: "#e5f6e8", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>Dashboard</button>
            <button style={{ border: "1px solid #4f7f6c", background: "#14533c", color: "#e5f6e8", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>farmer</button>
            <button onClick={onLogout} style={{ border: "1px solid #4f7f6c", background: "#14533c", color: "#e5f6e8", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>Logout</button>
          </div>
        </header>

        <main style={{ padding: 22 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, maxWidth: 580, marginBottom: 20 }}>
            {[["🌾", "Total Products", totalProducts], ["🧴", "In Supply Chain", inSupply], ["✅", "Distributed", distributed]].map(([icon, label, value]) => (
              <div key={label} style={{ background: "white", borderRadius: 10, border: "1px solid #e6e7e3", padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#7d8178", fontSize: 12 }}><span>{icon}</span><span>{label}</span></div>
                <div style={{ marginTop: 8, fontSize: 30, fontWeight: 700, color: "#223322" }}>{value}</div>
              </div>
            ))}
          </div>

          {activeMenu === "products" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 36, fontWeight: 600, color: "#2a2d27" }}>My Herbs</div>
                <button onClick={() => setActiveMenu("add")} style={{ border: "none", borderRadius: 20, background: "#0f4a35", color: "#f4fff7", padding: "8px 16px", cursor: "pointer", fontWeight: 700 }}>
                  + Add New
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 14 }}>
                {products.map(p => {
                  const chip = stageChip(p.stage);
                  return (
                    <div key={p.id} style={{ background: "white", border: "1px solid #e8e8e5", borderRadius: 14, overflow: "hidden" }}>
                      {p.imageDataUrl ? (
                        <div style={{ height: 120, display: "flex" }}>
                          <img src={p.imageDataUrl} alt={p.name} style={{ width: "100%", height: 120, objectFit: "cover" }} />
                        </div>
                      ) : (
                        <div style={{ height: 120, background: "linear-gradient(130deg, #e8edd9, #b8dbb1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>🌿</div>
                      )}
                      <div style={{ padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div style={{ fontSize: 28, fontWeight: 600 }}>{p.name}</div>
                          <span style={{ background: chip.bg, color: chip.color, padding: "3px 9px", borderRadius: 999, fontSize: 11, fontFamily: "monospace" }}>{p.stage}</span>
                        </div>
                        <div style={{ color: "#6c7269", fontSize: 14, marginBottom: 10 }}>{p.desc}</div>
                        <div style={{ fontSize: 12, color: "#768074", marginBottom: 10 }}>📍 {p.place} · 🌿 {p.stock} left{(p.cost && String(p.cost).trim() && p.cost !== "—") ? ` · 💰 ${p.cost}` : ""}</div>
                        <div style={{ fontSize: 11, color: "#667266", fontFamily: "monospace", marginBottom: 10 }}>Product ID: {p.productId}</div>
                        <button onClick={() => setSelected(p)} style={{ border: "1px solid #bcc2b8", background: "white", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>
                          View Details
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {activeMenu === "add" && (
            <div style={{ background: "white", border: "1px solid #e5e5e2", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 36, marginBottom: 14, color: "#2b2f2b" }}>Add New Herb</div>
              <div style={{ fontSize: 10, color: "#7a8078", fontFamily: "monospace", marginBottom: 6 }}>HERB NAME *</div>
              <input
                placeholder="e.g. Ashwagandha Root Powder"
                value={newHerb.name}
                onChange={e => setNewHerb(h => ({ ...h, name: e.target.value }))}
                style={{ width: "100%", height: 36, border: "1px solid #dfe2da", borderRadius: 4, padding: "0 10px", marginBottom: 12, background: "#f7f8f3", color: "#333" }}
              />

              <div style={{ fontSize: 10, color: "#7a8078", fontFamily: "monospace", marginBottom: 6 }}>DESCRIPTION</div>
              <textarea
                placeholder="Describe the herb, its variety, quality grade..."
                value={newHerb.description}
                onChange={e => setNewHerb(h => ({ ...h, description: e.target.value }))}
                style={{ width: "100%", minHeight: 76, border: "1px solid #dfe2da", borderRadius: 4, padding: "9px 10px", marginBottom: 12, background: "#f7f8f3", color: "#333", resize: "vertical" }}
              />

              <div style={{ fontSize: 10, color: "#7a8078", fontFamily: "monospace", marginBottom: 6 }}>PRODUCT IMAGE</div>
              <input
                type="file"
                accept="image/*"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (!f) {
                    setNewHerb(h => ({ ...h, imageName: "", imageDataUrl: "", imagePreviewUrl: "" }));
                    return;
                  }
                  const fr = new FileReader();
                  fr.onload = () => {
                    const dataUrl = String(fr.result || "");
                    setNewHerb(h => ({ ...h, imageName: f.name || "", imageDataUrl: dataUrl, imagePreviewUrl: dataUrl }));
                  };
                  fr.readAsDataURL(f);
                }}
                style={{ marginBottom: 12, fontSize: 12 }}
              />
              {newHerb.imagePreviewUrl && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#7a8078", fontFamily: "monospace", marginBottom: 6 }}>PHOTO PREVIEW</div>
                  <img
                    src={newHerb.imagePreviewUrl}
                    alt="Selected"
                    style={{ width: 220, height: 140, objectFit: "cover", borderRadius: 8, border: "1px solid #dfe2da", background: "#f7f8f3" }}
                  />
                </div>
              )}

              <div style={{ fontSize: 10, color: "#7a8078", fontFamily: "monospace", marginBottom: 6 }}>HARVEST LOCATION</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <input
                  placeholder="Latitude"
                  value={newHerb.latitude}
                  onChange={e => setNewHerb(h => ({ ...h, latitude: e.target.value }))}
                  style={{ width: "100%", height: 34, border: "1px solid #dfe2da", borderRadius: 4, padding: "0 10px", background: "#f7f8f3" }}
                />
                <input
                  placeholder="Longitude"
                  value={newHerb.longitude}
                  onChange={e => setNewHerb(h => ({ ...h, longitude: e.target.value }))}
                  style={{ width: "100%", height: 34, border: "1px solid #dfe2da", borderRadius: 4, padding: "0 10px", background: "#f7f8f3" }}
                />
              </div>
              <input
                placeholder="Address / Village, District, State"
                value={newHerb.address}
                onChange={e => setNewHerb(h => ({ ...h, address: e.target.value }))}
                style={{ width: "100%", height: 34, border: "1px solid #dfe2da", borderRadius: 4, padding: "0 10px", marginBottom: 12, background: "#f7f8f3" }}
              />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#7a8078", fontFamily: "monospace", marginBottom: 6 }}>HARVEST DATE *</div>
                  <input
                    type="date"
                    value={newHerb.harvestDate}
                    onChange={e => setNewHerb(h => ({ ...h, harvestDate: e.target.value }))}
                    style={{ width: "100%", height: 34, border: "1px solid #dfe2da", borderRadius: 4, padding: "0 10px", background: "#f7f8f3" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#7a8078", fontFamily: "monospace", marginBottom: 6 }}>COST</div>
                  <input
                    placeholder="e.g. ₹450 / kg"
                    value={newHerb.cost}
                    onChange={e => setNewHerb(h => ({ ...h, cost: e.target.value }))}
                    style={{ width: "100%", height: 34, border: "1px solid #dfe2da", borderRadius: 4, padding: "0 10px", background: "#f7f8f3" }}
                  />
                </div>
              </div>

              {formError && <div style={{ color: "#b04545", fontSize: 12, marginBottom: 10 }}>{formError}</div>}
              {newHerb.imageName && <div style={{ color: "#5f6f5f", fontSize: 12, marginBottom: 10 }}>Selected image: {newHerb.imageName}</div>}

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={addHerb} style={{ border: "none", background: "#0f4a35", color: "white", borderRadius: 6, padding: "9px 18px", cursor: "pointer", fontWeight: 700 }}>
                  Submit
                </button>
                <button onClick={resetHerbForm} style={{ border: "1px solid #bbc4ba", background: "white", color: "#3f4a3f", borderRadius: 6, padding: "9px 18px", cursor: "pointer" }}>
                  Reset
                </button>
                <button onClick={() => setActiveMenu("products")} style={{ border: "1px solid #bbc4ba", background: "white", color: "#3f4a3f", borderRadius: 6, padding: "9px 18px", cursor: "pointer" }}>
                  Back
                </button>
              </div>
            </div>
          )}

          {activeMenu === "ledger" && (() => {
            const chain = Blockchain.getChain();
            const users = Blockchain.getUsers();
            const integrity = Blockchain.verifyChain();
            const myBlocks = chain; // show all blocks
            return (
              <div style={{ background: "white", border: "1px solid #e5e5e2", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <div style={{ fontSize: 30, fontWeight: 700, color: "#2b3d2b" }}>🔗 Blockchain Ledger</div>
                  <button onClick={() => { localStorage.removeItem("ayurtrace_blockchain_v1"); localStorage.removeItem("ayurtrace_users_v1"); Blockchain._chain = null; Blockchain._users = null; window.location.reload(); }}
                    style={{ border: "1px solid #e0a0a0", background: "#fff5f5", color: "#b04545", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>
                    🗑 Reset Chain
                  </button>
                </div>
                <div style={{ fontSize: 12, color: "#566357", fontFamily: "monospace", marginBottom: 12 }}>
                  {integrity.valid
                    ? <span style={{ color: "#1a8b4c" }}>✓ VALID — chain has not been tampered with</span>
                    : <span style={{ color: "#b04545" }}>✗ TAMPERED at block #{integrity.failedAt}</span>}
                </div>
                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 14 }}>
                  {[
                    ["📦", "Total Blocks", chain.length, "#1a6b3a"],
                    ["👤", "Users", chain.filter(b=>b.type==="USER_REGISTRATION").length, "#5560c0"],
                    ["🌿", "Products", chain.filter(b=>b.type==="PRODUCT_ADDED").length, "#1a6b3a"],
                    ["🔄", "Stage Updates", chain.filter(b=>b.type==="STAGE_UPDATE").length, "#c06a10"],
                    ["🚚", "Chain Events", chain.filter(b=>b.type==="SUPPLY_CHAIN_EVENT").length, "#107a6b"],
                  ].map(([icon, label, val, color]) => (
                    <div key={label} style={{ background: "#f7faf5", border: "1px solid #d8e8d4", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 18 }}>{icon}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "monospace" }}>{val}</div>
                      <div style={{ fontSize: 9, color: "#6a8070", fontFamily: "monospace" }}>{label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: "#f7faf5", border: "1px solid #d8e8d4", borderRadius: 8, padding: 12, marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1f4d31", marginBottom: 8 }}>👥 All Registered Users (on-chain)</div>
                  {Object.values(users).length === 0
                    ? <div style={{ fontSize: 12, color: "#8a9e8a" }}>No users on-chain yet. Use Sign In or Sign Up to register.</div>
                    : Object.values(users).map(u => (
                      <div key={u.userId} style={{ fontSize: 12, color: "#3a5a3a", fontFamily: "monospace", marginBottom: 6, padding: "6px 8px", background: u.role === "Farmer" ? "#eef7ee" : u.role === "Merchant" ? "#fdf7ee" : "#eef3fd", borderRadius: 6 }}>
                        <span style={{ fontWeight: 700 }}>{u.role === "Farmer" ? "🌾" : u.role === "Merchant" ? "🏪" : "🧘"} {u.role}</span>
                        {" · "}{u.name || u.email || "—"}
                        {u.farmName ? ` · Farm: ${u.farmName}` : ""}
                        {u.farmLoc ? ` · 📍 ${u.farmLoc}` : ""}
                        {u.bizName ? ` · Biz: ${u.bizName}` : ""}
                        {u.license ? ` · Lic: ${u.license}` : ""}
                        <div style={{ color: "#9aaa9a", fontSize: 10, marginTop: 2 }}>ID: {u.userId} · {new Date(u.registeredAt).toLocaleString()}</div>
                      </div>
                    ))
                  }
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#2b3d2b", marginBottom: 8 }}>📦 Product & Registration Blocks</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[...myBlocks].reverse().map(b => (
                    <div key={b.index} style={{ background: "#f5faf5", border: "1px solid #cde0cd", borderRadius: 8, padding: "10px 12px", fontFamily: "monospace", fontSize: 11 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ color: b.type==="USER_REGISTRATION"?"#5560c0":b.type==="PRODUCT_ADDED"?"#1a6b3a":b.type==="STAGE_UPDATE"?"#c06a10":b.type==="SUPPLY_CHAIN_EVENT"?"#107a6b":"#666", fontWeight: 700 }}>#{b.index.toString().padStart(3, "0")} · {b.type}</span>
                        <span style={{ color: "#8a9e8a", fontSize: 10 }}>{new Date(b.timestamp).toLocaleDateString()}</span>
                      </div>
                      <div style={{ color: "#c9a84c", fontSize: 10, marginBottom: 2 }}>{b.hash}</div>
                      <div style={{ color: "#9aaa9a", fontSize: 9, marginBottom: 3 }}>prev: {b.prevHash}</div>
                      <div style={{ color: "#4a6a4a" }}>
                        {b.type === "PRODUCT_ADDED" && `${b.data?.name || b.data?.herb || "Product"} · ${b.data?.place || b.data?.batch || ""}`}
                        {b.type === "USER_REGISTRATION" && `${b.data?.role} · ${b.data?.name || b.data?.email}`}
                        {b.type === "SUPPLY_CHAIN_EVENT" && `${b.data?.herb} · ${b.data?.stageName}`}
                        {b.type === "STAGE_UPDATE" && `${b.data?.productName || b.data?.productId} → ${b.data?.stage}`}
                        {b.type === "GENESIS" && b.data?.event}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {selected && (
            <div style={{ position: "fixed", inset: 0, background: "#00000055", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }}>
              <div style={{ width: 520, maxWidth: "90vw", background: "white", borderRadius: 12, border: "1px solid #d9ddd6", padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 30, fontWeight: 700 }}>{selected.name}</div>
                  <button onClick={() => setSelected(null)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22 }}>×</button>
                </div>
                <div style={{ fontSize: 14, color: "#697367", marginBottom: 8 }}>{selected.desc}</div>
                {selected.imageDataUrl && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "#7a8078", fontFamily: "monospace", marginBottom: 6 }}>IMAGE</div>
                    <img src={selected.imageDataUrl} alt={selected.name} style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, border: "1px solid #e6e7e3" }} />
                  </div>
                )}
                <div style={{ fontSize: 13, marginBottom: 4 }}><strong>ID:</strong> {selected.id}</div>
                <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Stage:</strong> {selected.stage}</div>
                <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Location:</strong> {selected.place}</div>
                <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Cost:</strong> {selected.cost || "—"}</div>
                <div style={{ fontSize: 13 }}><strong>Stock Left:</strong> {selected.stock}</div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function MerchantDashboard({ onLogout }) {
  const [activeMenu, setActiveMenu] = useState("products");
  const [products, setProducts] = useState(() => {
    const stored = typeof window !== "undefined" ? loadStoredProducts() : null;
    if (stored?.length) return stored.map(enrichProductImageFromMap);
    const initial = [
      { id: "MRC-001", productId: seedToProductId("MRC-001"), name: "tulasi", stage: "Harvested", place: "Indore, MP", stock: 322, desc: "tulasi" },
      { id: "MRC-002", productId: seedToProductId("MRC-002"), name: "tulasi", stage: "Harvested", place: "Pune", stock: 0, desc: "tulasi" },
      { id: "MRC-003", productId: seedToProductId("MRC-003"), name: "Triphala Churna", stage: "Harvested", place: "Jaipur, Rajasthan", stock: 191, desc: "Traditional blend of Amlaki, Bibhitaki, and Haritaki." },
      { id: "MRC-004", productId: seedToProductId("MRC-004"), name: "Tulsi (Holy Basil)", stage: "Manufacturing", place: "Bhopal, Madhya Pradesh", stock: 0, desc: "Sacred Ocimum sanctum leaves grown organically in Madhya Pradesh." },
      { id: "MRC-005", productId: seedToProductId("MRC-005"), name: "Ashwagandha Root", stage: "Packaging", place: "Pauri Garhwal, Uttarakhand", stock: 174, desc: "Premium Withania somnifera roots harvested from high-altitude farms." },
    ];
    persistProductList(initial);
    return initial;
  });
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [nextStage, setNextStage] = useState("Harvested");
  const [qrVersion, setQrVersion] = useState(1);
  const stageFlow = ["Collection", "Processing", "Manufacturing", "Packaging", "Distributed"];
  const [stageDetails, setStageDetails] = useState({
    benefits: "",
    sideEffects: "",
    expiredHandling: "",
    processingType: "",
    temperatureUsed: "",
    duration: "",
    equipmentUsed: "",
    qualityCheckStatus: "",
    supervisorName: "",
    processingDate: "",
    processingNotes: "",
    productType: "",
    ingredientsUsed: "",
    batchNumber: "",
    manufacturingMethod: "",
    machineUsed: "",
    qualityTestResult: "",
    manufacturingSupervisor: "",
    manufacturingDate: "",
    manufacturingNotes: "",
    packagingType: "",
    packagingMaterial: "",
    quantityPacked: "",
    packagingBatchNumber: "",
    expiryDate: "",
    packagingDate: "",
    labelVerified: "No",
    packagingNotes: "",
    // Distributed
    distributorName: "",
    transportMethod: "",
    dispatchLocation: "",
    destinationLocation: "",
    dispatchDate: "",
    estimatedDeliveryDate: "",
    trackingId: "",
    distributionNotes: "",
  });

  const chip = stage => ({
    Harvested: { bg: "#dff6e7", color: "#1a8b4c" },
    Manufacturing: { bg: "#fde8df", color: "#c16732" },
    Packaging: { bg: "#fbeec7", color: "#9e7d15" },
    Distributed: { bg: "#e2ebff", color: "#3b5ba9" },
  }[stage] || { bg: "#e9ecef", color: "#495057" });

  const setStage = () => {
    if (!editing) return;
    const normalizedStage = nextStage === "Collection" ? "Harvested" : nextStage;
    // Record stage update on blockchain (images excluded)
    Blockchain.updateProductStage(
      editing.productId || editing.id,
      editing.name,
      nextStage,
      stageDetails,
      "Merchant"
    );
    setProducts(prev => prev.map(p => (
      p.id === editing.id
        ? {
          ...p,
          stage: normalizedStage,
          details: {
            ...stageDetails,
            completedStages: {
              ...(p.details?.completedStages || {}),
              [nextStage]: true,
            },
          },
        }
        : p
    )));
    setEditing(prev => (prev ? {
      ...prev,
      stage: normalizedStage,
      details: {
        ...stageDetails,
        completedStages: {
          ...(prev.details?.completedStages || {}),
          [nextStage]: true,
        },
      },
    } : prev));
    setProducts(prev => { persistProductList(prev); return prev; });
  };

  useEffect(() => {
    setProducts(prev => {
      const next = prev.map(enrichProductImageFromMap);
      let changed = false;
      for (let i = 0; i < prev.length; i++) {
        const a = prev[i]?.imageDataUrl || "";
        const b = next[i]?.imageDataUrl || "";
        if (a !== b) changed = true;
      }
      if (!changed) return prev;
      persistProductList(next);
      return next;
    });
  }, []);

  const totalProducts = products.length;
  const inProcessing = products.filter(p => p.stage === "Manufacturing").length;
  const packaged = products.filter(p => p.stage === "Packaging").length;
  const distributed = products.filter(p => p.stage === "Distributed").length;

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#f4f5ef", color: "#1f2a1f", fontFamily: "'Crimson Pro', Georgia, serif" }}>
      <aside style={{ width: 220, background: "#0e402f", color: "#d8f0dc", borderRight: "1px solid #19513c" }}>
        <div style={{ padding: "24px 18px", borderBottom: "1px solid #1f5f47" }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>🏪</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#d5efd8", textTransform: "lowercase" }}>ett</div>
          <div style={{ fontSize: 11, opacity: 0.8, fontFamily: "monospace", letterSpacing: "1px", marginTop: 2 }}>MERCHANT</div>
          <div style={{ fontSize: 12, color: "#9fc9ab", marginTop: 8 }}>erfg</div>
        </div>
        <button onClick={() => setActiveMenu("products")} style={{ width: "100%", textAlign: "left", padding: "14px 18px", border: "none", background: activeMenu === "products" ? "#225a45" : "transparent", color: "#d8f0dc", cursor: "pointer", fontSize: 14 }}>🌿 All Products</button>
        <button onClick={() => { setActiveMenu("updates"); if (!editing && products.length) { setEditing(products[0]); setNextStage(products[0].stage); } }} style={{ width: "100%", textAlign: "left", padding: "14px 18px", border: "none", background: activeMenu === "updates" ? "#225a45" : "transparent", color: "#d8f0dc", cursor: "pointer", fontSize: 14 }}>🖊 Update Stage</button>
        <button onClick={() => setActiveMenu("ledger")} style={{ width: "100%", textAlign: "left", padding: "14px 18px", border: "none", background: activeMenu === "ledger" ? "#225a45" : "transparent", color: "#d8f0dc", cursor: "pointer", fontSize: 14 }}>🔗 Blockchain Ledger</button>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header style={{ height: 58, background: "#0f4a35", borderBottom: "1px solid #2f6651", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 18px", color: "#e9f7eb" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>🌿</span>
            <span style={{ fontSize: 30, fontWeight: 600 }}>Ayur Trace</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setActiveMenu("products")} style={{ border: "1px solid #4f7f6c", background: "#14533c", color: "#e5f6e8", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>Dashboard</button>
            <button style={{ border: "1px solid #4f7f6c", background: "#14533c", color: "#e5f6e8", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>merchant</button>
            <button onClick={onLogout} style={{ border: "1px solid #4f7f6c", background: "#14533c", color: "#e5f6e8", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>Logout</button>
          </div>
        </header>

        <main style={{ padding: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, maxWidth: 700, marginBottom: 16 }}>
            {[["🌿", "Total Products", totalProducts], ["🕐", "In Processing", inProcessing], ["📦", "Packaged", packaged], ["🚚", "Distributed", distributed]].map(([icon, label, value]) => (
              <div key={label} style={{ background: "white", borderRadius: 9, border: "1px solid #e6e7e3", padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#7d8178", fontSize: 12 }}><span>{icon}</span><span>{label}</span></div>
                <div style={{ marginTop: 8, fontSize: 28, fontWeight: 700, color: "#223322" }}>{value}</div>
              </div>
            ))}
          </div>

          {activeMenu === "products" && (
            <>
              <div style={{ fontSize: 36, marginBottom: 12 }}>All Farmer Products</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 12 }}>
                {products.map((p, idx) => {
                  const c = chip(p.stage);
                  return (
                    <div key={p.id} style={{ background: "white", border: "1px solid #e8e8e5", borderRadius: 12, overflow: "hidden" }}>
                      {p.imageDataUrl ? (
                        <div style={{ height: 110, display: "flex" }}>
                          <img src={p.imageDataUrl} alt={p.name} style={{ width: "100%", height: 110, objectFit: "cover" }} />
                        </div>
                      ) : (
                        <div style={{ height: 110, background: idx === 1 ? "linear-gradient(135deg, #a9d49f, #5b8f52)" : "linear-gradient(130deg, #e8edd9, #b8dbb1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🌿</div>
                      )}
                      <div style={{ padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                          <div style={{ fontSize: 25, fontWeight: 600 }}>{p.name}</div>
                          <span style={{ background: c.bg, color: c.color, padding: "2px 8px", borderRadius: 999, fontSize: 10, fontFamily: "monospace" }}>{p.stage}</span>
                        </div>
                        <div style={{ color: "#6c7269", fontSize: 13, minHeight: 32 }}>{p.desc}</div>
                        <div style={{ fontSize: 11, color: "#768074", margin: "8px 0 10px" }}>📍 {p.place} · 🌿 {p.stock} left</div>
                        {p.productId && <div style={{ fontSize: 10, color: "#667266", fontFamily: "monospace", marginBottom: 6 }}>Product ID: {p.productId}</div>}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => setSelected(p)} style={{ border: "1px solid #bcc2b8", background: "white", borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontSize: 12 }}>View Details</button>
                          <button onClick={() => {
                            setEditing(p);
                            setNextStage(p.stage === "Harvested" ? "Collection" : p.stage);
                            setStageDetails({
                              benefits: p.details?.benefits || "",
                              sideEffects: p.details?.sideEffects || "",
                              expiredHandling: p.details?.expiredHandling || "",
                              processingType: p.details?.processingType || "",
                              temperatureUsed: p.details?.temperatureUsed || "",
                              duration: p.details?.duration || "",
                              equipmentUsed: p.details?.equipmentUsed || "",
                              qualityCheckStatus: p.details?.qualityCheckStatus || "",
                              supervisorName: p.details?.supervisorName || "",
                              processingDate: p.details?.processingDate || "",
                              processingNotes: p.details?.processingNotes || "",
                              productType: p.details?.productType || "",
                              ingredientsUsed: p.details?.ingredientsUsed || "",
                              batchNumber: p.details?.batchNumber || "",
                              manufacturingMethod: p.details?.manufacturingMethod || "",
                              machineUsed: p.details?.machineUsed || "",
                              qualityTestResult: p.details?.qualityTestResult || "",
                              manufacturingSupervisor: p.details?.manufacturingSupervisor || "",
                              manufacturingDate: p.details?.manufacturingDate || "",
                              manufacturingNotes: p.details?.manufacturingNotes || "",
                              packagingType: p.details?.packagingType || "",
                              packagingMaterial: p.details?.packagingMaterial || "",
                              quantityPacked: p.details?.quantityPacked || "",
                              packagingBatchNumber: p.details?.packagingBatchNumber || "",
                              expiryDate: p.details?.expiryDate || "",
                              packagingDate: p.details?.packagingDate || "",
                              labelVerified: p.details?.labelVerified || "No",
                              packagingNotes: p.details?.packagingNotes || "",
                            });
                            setActiveMenu("updates");
                          }} style={{ border: "none", background: "#d8873e", color: "white", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>Update</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {activeMenu === "updates" && (
            <>
              <div style={{ fontSize: 32, marginBottom: 10 }}>Update: {editing?.name || "Select Product"}</div>
              {editing?.imageDataUrl && (
                <div style={{ display: "flex", gap: 14, alignItems: "center", background: "white", border: "1px solid #e5e5e2", borderRadius: 12, padding: 12, marginBottom: 10 }}>
                  <img src={editing.imageDataUrl} alt={editing.name} style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 8, border: "1px solid #e6e7e3" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#6b746a", fontFamily: "monospace" }}>Product ID: {editing.productId || "—"}</div>
                    <div style={{ fontSize: 12, color: "#6b746a", marginTop: 4 }}>Cost: {editing.cost || "—"}</div>
                    <div style={{ fontSize: 12, color: "#6b746a", marginTop: 4 }}>Location: {editing.place || "—"}</div>
                  </div>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                <div style={{ background: "white", border: "1px solid #e5e5e2", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 12, color: "#566357", marginBottom: 8 }}>Supply Chain Timeline</div>
                  {stageFlow.map((stage, index) => {
                    const active = stage === (editing?.stage || nextStage);
                    const done = Boolean(editing?.details?.completedStages?.[stage]);
                    return (
                      <div key={stage} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                        <div style={{ width: 12, display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: done ? "#1a8b4c" : (active ? "#2d6e54" : "#c7d1c6"), marginTop: 4 }} />
                          {index < stageFlow.length - 1 && <div style={{ width: 1, height: 26, background: "#ced7cc" }} />}
                        </div>
                        <button
                          onClick={() => setNextStage(stage)}
                          style={{
                            flex: 1,
                            textAlign: "left",
                            border: `1px solid ${done ? "#1a8b4c" : (active ? "#2d6e54" : "#e4e8e1")}`,
                            background: active ? "#eef7f0" : "#f9faf7",
                            borderRadius: 6,
                            padding: "7px 10px",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{stage}</div>
                          <div style={{ fontSize: 10, color: done ? "#1a8b4c" : "#7a8579" }}>
                            {done ? "✓ Saved" : (active ? "Current stage" : "Click to set stage")}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div style={{ background: "white", border: "1px solid #e5e5e2", borderRadius: 12, padding: 10 }}>
                  <div style={{ fontSize: 12, color: "#566357", marginBottom: 8 }}>QR Code</div>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
                    <QRCode value={`${editing?.productId || editing?.id || "NONE"}-${qrVersion}`} size={150} showValue />
                  </div>
                  <div style={{ textAlign: "center", fontSize: 12, color: "#667266", fontFamily: "monospace", marginBottom: 10 }}>
                    Product ID: {editing?.productId || "—"}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={async () => {
                        const v = `${editing?.productId || editing?.id || "NONE"}-${qrVersion}`;
                        const url = await QR.toDataURL(String(v), { width: 800, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0D1F0F", light: "#ffffff" } });
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${editing?.productId || "qr"}.png`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                      }}
                      style={{ flex: 1, border: "none", background: "#0f4a35", color: "white", borderRadius: 6, padding: "6px 8px", cursor: "pointer", fontSize: 11 }}
                    >
                      Download
                    </button>
                    <button onClick={() => setQrVersion(v => v + 1)} style={{ flex: 1, border: "1px solid #bcc2b8", background: "white", borderRadius: 6, padding: "6px 8px", cursor: "pointer", fontSize: 11 }}>Regenerate</button>
                  </div>
                </div>
              </div>

              <div style={{ background: "white", border: "1px solid #e5e5e2", borderRadius: 12, padding: 12, marginTop: 10 }}>
                <div style={{ fontSize: 14, marginBottom: 8 }}>Update Product Details</div>
                <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>SELECT STAGE TO UPDATE</div>
                <select value={nextStage} onChange={e => setNextStage(e.target.value)} style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10 }}>
                  {stageFlow.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {nextStage === "Collection" && (
                  <>
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>BENEFITS (COMMA-SEPARATED)</div>
                    <input
                      value={stageDetails.benefits}
                      onChange={e => setStageDetails(d => ({ ...d, benefits: e.target.value }))}
                      placeholder="Reduces stress, improves sleep, boosts immunity"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>SIDE EFFECTS (COMMA-SEPARATED)</div>
                    <input
                      value={stageDetails.sideEffects}
                      onChange={e => setStageDetails(d => ({ ...d, sideEffects: e.target.value }))}
                      placeholder="May cause drowsiness, avoid during pregnancy"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>EXPIRED MEDICINE HANDLING</div>
                    <textarea
                      value={stageDetails.expiredHandling}
                      onChange={e => setStageDetails(d => ({ ...d, expiredHandling: e.target.value }))}
                      placeholder="How to safely dispose of expired product"
                      style={{ width: "100%", minHeight: 44, border: "1px solid #d8ded2", borderRadius: 6, padding: "8px 10px", marginBottom: 10, background: "#f7f8f3", resize: "vertical" }}
                    />
                  </>
                )}
                {nextStage === "Processing" && (
                  <>
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>PROCESSING TYPE</div>
                    <input
                      value={stageDetails.processingType}
                      onChange={e => setStageDetails(d => ({ ...d, processingType: e.target.value }))}
                      placeholder="e.g. drying, grinding, extraction"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>TEMPERATURE USED (°C)</div>
                        <input
                          type="number"
                          value={stageDetails.temperatureUsed}
                          onChange={e => setStageDetails(d => ({ ...d, temperatureUsed: e.target.value }))}
                          placeholder="e.g. 45"
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>DURATION (HOURS/DAYS)</div>
                        <input
                          value={stageDetails.duration}
                          onChange={e => setStageDetails(d => ({ ...d, duration: e.target.value }))}
                          placeholder="e.g. 8 hours"
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>EQUIPMENT USED</div>
                    <input
                      value={stageDetails.equipmentUsed}
                      onChange={e => setStageDetails(d => ({ ...d, equipmentUsed: e.target.value }))}
                      placeholder="e.g. Rotary dryer"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>QUALITY CHECK STATUS</div>
                        <input
                          value={stageDetails.qualityCheckStatus}
                          onChange={e => setStageDetails(d => ({ ...d, qualityCheckStatus: e.target.value }))}
                          placeholder="e.g. Passed"
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>SUPERVISOR NAME</div>
                        <input
                          value={stageDetails.supervisorName}
                          onChange={e => setStageDetails(d => ({ ...d, supervisorName: e.target.value }))}
                          placeholder="e.g. Dr. Rao"
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>PROCESSING DATE</div>
                    <input
                      type="date"
                      value={stageDetails.processingDate}
                      onChange={e => setStageDetails(d => ({ ...d, processingDate: e.target.value }))}
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>NOTES (OPTIONAL)</div>
                    <textarea
                      value={stageDetails.processingNotes}
                      onChange={e => setStageDetails(d => ({ ...d, processingNotes: e.target.value }))}
                      placeholder="Optional notes"
                      style={{ width: "100%", minHeight: 44, border: "1px solid #d8ded2", borderRadius: 6, padding: "8px 10px", marginBottom: 10, background: "#f7f8f3", resize: "vertical" }}
                    />
                  </>
                )}
                {nextStage === "Manufacturing" && (
                  <>
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>PRODUCT TYPE</div>
                    <input
                      value={stageDetails.productType}
                      onChange={e => setStageDetails(d => ({ ...d, productType: e.target.value }))}
                      placeholder="e.g. powder, oil, tablet"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>INGREDIENTS USED</div>
                    <input
                      value={stageDetails.ingredientsUsed}
                      onChange={e => setStageDetails(d => ({ ...d, ingredientsUsed: e.target.value }))}
                      placeholder="List ingredients used"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>BATCH NUMBER</div>
                    <input
                      value={stageDetails.batchNumber}
                      onChange={e => setStageDetails(d => ({ ...d, batchNumber: e.target.value }))}
                      placeholder="e.g. BT-2026-001"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>MANUFACTURING METHOD</div>
                    <input
                      value={stageDetails.manufacturingMethod}
                      onChange={e => setStageDetails(d => ({ ...d, manufacturingMethod: e.target.value }))}
                      placeholder="e.g. cold extraction"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>MACHINE/UNIT USED</div>
                    <input
                      value={stageDetails.machineUsed}
                      onChange={e => setStageDetails(d => ({ ...d, machineUsed: e.target.value }))}
                      placeholder="e.g. Unit A-3"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>QUALITY TEST RESULT</div>
                    <input
                      value={stageDetails.qualityTestResult}
                      onChange={e => setStageDetails(d => ({ ...d, qualityTestResult: e.target.value }))}
                      placeholder="e.g. Passed"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>SUPERVISOR NAME</div>
                    <input
                      value={stageDetails.manufacturingSupervisor}
                      onChange={e => setStageDetails(d => ({ ...d, manufacturingSupervisor: e.target.value }))}
                      placeholder="e.g. Dr. Sharma"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>MANUFACTURING DATE</div>
                    <input
                      type="date"
                      value={stageDetails.manufacturingDate}
                      onChange={e => setStageDetails(d => ({ ...d, manufacturingDate: e.target.value }))}
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>NOTES (OPTIONAL)</div>
                    <textarea
                      value={stageDetails.manufacturingNotes}
                      onChange={e => setStageDetails(d => ({ ...d, manufacturingNotes: e.target.value }))}
                      placeholder="Optional notes"
                      style={{ width: "100%", minHeight: 44, border: "1px solid #d8ded2", borderRadius: 6, padding: "8px 10px", marginBottom: 10, background: "#f7f8f3", resize: "vertical" }}
                    />
                  </>
                )}
                {nextStage === "Packaging" && (
                  <>
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>PACKAGING TYPE</div>
                    <input
                      value={stageDetails.packagingType}
                      onChange={e => setStageDetails(d => ({ ...d, packagingType: e.target.value }))}
                      placeholder="e.g. bottle, box, pouch"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>MATERIAL USED</div>
                    <input
                      value={stageDetails.packagingMaterial}
                      onChange={e => setStageDetails(d => ({ ...d, packagingMaterial: e.target.value }))}
                      placeholder="e.g. recyclable glass"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>QUANTITY PACKED</div>
                        <input
                          value={stageDetails.quantityPacked}
                          onChange={e => setStageDetails(d => ({ ...d, quantityPacked: e.target.value }))}
                          placeholder="e.g. 500 units"
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>BATCH NUMBER</div>
                        <input
                          value={stageDetails.packagingBatchNumber}
                          onChange={e => setStageDetails(d => ({ ...d, packagingBatchNumber: e.target.value }))}
                          placeholder="e.g. PK-2026-07"
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>EXPIRY DATE</div>
                        <input
                          type="date"
                          value={stageDetails.expiryDate}
                          onChange={e => setStageDetails(d => ({ ...d, expiryDate: e.target.value }))}
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>PACKAGING DATE</div>
                        <input
                          type="date"
                          value={stageDetails.packagingDate}
                          onChange={e => setStageDetails(d => ({ ...d, packagingDate: e.target.value }))}
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>LABEL VERIFIED (YES/NO)</div>
                    <select
                      value={stageDetails.labelVerified}
                      onChange={e => setStageDetails(d => ({ ...d, labelVerified: e.target.value }))}
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    >
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>NOTES (OPTIONAL)</div>
                    <textarea
                      value={stageDetails.packagingNotes}
                      onChange={e => setStageDetails(d => ({ ...d, packagingNotes: e.target.value }))}
                      placeholder="Optional notes"
                      style={{ width: "100%", minHeight: 44, border: "1px solid #d8ded2", borderRadius: 6, padding: "8px 10px", marginBottom: 10, background: "#f7f8f3", resize: "vertical" }}
                    />
                  </>
                )}
                {nextStage === "Distributed" && (
                  <>
                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>DISTRIBUTOR NAME</div>
                    <input
                      value={stageDetails.distributorName}
                      onChange={e => setStageDetails(d => ({ ...d, distributorName: e.target.value }))}
                      placeholder="e.g. ABC Distributors"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />

                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>TRANSPORT METHOD</div>
                    <input
                      value={stageDetails.transportMethod}
                      onChange={e => setStageDetails(d => ({ ...d, transportMethod: e.target.value }))}
                      placeholder="truck, courier, etc."
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>DISPATCH LOCATION</div>
                        <input
                          value={stageDetails.dispatchLocation}
                          onChange={e => setStageDetails(d => ({ ...d, dispatchLocation: e.target.value }))}
                          placeholder="e.g. Pune, MH"
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>DESTINATION LOCATION</div>
                        <input
                          value={stageDetails.destinationLocation}
                          onChange={e => setStageDetails(d => ({ ...d, destinationLocation: e.target.value }))}
                          placeholder="e.g. Bengaluru, KA"
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>DISPATCH DATE</div>
                        <input
                          type="date"
                          value={stageDetails.dispatchDate}
                          onChange={e => setStageDetails(d => ({ ...d, dispatchDate: e.target.value }))}
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>EST. DELIVERY DATE</div>
                        <input
                          type="date"
                          value={stageDetails.estimatedDeliveryDate}
                          onChange={e => setStageDetails(d => ({ ...d, estimatedDeliveryDate: e.target.value }))}
                          style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                        />
                      </div>
                    </div>

                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>TRACKING ID</div>
                    <input
                      value={stageDetails.trackingId}
                      onChange={e => setStageDetails(d => ({ ...d, trackingId: e.target.value }))}
                      placeholder="e.g. TRK-123456"
                      style={{ width: "100%", height: 34, border: "1px solid #d8ded2", borderRadius: 6, padding: "0 10px", marginBottom: 10, background: "#f7f8f3" }}
                    />

                    <div style={{ fontSize: 10, color: "#6f786d", marginBottom: 4 }}>NOTES</div>
                    <textarea
                      value={stageDetails.distributionNotes}
                      onChange={e => setStageDetails(d => ({ ...d, distributionNotes: e.target.value }))}
                      placeholder="Any dispatch / delivery notes"
                      style={{ width: "100%", minHeight: 44, border: "1px solid #d8ded2", borderRadius: 6, padding: "8px 10px", marginBottom: 10, background: "#f7f8f3", resize: "vertical" }}
                    />
                  </>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={setStage} style={{ border: "none", background: "#0f4a35", color: "white", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Save Changes</button>
                  <button onClick={() => {
                    setEditing(products[0] || null);
                    setNextStage(products[0]?.stage === "Harvested" ? "Collection" : (products[0]?.stage || "Collection"));
                    setStageDetails({
                      benefits: "",
                      sideEffects: "",
                      expiredHandling: "",
                      processingType: "",
                      temperatureUsed: "",
                      duration: "",
                      equipmentUsed: "",
                      qualityCheckStatus: "",
                      supervisorName: "",
                      processingDate: "",
                      processingNotes: "",
                      productType: "",
                      ingredientsUsed: "",
                      batchNumber: "",
                      manufacturingMethod: "",
                      machineUsed: "",
                      qualityTestResult: "",
                      manufacturingSupervisor: "",
                      manufacturingDate: "",
                      manufacturingNotes: "",
                      packagingType: "",
                      packagingMaterial: "",
                      quantityPacked: "",
                      packagingBatchNumber: "",
                      expiryDate: "",
                      packagingDate: "",
                      labelVerified: "No",
                      packagingNotes: "",
                      distributorName: "",
                      transportMethod: "",
                      dispatchLocation: "",
                      destinationLocation: "",
                      dispatchDate: "",
                      estimatedDeliveryDate: "",
                      trackingId: "",
                      distributionNotes: "",
                    });
                  }} style={{ border: "1px solid #bcc2b8", background: "white", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Reset</button>
                </div>
              </div>

              <div style={{ marginTop: 10, background: "white", border: "1px solid #eceee8", borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6a7369", marginBottom: 8 }}>Pick product to update:</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {products.map(p => (
                    <button key={p.id} onClick={() => {
                      setEditing(p);
                      setNextStage(p.stage === "Harvested" ? "Collection" : p.stage);
                      setStageDetails({
                        benefits: p.details?.benefits || "",
                        sideEffects: p.details?.sideEffects || "",
                        expiredHandling: p.details?.expiredHandling || "",
                        processingType: p.details?.processingType || "",
                        temperatureUsed: p.details?.temperatureUsed || "",
                        duration: p.details?.duration || "",
                        equipmentUsed: p.details?.equipmentUsed || "",
                        qualityCheckStatus: p.details?.qualityCheckStatus || "",
                        supervisorName: p.details?.supervisorName || "",
                        processingDate: p.details?.processingDate || "",
                        processingNotes: p.details?.processingNotes || "",
                        productType: p.details?.productType || "",
                        ingredientsUsed: p.details?.ingredientsUsed || "",
                        batchNumber: p.details?.batchNumber || "",
                        manufacturingMethod: p.details?.manufacturingMethod || "",
                        machineUsed: p.details?.machineUsed || "",
                        qualityTestResult: p.details?.qualityTestResult || "",
                        manufacturingSupervisor: p.details?.manufacturingSupervisor || "",
                        manufacturingDate: p.details?.manufacturingDate || "",
                        manufacturingNotes: p.details?.manufacturingNotes || "",
                        packagingType: p.details?.packagingType || "",
                        packagingMaterial: p.details?.packagingMaterial || "",
                        quantityPacked: p.details?.quantityPacked || "",
                        packagingBatchNumber: p.details?.packagingBatchNumber || "",
                        expiryDate: p.details?.expiryDate || "",
                        packagingDate: p.details?.packagingDate || "",
                        labelVerified: p.details?.labelVerified || "No",
                        packagingNotes: p.details?.packagingNotes || "",
                        distributorName: p.details?.distributorName || "",
                        transportMethod: p.details?.transportMethod || "",
                        dispatchLocation: p.details?.dispatchLocation || "",
                        destinationLocation: p.details?.destinationLocation || "",
                        dispatchDate: p.details?.dispatchDate || "",
                        estimatedDeliveryDate: p.details?.estimatedDeliveryDate || "",
                        trackingId: p.details?.trackingId || "",
                        distributionNotes: p.details?.distributionNotes || "",
                      });
                    }} style={{ border: `1px solid ${editing?.id === p.id ? "#2d6e54" : "#d4dbd1"}`, background: editing?.id === p.id ? "#edf7ef" : "white", borderRadius: 16, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {activeMenu === "ledger" && (() => {
            const chain = Blockchain.getChain();
            const users = Blockchain.getUsers();
            const integrity = Blockchain.verifyChain();
            return (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 32 }}>🔗 Blockchain Ledger</div>
                  <button onClick={() => { localStorage.removeItem("ayurtrace_blockchain_v1"); localStorage.removeItem("ayurtrace_users_v1"); Blockchain._chain = null; Blockchain._users = null; window.location.reload(); }}
                    style={{ border: "1px solid #e0a0a0", background: "#fff5f5", color: "#b04545", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>
                    🗑 Reset Chain
                  </button>
                </div>
                <div style={{ fontSize: 12, color: integrity.valid ? "#1a8b4c" : "#b04545", fontFamily: "monospace", marginBottom: 12 }}>
                  {integrity.valid ? `✓ VALID — ${chain.length} blocks, chain has not been tampered with` : `✗ TAMPERED at block #${integrity.failedAt}`}
                </div>
                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 14 }}>
                  {[
                    ["📦", "Total Blocks", chain.length, "#1a6b3a"],
                    ["👤", "Users", chain.filter(b=>b.type==="USER_REGISTRATION").length, "#5560c0"],
                    ["🌿", "Products", chain.filter(b=>b.type==="PRODUCT_ADDED").length, "#1a6b3a"],
                    ["🔄", "Stage Updates", chain.filter(b=>b.type==="STAGE_UPDATE").length, "#c06a10"],
                    ["🚚", "Chain Events", chain.filter(b=>b.type==="SUPPLY_CHAIN_EVENT").length, "#107a6b"],
                  ].map(([icon, label, val, color]) => (
                    <div key={label} style={{ background: "white", border: "1px solid #e5e5e2", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 18 }}>{icon}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "monospace" }}>{val}</div>
                      <div style={{ fontSize: 9, color: "#6a8070", fontFamily: "monospace" }}>{label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: "white", border: "1px solid #e5e5e2", borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: "#2b3d2b" }}>👥 Registered Users (on-chain)</div>
                  {Object.values(users).length === 0
                    ? <div style={{ fontSize: 12, color: "#8a9e8a" }}>No users registered yet. Use Sign In or Sign Up.</div>
                    : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
                      {Object.values(users).map(u => (
                        <div key={u.userId} style={{ background: u.role==="Farmer"?"#eef7ee":u.role==="Merchant"?"#fdf7ee":"#eef3fd", border: "1px solid #d8e8d4", borderRadius: 8, padding: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#1f4d31" }}>{u.role==="Farmer"?"🌾":u.role==="Merchant"?"🏪":"🧘"} {u.name || u.email || u.role}</div>
                          <div style={{ fontSize: 10, color: "#6a8070", fontFamily: "monospace", marginTop: 2 }}>{u.role?.toUpperCase()} · {u.userId}</div>
                          {u.email && <div style={{ fontSize: 10, color: "#6a8070", marginTop: 2 }}>✉ {u.email}</div>}
                          {u.farmName && <div style={{ fontSize: 10, color: "#6a8070", marginTop: 2 }}>🌾 {u.farmName}</div>}
                          {u.farmLoc && <div style={{ fontSize: 10, color: "#6a8070", marginTop: 2 }}>📍 {u.farmLoc}</div>}
                          {u.bizName && <div style={{ fontSize: 10, color: "#6a8070", marginTop: 2 }}>🏪 {u.bizName}</div>}
                          {u.license && <div style={{ fontSize: 10, color: "#6a8070", marginTop: 2 }}>📋 {u.license}</div>}
                          <div style={{ fontSize: 9, color: "#9aaa9a", fontFamily: "monospace", marginTop: 4 }}>{new Date(u.registeredAt).toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                  }
                </div>
                <div style={{ background: "white", border: "1px solid #e5e5e2", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: "#2b3d2b" }}>📦 All Blocks (newest first)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {[...chain].reverse().map(b => (
                      <div key={b.index} style={{ background: "#f5faf5", border: "1px solid #cde0cd", borderRadius: 8, padding: "10px 12px", fontFamily: "monospace", fontSize: 11 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ color: b.type==="USER_REGISTRATION"?"#5560c0":b.type==="PRODUCT_ADDED"?"#1a6b3a":b.type==="STAGE_UPDATE"?"#c06a10":b.type==="SUPPLY_CHAIN_EVENT"?"#107a6b":"#666", fontWeight: 700 }}>#{b.index.toString().padStart(3, "0")} · {b.type}</span>
                          <span style={{ color: "#8a9e8a" }}>{new Date(b.timestamp).toLocaleDateString()}</span>
                        </div>
                        <div style={{ color: "#c9a84c", marginBottom: 2, fontSize: 10 }}>{b.hash}</div>
                        <div style={{ color: "#9aaa9a", fontSize: 9, marginBottom: 4 }}>prev: {b.prevHash}</div>
                        <div style={{ color: "#4a6a4a" }}>
                          {b.type === "USER_REGISTRATION" && `${b.data?.role} · ${b.data?.name || b.data?.email || ""}`}
                          {b.type === "PRODUCT_ADDED" && `${b.data?.name || b.data?.herb || "Product"} · ${b.data?.place || b.data?.batch || ""}`}
                          {b.type === "STAGE_UPDATE" && `${b.data?.productName || b.data?.productId} → ${b.data?.stage}`}
                          {b.type === "SUPPLY_CHAIN_EVENT" && `${b.data?.herb} · ${b.data?.stageName}`}
                          {b.type === "GENESIS" && b.data?.event}
                        </div>
                        {b.actor && b.type !== "GENESIS" && <div style={{ color: "#8a9e8a", fontSize: 10, marginTop: 2 }}>actor: {b.actor}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </main>
      </div>

      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "#00000055", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }}>
          <div style={{ width: 500, maxWidth: "90vw", background: "white", borderRadius: 12, border: "1px solid #d9ddd6", padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 30, fontWeight: 700 }}>{selected.name}</div>
              <button onClick={() => setSelected(null)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22 }}>×</button>
            </div>
            <div style={{ fontSize: 14, color: "#697367", marginBottom: 8 }}>{selected.desc}</div>
            {selected.imageDataUrl && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#7a8078", fontFamily: "monospace", marginBottom: 6 }}>IMAGE</div>
                <img src={selected.imageDataUrl} alt={selected.name} style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, border: "1px solid #e6e7e3" }} />
              </div>
            )}
            <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Product ID:</strong> {selected.productId || "—"}</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}><strong>ID:</strong> {selected.id}</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Stage:</strong> {selected.stage}</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Location:</strong> {selected.place}</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Cost:</strong> {selected.cost || "—"}</div>
            <div style={{ fontSize: 13 }}><strong>Stock Left:</strong> {selected.stock}</div>
          </div>
        </div>
      )}

    </div>
  );
}

function ConsumerDashboard({ onLogout }) {
  const [view, setView] = useState("verify");
  const [scanInput, setScanInput] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [products, setProducts] = useState(() => {
    const stored = typeof window !== "undefined" ? loadStoredProducts() : null;
    const base = Array.isArray(stored) && stored.length ? stored : SEED_PRODUCTS;
    // Merge: prefer stored farmer/merchant products, but also include demo chain products if missing.
    const byPid = new Map();
    for (const p of base) {
      if (p?.productId) byPid.set(String(p.productId), p);
    }
    for (const p of SEED_PRODUCTS) {
      if (p?.productId && !byPid.has(String(p.productId))) byPid.set(String(p.productId), p);
    }
    return Array.from(byPid.values()).map(enrichProductImageFromMap);
  });

  const mergeConsumerCatalog = () => {
    const stored = typeof window !== "undefined" ? loadStoredProducts() : null;
    const base = Array.isArray(stored) && stored.length ? stored : SEED_PRODUCTS;
    const byPid = new Map();
    for (const p of base) {
      if (p?.productId) byPid.set(String(p.productId), p);
    }
    for (const p of SEED_PRODUCTS) {
      if (p?.productId && !byPid.has(String(p.productId))) byPid.set(String(p.productId), p);
    }
    return Array.from(byPid.values()).map(enrichProductImageFromMap);
  };

  useEffect(() => {
    const apply = () => {
      setProducts(prev => {
        const next = mergeConsumerCatalog();
        if (next.length !== prev.length) return next;
        for (let i = 0; i < prev.length; i++) {
          const aImg = prev[i]?.imageDataUrl || "";
          const bImg = next[i]?.imageDataUrl || "";
          const aPid = String(prev[i]?.productId || "");
          const bPid = String(next[i]?.productId || "");
          if (aImg !== bImg || aPid !== bPid) return next;
        }
        return prev;
      });
    };
    apply();
    const onFocus = () => apply();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const handleVerify = () => {
    const q = scanInput.trim();
    setSearchAttempt(a => a + 1);
    if (!q) {
      setScanResult(null);
      return;
    }
    const catalog = mergeConsumerCatalog();
    setProducts(catalog);
    const qLower = q.toLowerCase();
    const match = catalog.find(p => {
      const pid = p.productId ? String(p.productId) : "";
      if (!pid) return false;
      return pid === q || pid.toLowerCase() === qLower;
    });
    setScanResult(match || null);
    if (match) setView("trace");
  };

  const TopBtn = ({ active, children, onClick }) => (
    <button
      onClick={onClick}
      style={{
        border: "1px solid #4f7f6c",
        background: active ? "#1b6349" : "#14533c",
        color: "#e5f6e8",
        borderRadius: 6,
        padding: "6px 12px",
        cursor: "pointer",
        fontSize: 12,
      }}
    >
      {children}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#f4f5ef", color: "#1f2a1f", fontFamily: "'Crimson Pro', Georgia, serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&display=swap'); *{box-sizing:border-box;margin:0;padding:0}`}</style>

      <aside style={{ width: 220, background: "#0e402f", color: "#d8f0dc", display: "flex", flexDirection: "column", borderRight: "1px solid #19513c" }}>
        <div style={{ padding: "24px 18px", borderBottom: "1px solid #1f5f47" }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>🧑</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#d5efd8", textTransform: "lowercase" }}>user</div>
          <div style={{ fontSize: 11, opacity: 0.8, fontFamily: "monospace", letterSpacing: "1px", marginTop: 2 }}>CONSUMER</div>
        </div>

        <button
          onClick={() => setView("verify")}
          style={{ textAlign: "left", padding: "14px 18px", border: "none", background: view === "verify" ? "#225a45" : "transparent", color: "#d8f0dc", cursor: "pointer", fontSize: 14 }}
        >
          🔎 Verify Product
        </button>
        <button
          onClick={() => setView("trace")}
          style={{ textAlign: "left", padding: "14px 18px", border: "none", background: view === "trace" ? "#225a45" : "transparent", color: "#d8f0dc", cursor: "pointer", fontSize: 14, opacity: scanResult ? 1 : 0.6 }}
        >
          🔗 View Full Chain
        </button>
        <button
          onClick={() => setView("ledger")}
          style={{ textAlign: "left", padding: "14px 18px", border: "none", background: view === "ledger" ? "#225a45" : "transparent", color: "#d8f0dc", cursor: "pointer", fontSize: 14 }}
        >
          📋 Ledger
        </button>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header style={{ height: 58, background: "#0f4a35", borderBottom: "1px solid #2f6651", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 18px", color: "#e9f7eb" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>🌿</span>
            <span style={{ fontSize: 30, fontWeight: 600 }}>Ayur Trace</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <TopBtn active={view === "verify"} onClick={() => setView("verify")}>Dashboard</TopBtn>
            <TopBtn active={false} onClick={() => {}}>user</TopBtn>
            <TopBtn active={false} onClick={onLogout}>Logout</TopBtn>
          </div>
        </header>

        <main style={{ padding: 22 }}>
          {view === "verify" && (
            <>
              <div style={{ background: "#2f6a49", color: "#f1fff3", borderRadius: 12, padding: "22px 22px", border: "1px solid #2a6042", marginBottom: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Hello, user</div>
                <div style={{ fontSize: 13, opacity: 0.92 }}>
                  Verify the authenticity of your Ayurvedic products. Scan a QR code or enter a Product ID below.
                </div>
              </div>

              <div style={{ background: "white", borderRadius: 12, border: "1px solid #e6e7e3", padding: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>🔎 Verify a Product</div>
                <div style={{ fontSize: 12, color: "#6b746a", marginBottom: 12 }}>
                  Enter the <strong>Product ID</strong> (example: <span style={{ fontFamily: "monospace" }}>AYR_61EC96F</span>).
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    value={scanInput}
                    onChange={e => { setScanInput(e.target.value); setScanResult(null); }}
                    onKeyDown={e => e.key === "Enter" && handleVerify()}
                    placeholder="Enter Product ID (e.g. AYR_61EC96F)"
                    style={{ flex: 1, height: 38, border: "1px solid #dfe2da", borderRadius: 8, padding: "0 12px", background: "#f7f8f3" }}
                  />
                  <button
                    onClick={handleVerify}
                    style={{ border: "none", background: "#0f4a35", color: "white", borderRadius: 8, padding: "0 16px", height: 38, cursor: "pointer", fontWeight: 700 }}
                  >
                    Verify
                  </button>
                </div>
                {searchAttempt > 0 && scanInput.trim() && !scanResult && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#b04545" }}>
                    No product found for “{scanInput.trim()}”.
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, background: "#eef3ff", border: "1px solid #d7e3ff", borderRadius: 10, padding: "10px 12px", color: "#35507a", fontSize: 12 }}>
                Try demo products: Run the seed script and use product IDs printed in the terminal, or visit <span style={{ fontFamily: "monospace" }}>/product/[ID]</span> directly.
              </div>

              <div style={{ marginTop: 18, fontSize: 13, color: "#566357", marginBottom: 10 }}>How It Works</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                {[
                  { n: "1", t: "Get Your Product", d: "Purchase any AyurTrace-verified Ayurvedic product." },
                  { n: "2", t: "Scan or Enter ID", d: "Scan the QR code or enter the product ID to verify." },
                  { n: "3", t: "View Full Chain", d: "See the complete journey from farm to your hands." },
                  { n: "4", t: "Rate & Review", d: "Share your experience and help other consumers." },
                ].map(c => (
                  <div key={c.n} style={{ background: "white", border: "1px solid #e6e7e3", borderRadius: 12, padding: 14 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 999, background: "#0f4a35", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
                      {c.n}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{c.t}</div>
                    <div style={{ fontSize: 12, color: "#6b746a", lineHeight: 1.5 }}>{c.d}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {view === "trace" && (
            <div style={{ background: "white", border: "1px solid #e6e7e3", borderRadius: 12, padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{scanResult ? (scanResult.herb || scanResult.name) : "No product selected"}</div>
                  {scanResult && (
                    <div style={{ fontSize: 12, color: "#6b746a", fontFamily: "monospace" }}>
                      {scanResult.productId}
                      {scanResult.batch ? ` · ${scanResult.batch}` : ""}
                    </div>
                  )}
                </div>
                <button onClick={() => setView("verify")} style={{ border: "1px solid #bcc2b8", background: "white", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 12 }}>
                  ← Back
                </button>
              </div>

              {!scanResult ? (
                <div style={{ fontSize: 13, color: "#6b746a" }}>Verify a product first to view its supply chain.</div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12, color: "#223322" }}>
                      Product ID: <strong>{scanResult.productId || "—"}</strong>
                    </div>
                    <QRCode value={scanResult.productId || scanResult.id} size={120} showValue />
                  </div>

                  {scanResult.imageDataUrl && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, color: "#566357", marginBottom: 6 }}>Product image</div>
                      <img src={scanResult.imageDataUrl} alt={scanResult.name || scanResult.herb || "Product"} style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 10, border: "1px solid #e6e7e3" }} />
                    </div>
                  )}

                  {scanResult.desc && (
                    <div style={{ fontSize: 13, color: "#4a5348", lineHeight: 1.55, marginBottom: 12 }}>
                      {scanResult.desc}
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10, marginBottom: 14, fontSize: 12, color: "#4a5348" }}>
                    <div style={{ background: "#f9faf7", border: "1px solid #eceee8", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 10, color: "#6b746a", fontFamily: "monospace", marginBottom: 4 }}>LOCATION</div>
                      <div>{scanResult.place || "—"}</div>
                    </div>
                    <div style={{ background: "#f9faf7", border: "1px solid #eceee8", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 10, color: "#6b746a", fontFamily: "monospace", marginBottom: 4 }}>STOCK</div>
                      <div>{typeof scanResult.stock === "number" ? scanResult.stock : (scanResult.stock || "—")}</div>
                    </div>
                    <div style={{ background: "#f9faf7", border: "1px solid #eceee8", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 10, color: "#6b746a", fontFamily: "monospace", marginBottom: 4 }}>COST</div>
                      <div>{scanResult.cost || "—"}</div>
                    </div>
                    <div style={{ background: "#f9faf7", border: "1px solid #eceee8", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 10, color: "#6b746a", fontFamily: "monospace", marginBottom: 4 }}>STAGE</div>
                      <div>{scanResult.stage || "—"}</div>
                    </div>
                  </div>

                {Array.isArray(scanResult.stages) && scanResult.stages.length > 0 ? (
                <div style={{ position: "relative", paddingLeft: 26 }}>
                  <div style={{ position: "absolute", left: 10, top: 0, bottom: 0, width: 2, background: "linear-gradient(to bottom,#1a8b4c,#cdd8cf)" }} />
                  {scanResult.stages.map((s, i) => (
                    <div key={i} style={{ position: "relative", marginBottom: 16, paddingLeft: 12 }}>
                      <div style={{ position: "absolute", left: -20, top: 2, width: 12, height: 12, borderRadius: "50%", background: s.verified ? "#1a8b4c" : "#d8873e", border: "2px solid white" }} />
                      <div style={{ border: `1px solid ${s.verified ? "#1a8b4c" : "#e6e7e3"}`, background: "#fafbf7", borderRadius: 10, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{s.name}</div>
                          <div style={{ fontSize: 11, color: s.verified ? "#1a8b4c" : "#8a6a2f", fontFamily: "monospace" }}>
                            {s.verified ? "✓ VERIFIED" : "PENDING"}
                          </div>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, color: "#6b746a" }}>
                          <span style={{ fontFamily: "monospace" }}>{s.actor}</span> · 📍 {s.location.label} · {new Date(s.timestamp).toLocaleDateString()}
                        </div>
                        {s.notes && <div style={{ marginTop: 6, fontSize: 12, color: "#6b746a", fontStyle: "italic" }}>{s.notes}</div>}
                      </div>
                    </div>
                  ))}
                </div>
                ) : (
                  <>
                    {(() => {
                      const history = Blockchain.getProductHistory(scanResult.productId || scanResult.id);
                      if (!history.length) return null;
                      return (
                        <div style={{ marginTop: 12, background: "#f0f7f0", border: "1px solid #c8e0c8", borderRadius: 8, padding: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#1f4d31", marginBottom: 8 }}>🔗 On-Chain Records ({history.length} blocks)</div>
                          {history.map(b => (
                            <div key={b.index} style={{ fontFamily: "monospace", fontSize: 10, color: "#3a5a3a", marginBottom: 4 }}>
                              <span style={{ color: "#1a6b3a" }}>#{b.index.toString().padStart(3,"0")}</span> · {b.type} · <span style={{ color: "#c9a84c" }}>{b.hash}</span>
                              {b.data?.stageName && <span style={{ color: "#566357" }}> · {b.data.stageName}</span>}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    <div style={{ marginTop: 10, fontSize: 13, color: "#6b746a" }}>
                      This Product ID is registered, but a full on-chain stage timeline is not available for it yet. Use the product details above.
                    </div>
                  </>
                )}
                </>
              )}
            </div>
          )}

          {view === "ledger" && (() => {
            const chain = Blockchain.getChain();
            const users = Blockchain.getUsers();
            const integrity = Blockchain.verifyChain();
            return (
              <div style={{ background: "white", border: "1px solid #e6e7e3", borderRadius: 12, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>🔗 Blockchain Ledger</div>
                  <button onClick={() => { localStorage.removeItem("ayurtrace_blockchain_v1"); localStorage.removeItem("ayurtrace_users_v1"); Blockchain._chain = null; Blockchain._users = null; window.location.reload(); }}
                    style={{ border: "1px solid #e0a0a0", background: "#fff5f5", color: "#b04545", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>
                    🗑 Reset Chain
                  </button>
                </div>
                <div style={{ fontSize: 12, fontFamily: "monospace", marginBottom: 12 }}>
                  {integrity.valid
                    ? <span style={{ color: "#1a8b4c" }}>✓ VALID — all {chain.length} records are authentic and unmodified</span>
                    : <span style={{ color: "#b04545" }}>✗ TAMPERED at block #{integrity.failedAt}</span>}
                </div>

                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 14 }}>
                  {[
                    ["📦", "Total Blocks", chain.length, "#1a6b3a"],
                    ["👤", "Users", chain.filter(b=>b.type==="USER_REGISTRATION").length, "#5560c0"],
                    ["🌿", "Products", chain.filter(b=>b.type==="PRODUCT_ADDED").length, "#1a6b3a"],
                    ["🔄", "Stage Updates", chain.filter(b=>b.type==="STAGE_UPDATE").length, "#c06a10"],
                    ["🚚", "Chain Events", chain.filter(b=>b.type==="SUPPLY_CHAIN_EVENT").length, "#107a6b"],
                  ].map(([icon, label, val, color]) => (
                    <div key={label} style={{ background: "#f8faf8", border: "1px solid #e0eae0", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 18 }}>{icon}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "monospace" }}>{val}</div>
                      <div style={{ fontSize: 9, color: "#6a8070", fontFamily: "monospace" }}>{label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>

                {/* Unified user registry */}
                <div style={{ background: "#f8faf8", border: "1px solid #d4e4d4", borderRadius: 8, padding: 12, marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1f4d31", marginBottom: 10 }}>👥 All Registered Users (on-chain)</div>
                  {Object.values(users).length === 0
                    ? <div style={{ fontSize: 12, color: "#8a9e8a" }}>No users on-chain yet. Sign in or sign up to register.</div>
                    : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8 }}>
                      {Object.values(users).map(u => (
                        <div key={u.userId} style={{ background: u.role==="Farmer"?"#eef7ee":u.role==="Merchant"?"#fdf7ee":"#eef3fd", border: "1px solid #d0e0d0", borderRadius: 8, padding: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#1f3d2f" }}>{u.role==="Farmer"?"🌾":u.role==="Merchant"?"🏪":"🧘"} {u.name || u.email || u.role}</div>
                          <div style={{ fontSize: 10, color: "#6a8070", fontFamily: "monospace", marginTop: 2 }}>{u.role?.toUpperCase()}</div>
                          {u.email && <div style={{ fontSize: 10, color: "#6a8070", marginTop: 1 }}>✉ {u.email}</div>}
                          {u.farmName && <div style={{ fontSize: 10, color: "#6a8070", marginTop: 1 }}>🌾 {u.farmName}</div>}
                          {u.farmLoc && <div style={{ fontSize: 10, color: "#6a8070", marginTop: 1 }}>📍 {u.farmLoc}</div>}
                          {u.bizName && <div style={{ fontSize: 10, color: "#6a8070", marginTop: 1 }}>🏪 {u.bizName}</div>}
                          {u.license && <div style={{ fontSize: 10, color: "#6a8070", marginTop: 1 }}>📋 {u.license}</div>}
                          <div style={{ fontSize: 9, color: "#9aaa9a", fontFamily: "monospace", marginTop: 4 }}>
                            {u.userId}<br/>{new Date(u.registeredAt).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  }
                </div>

                <div style={{ fontSize: 13, fontWeight: 700, color: "#2b3a2b", marginBottom: 8 }}>📦 All Blocks (newest first)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[...chain].reverse().map(b => (
                    <div key={b.index} style={{ background: "#f8faf8", border: "1px solid #d4e4d4", borderRadius: 8, padding: "10px 12px", fontFamily: "monospace", fontSize: 11 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ color: b.type==="USER_REGISTRATION"?"#5560c0":b.type==="PRODUCT_ADDED"?"#1a6b3a":b.type==="STAGE_UPDATE"?"#c06a10":b.type==="SUPPLY_CHAIN_EVENT"?"#107a6b":"#666", fontWeight: 700 }}>#{b.index.toString().padStart(3, "0")} · {b.type}</span>
                        <span style={{ color: "#8a9e8a", fontSize: 10 }}>{new Date(b.timestamp).toLocaleDateString()}</span>
                      </div>
                      <div style={{ color: "#c9a84c", fontSize: 10, marginBottom: 2 }}>{b.hash}</div>
                      <div style={{ color: "#9aaa9a", fontSize: 9, marginBottom: 3 }}>prev: {b.prevHash}</div>
                      <div style={{ color: "#4a6a4a" }}>
                        {b.type === "USER_REGISTRATION" && `${b.data?.role} · ${b.data?.name || b.data?.email || ""}`}
                        {b.type === "PRODUCT_ADDED" && `${b.data?.name || b.data?.herb || "Product"} · ${b.data?.place || b.data?.batch || ""}`}
                        {b.type === "STAGE_UPDATE" && `${b.data?.productName || b.data?.productId} → ${b.data?.stage}`}
                        {b.type === "SUPPLY_CHAIN_EVENT" && `${b.data?.herb} · ${b.data?.stageName}`}
                        {b.type === "GENESIS" && b.data?.event}
                      </div>
                      {b.actor && b.type !== "GENESIS" && <div style={{ color: "#8a9e8a", fontSize: 10, marginTop: 2 }}>actor: {b.actor}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </main>
      </div>
    </div>
  );
}
function MainDashboard({ userRole, onLogout }) {
  const [products] = useState(SEED_PRODUCTS);
  const [chain] = useState(() => buildChain(SEED_PRODUCTS));
  const [view, setView] = useState("dashboard");
  const [selected, setSelected] = useState(null);
  const [scanInput, setScanInput] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [role, setRole] = useState(userRole || "Consumer");
  const [animIn, setAnimIn] = useState(true);
  const prevView = useRef(view);

  if ((userRole || "Consumer") === "Farmer") {
    return <FarmerDashboard onLogout={onLogout} />;
  }
  if ((userRole || "Consumer") === "Merchant") {
    return <MerchantDashboard onLogout={onLogout} />;
  }
  if ((userRole || "Consumer") === "Consumer") {
    return <ConsumerDashboard onLogout={onLogout} />;
  }

  useEffect(() => {
    if (prevView.current !== view) { setAnimIn(false); setTimeout(() => setAnimIn(true), 30); }
    prevView.current = view;
  }, [view]);

  const handleScan = () => {
    const match = products.find(p => p.id === scanInput.trim() || p.batch === scanInput.trim());
    setScanResult(match || null);
    if (match) setSelected(match);
  };

  const totalBlocks = chain.length;
  const verified = products.flatMap(p => p.stages).filter(s => s.verified).length;
  const pending = products.flatMap(p => p.stages).filter(s => !s.verified).length;

  const navBtn = active => ({ background: active ? C.card : "transparent", border: `1px solid ${active ? C.accent : "transparent"}`, color: active ? C.accent : C.muted, padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontFamily: "'Crimson Pro', serif", transition: "all .2s" });
  const tag = (color, bg) => ({ background: bg, color, fontSize: 11, fontFamily: "monospace", padding: "2px 8px", borderRadius: 4, display: "inline-block" });
  const btn = (v = "primary") => ({ background: v === "primary" ? C.accent : "transparent", color: v === "primary" ? C.bg : C.accent, border: `1px solid ${C.accent}`, padding: "8px 18px", borderRadius: 7, cursor: "pointer", fontSize: 13, fontFamily: "monospace", fontWeight: 600 });
  const statCard = accent => ({ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${accent}`, borderRadius: 8, padding: "14px 18px" });

  const DashView = () => (
    <>
      <div style={{ fontSize: 28, fontWeight: 700, color: C.text, marginBottom: 4 }}>Supply Chain Overview</div>
      <div style={{ fontSize: 14, color: C.muted, marginBottom: 24, fontFamily: "monospace" }}>BLOCKCHAIN-VERIFIED AYURVEDIC TRACEABILITY NETWORK</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 28 }}>
        {[{ label: "Chain Blocks", value: totalBlocks, accent: C.accent }, { label: "Products Tracked", value: products.length, accent: C.teal }, { label: "Verified Events", value: verified, accent: C.gold }, { label: "Pending Verification", value: pending, accent: C.danger }].map(({ label, value, accent }) => (
          <div key={label} style={statCard(accent)}>
            <div style={{ fontSize: 32, fontWeight: 700, color: accent, fontFamily: "monospace" }}>{value}</div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: "monospace", marginTop: 2 }}>{label.toUpperCase()}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 16, color: C.muted, marginBottom: 14, fontFamily: "monospace" }}>— ACTIVE PRODUCT BATCHES</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 20 }}>
        {products.map(p => {
          const sb = statusBadge(p.status);
          return (
            <div key={p.id} style={{ background: C.card, border: `1px solid ${selected?.id === p.id ? C.accent : C.border}`, borderRadius: 12, padding: 20, cursor: "pointer", transition: "all .2s" }}
              onClick={() => { setSelected(p); setView("product"); }}
              onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
              onMouseLeave={e => e.currentTarget.style.transform = "none"}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{p.herb}</div>
                  <div style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>{p.id} · {p.batch}</div>
                </div>
                <div style={tag(sb.color, sb.bg)}>{sb.label}</div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>STAGE {p.currentStage + 1} / {p.stages.length}</span>
                  <span style={{ fontSize: 11, color: C.accent, fontFamily: "monospace" }}>{p.stages[p.currentStage]?.name}</span>
                </div>
                <div style={{ height: 4, background: C.surface, borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${((p.currentStage + 1) / p.stages.length) * 100}%`, background: `linear-gradient(to right,${C.teal},${C.accent})`, borderRadius: 2 }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {p.stages.map((s, i) => (
                  <div key={i} style={{ fontSize: 10, fontFamily: "monospace", padding: "2px 7px", borderRadius: 4, background: i <= p.currentStage ? C.surface : C.bg, border: `1px solid ${i <= p.currentStage ? C.accent : C.border}`, color: i <= p.currentStage ? C.accent : C.muted, display: "flex", alignItems: "center", gap: 3 }}>
                    {stageIcon(s.name)} {s.name.split(" ")[0]}{s.verified && <span>✓</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  const ProductView = () => {
    if (!selected) return <div style={{ color: C.muted, padding: 40, textAlign: "center" }}>Select a product from the dashboard.</div>;
    const sb = statusBadge(selected.status);
    return (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{selected.herb}</div>
            <div style={{ fontSize: 14, color: C.muted, fontFamily: "monospace" }}>{selected.id} · Batch {selected.batch}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={tag(sb.color, sb.bg)}>{sb.label}</div>
            <QRCode value={selected.id} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 310px", gap: 24 }}>
          <div>
            <div style={{ fontSize: 13, color: C.muted, fontFamily: "monospace", marginBottom: 16 }}>— SUPPLY CHAIN JOURNEY</div>
            <div style={{ position: "relative", paddingLeft: 28 }}>
              <div style={{ position: "absolute", left: 10, top: 0, bottom: 0, width: 2, background: `linear-gradient(to bottom,${C.accent},${C.border})` }} />
              {selected.stages.map((s, i) => (
                <div key={i} style={{ position: "relative", marginBottom: 24, paddingLeft: 16 }}>
                  <div style={{ position: "absolute", left: -22, top: 4, width: 14, height: 14, borderRadius: "50%", background: s.verified ? C.accent : C.gold, border: `2px solid ${C.bg}`, zIndex: 1 }} />
                  <div style={{ background: C.card, border: `1px solid ${i <= selected.currentStage ? C.border : "#1A2A1C"}`, borderRadius: 10, padding: 16, opacity: i <= selected.currentStage ? 1 : 0.45 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div><span style={{ fontSize: 16 }}>{stageIcon(s.name)}</span><span style={{ fontWeight: 700, marginLeft: 8 }}>{s.name}</span></div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <div style={tag(roleColor(s.role), C.surface)}>{s.role}</div>
                        {s.verified ? <div style={{ fontSize: 11, color: C.accent, fontFamily: "monospace" }}>✓ VERIFIED</div> : <div style={{ fontSize: 11, color: C.gold, fontFamily: "monospace" }}>⚠ PENDING</div>}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                      <div><div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>ACTOR</div><div style={{ fontSize: 13 }}>{s.actor}</div></div>
                      <div><div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>TIMESTAMP</div><div style={{ fontSize: 13, fontFamily: "monospace" }}>{new Date(s.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div></div>
                      <div><div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>LOCATION</div><div style={{ fontSize: 13, color: C.teal }}>📍 {s.location.label}</div></div>
                      <div><div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>GPS</div><div style={{ fontSize: 11, fontFamily: "monospace", color: C.muted }}>{s.location.lat.toFixed(2)}°N, {s.location.lng.toFixed(2)}°E</div></div>
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, fontStyle: "italic", borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>{s.notes}</div>
                    <div style={{ marginTop: 8, fontSize: 10, fontFamily: "monospace", color: C.border }}>BLOCK HASH: {hashBlock({ productId: selected.id, stage: s.name, actor: s.actor }, "prev")}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: C.muted, fontFamily: "monospace", marginBottom: 12 }}>— GEO MAP</div>
            <MiniMap stages={selected.stages.slice(0, selected.currentStage + 1)} />
            <div style={{ marginTop: 20, fontSize: 13, color: C.muted, fontFamily: "monospace", marginBottom: 12 }}>— PRODUCT QR CODE</div>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <QRCode value={selected.id} />
              <div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>SCAN TO VERIFY</div>
                <div style={{ fontSize: 14, color: C.accent, fontFamily: "monospace", marginTop: 4 }}>{selected.id}</div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>Batch: {selected.batch}</div>
              </div>
            </div>
            <div style={{ marginTop: 20, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 13, color: C.muted, fontFamily: "monospace", marginBottom: 8 }}>CHAIN INTEGRITY</div>
              {selected.stages.map((s, i) => {
                const h = hashBlock({ productId: selected.id, stage: s.name, actor: s.actor }, "prev");
                return <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11, fontFamily: "monospace" }}><span style={{ color: C.muted }}>{s.name.split(" ")[0]}</span><span style={{ color: i <= selected.currentStage ? C.accent : C.border }}>{h.slice(0, 12)}…</span></div>;
              })}
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Crimson Pro', Georgia, serif", display: "flex", flexDirection: "column" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&display=swap'); *{box-sizing:border-box;margin:0;padding:0} ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:#0D1F0F} ::-webkit-scrollbar-thumb{background:#2A5535;border-radius:3px}`}</style>
      <header style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 26 }}>🌿</span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.accent }}>AyurTrace</div>
            <div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace", letterSpacing: "2px" }}>BLOCKCHAIN SUPPLY CHAIN</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[["dashboard","Dashboard"],["product","Product Detail"],["blockchain","Ledger"],["scan","Verify / Scan"]].map(([v,l]) => (
            <button key={v} style={navBtn(view === v)} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>ROLE:</span>
          <select style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, padding: "5px 10px", borderRadius: 6, fontSize: 12, fontFamily: "monospace" }} value={role} onChange={e => setRole(e.target.value)}>
            {["Farmer","Merchant","Consumer"].map(r => <option key={r}>{r}</option>)}
          </select>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent, boxShadow: `0 0 8px ${C.accent}` }} />
          <span style={{ fontSize: 11, color: C.accent, fontFamily: "monospace" }}>LIVE</span>
          <button onClick={onLogout} style={{ marginLeft: 6, background: "transparent", border: `1px solid ${C.border}`, color: C.muted, padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>LOGOUT</button>
        </div>
      </header>
      <main style={{ flex: 1, padding: "28px 24px", maxWidth: 1100, margin: "0 auto", width: "100%", opacity: animIn ? 1 : 0, transition: "opacity .2s" }}>
        {view === "dashboard" && <DashView />}
        {view === "product" && <ProductView />}
        {view === "blockchain" && (
          <>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Blockchain Ledger</div>
            <div style={{ fontSize: 14, color: C.muted, marginBottom: 24, fontFamily: "monospace" }}>IMMUTABLE SUPPLY CHAIN RECORDS · {chain.length} BLOCKS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>{chain.map(b => <BlockCard key={b.index} block={b} />)}</div>
          </>
        )}
        {view === "scan" && (
          <>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Verify Product</div>
            <div style={{ fontSize: 14, color: C.muted, marginBottom: 24, fontFamily: "monospace" }}>ENTER PRODUCT ID OR BATCH NUMBER TO TRACE ORIGIN</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
              <input style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: "10px 14px", borderRadius: 7, fontSize: 13, fontFamily: "monospace", outline: "none", width: 260 }} placeholder="e.g. AYU-2025-001 or ASH-B01" value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleScan()} />
              <button style={btn("primary")} onClick={handleScan}>VERIFY →</button>
            </div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: "monospace", marginBottom: 8 }}>QUICK SCAN EXAMPLES:</div>
              <div style={{ display: "flex", gap: 8 }}>
                {products.map(p => <button key={p.id} style={{ ...btn("outline"), fontSize: 11 }} onClick={() => { setScanInput(p.id); setScanResult(p); setSelected(p); }}>{p.id}</button>)}
              </div>
            </div>
            {scanResult && (
              <div style={{ background: C.card, border: `1px solid ${C.accent}`, borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", gap: 16 }}>
                  <QRCode value={scanResult.id} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: C.accent }}>{scanResult.herb}</div>
                      <div style={tag(statusBadge(scanResult.status).color, statusBadge(scanResult.status).bg)}>{statusBadge(scanResult.status).label}</div>
                    </div>
                    <div style={{ fontSize: 12, fontFamily: "monospace", color: C.muted, marginBottom: 12 }}>{scanResult.id} · Batch {scanResult.batch}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                      <div><div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>ORIGIN</div><div style={{ color: C.teal }}>📍 {scanResult.stages[0]?.location.label}</div></div>
                      <div><div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>CURRENT STAGE</div><div>{scanResult.stages[scanResult.currentStage]?.name}</div></div>
                      <div><div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>TOTAL STAGES</div><div>{scanResult.stages.length} (✓ {scanResult.stages.filter(s => s.verified).length} verified)</div></div>
                      <div><div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>CHAIN BLOCKS</div><div style={{ fontFamily: "monospace", color: C.accent }}>{scanResult.stages.length} blocks</div></div>
                    </div>
                    <button style={btn("primary")} onClick={() => { setSelected(scanResult); setView("product"); }}>VIEW FULL TRACE →</button>
                  </div>
                </div>
              </div>
            )}
            {scanInput && !scanResult && <div style={{ color: C.danger, fontFamily: "monospace", fontSize: 13 }}>✗ No product found for "{scanInput}"</div>}
          </>
        )}
      </main>
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", background: C.surface }}>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>AyurTrace · Immutable Ayurvedic Supply Chain · {chain.length} Blocks Committed</div>
        <div style={{ display: "flex", gap: 16 }}>
          {products.map(p => { const sb = statusBadge(p.status); return <div key={p.id} style={{ fontSize: 10, fontFamily: "monospace", color: sb.color }}>{p.herb}: {sb.label}</div>; })}
        </div>
      </footer>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("landing");
  const [userRole, setUserRole] = useState(null);
  if (page === "app") return <MainDashboard userRole={userRole} onLogout={() => { setUserRole(null); setPage("landing"); }} />;
  if (page === "login" || page === "signup") return <AuthPage mode={page} onNavigate={setPage} onLogin={r => { setUserRole(r); setPage("app"); }} />;
  return <LandingPage onNavigate={setPage} />;
}
