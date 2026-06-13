const $ = (sel) => document.querySelector(sel);
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// SkyCrypt profile URL for a player. Accepts a username or UUID; appends the
// specific SkyBlock profile (cute name like "Mango") when we know it, so the
// link opens the exact profile the item was found on.
function skycryptUrl(handle, profileName) {
  if (!handle) return null;
  let u = `https://sky.shiiyu.moe/stats/${encodeURIComponent(handle)}`;
  if (profileName) u += `/${encodeURIComponent(profileName)}`;
  return u;
}

// Render the owner as a SkyCrypt link. Works for both named players and AH
// finds that only have a UUID (SkyCrypt accepts a UUID too). `short` truncates
// a bare UUID for compact card display.
function playerLink(f, { short = false } = {}) {
  const handle = f.username || f.account_uuid;
  if (!handle) return '—';
  const label = f.username
    ? esc(f.username)
    : `<span class="mono">${esc(short ? String(handle).slice(0, 8) + '…' : handle)}</span>`;
  const url = skycryptUrl(handle, f.profile_name);
  return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
}

// Friendly names for the raw inventory location keys Hypixel uses.
const LOCATION_LABELS = {
  inv_contents: 'Inventory',
  inventory: 'Inventory',
  ender_chest_contents: 'Ender Chest',
  backpack_contents: 'Backpack',
  backpack_icons: 'Backpack',
  personal_vault_contents: 'Personal Vault',
  wardrobe_contents: 'Wardrobe',
  equipment_contents: 'Equipment slots',
  talisman_bag: 'Accessory Bag',
  fishing_bag: 'Fishing Bag',
  quiver: 'Quiver',
  potion_bag: 'Potion Bag',
  sacks_counts: 'Sacks',
  candy_inventory_contents: 'Candy Bag',
  armor: 'Armor (equipped)',
  inv_armor: 'Armor (equipped)',
  wardrobe: 'Wardrobe',
  auction: 'Auction House (listed for sale)',
};
function locationLabel(loc) {
  if (!loc) return 'Unknown';
  if (LOCATION_LABELS[loc]) return LOCATION_LABELS[loc];
  // Fallback: turn snake_case into Title Case, drop a trailing "contents".
  return String(loc)
    .replace(/_contents$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Natural-language "where it was found" phrase for the detail view.
function locationPhrase(f) {
  const label = locationLabel(f.location);
  if (f.location === 'auction') return 'Listed on the Auction House';
  if (!f.location) return 'Location unknown';
  const who = f.username ? `${f.username}'s` : 'their';
  return `In ${who} ${label}`;
}


const CATEGORIES = [
  { key: '', label: 'All' },
  { key: 'exotic', label: 'Exotics' },
  { key: 'game_breaker', label: 'Game breakers' },
  { key: 'curated_rare', label: 'Collectors' },
  { key: 'special_rarity', label: 'Special rarity' },
  { key: 'random_dyed', label: 'Random-dyed (Satin)' },
];

const state = { category: '', q: '', confidence: '', source: '', item: '', color: '', itemState: '', offset: 0 };

// ---------- stats + engine bar ----------
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
    if (s.capabilities && !s.capabilities.hypixelKey) {
      chips.push(`<span class="stat-chip warn">no Hypixel key → SkyCrypt fallback</span>`);
    } else if (s.capabilities && s.capabilities.hypixelKey) {
      chips.push(`<span class="stat-chip ok">Hypixel key ✓ friend-chain on</span>`);
    }
    $('#stats').innerHTML = chips.join('');
    renderEngineBar(s);
  } catch {
    $('#stats').innerHTML = '<span class="stat-chip warn">stats unavailable</span>';
  }
}

