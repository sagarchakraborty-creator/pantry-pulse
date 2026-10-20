'use strict';
// Pantry Pulse: stock is entered by hand as a percentage left; usage per week is worked out from the
// history of those entries and drives the weekend refill list, the low-stock prompt and reminders.
const KEY = 'pantry.v1';
const DAY = 864e5;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const APPS = {
  blinkit: { name: 'Blinkit', url: q => `https://blinkit.com/s/?q=${encodeURIComponent(q)}` },
  zepto: { name: 'Zepto', url: q => `https://www.zepto.com/search?query=${encodeURIComponent(q)}` },
  minutes: { name: 'Flipkart Minutes', url: q => `https://www.flipkart.com/search?q=${encodeURIComponent(q)}&marketplace=HYPERLOCAL` },
};
const CATS = ['Staples', 'Dals & pulses', 'Oils & ghee', 'Spices', 'Dairy & bakery', 'Snacks & drinks', 'Fruits & veg', 'Household', 'Personal care', 'Other'];
const STARTER = [
  ['Atta', 'Staples', '5 kg'], ['Rice', 'Staples', '5 kg'], ['Sugar', 'Staples', '1 kg'], ['Salt', 'Staples', '1 kg'],
  ['Poha', 'Staples', '500 g'], ['Besan', 'Staples', '500 g'],
  ['Toor dal', 'Dals & pulses', '1 kg'], ['Moong dal', 'Dals & pulses', '500 g'], ['Masoor dal', 'Dals & pulses', '500 g'], ['Rajma', 'Dals & pulses', '500 g'],
  ['Mustard oil', 'Oils & ghee', '1 L'], ['Sunflower oil', 'Oils & ghee', '1 L'], ['Ghee', 'Oils & ghee', '500 ml'],
  ['Turmeric', 'Spices', '100 g'], ['Red chilli powder', 'Spices', '100 g'], ['Jeera', 'Spices', '100 g'], ['Garam masala', 'Spices', '100 g'],
  ['Milk', 'Dairy & bakery', '7 L'], ['Curd', 'Dairy & bakery', '1 kg'], ['Paneer', 'Dairy & bakery', '400 g'], ['Bread', 'Dairy & bakery', '2 packs'], ['Eggs', 'Dairy & bakery', '12'],
  ['Tea', 'Snacks & drinks', '250 g'], ['Coffee', 'Snacks & drinks', '100 g'], ['Biscuits', 'Snacks & drinks', '4 packs'],
  ['Onion', 'Fruits & veg', '2 kg'], ['Potato', 'Fruits & veg', '2 kg'], ['Tomato', 'Fruits & veg', '1 kg'],
  ['Dishwash liquid', 'Household', '500 ml'], ['Detergent', 'Household', '1 kg'],
  ['Toothpaste', 'Personal care', '1'], ['Bath soap', 'Personal care', '4'],
];

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

let S = load();
let view = 'stock', filter = 'All', query = '', installEvt = null;

function defaults() {
  return { items: [], settings: { threshold: 10, refillDay: 6, checkEvery: 3, app: 'blinkit' }, notes: {} };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.items)) return { ...defaults(), ...s, settings: { ...defaults().settings, ...s.settings }, notes: s.notes || {} };
  } catch (e) { /* no saved data yet */ }
  return defaults();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save on this device'); }
  writeSummary();
}

/* ---------- stock maths ---------- */
const thr = () => S.settings.threshold;
function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function nextRefill() {
  const t = startOfDay();
  return new Date(+t + ((S.settings.refillDay - t.getDay() + 7) % 7) * DAY);
}
function daysToRefill() { return Math.round((nextRefill() - startOfDay()) / DAY); }
function refillWord() { const n = daysToRefill(); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : DAYS[S.settings.refillDay]; }
const fmtDate = d => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

