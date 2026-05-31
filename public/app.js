const $ = (sel) => document.querySelector(sel);
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CATEGORIES = [
  { key: '', label: 'All' },
  { key: 'exotic', label: 'Exotics' },
  { key: 'special_rarity', label: 'Special rarity' },
  { key: 'curated_rare', label: 'Collectors' },
  { key: 'game_breaker', label: 'Game breakers' },
];

const state = { category: '', q: '', confidence: '', source: '', offset: 0 };

// ---------- stats ----------
async function loadStats() {
  try {
    const s = await (await fetch('/api/stats')).json();
    const chips = [
      `<span class="stat-chip"><b>${fmt(s.totalFindings)}</b> findings</span>`,
      `<span class="stat-chip"><b>${fmt(s.totalAccounts)}</b> accounts</span>`,
    ];
    for (const c of (s.byCategory || []).slice(0, 4)) {
      chips.push(`<span class="stat-chip">${esc(c.category)}: <b>${fmt(c.c)}</b></span>`);
    }
    if (s.ahWorker && s.ahWorker.enabled) {
      chips.push(`<span class="stat-chip ok">AH worker on</span>`);
    }
    if (s.capabilities && !s.capabilities.hypixelKey) {
      chips.push(`<span class="stat-chip warn">no Hypixel key → SkyCrypt fallback</span>`);
    }
    $('#stats').innerHTML = chips.join('');
  } catch {
    $('#stats').innerHTML = '<span class="stat-chip warn">stats unavailable</span>';
  }
}

// ---------- scan ----------
$('#scan-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#scan-input').value.trim();
  if (!name) return;
  const box = $('#scan-result');
  box.innerHTML = `<p class="hint">Scanning <b>${esc(name)}</b>… (this can take a few seconds)</p>`;
  try {
    const res = await fetch(`/api/scan/${encodeURIComponent(name)}`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'scan failed');
    box.innerHTML =
      `<p class="ok">Scanned <b>${esc(data.username || name)}</b> · ${data.profilesScanned} profile(s) · ` +
      `${fmt(data.itemsScanned)} items · <b>${fmt(data.findings.length)}</b> findings ` +
      `(${fmt(data.newFindings)} new) · mode: ${esc(data.mode)}</p>`;
    box.innerHTML += renderCards(data.findings);
    loadStats();
    resetAndLoadFindings();
  } catch (err) {
    box.innerHTML = `<p class="error">✕ ${esc(err.message)}</p>
      <p class="hint">If this says 403 / timed out, the data APIs are blocked by this environment's network policy. Run locally or loosen the policy.</p>`;
  }
});

// ---------- findings browser ----------
function renderCatFilters() {
  $('#cat-filters').innerHTML = CATEGORIES.map(
    (c) => `<span class="chip ${c.key === state.category ? 'active' : ''}" data-cat="${c.key}">${c.label}</span>`,
  ).join('');
  document.querySelectorAll('#cat-filters .chip').forEach((el) =>
    el.addEventListener('click', () => {
      state.category = el.dataset.cat;
      renderCatFilters();
      resetAndLoadFindings();
    }),
  );
}

function cardFor(f) {
  const isExotic = f.category === 'exotic' && f.hex;
  const swatch = isExotic
    ? `<div class="swatch" style="background:#${esc(f.hex)}" title="#${esc(f.hex)}"></div>`
    : `<div class="swatch" style="background:linear-gradient(135deg,#2a2f3d,#3a4050)"></div>`;
  const player = f.username
    ? `<a href="https://sky.shiiyu.moe/stats/${encodeURIComponent(f.username)}" target="_blank" rel="noopener">${esc(f.username)}</a>`
    : (f.account_uuid ? `<span class="mono">${esc(String(f.account_uuid).slice(0, 8))}…</span>` : '—');
  const price = f.price ? `${fmt(f.price)} coins` : '';
  const confBadge = f.confidence === 'low' ? `<span class="badge conf-low">low conf</span>` : '';
  return `
    <div class="card">
      <div class="card-head">
        ${swatch}
        <div>
          <div class="card-title">${esc(f.item_name || f.item_id || 'Unknown')}</div>
          <div class="card-sub mono">${esc(f.item_id || '')}${isExotic ? ' · #' + esc(f.hex) : ''}</div>
        </div>
      </div>
      <div class="badges">
        <span class="badge ${esc(f.category)}">${esc((f.subcategory || f.category).replace('_', ' '))}</span>
        ${f.rarity ? `<span class="badge">${esc(f.rarity.replace('_', ' '))}</span>` : ''}
        ${confBadge}
      </div>
      ${f.reason ? `<div class="reason">${esc(f.reason)}</div>` : ''}
      <div class="card-foot">
        <span>${player}</span>
        <span>${esc(price)}</span>
      </div>
    </div>`;
}