function renderEngineBar(s) {
  const ah = s.ahWorker || {};
  const cr = s.crawler || {};
  const q = cr.queue || {};
  const t = cr.totals || {};
  const cards = [
    `<div class="engine-stat ${ah.enabled ? 'live' : ''}"><b>${ah.enabled ? (ah.running ? 'scanning…' : 'on') : 'off'}</b>AH worker</div>`,
    `<div class="engine-stat ${cr.enabled ? 'live' : ''}"><b>${cr.enabled ? (cr.running ? 'crawling…' : 'on') : 'off'}</b>Crawler</div>`,
    `<div class="engine-stat"><b>${fmt(q.queued || 0)}</b>queued</div>`,
    `<div class="engine-stat"><b>${fmt(q.done || 0)}</b>accounts crawled</div>`,
    `<div class="engine-stat"><b>${fmt(t.scanned || 0)}</b>scanned this run</div>`,
  ];
  cards.push(`<div class="engine-stat"><b>${fmt(cr.scansPerMin || 0)}</b>scans / min</div>`);
  // Daily key-request budget — the thing that was getting burned.
  const b = cr.budget;
  if (b && b.limit) {
    const cls = b.spent ? '' : 'live';
    const label = b.spent ? `spent · resets ~${b.resetInHours}h` : 'daily key budget';
    cards.push(`<div class="engine-stat ${cls}"><b>${fmt(b.remaining)} / ${fmt(b.limit)}</b>${label}</div>`);
  }
  if (t.errors) cards.push(`<div class="engine-stat"><b>${fmt(t.errors)}</b>errors</div>`);
  $('#engine-bar').innerHTML = cards.join('');

  // Show WHY scans are failing (top error kinds), so problems are diagnosable.
  const kinds = Object.entries(cr.errorKinds || {}).sort((a, b) => b[1] - a[1]);
  let diag = $('#engine-diag');
  if (!diag) {
    diag = document.createElement('div');
    diag.id = 'engine-diag';
    diag.className = 'engine-diag';
    $('#engine-bar').after(diag);
  }
  if (kinds.length && (t.scanned || 0) === 0) {
    diag.innerHTML = `<span class="warn-text">⚠ scans failing:</span> ` +
      kinds.slice(0, 3).map(([k, n]) => `${esc(k)} <b>×${fmt(n)}</b>`).join(' · ');
  } else if (kinds.length) {
    diag.innerHTML = `<span class="muted">errors:</span> ` +
      kinds.slice(0, 3).map(([k, n]) => `${esc(k)} ×${fmt(n)}`).join(' · ');
  } else {
    diag.innerHTML = '';
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
    const warn = data.warning ? ` · <span class="warn-text">${esc(data.warning)}</span>` : '';
    box.innerHTML =
      `<p class="ok">Scanned <b>${esc(data.username || name)}</b> · ${data.profilesScanned} profile(s) · ` +
      `${fmt(data.itemsScanned)} items · <b>${fmt(data.findings.length)}</b> findings ` +
      `(${fmt(data.newFindings)} new) · mode: ${esc(data.mode)}${warn}</p>`;
    box.innerHTML += renderCards(data.findings);
    loadStats();
    resetAndLoadFindings();
  } catch (err) {
    box.innerHTML = `<p class="error">✕ ${esc(err.message)}</p>
      <p class="hint">If this says 403 / timed out, the data APIs are blocked by this environment's network policy. Run locally or loosen the policy.</p>`;
  }
});