// Percent used per week, from the latest run of entries since the item was last topped up.
function rate(it) {
  const h = it.hist;
  if (h.length < 2) return null;
  let i = h.length - 1;
  while (i > 0 && h[i - 1].p >= h[i].p) i--;
  const a = h[i], b = h[h.length - 1];
  const days = (b.t - a.t) / DAY;
  if (days < 0.5) return null;
  return Math.max(0, (a.p - b.p) / days * 7);
}
function projectedIn(it, days) {
  const r = rate(it);
  if (!r) return it.pct;
  return Math.max(0, it.pct - r / 7 * days);
}
function untilRefill() { return Math.max(0, (nextRefill() - Date.now()) / DAY); }
function status(it) {
  if (it.pct <= thr()) return 'low';
  if (projectedIn(it, untilRefill()) <= thr()) return 'soon';
  const r = rate(it);
  if (projectedIn(it, untilRefill() + 7) <= thr() || it.pct <= 30 || (r && r >= 35)) return 'watch';
  return 'ok';
}
function trend(it) {
  const r = rate(it);
  if (r == null) return it.hist.length < 2 ? 'Update again in a day or two to see usage' : 'Usage shows after another update';
  if (r < 1) return 'Hardly used lately';
  const base = `Using ~${Math.round(r)}% a week`;
  if (it.pct <= thr()) return base;
  const d = Math.round((it.pct - thr()) / (r / 7));
  return `${base} · below ${thr()}% in ${d < 1 ? 'under a day' : d + (d === 1 ? ' day' : ' days')}`;
}
function setPct(it, p) {
  p = Math.max(0, Math.min(100, Math.round(p)));
  const prev = it.pct, now = Date.now();
  const last = it.hist[it.hist.length - 1];
  // Entries a few minutes apart are the same reading being adjusted, so keep one point.
  if (last && now - last.t < 20 * 60e3) { last.p = p; last.t = now; } else it.hist.push({ t: now, p });
  if (it.hist.length > 90) it.hist = it.hist.slice(-90);
  if (p > prev) { it.onList = false; it.got = false; }
  it.pct = p; it.updated = now;
  return prev > thr() && p <= thr();
}
function refillGroups() {
  const by = s => S.items.filter(it => status(it) === s);
  const low = by('low').sort((a, b) => a.pct - b.pct);
  const soon = by('soon').sort((a, b) => a.pct - b.pct);
  const mine = S.items.filter(it => it.onList && !['low', 'soon'].includes(status(it)));
  const later = S.items.filter(it => status(it) === 'watch' && !it.onList && projectedIn(it, untilRefill() + 7) <= thr());
  return { low, soon, mine, later, count: low.length + soon.length + mine.length };
}
const stale = () => S.items.filter(it => Date.now() - (it.updated || 0) > S.settings.checkEvery * DAY);

/* ---------- rendering ---------- */
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  const g = refillGroups();
  const badge = $('#refillCount');
  badge.hidden = !g.count; badge.textContent = g.count;
  $('#fab').hidden = view !== 'stock' || !S.items.length;
  $('#checkBtn').hidden = view !== 'stock' || !S.items.length;
  const main = $('#main');
  if (view === 'stock') { $('#title').textContent = 'Pantry'; $('#subtitle').textContent = `${S.items.length} items · refill ${refillWord()}`; main.innerHTML = S.items.length ? stockView(g) : starterView(); }
  if (view === 'refill') { $('#title').textContent = 'Weekend refill'; $('#subtitle').textContent = fmtDate(nextRefill()); main.innerHTML = refillView(g); }
  if (view === 'settings') { $('#title').textContent = 'Settings'; $('#subtitle').textContent = 'Reminders, refill day, backup'; main.innerHTML = settingsView(); }
}

