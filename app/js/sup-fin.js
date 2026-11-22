/* Fulbro: «Анализ» поставщика — вкладки как в «Финансах» старого «Склада» (владелец, 22.11.2026):
   ПТП (куда уходит прибыль, кольцо), ABC, РНР (расходы на рекламу), Продажи, Прогноз.
   Деньги поставщика (реклама в день, поправка за день, комиссии банка, проценты) — в таблице sup_finance:
   видит только сам поставщик (не склад, не его сотрудник), с любого телефона. */

const SF_DAY = 86400000;
const sfKey = ts=> { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const sfTs = key=> { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const sfFmtDay = key=> { const [y, m, d] = String(key).split('-'); return d + '.' + m + '.' + y; };
const sfR = n=> Math.round((Number(n) || 0) * 100) / 100;
const sfRub = n=> Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';

/* --- данные --- */
async function sfAll(kind){
  const sup = Sync.mySupplierId();
  return (await getAll('supFin')).filter(x=> !x.deletedAt && (!sup || x.supplierId === sup) && (!kind || x.kind === kind));
}
async function sfSettings(){
  const s = (await sfAll('настройки'))[0];
  const d = (s && s.data) || {};
  const n = (v, def)=> v === undefined || v === null || v === '' || !isFinite(Number(v)) ? def : Math.max(0, Number(v));
  return {commission: n(d.commission, 0), tax: n(d.tax, 0), packaging: n(d.packaging, 0), leadDays: Math.max(1, Math.min(180, Math.round(n(d.leadDays, 14))))};
}
async function sfSaveSettings(v){
  const sup = Sync.mySupplierId(); if(!sup) throw new Error('Нет поставщика');
  const cur = await sfSettings();
  const num = (x, def, max)=>{ if(x === undefined) return def; const n = Number(String(x).replace(/\s/g, '').replace(',', '.')); if(!(n >= 0) || n > max) throw new Error('Проверьте число: ' + x); return n; };
  const data = {commission: num(v.commission, cur.commission, 100), tax: num(v.tax, cur.tax, 100), packaging: num(v.packaging, cur.packaging, 1000000), leadDays: Math.round(num(v.leadDays, cur.leadDays, 180)) || 14};
  const old = (await sfAll('настройки'))[0];
  await put('supFin', Object.assign({}, old || {id: newUid(), supplierId: sup, kind: 'настройки', day: null, amount: 0}, {data}));
  sfSync();
  return data;
}
function sfAmount(x){
  const n = Number(String(x == null ? '' : x).replace(/\s/g, '').replace(',', '.'));
  if(!(n >= 0) || n > 1000000000) throw new Error('Введите сумму числом');
  return sfR(n);
}
async function sfAdd(kind, day, amount){
  const sup = Sync.mySupplierId(); if(!sup) throw new Error('Нет поставщика');
  await put('supFin', {id: newUid(), supplierId: sup, kind, day, amount: sfAmount(amount), data: {}});
  sfSync();
}
/* реклама в день: новая сумма — с этого дня; запись на тот же день заменяется */
async function sfSetAdRate(amount, day){
  day = day || sfKey(Date.now());
  for(const x of await sfAll('реклама')) if(x.day === day){ x.deletedAt = Date.now(); await put('supFin', x); }
  await sfAdd('реклама', day, amount);
}
async function sfSetAdDay(day, amount){
  for(const x of await sfAll('реклама_день')) if(x.day === day){ x.deletedAt = Date.now(); await put('supFin', x); }
  await sfAdd('реклама_день', day, amount);
}
async function sfClearAdDay(day){
  let n = 0;
  for(const x of await sfAll('реклама_день')) if(x.day === day){ x.deletedAt = Date.now(); await put('supFin', x); n++; }
  sfSync(); return n;
}
async function sfRemove(id){
  const x = await get('supFin', id); if(!x) return;
  x.deletedAt = Date.now(); await put('supFin', x); sfSync();
}
function sfSync(){ if(window.Sync && Sync.syncNow && typeof ffSoft === 'function') ffSoft(()=> Sync.syncNow('деньги поставщика')); }

/* реклама за период: на каждый день — поправка за день, иначе сумма «в день», действующая с ближайшей даты не позже */
async function sfAdsFor(from, to){
  const rates = (await sfAll('реклама')).sort((a, b)=> a.day < b.day ? -1 : 1);
  const fix = new Map((await sfAll('реклама_день')).map(x=> [x.day, Number(x.amount) || 0]));
  let sum = 0;
  for(let t = dayStart(from); t <= to; t = dayStart(t + SF_DAY + SF_DAY / 2)){
    const k = sfKey(t);
    if(fix.has(k)){ sum += fix.get(k); continue; }
    let r = 0; for(const x of rates) if(x.day <= k) r = Number(x.amount) || 0; else break;
    sum += r;
  }
  return sfR(sum);
}
async function sfBankFor(from, to){
  return sfR((await sfAll('банк')).filter(x=> { const t = sfTs(x.day); return t >= dayStart(from) && t <= to; }).reduce((s, x)=> s + (Number(x.amount) || 0), 0));
}
/* плата складу за период: собранные отправки и приёмки с суммой */
async function sfWarehouseFee(from, to){
  const sup = Sync.mySupplierId();
  const lastCollect = new Map();
  for(const l of await getAll('shipmentLines')) if(!l.deletedAt && l.collectedTs) lastCollect.set(l.shipmentId, Math.max(lastCollect.get(l.shipmentId) || 0, Number(l.collectedTs)));
  let sum = 0;
  for(const s of await getAll('shipments')){
    if(s.deletedAt || s.status !== 'собрана' || !(Number(s.fee) > 0) || (sup && s.supplierId !== sup)) continue;
    const t = lastCollect.get(s.id) || Number(s.createdTs) || 0;
    if(t >= from && t <= to) sum += Number(s.fee);
  }
  for(const r of await getAll('receipts')){
    if(r.deletedAt || !(Number(r.fee) > 0) || (sup && r.supplierId !== sup)) continue;
    const t = Number(r.createdTs) || 0;
    if(t >= from && t <= to) sum += Number(r.fee);
  }
  return sfR(sum);
}
/* «Куда уходит прибыль» — как в «Финансах» «Склада» (opEconomics): по каждой продаже выручка, себестоимость,
   валовая прибыль, налог, комиссия, упаковка, скидка на доставку — проценты и суммы из карточки товара
   (личные цифры поставщика). Сверху — плата складу FoG, реклама и комиссии банка за период. */
async function sfProfit(range){
  const {from, to} = range;
  const st = await sfSettings(), cost = await anCostIndex();
  const privs = new Map((await getAll('privates')).map(p=> [p.modelId, p]));
  const pick = (p, k, def)=> p && Number(p[k]) > 0 ? Number(p[k]) : def;
  let revenue = 0, qty = 0, costSum = 0, costUnknown = false, commission = 0, tax = 0, packaging = 0, delivery = 0;
  const byModel = {};
  for(const s of (await supplierSales()).filter(s=> s.ts >= from && s.ts <= to)){
    const rev = s.qty * s.price, p = privs.get(s.modelId);
    const c = cost(s.sizeId); if(c === null) costUnknown = true;
    const e = {rev, cost: c === null ? 0 : s.qty * c, comm: rev * pick(p, 'commissionPercent', st.commission) / 100, tax: rev * pick(p, 'taxPercent', st.tax) / 100,
      pack: s.qty * pick(p, 'packaging', st.packaging), deliv: s.qty * pick(p, 'deliveryDiscount', 0)};
    revenue += rev; qty += s.qty; costSum += e.cost; commission += e.comm; tax += e.tax; packaging += e.pack; delivery += e.deliv;
    const m = byModel[s.modelId] || (byModel[s.modelId] = {modelId: s.modelId, qty: 0, revenue: 0, net: 0});
    m.qty += s.qty; m.revenue += rev; m.net += rev - e.cost - e.comm - e.tax - e.pack - e.deliv;
  }
  const warehouse = await sfWarehouseFee(from, to), ads = await sfAdsFor(from, to), bank = await sfBankFor(from, to);
  const gross = revenue - costSum;
  const net = gross - commission - tax - packaging - delivery - warehouse - ads - bank;
  return {qty, revenue: sfR(revenue), cost: sfR(costSum), costUnknown, gross: sfR(gross), warehouse, commission: sfR(commission), tax: sfR(tax), packaging: sfR(packaging),
    delivery: sfR(delivery), ads, bank, net: sfR(net), byModel: Object.values(byModel).sort((a, b)=> b.net - a.net)};
}
/* ABC: A — товары, что дают первые 80% выручки, B — следующие 15%, C — остальные 5% */
async function sfAbc(range){
  const by = {};
  for(const s of (await supplierSales()).filter(s=> s.ts >= range.from && s.ts <= range.to)){
    const o = by[s.modelId] || (by[s.modelId] = {modelId: s.modelId, qty: 0, revenue: 0});
    o.qty += s.qty; o.revenue += s.qty * s.price;
  }
  const list = Object.values(by).sort((a, b)=> b.revenue - a.revenue || b.qty - a.qty);
  const total = list.reduce((n, x)=> n + x.revenue, 0);
  let cum = 0;
  for(const x of list){
    // группа — по доле ДО товара: единственный товар (100%) — это A, а не C
    const before = cum; x.share = total ? x.revenue / total * 100 : 0; cum += x.share; x.cum = Math.min(100, cum);
    x.group = before < 80 ? 'A' : before < 95 ? 'B' : 'C';
  }
  return {total: sfR(total), list};
}
/* Прогноз по размерам: скорость — продажи за 30 полных дней (не меньше 7 дней с первой продажи) */
async function sfForecast(now){
  now = now || Date.now();
  const today = dayStart(now), from = today - 30 * SF_DAY, lead = (await sfSettings()).leadDays;
  const by = {};
  for(const s of await supplierSales()){
    const o = by[s.sizeId] || (by[s.sizeId] = {sold: 0, first: Infinity});
    o.first = Math.min(o.first, dayStart(s.ts));
    if(s.ts >= from && s.ts < today) o.sold += s.qty;
  }
  const counts = await supplierCounts(), names = await anNames(), out = [];
  const ids = new Set([...counts.keys(), ...Object.keys(by)]);
  const live = new Set((await getAll('sizes')).filter(z=> !z.deletedAt).map(z=> z.id));
  for(const id of ids){
    if(!live.has(id)) continue;
    const c = counts.get(id) || {stock: 0, incoming: 0, waiting: 0}, s = by[id] || {sold: 0, first: Infinity};
    const days = Math.max(7, Math.min(30, Math.round((today - s.first) / SF_DAY)));
    const rate = s.sold / days, stock = Math.max(0, c.stock - (c.waiting || 0));
    const daysLeft = rate > 0 ? stock / rate : Infinity;
    const status = rate > 0 && stock <= 0 ? 'out' : rate > 0 && daysLeft <= lead ? 'order' : rate > 0 ? 'ok' : 'idle';
    const orderQty = rate > 0 ? Math.max(0, Math.ceil(rate * (lead + 30) - stock - Math.max(0, c.incoming || 0))) : 0;
    out.push({sizeId: id, name: (names.sizes[id] || '').replace(/ Единый$/, ''), stock, incoming: c.incoming || 0, rate, daysLeft, status, orderQty});
  }
  const rank = f=> ({out: 0, order: 1, ok: 2, idle: 3})[f.status];
  return {lead, list: out.sort((a, b)=> rank(a) - rank(b) || a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, 'ru'))};
}
/* продажи по корзинам: 30 дней или 12 недель, последняя — текущая */
function sfBuckets(rows, mode, metric, now){
  const n = mode === 'week' ? 12 : 30, step = mode === 'week' ? 7 * SF_DAY : SF_DAY;
  const last = mode === 'week' ? weekStart(now) : dayStart(now), out = [];
  for(let i = n - 1; i >= 0; i--){
    const start = mode === 'week' ? weekStart(last - i * step + SF_DAY / 2) : dayStart(last - i * step + SF_DAY / 2);
    out.push({start, end: mode === 'week' ? weekStart(start + step + SF_DAY / 2) : dayStart(start + step + SF_DAY / 2), value: 0});
  }
  for(const r of rows) for(const b of out) if(r.ts >= b.start && r.ts < b.end){ b.value += metric === 'rub' ? r.qty * r.price : r.qty; break; }
  out.forEach((b, i)=>{
    b.label = mode === 'week' ? 'неделя с ' + ddmm(b.start) : new Date(b.start).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', weekday: 'short'});
    b.short = ddmm(b.start);
    b.tick = mode === 'week' ? (i % 3 === 2 || i === out.length - 1) : (i % 7 === 1 || i === out.length - 1);
  });
  return out;
}
/* что растёт и что падает: 14 полных дней против 14 до них, по товарам */
function sfTrends(rows, names, now){
  const today = dayStart(now), cur0 = today - 14 * SF_DAY, prev0 = today - 28 * SF_DAY, by = {};
  for(const r of rows){
    if(r.ts < prev0 || r.ts >= today) continue;
    const o = by[r.modelId] || (by[r.modelId] = {name: names.models[r.modelId] || '', cur: 0, prev: 0, days: new Array(28).fill(0)});
    if(r.ts >= cur0) o.cur += r.qty; else o.prev += r.qty;
    o.days[Math.min(27, Math.floor((r.ts - prev0) / SF_DAY))] += r.qty;
  }
  const list = Object.values(by).map(o=> Object.assign(o, {d: o.cur - o.prev})).filter(o=> Math.abs(o.d) >= 2 && (o.prev === 0 || Math.abs(o.d) / o.prev >= 0.1));
  return {up: list.filter(o=> o.d > 0).sort((a, b)=> b.d - a.d), down: list.filter(o=> o.d < 0).sort((a, b)=> a.d - b.d)};
}


/* --- экран: как «Расходы и прибыль» в «Складе» — кольцо «Куда уходит прибыль» с карточками,
   под ним ПТП / ABC / РНР / Продажи / Прогноз. «Сводка» — прежний экран «Анализа». --- */
const SF_TABS = [['sum', 'Сводка'], ['ptp', 'ПТП'], ['abc', 'ABC'], ['ads', 'РНР'], ['sales', 'Продажи'], ['fc', 'Прогноз']];
let anTab = 'sum', sfSalesMode = 'day', sfSalesMetric = 'qty';
function anSetTab(t){ anTab = t; renderSupplierAnalysis(); }
function sfSetSales(mode){ sfSalesMode = mode; renderSupplierAnalysis(); }
function sfSetMetric(m){ sfSalesMetric = m; renderSupplierAnalysis(); }
function sfTabsHtml(){
  return `<div class="period-seg an-tabs" role="tablist" aria-label="Разделы анализа">${SF_TABS.map(([k, t])=> `<button type="button" role="tab" data-tab="${k}" aria-selected="${anTab === k}" class="${anTab === k ? 'active' : ''}" onclick="anSetTab('${k}')">${t}</button>`).join('')}</div>`;
}
const sfEmpty = (icon, text)=> typeof emptyLine === 'function' ? emptyLine(icon, text) : `<p class="hint">${escapeHtml(text)}</p>`;
const sfCard = (title, body, id)=> `<div class="card"${id ? ` id="${id}"` : ''}><div class="card-head"><span class="t-eyebrow">${title}</span></div>${body}</div>`;

/* кольцо — те же цвета и порядок, что в «Складе»; плюс «Склад FoG» и «Комиссии банка» */
const SF_SEGS = [['net', 'Чистая прибыль', '#4A7DFF', 'i-check-circle'], ['cost', 'Себестоимость', '#2BBE85', 'i-box'], ['gross', 'Валовая прибыль', '#FFA35C', 'i-chart'],
  ['tax', 'Налог', '#E8598A', 'i-alert'], ['commission', 'Комиссия маркетплейса', '#FFC94D', 'i-wallet'], ['warehouse', 'Склад FoG', '#E86F2E', 'i-box'],
  ['packaging', 'Упаковка', '#2FBFAE', 'i-box'], ['delivery', 'Скидка на доставку', '#8C7EF2', 'i-out'], ['ads', 'Реклама', '#B57BFF', 'i-chart'], ['bank', 'Комиссии банка', '#7A8699', 'i-wallet']];
let sfRingPicked = null, sfRingData = null;
function sfRingHtml(p){
  sfRingData = p; sfRingPicked = null;
  const segs = SF_SEGS.map(([k, name, color, icon])=> ({k, name, color, icon, value: p[k], arc: Math.max(0, p[k])}));
  const total = segs.reduce((n, s)=> n + s.arc, 0);
  const cx = 110, cy = 110, r = 92, sw = 20, C = 2 * Math.PI * r;
  let svg = `<circle class="ring-track" cx="${cx}" cy="${cy}" r="${r}" stroke-width="${sw}"/>`, acc = 0;
  if(total > 0) segs.forEach((s, i)=>{
    if(s.arc <= 0) return;
    const frac = s.arc / total, len = frac * C;
    svg += `<circle data-idx="${i}" data-seg="${s.k}" onclick="sfRingPick(${i})" cx="${cx}" cy="${cy}" r="${r}" stroke-width="${sw}" stroke="${s.color}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc * C).toFixed(2)}"/>`;
    acc += frac;
  });
  const grid = p.revenue <= 0 ? sfEmpty('i-wallet', 'За этот период продаж не было') : segs.map((s, i)=> `<div class="cat-card" id="sfSeg${i}" data-leg="${s.k}" style="--seg-color:${s.color}" onclick="sfRingPick(${i})">
      <div class="cat-share" style="background:${s.color}26;color:${s.color}">${total > 0 ? Math.round(s.arc / total * 100) : 0}%</div>
      <div class="cat-icon" style="background:${s.color}"><svg class="icon"><use href="#${s.icon}"/></svg></div>
      <div class="cat-name">${escapeHtml(s.name)}</div><div class="cat-meta">доля кольца</div><div class="cat-amount">${Math.round(s.value)} ₽</div></div>`).join('');
  return `<div class="card ring-card"><div class="card-head"><span class="t-eyebrow">Куда уходит прибыль</span></div>
    <div class="ring-wrap"><svg viewBox="0 0 220 220" class="ring-svg" id="anRing">${svg}</svg>
      <div class="ring-center" onclick="sfRingTotal()"><div class="ring-amount" id="sfRingAmount">${Math.round(p.net)} ₽</div><div class="ring-label" id="sfRingLabel">Чистая прибыль</div></div></div>
    <div class="cat-grid sf-legend" id="sfRingGrid">${grid}</div>
    ${p.revenue > 0 ? '<div class="t-caption" style="margin-top:var(--sp-3);color:var(--text-tertiary);">Нажмите на деление кольца или карточку — в центре появится сумма именно по ней. Нажмите ещё раз (или в центр), чтобы вернуться к прибыли.</div>' : ''}
    ${p.costUnknown ? '<div class="t-caption" style="margin-top:6px;color:var(--warning);">Не у всех товаров есть цена закупки — себестоимость посчитана не полностью.</div>' : ''}</div>`;
}
function sfRingTotal(){
  sfRingPicked = null; if(!sfRingData) return;
  document.getElementById('sfRingAmount').textContent = Math.round(sfRingData.net) + ' ₽';
  document.getElementById('sfRingLabel').textContent = 'Чистая прибыль';
  document.querySelectorAll('#sfRingGrid .cat-card').forEach(c=> c.classList.remove('selected'));
  document.querySelectorAll('#anRing circle[data-idx]').forEach(c=> c.classList.remove('picked'));
}
function sfRingPick(i){
  const s = SF_SEGS[i]; if(!s || !sfRingData) return;
  if(sfRingPicked === i){ sfRingTotal(); return; }
  sfRingPicked = i;
  document.getElementById('sfRingAmount').textContent = Math.round(sfRingData[s[0]]) + ' ₽';
  document.getElementById('sfRingLabel').textContent = s[1];
  document.querySelectorAll('#sfRingGrid .cat-card').forEach(c=> c.classList.toggle('selected', c.id === 'sfSeg' + i));
  document.querySelectorAll('#anRing circle[data-idx]').forEach(c=> c.classList.toggle('picked', Number(c.dataset.idx) === i));
}
async function sfPtpHtml(p){
  const names = await anNames();
  return sfCard('Прибыль по товарам', p.byModel.length ? p.byModel.map(r=> `<div class="row-item"><div class="rmain"><div class="rname">${escapeHtml(names.models[r.modelId] || '')}</div><div class="rmeta">выручка ${Math.round(r.revenue)} ₽</div></div><span class="rval ${r.net >= 0 ? 'pos' : 'neg'}">${Math.round(r.net)} ₽</span></div>`).join('') : sfEmpty('i-wallet', 'За этот период продаж не было'), 'sfPtp');
}
async function sfAbcHtml(range){
  const a = await sfAbc(range), names = await anNames();
  return sfCard('ABC-анализ', a.list.length ? a.list.map((x, i)=> `<div class="row-item sf-abc" data-group="${x.group}"><div class="rmain"><div class="rname">${i + 1}. ${escapeHtml(names.models[x.modelId] || '')}</div><div class="rmeta">${x.qty} шт · ${Math.round(x.revenue)} ₽ · накопл. ${x.cum.toFixed(1)}%</div></div><span class="tag ${x.group}">${x.group}</span></div>`).join('') : sfEmpty('i-chart', 'Нет продаж за выбранный период'), 'sfAbc');
}
/* в журнале и смены ежедневной суммы, и поправки за отдельные дни — иначе непонятно, откуда цифра */
async function sfAdsLogHtml(){
  const rates = (await sfAll('реклама')).sort((a, b)=> a.day < b.day ? 1 : -1).map(x=> ({x, title: 'По ' + Math.round(x.amount) + ' ₽ в день', meta: 'с ' + sfFmtDay(x.day), what: 'сумму с ' + sfFmtDay(x.day), cls: 'sf-ad'}));
  const fixes = (await sfAll('реклама_день')).sort((a, b)=> a.day < b.day ? 1 : -1).map(x=> ({x, title: sfFmtDay(x.day), meta: 'поправка за день', what: 'поправку за ' + sfFmtDay(x.day), cls: 'sf-fix'}));
  const rows = rates.concat(fixes);
  if(!rows.length) return sfEmpty('i-wallet', 'Расходы на рекламу пока не вносились');
  return rows.slice(0, 60).map(r=> `<div class="row-item ${r.cls}"><div class="rmain"><div class="rname">${escapeHtml(r.title)}</div><div class="rmeta">${escapeHtml(r.meta)}</div></div>
    <div class="rside"><span class="rval">${Math.round(r.x.amount)} ₽</span><button type="button" class="icon-btn sf-del" onclick="sfAskRemove('${escapeAttr(r.x.id)}','${escapeAttr(r.what)}')" aria-label="Убрать ${escapeAttr(r.what)}"><svg class="icon"><use href="#i-trash"/></svg></button></div></div>`).join('');
}
async function sfSalesHtml(){
  const now = Date.now(), rows = await supplierSales(), names = await anNames();
  const b = sfBuckets(rows, sfSalesMode, sfSalesMetric, now);
  const unit = sfSalesMetric === 'rub' ? '₽' : 'шт';
  const total = b.reduce((n, x)=> n + x.value, 0);
  const span = b[b.length - 1].end - b[0].start, prevFrom = b[0].start - span;
  const prev = rows.filter(r=> r.ts >= prevFrom && r.ts < b[0].start).reduce((n, r)=> n + (sfSalesMetric === 'rub' ? r.qty * r.price : r.qty), 0);
  const chg = prev > 0 ? Math.round((total - prev) / prev * 100) : null;
  const times = prev > 0 ? total / prev : 0, tr0 = Math.round(times);
  const raza = (times !== tr0 || (tr0 % 10 >= 2 && tr0 % 10 <= 4 && (tr0 % 100 < 12 || tr0 % 100 > 14))) ? 'раза' : 'раз';
  const chgText = chg === null ? '' : chg >= 200 ? 'в ' + fmtRate(times) + ' ' + raza : (chg >= 0 ? '+' : '−') + Math.abs(chg) + '%';
  const name = sfSalesMode === 'week' ? '12 недель' : '30 дней';
  const seg = (items, cur, fn, id)=> `<div class="period-seg ch-seg" id="${id}">${items.map(([v, t])=> `<button type="button" data-v="${v}" class="${cur === v ? 'active' : ''}" onclick="${fn}('${v}')">${t}</button>`).join('')}</div>`;
  const tr = sfTrends(rows, names, now);
  const trRow = o=> { const pct = o.prev > 0 ? Math.round(o.d / o.prev * 100) : null;
    return `<div class="row-item"><div class="rmain"><div class="rname">${escapeHtml(o.name)}</div><div class="rmeta num">${fmtNum(o.prev)} → ${fmtNum(o.cur)} шт</div></div>${sparkSvg(o.days)}<span class="trend ${o.d > 0 ? 'up' : 'down'}">${trendIcon(o.d > 0)}${pct === null ? 'новый' : (o.d > 0 ? '+' : '−') + Math.abs(pct) + '%'}</span></div>`; };
  sfSalesBuckets = b;
  return `<div class="card sf-sales"><div class="card-head"><span class="t-eyebrow">Продажи</span></div>
      <div class="ch-controls">${seg([['day', 'Дни'], ['week', 'Недели']], sfSalesMode, 'sfSetSales', 'sfModeSeg')}${seg([['qty', 'Штуки'], ['rub', 'Рубли']], sfSalesMetric, 'sfSetMetric', 'sfMetricSeg')}</div>
      <div><div class="ch-hero num">${fmtNum(total)} ${unit}</div><div class="t-caption" style="color:var(--text-secondary);">за ${name}${chg === null ? '' : ` · <span class="trend ${chg >= 0 ? 'up' : 'down'}">${trendIcon(chg >= 0)}${chgText}</span> ${chg >= 200 ? 'больше, чем за' : 'к'} предыдущие ${name}`}</div></div>
      <div class="ch-wrap" id="sfSalesChart">${total ? barChartSvg(b, unit) + '<div class="ch-tip" hidden></div>' : sfEmpty('i-alert', 'Продаж за этот отрезок нет')}</div>
      <details class="ch-table"><summary>Показать цифрами</summary><div>${b.slice().reverse().map(x=> `<div class="row-item"><div class="rmain">${escapeHtml(x.label)}</div><span class="rval">${fmtNum(x.value)} ${unit}</span></div>`).join('')}</div></details></div>
    ${sfCard('Что растёт, что падает', `<div class="t-caption" style="margin:-4px 0 var(--sp-2);color:var(--text-tertiary);">Продажи в штуках: последние 14 дней против 14 дней до них.</div>
      ${!tr.up.length && !tr.down.length ? sfEmpty('i-alert', 'За 4 недели заметных изменений нет') : (tr.up.length ? '<div class="t-eyebrow ch-group">Растут</div>' + tr.up.map(trRow).join('') : '') + (tr.down.length ? '<div class="t-eyebrow ch-group">Падают</div>' + tr.down.map(trRow).join('') : '')}`)}`;
}
let sfSalesBuckets = [];
/* подсказка над столбиком — как в «Складе» */
function sfWireChart(){
  const box = document.getElementById('sfSalesChart'); if(!box) return;
  const svg = box.querySelector('svg'), tip = box.querySelector('.ch-tip'); if(!svg || !tip) return;
  const unit = sfSalesMetric === 'rub' ? '₽' : 'шт';
  const hide = ()=>{ tip.hidden = true; svg.querySelectorAll('.ch-bar').forEach(p=> p.classList.remove('dim')); };
  const show = e=>{
    const t = e.target.closest('.ch-hit'); if(!t){ hide(); return; }
    const i = Number(t.dataset.i), b = sfSalesBuckets[i]; if(!b) return;
    svg.querySelectorAll('.ch-bar').forEach(p=> p.classList.toggle('dim', Number(p.dataset.i) !== i));
    tip.innerHTML = `<b class="num">${fmtNum(b.value)} ${unit}</b><span>${escapeHtml(b.label)}</span>`; tip.hidden = false;
    const br = box.getBoundingClientRect(), tr = t.getBoundingClientRect();
    tip.style.left = Math.min(br.width - tip.offsetWidth - 4, Math.max(4, tr.left - br.left + tr.width / 2 - tip.offsetWidth / 2)) + 'px';
  };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', e=>{ if(e.pointerType === 'mouse') hide(); });
}
async function sfFcHtml(){
  const f = await sfForecast();
  const badge = x=> x.status === 'out' ? '<span class="fc-badge out"><svg class="icon"><use href="#i-alert"/></svg>Закончился</span>' : x.status === 'order' ? '<span class="fc-badge order"><svg class="icon"><use href="#i-alert"/></svg>Пора заказать</span>' : '';
  const left = x=> x.rate === 0 ? 'не продаётся 30 дней' : x.status === 'out' ? 'нет на складе' : x.daysLeft > 365 ? 'хватит больше чем на год' : 'хватит на ~' + Math.floor(x.daysLeft) + ' ' + ruPlural(Math.floor(x.daysLeft), 'день', 'дня', 'дней');
  return sfCard('На сколько дней хватит', `<div class="filter-row sf-lead" style="align-items:center;"><label for="sfLead" class="t-small" style="flex:1;">Заказ идёт, дней</label>
      <input type="number" id="sfLead" inputmode="numeric" min="1" max="180" value="${f.lead}" style="max-width:90px;"><button type="button" class="btn primary sm" style="width:auto;" onclick="sfSaveLead()"><svg class="icon"><use href="#i-check"/></svg>OK</button></div>
    <div class="t-caption" style="margin:8px 0 var(--sp-2);color:var(--text-tertiary);">Скорость — средние продажи за последние 30 дней. «Пора заказать» — если товара хватит меньше, чем идёт заказ. Сколько заказать — чтобы хватило на время доставки и ещё на 30 дней (что уже едет на склад — вычтено).</div>
    ${f.list.length ? f.list.map(x=> `<div class="row-item fc-row ${x.status}"><div class="rmain"><div class="rname">${escapeHtml(x.name)}</div><div class="rmeta">${left(x)}${x.rate > 0 ? ' · ' + fmtRate(x.rate) + ' шт/день' : ''}</div>${x.orderQty > 0 && x.status !== 'ok' ? `<div class="rmeta fc-order num">Заказать ~${fmtNum(x.orderQty)} шт</div>` : ''}</div><div class="rside"><span class="rval num">${x.stock} шт</span>${badge(x)}</div></div>`).join('') : sfEmpty('i-box', 'Товаров пока нет')}`, 'sfFc');
}
async function sfSaveLead(){
  try{ const d = await sfSaveSettings({leadDays: document.getElementById('sfLead').value}); toast('Сохранено: заказ за ' + d.leadDays + ' ' + ruPlural(d.leadDays, 'день', 'дня', 'дней')); renderSupplierAnalysis(); }
  catch(e){ toast(e.message); }
}
/* содержимое вкладки (кроме «Сводки» — её рисует supplier-analysis.js) */
async function sfTabHtml(range){
  if(anTab === 'sales') return sfSalesHtml();
  if(anTab === 'fc') return sfFcHtml();
  /* кольцо «Куда уходит прибыль» — над вкладками, на всех (sfTopRingHtml) */
  if(anTab === 'abc') return await sfAbcHtml(range);
  if(anTab === 'ads') return sfCard('История расходов на рекламу', await sfAdsLogHtml(), 'sfRnr');
  return await sfPtpHtml(await sfProfit(range));
}
/* 22.11.2026 (владелец): кольцо видно всегда, когда заходишь в «Анализ», — оно про весь экран, а не про одну вкладку */
async function sfTopRingHtml(range){ return sfRingHtml(await sfProfit(range)); }
function sfAfterRender(){ if(anTab === 'sales') sfWireChart(); }

/* --- «⋯» → «Финансы»: реклама каждый день, поправка за день, комиссии банка (как в «Складе») --- */
async function sfFinanceHtml(){
  const rates = (await sfAll('реклама')).sort((a, b)=> a.day < b.day ? -1 : 1), cur = rates[rates.length - 1];
  const today = sfKey(Date.now());
  const fix = (await sfAll('реклама_день')).find(x=> x.day === today);
  return `<div class="card"><div class="card-head"><span class="t-eyebrow">Реклама каждый день</span></div>
      <div class="filter-row"><input type="number" id="sfAdRate" inputmode="numeric" placeholder="Сумма в день, ₽" value="${cur ? cur.amount : ''}" aria-label="Сумма в день, ₽">
        <button type="button" class="btn primary sm" id="sfAdRateOk" style="width:auto;white-space:nowrap;" onclick="sfSaveAdRate()"><svg class="icon"><use href="#i-check"/></svg>Применить</button></div>
      <div class="t-caption" id="sfAdRateNow" style="margin-top:8px;color:var(--text-tertiary);">${cur ? `Сейчас: ${Math.round(cur.amount)} ₽ в день, с ${sfFmtDay(cur.day)}. Поменяете — новая сумма пойдёт с сегодняшнего дня, прошлые останутся как были.` : 'Сумма не задана — реклама считается только по поправкам за конкретные дни.'}</div></div>
    <div class="card"><div class="card-head"><span class="t-eyebrow">Поправка за день</span><span class="t-caption" id="sfFixMark" style="${fix ? '' : 'display:none;'}color:var(--success);">записано</span></div>
      <div class="filter-row"><input type="date" id="sfFixDay" value="${today}" max="${today}" onchange="sfLoadFix()" aria-label="День"><input type="number" id="sfFixSum" inputmode="numeric" placeholder="Сумма, ₽" value="${fix ? fix.amount : ''}" oninput="document.getElementById('sfFixMark').style.display='none'" aria-label="Сумма, ₽"></div>
      <div class="btn-row" style="margin-top:8px;"><button type="button" class="btn ghost" id="sfFixClear" onclick="sfClearFix()"><svg class="icon"><use href="#i-x"/></svg>Убрать</button><button type="button" class="btn primary" id="sfFixOk" onclick="sfSaveFix()"><svg class="icon"><use href="#i-check"/></svg>Записать</button></div>
      <div class="t-caption" style="margin-top:8px;color:var(--text-tertiary);">Нужна, когда в конкретный день потратили не как обычно. Без поправки за день берётся сумма выше.</div></div>
    <div class="card"><div class="card-head"><span class="t-eyebrow">Комиссии банка</span></div>
      <div class="filter-row"><input type="date" id="sfBankDay" value="${today}" max="${today}" aria-label="День"><input type="number" id="sfBankSum" inputmode="decimal" placeholder="Сумма, ₽" aria-label="Сумма, ₽"></div>
      <button type="button" class="btn primary" id="sfBankOk" style="margin-top:8px;" onclick="sfSaveBank()"><svg class="icon"><use href="#i-check"/></svg>Записать</button>
      <div class="t-caption" style="margin-top:8px;color:var(--text-tertiary);">Вычитается из чистой прибыли за период, в который попадает дата.</div>
      <div id="sfBankList" style="margin-top:var(--sp-2);">${await sfBankListHtml()}</div></div>`;
}
function anMoreMenu(){ sfOpenFinance(); }
async function sfOpenFinance(){ uiSheet({title: 'Финансы', html: await sfFinanceHtml()}); }
async function sfRefreshFinance(){ const b = document.querySelector('#uiSheet .ui-sheet-body'); if(b) b.innerHTML = await sfFinanceHtml(); await renderSupplierAnalysis(); }
async function sfSaveAdRate(){
  try{ const v = sfAmount(document.getElementById('sfAdRate').value); if(document.getElementById('sfAdRate').value === '') throw new Error('Введите сумму в рублях');
    await sfSetAdRate(v); toast('С сегодняшнего дня считается по ' + Math.round(v) + ' ₽'); await sfRefreshFinance(); }catch(e){ toast(e.message === 'Введите сумму числом' ? 'Введите сумму в рублях' : e.message); }
}
async function sfLoadFix(){
  const d = document.getElementById('sfFixDay').value, x = (await sfAll('реклама_день')).find(r=> r.day === d);
  document.getElementById('sfFixSum').value = x ? x.amount : ''; document.getElementById('sfFixMark').style.display = x ? '' : 'none';
}
async function sfSaveFix(){
  const d = document.getElementById('sfFixDay').value, raw = document.getElementById('sfFixSum').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ toast('Выберите день'); return; }
  if(raw === '' || !(Number(raw) >= 0)){ toast('Введите сумму в рублях'); return; }
  await sfSetAdDay(d, raw); toast('Записано: ' + Math.round(Number(raw)) + ' ₽ за ' + sfFmtDay(d)); await sfRefreshFinance();
  document.getElementById('sfFixDay').value = d; await sfLoadFix();
}
async function sfClearFix(){
  const d = document.getElementById('sfFixDay').value;
  if(!await sfClearAdDay(d)){ toast('За этот день поправки нет'); return; }
  toast('Поправка убрана — день считается по обычной сумме'); await sfRefreshFinance();
}
async function sfSaveBank(){
  const d = document.getElementById('sfBankDay').value, raw = document.getElementById('sfBankSum').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ toast('Выберите день'); return; }
  if(raw === '' || !(Number(String(raw).replace(',', '.')) > 0)){ toast('Введите сумму'); return; }
  await sfAdd('банк', d, raw); toast('Комиссия банка записана: ' + sfFmtDay(d)); await sfRefreshFinance();
}
async function sfBankListHtml(){
  const list = (await sfAll('банк')).sort((a, b)=> a.day < b.day ? 1 : -1);
  return list.length ? list.slice(0, 60).map(x=> `<div class="row-item sf-bank"><div class="rmain"><div class="rname">${sfFmtDay(x.day)}</div><div class="rmeta">комиссия банка</div></div><div class="rside"><span class="rval">${sfRub(x.amount)}</span><button type="button" class="icon-btn sf-del" onclick="sfAskRemove('${escapeAttr(x.id)}','комиссию за ${sfFmtDay(x.day)}')" aria-label="Удалить"><svg class="icon"><use href="#i-trash"/></svg></button></div></div>`).join('') : '';   // 22.11.2026 (владелец): строку «пока не записывали» убрали
}
/* удалить — сразу, с «Отменить» внизу (вместо «Точно?») */
async function sfAskRemove(id, what){
  await sfRemove(id);
  uiUndo('Убрано: ' + what, async ()=>{ const x = await get('supFin', id); if(x){ delete x.deletedAt; await put('supFin', x); sfSync(); } await sfRefreshFinance(); });
  await sfRefreshFinance();
}