// "Add to crawl" — enqueue without waiting for a full scan.
$('#queue-btn').addEventListener('click', async () => {
  const name = $('#scan-input').value.trim();
  if (!name) return;
  const box = $('#scan-result');
  try {
    const res = await fetch('/api/crawl/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'enqueue failed');
    box.innerHTML = `<p class="ok">Queued <b>${esc(name)}</b> for the crawler${data.added ? '' : ' (already queued)'}.</p>`;
    loadStats();
  } catch (err) {
    box.innerHTML = `<p class="error">✕ ${esc(err.message)}</p>`;
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

function cardFor(f, flash = false) {
  const isExotic = f.category === 'exotic' && f.hex;
  const swatch = isExotic
    ? `<div class="swatch" style="background:#${esc(f.hex)}" title="#${esc(f.hex)}"></div>`
    : `<div class="swatch" style="background:linear-gradient(135deg,#2a2f3d,#3a4050)"></div>`;
  const price = f.price ? `${fmt(f.price)} coins` : '';
  const confBadge = f.confidence === 'low' ? `<span class="badge conf-low">low conf</span>` : '';
  const stateBadge = f.reforge
    ? `<span class="badge state" title="Reforge: ${esc(f.reforge)}">✦ ${esc(f.reforge)}</span>`
    : (f.enchanted ? '<span class="badge state">✦ enchanted</span>' : '<span class="badge state">clean</span>');
  return `
    <div class="card clickable${flash ? ' flash' : ''}" data-id="${esc(f.id)}" title="Click for details, price &amp; colour population">
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
        ${stateBadge}
        ${confBadge}
      </div>
      ${f.reason ? `<div class="reason">${esc(f.reason)}</div>` : ''}
      <div class="card-foot">
        <span title="Open on SkyCrypt">👤 ${playerLink(f, { short: true })}</span>
        <span title="Where on their profile">📍 ${esc(locationLabel(f.location))}</span>
      </div>
      ${price ? `<div class="card-price">${esc(price)}</div>` : ''}
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
  if (state.item) p.set('item', state.item);
  if (state.color) p.set('color', state.color.replace(/^#/, ''));
  if (state.itemState) p.set('state', state.itemState);
  p.set('limit', PAGE);
  p.set('offset', state.offset);
  const data = await (await fetch(`/api/findings?${p}`)).json();
  const html = (data.findings || []).map(cardFor).join('');
  const grid = $('#findings');
  if (append) grid.insertAdjacentHTML('beforeend', html);
  else grid.innerHTML = html || `<div class="empty">No findings match these filters.</div>`;
  $('#load-more').hidden = (data.findings || []).length < PAGE;
}

function resetAndLoadFindings() {
  state.offset = 0;
  loadFindings(false);
}

const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

$('#find-search').addEventListener('input', debounce((e) => {
  state.q = e.target.value.trim();
  resetAndLoadFindings();
}));
$('#item-search').addEventListener('input', debounce((e) => {
  state.item = e.target.value.trim();
  resetAndLoadFindings();
}));
// Named colours -> a representative swatch for the preview box + quick chips.
const NAMED_COLORS = {
  red: 'ff0000', orange: 'ff9000', brown: '7a4a1e', yellow: 'ffe000', green: '22c032',
  cyan: '22d3d3', blue: '2a6cff', purple: '9b30ff', pink: 'ff5fd0',
  black: '111111', white: 'f5f5f5', gray: '8a8a8a',
};
function colorPreview(v) {
  const raw = v.trim().toLowerCase().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw.split('').map((c) => c + c).join('')}`;
  const named = NAMED_COLORS[raw] || NAMED_COLORS[({ grey: 'gray', magenta: 'pink', violet: 'purple', aqua: 'cyan', teal: 'cyan', gold: 'yellow' })[raw]];
  return named ? `#${named}` : 'transparent';
}
function applyColorSearch(v) {
  state.color = v;
  $('#color-search').value = v;
  $('#color-swatch').style.background = colorPreview(v);
  resetAndLoadFindings();
}
$('#color-search').addEventListener('input', debounce((e) => applyColorSearch(e.target.value.trim())));

// Quick general-colour chips.
$('#color-chips').innerHTML =
  `<span class="chip color-chip" data-color="">any</span>` +
  Object.keys(NAMED_COLORS).map((n) =>
    `<span class="chip color-chip" data-color="${n}"><span class="cc-dot" style="background:#${NAMED_COLORS[n]}"></span>${n}</span>`).join('');
document.querySelectorAll('#color-chips .color-chip').forEach((el) =>
  el.addEventListener('click', () => {
    document.querySelectorAll('#color-chips .color-chip').forEach((c) => c.classList.remove('active'));
    el.classList.add('active');
    applyColorSearch(el.dataset.color);
  }));
$('#state-filter').addEventListener('change', (e) => { state.itemState = e.target.value; resetAndLoadFindings(); });
$('#conf-filter').addEventListener('change', (e) => { state.confidence = e.target.value; resetAndLoadFindings(); });
$('#source-filter').addEventListener('change', (e) => { state.source = e.target.value; resetAndLoadFindings(); });
$('#load-more').addEventListener('click', () => { state.offset += PAGE; loadFindings(true); });

// ---------- reference panel ----------
let refLoaded = false;
function swatchChips(map) {
  return Object.entries(map)
    .map(([k, hex]) => `<span class="swatch-chip"><span class="sw" style="background:#${esc(hex)}"></span>${esc(k)} <span class="mono">#${esc(hex)}</span></span>`)
    .join('');
}
function hexChips(list) {
  return (list || [])
    .map((hex) => `<span class="swatch-chip"><span class="sw" style="background:#${esc(hex)}"></span><span class="mono">#${esc(hex)}</span></span>`)
    .join('');
}
async function loadReference() {
  const box = $('#reference');
  box.innerHTML = `<p class="hint">Loading…</p>`;
  try {
    const r = await (await fetch('/api/reference')).json();
    const ex = r.exotic || {}; const no = r.notExotic || {}; const ri = r.rareItems || {};
    const famHtml = Object.entries(ex.families || {}).map(([name, list]) => `
      <div class="ref-fam">
        <div class="ref-fam-name">${esc(name.replace('_', ' '))} ${list.length ? `<span class="mono">(${list.length})</span>` : '<span class="mono">(open — any off-chart colour)</span>'}</div>
        ${ex.info && ex.info[name] ? `<div class="ref-fam-info">${esc(ex.info[name])}</div>` : ''}
        ${list.length ? `<div class="swatch-grid">${hexChips(list)}</div>` : ''}
      </div>`).join('');

    const knownHtml = Object.entries(no.knownDyes || {}).map(([name, list]) => `
      <div class="ref-fam">
        <div class="ref-fam-name">${esc(name)} dye <span class="mono">(${list.length})</span></div>
        <div class="swatch-grid">${hexChips(list)}</div>
      </div>`).join('');

    const rareHtml = (items, title) => `
      <div class="ref-fam">
        <div class="ref-fam-name">${esc(title)} <span class="mono">(${items.length})</span></div>
        <div class="ref-items">${items.map((i) => `<span class="ref-pill">${esc(i.label || i.id)} <span class="mono">${esc(i.id)}</span></span>`).join('')}</div>
      </div>`;

    box.innerHTML = `
      <div class="ref-group ref-yes">
        <h3>✓ EXOTIC colours (flagged)</h3>
        <p class="ref-desc">Off-default colours that aren't a known dye. Sub-tagged by likely origin:</p>
        ${famHtml}
      </div>
      <div class="ref-group ref-no">
        <h3>✕ NOT exotic</h3>
        <p class="ref-desc">${esc(no.note || '')}</p>
        <div class="ref-fam">
          <div class="ref-fam-name">Undyed / vanilla leather</div>
          <div class="swatch-grid">${hexChips([no.vanillaLeather])}</div>
        </div>
        ${knownHtml}
        <div class="ref-fam">
          <div class="ref-fam-name">Preloaded piece defaults <span class="mono">(${Object.keys(no.defaultColors || {}).length})</span></div>
          <div class="ref-fam-info">A piece showing its own factory colour is not exotic. The crawler also learns defaults as it scans.</div>
          <div class="swatch-grid">${swatchChips(no.defaultColors || {})}</div>
        </div>
      </div>
      <div class="ref-group">
        <h3>★ Rare ITEMS (flagged regardless of colour)</h3>
        <p class="ref-desc">Special-rarity tiers: <b>${(ri.specialRarityTiers || []).join(', ')}</b></p>
        ${rareHtml(ri.gameBreakers || [], 'Game breakers')}
        ${rareHtml(ri.curated || [], 'Collectors / cosmetics')}
      </div>`;
  } catch (err) {
    box.innerHTML = `<p class="error">✕ ${esc(err.message)}</p>`;
  }
}
$('#ref-toggle').addEventListener('click', () => {
  const box = $('#reference');
  const show = box.hidden;
  box.hidden = !show;
  $('#ref-toggle').textContent = show ? 'Hide' : 'Show';
  if (show && !refLoaded) { refLoaded = true; loadReference(); }
});

// ---------- item detail modal ----------
const overlay = $('#modal-overlay');
function closeModal() { overlay.hidden = true; $('#modal-body').innerHTML = ''; }
$('#modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) closeModal(); });

// Pull buy/sell out of Coflnet's various current-price shapes.
function extractPrices(cur = {}) {
  const buy = cur.buy ?? cur.buyPrice ?? cur.lowestBin ?? cur.lowest_bin ?? cur.min ?? cur.minPrice;
  const sell = cur.sell ?? cur.sellPrice ?? cur.median ?? cur.max ?? cur.maxPrice;
  return { buy, sell };
}

// Delegated click: any card opens its detail view (works for live-added cards).
document.addEventListener('click', (e) => {
  const card = e.target.closest('.card.clickable');
  if (!card || !card.dataset.id) return;
  openDetail(card.dataset.id);
});

async function openDetail(id) {
  overlay.hidden = false;
  $('#modal-body').innerHTML = `<p class="hint">Loading…</p>`;
  try {
    const d = await (await fetch(`/api/findings/${encodeURIComponent(id)}?span=week`)).json();
    if (!d.ok) throw new Error(d.error || 'not found');
    $('#modal-body').innerHTML = renderDetail(d);
    const bp = d.basePrice || {};
    if (bp.history) drawSpark($('#detail-spark'), bp.history);
  } catch (err) {
    $('#modal-body').innerHTML = `<p class="error">✕ ${esc(err.message)}</p>`;
  }
}

function renderDetail(d) {
  const f = d.finding;
  const isColored = Boolean(f.hex);
  const swatch = isColored
    ? `<div class="swatch big" style="background:#${esc(f.hex)}" title="#${esc(f.hex)}"></div>`
    : `<div class="swatch big" style="background:linear-gradient(135deg,#2a2f3d,#3a4050)"></div>`;

  // Owner line — links to the exact SkyCrypt profile (works for UUID-only AH finds too).
  const owner = playerLink(f);
  const scUrl = skycryptUrl(f.username || f.account_uuid, f.profile_name);

  // Base (non-dyed) price block.
  const bp = d.basePrice || {};
  const { buy, sell } = extractPrices(bp.current || {});
  let priceRows = '';
  if (buy != null) priceRows += `<tr><td>Buy / lowest BIN</td><td>${fmt(Math.round(buy))} coins</td></tr>`;
  if (sell != null) priceRows += `<tr><td>Sell / median</td><td>${fmt(Math.round(sell))} coins</td></tr>`;
  if (!priceRows) {
    priceRows = `<tr><td colspan="2" class="muted">${esc(bp.currentError || bp.historyError || 'No price data (item may be untracked or APIs unreachable)')}</td></tr>`;
  }

  // Colour population block.
  const cs = d.colorStats;
  let colorBlock = '';
  if (isColored && cs) {
    const items = (cs.byItem || [])
      .map((r) => `<tr><td>${esc(r.item_name || r.item_id || '—')}</td><td class="mono">${esc(r.item_id || '')}</td><td>${fmt(r.c)}</td></tr>`)
      .join('');
    const owners = (cs.byOwner || [])
      .map((r) => `<tr><td>${playerLink(r, { short: true })}</td><td>${fmt(r.c)}</td></tr>`)
      .join('');
    colorBlock = `
      <div class="detail-section">
        <h4>Colour population — <span class="mono">#${esc(cs.hex)}</span>${cs.subcategory ? ` <span class="badge exotic">${esc(cs.subcategory.replace('_', ' '))}</span>` : ''}</h4>
        <div class="pop-summary">
          <div class="pop-stat"><b>${fmt(cs.total)}</b>total pieces of this colour</div>
          <div class="pop-stat"><b>${fmt(cs.distinctOwners)}</b>distinct owners</div>
        </div>
        <div class="detail-cols">
          <div>
            <div class="detail-label">By item type</div>
            <table class="kv"><tbody>${items || '<tr><td class="muted">—</td></tr>'}</tbody></table>
          </div>
          <div>
            <div class="detail-label">Who has this colour</div>
            <table class="kv"><tbody>${owners || '<tr><td class="muted">—</td></tr>'}</tbody></table>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="detail-head">
      ${swatch}
      <div>
        <h3>${esc(f.item_name || f.item_id || 'Unknown')}</h3>
        <div class="card-sub mono">${esc(f.item_id || '')}${isColored ? ' · #' + esc(f.hex) : ''}</div>
        <div class="badges">
          <span class="badge ${esc(f.category)}">${esc((f.subcategory || f.category).replace('_', ' '))}</span>
          ${f.rarity ? `<span class="badge">${esc(f.rarity.replace('_', ' '))}</span>` : ''}
          ${f.confidence ? `<span class="badge conf-${esc(f.confidence)}">${esc(f.confidence)} conf</span>` : ''}
        </div>
      </div>
    </div>

    ${f.reason ? `<p class="reason">${esc(f.reason)}</p>` : ''}

    <div class="found-callout">📍 <b>${esc(locationPhrase(f))}</b></div>

    <div class="detail-section">
      <h4>Owner &amp; location</h4>
      <table class="kv"><tbody>
        <tr><td>Player</td><td>${owner}</td></tr>
        <tr><td>Profile</td><td>${f.profile_name ? esc(f.profile_name) : '<span class="muted">unknown</span>'}</td></tr>
        <tr><td>Found in</td><td>📍 ${esc(locationLabel(f.location))}</td></tr>
        <tr><td>Source</td><td>${esc(f.source === 'ah' ? 'Auction House' : (f.source || '—'))}</td></tr>
        ${f.price ? `<tr><td>Listed price (AH)</td><td>${fmt(f.price)} coins</td></tr>` : ''}
        ${f.account_uuid ? `<tr><td>UUID</td><td class="mono uuid-cell">${esc(f.account_uuid)}</td></tr>` : ''}
      </tbody></table>
      ${scUrl ? `<a class="sc-btn" href="${scUrl}" target="_blank" rel="noopener">View ${f.username ? esc(f.username) : 'player'} on SkyCrypt ↗</a>` : ''}
    </div>

    <div class="detail-section">
      <h4>Base item value <span class="muted">(non-dyed ${esc(f.item_id || 'item')})</span></h4>
      <table class="kv"><tbody>${priceRows}</tbody></table>
      <div id="detail-spark"></div>
      <p class="hint">Dyeing doesn't change the item id, so this is the AH/Bazaar value of the plain piece. Exotic colour is a separate premium on top.</p>
    </div>

    ${colorBlock}`;
}

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

// ---------- live discovery feed ----------
// Polls for findings newer than the newest we've shown and prepends them, so the
// site updates itself as the background crawler files new rares.
const live = { since: 0, seen: new Set(), enabled: true, max: 24, timer: null };

async function pollLive(first = false) {
  if (!live.enabled) return;
  try {
    // Live stream is chronological but hides random-dyed (Satin) so genuine
    // finds aren't buried.
    const url = first
      ? '/api/findings?limit=12&sort=recent&excludeCategory=random_dyed'
      : `/api/findings?since=${live.since}&limit=40&sort=recent&excludeCategory=random_dyed`;
    const data = await (await fetch(url)).json();
    const rows = data.findings || [];
    if (typeof data.latest === 'number') live.since = Math.max(live.since, data.latest);

    const feed = $('#live-feed');
    // On first load, just render the most recent few (newest first).
    if (first) {
      for (const f of rows) live.seen.add(f.id);
      feed.innerHTML = rows.map(cardFor).join('');
      return;
    }
    // Incremental: prepend genuinely-new findings with a flash.
    const fresh = rows.filter((f) => !live.seen.has(f.id));
    if (!fresh.length) return;
    for (const f of fresh) live.seen.add(f.id);
    // API returns newest-first; insert oldest-of-the-batch first so newest ends on top.
    for (const f of fresh.reverse()) {
      feed.insertAdjacentHTML('afterbegin', cardFor(f, true));
    }
    while (feed.children.length > live.max) feed.removeChild(feed.lastChild);
  } catch {
    /* transient; try again next tick */
  }
}

function setLive(on) {
  live.enabled = on;
  $('#live-dot').classList.toggle('on', on);
  if (on && !live.timer) {
    live.timer = setInterval(() => { pollLive(false); loadStats(); }, 4000);
  } else if (!on && live.timer) {
    clearInterval(live.timer);
    live.timer = null;
  }
}

$('#live-toggle').addEventListener('change', (e) => setLive(e.target.checked));

// ---------- boot ----------
renderCatFilters();
loadStats();
loadFindings(false);
pollLive(true);
setLive(true);