function stockView(g) {
  const counts = { low: 0, soon: 0, ok: 0 };
  S.items.forEach(it => { const s = status(it); counts[s === 'watch' ? 'ok' : s]++; });
  const st = stale();
  const q = query.trim().toLowerCase();
  const shown = S.items.filter(it => (filter === 'All' || it.cat === filter || (filter === 'Low' && ['low', 'soon'].includes(status(it)))) && (!q || it.name.toLowerCase().includes(q)));
  const cats = CATS.filter(c => S.items.some(it => it.cat === c));
  const groups = cats.map(c => {
    const rows = shown.filter(it => it.cat === c).sort((a, b) => a.pct - b.pct);
    return rows.length ? `<section class="group"><h2>${esc(c)}</h2><div class="list">${rows.map(itemRow).join('')}</div></section>` : '';
  }).join('');
  return `
    <div class="summary">
      <button class="sum low" type="button" data-filter="Low"><b>${counts.low}</b><span>Below ${thr()}%</span></button>
      <button class="sum soon" type="button" data-filter="Low"><b>${counts.soon}</b><span>Low by ${esc(refillWord())}</span></button>
      <button class="sum ok" type="button" data-filter="All"><b>${counts.ok}</b><span>Stocked</span></button>
    </div>
    ${installBanner()}
    ${st.length ? `<div class="banner"><p><b>${st.length} item${st.length === 1 ? '' : 's'}</b> not updated in ${S.settings.checkEvery}+ days. A quick check keeps the refill list right.</p><button class="btn small" type="button" data-act="check-stale">Check now</button></div>` : ''}
    <div class="search">
      <input id="q" type="search" placeholder="Search items" value="${esc(query)}" aria-label="Search items">
      <div class="chips">${['All', 'Low', ...cats].map(c => `<button type="button" class="chip${filter === c ? ' on' : ''}" data-filter="${esc(c)}">${c === 'Low' ? 'Running low' : esc(c)}</button>`).join('')}</div>
    </div>
    ${groups || `<p class="empty">No items match.</p>`}`;
}
function itemRow(it) {
  const s = status(it);
  const tag = s === 'low' ? `<span class="tag low">Refill</span>` : s === 'soon' ? `<span class="tag soon">Low by ${esc(refillWord())}</span>` : '';
  return `<button type="button" class="item s-${s}" data-edit="${it.id}">
    <span class="name">${esc(it.name)} ${tag}</span><span class="pct">${it.pct}%</span>
    <span class="gauge"><i style="width:${it.pct}%"></i></span>
    <span class="meta"><span>${esc(trend(it))}</span><span>${esc(it.need ? 'Need ' + it.need : '')}</span></span>
  </button>`;
}
function starterView() {
  const groups = CATS.filter(c => STARTER.some(s => s[1] === c)).map(c => `<div><h3>${esc(c)}</h3><div class="picks">${
    STARTER.filter(s => s[1] === c).map(s => `<label class="pick"><input type="checkbox" name="starter" value="${esc(s[0])}" checked><span>${esc(s[0])}</span></label>`).join('')
  }</div></div>`).join('');
  return `<div class="card">
      <h2>Start with what's in your kitchen</h2>
      <p>Untick what you don't buy. Next you'll set how much of each is left, as a percentage, in a quick stock check. Add anything missing later with “+ Add item”.</p>
    </div>
    ${installBanner()}
    <div class="card starter">${groups}<button class="btn" type="button" data-act="starter">Add selected and set stock</button></div>`;
}
function refillView(g) {
  const sec = (title, note, items) => items.length ? `<section class="group"><h2>${title}</h2>${note ? `<p class="muted" style="margin:-4px 2px 8px;font-size:13px">${note}</p>` : ''}<div class="list">${items.map(refillRow).join('')}</div></section>` : '';
  const got = S.items.filter(it => it.got && isOnRefill(it, g)).length;
  if (!g.count && !g.later.length) return `<div class="card"><h2>Nothing to refill yet</h2><p>Items land here automatically once they fall below ${thr()}%, or when they will at your current pace before ${DAYS[S.settings.refillDay]}. You can also add any item yourself from its stock screen.</p></div>${pasteCard()}`;
  return `
    <div class="refill-head"><h2>${g.count} item${g.count === 1 ? '' : 's'} to buy ${esc(refillWord())}</h2><p>Quantities are your own weekly estimates. Tick items as you buy them.</p></div>
    <div class="row">
      <button class="btn grow" type="button" data-act="share">Share list</button>
      <button class="btn ghost grow" type="button" data-act="restock" ${got ? '' : 'disabled'}>Mark ${got || ''} ticked as refilled</button>
    </div>
    ${sec(`Below ${thr()}% now`, '', g.low)}
    ${sec(`Will drop below ${thr()}% by ${esc(refillWord())}`, 'Based on how fast you have been using it.', g.soon)}
    ${sec('Added by you', '', g.mine)}
    ${sec('Optional: may run out before the next weekend', '', g.later)}
    ${pasteCard()}`;
}
function isOnRefill(it, g) { return [...g.low, ...g.soon, ...g.mine, ...g.later].includes(it); }
function refillRow(it) {
  const pick = it.app || S.settings.app;
  const order = [pick, ...Object.keys(APPS).filter(k => k !== pick)];
  return `<div class="ritem${it.got ? ' done' : ''}">
    <input type="checkbox" data-got="${it.id}" ${it.got ? 'checked' : ''} aria-label="Bought ${esc(it.name)}">
    <span class="name">${esc(it.name)}</span><span class="qty">${esc(it.need || '—')}</span>
    <span class="meta"><span>${it.pct}% left</span><span class="shop">${order.map(k => `<a href="${APPS[k].url(it.name)}" target="_blank" rel="noopener">${APPS[k].name}</a>`).join('')}</span></span>
  </div>`;
}
function pasteCard() {
  return `<div class="card">
    <h2>Got a delivery?</h2>
    <p>Copy the item list from your Blinkit, Zepto or Flipkart Minutes order (order details, SMS or email) and paste it here. Matching items are set back to 100%.</p>
    <label class="f">Order text<textarea id="orderText" placeholder="e.g. Aashirvaad Shudh Chakki Atta 5 kg × 1&#10;Amul Taaza Milk 1 L × 2"></textarea></label>
    <button class="btn" type="button" data-act="match">Find items in this order</button>
    <div id="matchOut"></div>
  </div>`;
}
function settingsView() {
  const s = S.settings;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const permText = { granted: 'On. You get a nudge when something falls below the limit and before refill day.', denied: 'Blocked in your phone settings for this app.', default: 'Off', unsupported: 'Not available on this device. Reminders still show inside the app.' }[perm];
  return `<div class="card">
    <div class="setting"><div><b>Low-stock limit</b><small>Items at or below this go on the refill list.</small></div>
      <select id="setThr">${[5, 10, 15, 20, 25].map(v => `<option value="${v}" ${v === s.threshold ? 'selected' : ''}>${v}%</option>`).join('')}</select></div>
    <div class="setting"><div><b>Refill day</b><small>The day you restock.</small></div>
      <select id="setDay">${DAYS.map((d, i) => `<option value="${i}" ${i === s.refillDay ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
    <div class="setting"><div><b>Stock check reminder</b><small>Remind me when items haven't been updated for…</small></div>
      <select id="setCheck">${[1, 2, 3, 5, 7].map(v => `<option value="${v}" ${v === s.checkEvery ? 'selected' : ''}>${v} day${v > 1 ? 's' : ''}</option>`).join('')}</select></div>
    <div class="setting"><div><b>Usual app</b><small>Shown first on the refill list.</small></div>
      <select id="setApp">${Object.entries(APPS).map(([k, a]) => `<option value="${k}" ${k === s.app ? 'selected' : ''}>${a.name}</option>`).join('')}</select></div>
    <div class="setting"><div><b>Notifications</b><small>${permText}</small></div>
      ${perm === 'default' ? `<button class="btn small" type="button" data-act="notify">Turn on</button>` : perm === 'granted' ? `<button class="btn small ghost" type="button" data-act="test-notify">Send a test</button>` : ''}</div>
  </div>
  ${installBanner(true)}
  <div class="card">
    <h2>Backup</h2>
    <p>Your stock lives on this phone only. Save a backup file to move it to another phone or keep it safe.</p>
    <div class="row"><button class="btn ghost grow" type="button" data-act="export">Save backup</button><button class="btn ghost grow" type="button" data-act="import">Restore backup</button></div>
  </div>
  <div class="card">
    <h2>Start over</h2>
    <p>Removes all ${S.items.length} items and their history from this phone.</p>
    <div id="resetBox"><button class="btn danger" type="button" data-act="reset">Remove everything</button></div>
  </div>`;
}
function installBanner(always) {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || (!always && S.notes.hideInstall)) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (installEvt) return `<div class="banner info"><p><b>Install Pantry Pulse</b> on your home screen so it opens like an app and can send reminders.</p><div class="row"><button class="btn small" type="button" data-act="install">Install</button>${always ? '' : `<button class="btn small ghost" type="button" data-act="hide-install">Later</button>`}</div></div>`;
  if (ios) return `<div class="banner info"><p><b>Install on iPhone:</b> tap Share, then “Add to Home Screen”.</p>${always ? '' : `<button class="btn small ghost" type="button" data-act="hide-install">Got it</button>`}</div>`;
  return always ? `<div class="banner info"><p><b>Install:</b> open the browser menu (⋮) and choose “Install app” or “Add to Home screen”.</p></div>` : '';
}

/* ---------- sheets ---------- */
const sheet = $('#sheet');
function openSheet(html) { $('#sheetBody').innerHTML = html; if (!sheet.open) sheet.showModal(); }
function closeSheet() { if (sheet.open) sheet.close(); render(); }
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
sheet.addEventListener('cancel', e => { e.preventDefault(); closeSheet(); });

function spark(it) {
  const h = it.hist.filter(x => x.t > Date.now() - 28 * DAY);
  if (h.length < 2) return '';
  const t0 = h[0].t, span = Math.max(1, h[h.length - 1].t - t0);
  const pts = h.map(x => `${(4 + (x.t - t0) / span * 292).toFixed(1)},${(44 - x.p / 100 * 40).toFixed(1)}`).join(' ');
  const ty = (44 - thr() / 100 * 40).toFixed(1);
  return `<svg class="spark" viewBox="0 0 300 48" preserveAspectRatio="none" aria-label="Stock over the last four weeks">
    <line x1="0" x2="300" y1="${ty}" y2="${ty}" stroke="var(--low)" stroke-dasharray="3 4" stroke-width="1" vector-effect="non-scaling-stroke"/>
    <polyline points="${pts}" fill="none" stroke="var(--leaf)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
function editSheet(it) {
  const isNew = !it;
  it = it || { id: '', name: '', cat: filter !== 'All' && filter !== 'Low' ? filter : 'Staples', need: '', app: '', pct: 100, hist: [] };
  openSheet(`
    <div class="sheet-head"><div><h2>${isNew ? 'Add item' : esc(it.name)}</h2>${isNew ? '' : `<p class="muted" style="margin:4px 0 0;font-size:13px">${esc(trend(it))}</p>`}</div><button class="x" type="button" data-act="close" aria-label="Close">✕</button></div>
    <div class="big"><span id="pctOut">${it.pct}</span><small>% left</small></div>
    <input id="pctIn" type="range" min="0" max="100" step="5" value="${it.pct}" aria-label="Stock left in percent">
    <div class="levels">${[0, 10, 25, 50, 75, 100].map(v => `<button type="button" data-lvl="${v}" class="${v === it.pct ? 'on' : ''}${v <= thr() ? ' lowlvl' : ''}">${v}</button>`).join('')}</div>
    ${spark(it)}
    ${isNew ? `<label class="f">Item name<input id="fName" autocomplete="off" placeholder="e.g. Basmati rice"></label>` : ''}
    <div class="grid2">
      <label class="f">Refill quantity<input id="fNeed" value="${esc(it.need)}" placeholder="e.g. 5 kg"></label>
      <label class="f">Category<select id="fCat">${CATS.map(c => `<option ${c === it.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    </div>
    <label class="f">Buy from<select id="fApp"><option value="">Usual app (${APPS[S.settings.app].name})</option>${Object.entries(APPS).map(([k, a]) => `<option value="${k}" ${k === it.app ? 'selected' : ''}>${a.name}</option>`).join('')}</select></label>
    ${isNew ? '' : `<label class="pick" style="display:flex;gap:8px;align-items:center"><input id="fList" type="checkbox" ${it.onList ? 'checked' : ''}><span>Put on this weekend's refill list anyway</span></label>`}
    <button class="btn" type="button" data-act="save-item" data-id="${it.id}">${isNew ? 'Add item' : 'Save'}</button>
    ${isNew ? '' : `<div class="row"><a class="btn ghost grow" style="text-align:center;text-decoration:none" href="${APPS[it.app || S.settings.app].url(it.name)}" target="_blank" rel="noopener">Order on ${APPS[it.app || S.settings.app].name}</a><span id="delBox"><button class="btn danger" type="button" data-act="delete" data-id="${it.id}">Delete</button></span></div>`}
  `);
  const pin = $('#pctIn');
  pin.addEventListener('input', () => { $('#pctOut').textContent = pin.value; markLevel(pin.value); });
  if (isNew) setTimeout(() => $('#fName').focus(), 50);
}
function markLevel(v) { document.querySelectorAll('#sheetBody [data-lvl]').forEach(b => b.classList.toggle('on', +b.dataset.lvl === +v)); }

let check = null; // { ids, i, changed }
function startCheck(ids) {
  if (!ids.length) return;
  check = { ids, i: 0, changed: 0 };
  checkStep();
}
function checkStep() {
  if (check.i >= check.ids.length) {
    const n = check.changed; check = null; save();
    openSheet(`<div class="sheet-head"><h2>Stock check done</h2><button class="x" type="button" data-act="close" aria-label="Close">✕</button></div>
      <p class="muted" style="margin:0">Updated ${n} item${n === 1 ? '' : 's'}. ${refillGroups().count} on the refill list for ${esc(refillWord())}.</p>
      <div class="row"><button class="btn grow" type="button" data-act="go-refill">See refill list</button><button class="btn ghost grow" type="button" data-act="close">Back to stock</button></div>`);
    return;
  }
  const it = S.items.find(x => x.id === check.ids[check.i]);
  if (!it) { check.i++; return checkStep(); }
  openSheet(`
    <div class="sheet-head"><div><p class="muted" style="margin:0;font-size:13px">${check.i + 1} of ${check.ids.length} · ${esc(it.cat)}</p><h2>${esc(it.name)}</h2></div><button class="x" type="button" data-act="end-check" aria-label="Stop stock check">✕</button></div>
    <div class="progress"><i style="width:${check.i / check.ids.length * 100}%"></i></div>
    <p style="margin:0">How much is left? <span class="muted">Last time ${it.pct}%</span></p>
    <div class="levels wide">${[0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(v => `<button type="button" data-check="${v}" class="${v === it.pct ? 'on' : ''}${v <= thr() ? ' lowlvl' : ''}">${v}%</button>`).join('')}</div>
    <div class="row"><button class="btn ghost grow" type="button" data-check="same">Same as last time</button><button class="btn ghost grow" type="button" data-check="skip">Skip</button></div>`);
}

function lowPrompt(it) {
  const pick = it.app || S.settings.app;
  notify(`${it.name} is down to ${it.pct}%`, `Added to your ${DAYS[S.settings.refillDay]} refill list.`, 'low-' + it.id);
  openSheet(`<div class="sheet-head"><h2>${esc(it.name)} is down to ${it.pct}%</h2><button class="x" type="button" data-act="close" aria-label="Close">✕</button></div>
    <p style="margin:0">It's on your refill list for ${esc(refillWord())}${it.need ? `: <b>${esc(it.need)}</b>` : ''}. If you can't wait that long, order it now.</p>
    <div class="row">${[pick, ...Object.keys(APPS).filter(k => k !== pick)].map((k, i) => `<a class="btn ${i ? 'ghost ' : ''}grow" style="text-align:center;text-decoration:none" href="${APPS[k].url(it.name)}" target="_blank" rel="noopener">${APPS[k].name}</a>`).join('')}</div>
    <button class="btn ghost" type="button" data-act="close">Wait for ${esc(refillWord())}</button>`);
}

/* ---------- actions ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-got]');
  if (!t) return;
  if (t.dataset.view) { view = t.dataset.view; render(); scrollTo(0, 0); return; }
  if (t.dataset.filter) { filter = t.dataset.filter; render(); return; }
  if (t.dataset.edit) { editSheet(S.items.find(x => x.id === t.dataset.edit)); return; }
  if (t.dataset.got) {
    const it = S.items.find(x => x.id === t.dataset.got);
    it.got = t.checked; save(); render(); return;
  }
  if (t.dataset.lvl != null) { $('#pctIn').value = t.dataset.lvl; $('#pctOut').textContent = t.dataset.lvl; markLevel(t.dataset.lvl); return; }
  if (t.dataset.check != null) {
    const it = S.items.find(x => x.id === check.ids[check.i]);
    const v = t.dataset.check;
    if (v !== 'skip') { const crossed = setPct(it, v === 'same' ? it.pct : +v); check.changed++; if (crossed) notify(`${it.name} is down to ${it.pct}%`, 'Added to your refill list.', 'low-' + it.id); }
    check.i++; save(); checkStep(); return;
  }
  const act = t.dataset.act;
  if (!act) return;
  ({
    close: closeSheet,
    'end-check': () => { check.i = check.ids.length; checkStep(); },
    'go-refill': () => { view = 'refill'; closeSheet(); },
    'check-stale': () => startCheck(stale().sort(byCat).map(x => x.id)),
    starter: () => {
      const picked = [...document.querySelectorAll('input[name=starter]:checked')].map(x => x.value);
      if (!picked.length) return toast('Pick at least one item');
      STARTER.filter(s => picked.includes(s[0])).forEach(([name, cat, need]) => S.items.push({ id: uid(), name, cat, need, app: '', pct: 100, hist: [], updated: 0 }));
      save(); render(); startCheck(S.items.slice().sort(byCat).map(x => x.id));
    },
    'save-item': () => {
      const id = t.dataset.id;
      let it = S.items.find(x => x.id === id);
      if (!it) {
        const name = $('#fName').value.trim();
        if (!name) { $('#fName').focus(); return toast('Give the item a name'); }
        if (S.items.some(x => x.name.toLowerCase() === name.toLowerCase())) return toast(`${name} is already on your list`);
        it = { id: uid(), name, cat: 'Other', need: '', app: '', pct: 100, hist: [], updated: 0 };
        S.items.push(it);
      }
      it.need = $('#fNeed').value.trim(); it.cat = $('#fCat').value; it.app = $('#fApp').value;
      if ($('#fList')) it.onList = $('#fList').checked;
      const crossed = setPct(it, +$('#pctIn').value);
      save();
      if (crossed) lowPrompt(it); else { closeSheet(); toast(`${it.name} saved at ${it.pct}%`); }
    },
    delete: () => { $('#delBox').innerHTML = `<button class="btn danger" type="button" data-act="delete-yes" data-id="${t.dataset.id}">Tap again to delete</button>`; },
    'delete-yes': () => { const it = S.items.find(x => x.id === t.dataset.id); S.items = S.items.filter(x => x !== it); save(); closeSheet(); toast(`${it.name} deleted`); },
    restock: () => {
      const got = S.items.filter(it => it.got);
      got.forEach(it => setPct(it, 100));
      save(); render(); toast(`${got.length} item${got.length === 1 ? '' : 's'} back to 100%`);
    },
    share: shareList,
    match: matchOrder,
    'apply-match': () => {
      const ids = [...document.querySelectorAll('input[name=matched]:checked')].map(x => x.value);
      ids.forEach(id => setPct(S.items.find(x => x.id === id), 100));
      save(); render(); toast(`${ids.length} item${ids.length === 1 ? '' : 's'} set to 100%`);
    },
    notify: enableNotifications,
    'test-notify': () => notify('Pantry Pulse', `${refillGroups().count} items on your ${DAYS[S.settings.refillDay]} refill list.`, 'test'),
    install: async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); },
    'hide-install': () => { S.notes.hideInstall = true; save(); render(); },
    export: exportData,
    import: () => $('#importFile').click(),
    reset: () => { $('#resetBox').innerHTML = `<div class="row"><button class="btn danger grow" type="button" data-act="reset-yes">Yes, remove all items</button><button class="btn ghost grow" type="button" data-act="reset-no">Keep them</button></div>`; },
    'reset-no': render,
    'reset-yes': () => { S = defaults(); save(); view = 'stock'; render(); toast('Everything removed'); },
  })[act]?.();
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { query = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); }
});
document.addEventListener('change', e => {
  const id = e.target.id, v = e.target.value;
  const map = { setThr: ['threshold', +v], setDay: ['refillDay', +v], setCheck: ['checkEvery', +v], setApp: ['app', v] };
  if (map[id]) { S.settings[map[id][0]] = map[id][1]; save(); render(); toast('Saved'); }
});
$('#fab').addEventListener('click', () => editSheet(null));
$('#checkBtn').addEventListener('click', () => startCheck(S.items.slice().sort(byCat).map(x => x.id)));
function byCat(a, b) { return CATS.indexOf(a.cat) - CATS.indexOf(b.cat) || a.name.localeCompare(b.name); }

function listText() {
  const g = refillGroups();
  const rows = [...g.low, ...g.soon, ...g.mine].map(it => `• ${it.name}${it.need ? ' – ' + it.need : ''}`);
  return `Grocery refill for ${fmtDate(nextRefill())}\n${rows.join('\n')}`;
}
async function shareList() {
  const text = listText();
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); toast('List copied. Paste it in WhatsApp or notes'); }
  catch (e) { openSheet(`<div class="sheet-head"><h2>Your list</h2><button class="x" type="button" data-act="close" aria-label="Close">✕</button></div><textarea readonly>${esc(text)}</textarea>`); }
}
function matchOrder() {
  const text = ($('#orderText').value || '').toLowerCase();
  if (!text.trim()) return toast('Paste your order text first');
  const hits = S.items.filter(it => {
    const n = it.name.toLowerCase();
    return text.includes(n) || n.split(/\s+/).every(w => w.length < 3 || text.includes(w));
  });
  $('#matchOut').innerHTML = hits.length
    ? `<p style="margin:0 0 8px">Found ${hits.length} of your items. Untick any that weren't in this order.</p><div class="picks">${hits.map(it => `<label class="pick"><input type="checkbox" name="matched" value="${it.id}" checked><span>${esc(it.name)} · ${it.pct}%</span></label>`).join('')}</div><button class="btn" type="button" data-act="apply-match" style="margin-top:12px;width:100%">Set these to 100%</button>`
    : `<p style="margin:0">None of your item names appear in that text. Check the names match, e.g. “Atta” in “Aashirvaad Atta 5 kg”.</p>`;
}
function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pantry-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.items)) throw new Error('no items');
    S = { ...defaults(), ...d, settings: { ...defaults().settings, ...d.settings }, notes: d.notes || {} };
    save(); render(); toast(`Restored ${S.items.length} items`);
  } catch (err) { toast('That file is not a Pantry Pulse backup'); }
});