function renderCards(list) {
  if (!list || !list.length) return `<div class="empty">No findings yet.</div>`;
  return `<div class="grid">${list.map(cardFor).join('')}</div>`;
}

const PAGE = 60;
async function loadFindings(append = false) {
  const p = new URLSearchParams();
  if (state.category) p.set('category', state.category);
  if (state.q) p.set('q', state.q);
  if (state.confidence) p.set('confidence', state.confidence);
  if (state.source) p.set('source', state.source);
  p.set('limit', PAGE);
  p.set('offset', state.offset);
  const data = await (await fetch(`/api/findings?${p}`)).json();
  const html = (data.findings || []).map(cardFor).join('');
  const grid = $('#findings');
  if (append) grid.insertAdjacentHTML('beforeend', html);
  else grid.innerHTML = html || `<div class="empty">No findings match. Scan a player above to populate the database.</div>`;
  $('#load-more').hidden = (data.findings || []).length < PAGE;
}

function resetAndLoadFindings() {
  state.offset = 0;
  loadFindings(false);
}

$('#find-search').addEventListener('input', (e) => {
  state.q = e.target.value.trim();
  clearTimeout(window.__t);
  window.__t = setTimeout(resetAndLoadFindings, 250);
});
$('#conf-filter').addEventListener('change', (e) => { state.confidence = e.target.value; resetAndLoadFindings(); });
$('#source-filter').addEventListener('change', (e) => { state.source = e.target.value; resetAndLoadFindings(); });
$('#load-more').addEventListener('click', () => { state.offset += PAGE; loadFindings(true); });

// ---------- prices ----------
$('#price-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const item = $('#price-input').value.trim().toUpperCase();
  if (!item) return;
  const box = $('#price-result');
  box.innerHTML = `<p class="hint">Fetching ${esc(item)}…</p>`;
  try {
    const data = await (await fetch(`/api/prices/${encodeURIComponent(item)}`)).json();
    let html = '<table class="kv">';
    const cur = data.current || {};
    const buy = cur.buy ?? cur.buyPrice ?? cur.lowestBin ?? cur.min;
    const sell = cur.sell ?? cur.sellPrice ?? cur.median ?? cur.max;
    html += `<tr><td>Item</td><td class="mono">${esc(data.item)}</td></tr>`;
    if (buy != null) html += `<tr><td>Buy / lowest</td><td>${fmt(Math.round(buy))} coins</td></tr>`;
    if (sell != null) html += `<tr><td>Sell / median</td><td>${fmt(Math.round(sell))} coins</td></tr>`;
    if (data.currentError) html += `<tr><td>Current</td><td class="error">${esc(data.currentError)}</td></tr>`;
    if (data.historyError) html += `<tr><td>History</td><td class="error">${esc(data.historyError)}</td></tr>`;
    html += '</table>';
    box.innerHTML = html;
    drawSpark(box, data.history);
  } catch (err) {
    box.innerHTML = `<p class="error">✕ ${esc(err.message)}</p>`;
  }
});

function drawSpark(box, history) {
  if (!Array.isArray(history) || history.length < 2) return;
  const points = history
    .map((h) => h.price ?? h.avg ?? h.buy ?? h.sell ?? h.min ?? h.max ?? h.value)
    .filter((v) => typeof v === 'number');
  if (points.length < 2) return;
  const c = document.createElement('canvas');
  c.className = 'spark';
  c.width = 600; c.height = 60;
  box.appendChild(c);
  const ctx = c.getContext('2d');
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  ctx.strokeStyle = '#00d4a0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((v, i) => {
    const x = (i / (points.length - 1)) * c.width;
    const y = c.height - ((v - min) / range) * (c.height - 8) - 4;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}

// ---------- boot ----------
renderCatFilters();
loadStats();
loadFindings(false);