let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- reminders ---------- */
async function enableNotifications() {
  if (!('Notification' in window)) return toast('This device does not support notifications');
  const p = await Notification.requestPermission();
  if (p === 'granted') { await registerPeriodic(); notify('Reminders are on', 'You will hear from Pantry Pulse when stock runs low.', 'on'); }
  render();
}
async function notify(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png' });
    else new Notification(title, { body, tag, icon: 'icons/icon-192.png' });
  } catch (e) { /* notifications are a bonus; the in-app list is the source of truth */ }
}
async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg || !('periodicSync' in reg)) return;
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state === 'granted') await reg.periodicSync.register('pantry-check', { minInterval: 12 * 3600e3 });
  } catch (e) { /* only installed apps on Android Chrome support this */ }
}
// The service worker can't read localStorage, so keep a small summary in the Cache API for background checks.
async function writeSummary() {
  if (!('caches' in window)) return;
  const g = refillGroups();
  const sum = {
    refillDay: DAYS[S.settings.refillDay], refillDate: nextRefill().toISOString(), threshold: thr(),
    low: g.low.map(x => x.name), soon: g.soon.map(x => x.name), count: g.count,
    stale: stale().length, checkEvery: S.settings.checkEvery,
  };
  try { const c = await caches.open('pantry-state'); await c.put('state.json', new Response(JSON.stringify(sum), { headers: { 'Content-Type': 'application/json' } })); } catch (e) { /* ignore */ }
}
function checkReminders() {
  const today = startOfDay().toDateString(), n = S.notes;
  const g = refillGroups();
  if (g.count && daysToRefill() <= 1 && n.refillNote !== nextRefill().toDateString()) {
    n.refillNote = nextRefill().toDateString();
    notify(`Refill ${refillWord()}: ${g.count} item${g.count === 1 ? '' : 's'}`, [...g.low, ...g.soon, ...g.mine].slice(0, 6).map(x => x.name).join(', '), 'refill');
  }
  const st = stale();
  if (st.length && n.checkNote !== today) {
    n.checkNote = today;
    notify('Time for a stock check', `${st.length} item${st.length === 1 ? '' : 's'} not updated in ${S.settings.checkEvery}+ days.`, 'check');
  }
  save();
}

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; render(); });
window.addEventListener('appinstalled', () => { installEvt = null; render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); checkReminders(); } });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    registerPeriodic();
    // A new version found while the app is open shows the update bar.
    const showBar = () => {
      $('#updateBar').hidden = false;
      $('#reloadBtn').onclick = () => reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
    };
    if (reg.waiting && navigator.serviceWorker.controller) showBar();
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showBar(); });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!refreshing) { refreshing = true; location.reload(); } });
}

if (location.hash === '#refill') view = 'refill';
render();
checkReminders();
