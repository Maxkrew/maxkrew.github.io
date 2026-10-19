/* «Fulbro», этап 2б: анализ поставщика — штуки и деньги (ОПИСАНИЕ §11в «Анализ поставщика»).
   Считается по подтверждённому складом: продажа = строка отправки с «Собрано», закупка —
   принятые строки прихода. Цены видит только поставщик. Плата складу — с этапа 3 (пока 0). */

const AN_DAY = 86400000, AN_STALE_DAYS = 60, AN_RUNOUT_DAYS = 14;

/* собранные строки отправок поставщика: {ts, modelId, sizeId, qty, price} */
async function supplierSales(){
  const mine = Sync.mySupplierId();
  const shs = new Map((await getAll('shipments')).filter(s=> !s.deletedAt && s.status !== 'отменена' && (!mine || s.supplierId === mine)).map(s=> [s.id, s]));
  const models = await modelsMap();
  const prices = new Map((await getAll('linePrices')).filter(p=> !p.deletedAt && p.doc === 'продажа').map(p=> [p.lineId, Number(p.price) || 0]));
  const lines = (await getAll('shipmentLines')).filter(l=> !l.deletedAt && shs.has(l.shipmentId));
  // склад делит строку по ячейкам (2 + 1) — у новых кусков своей цены нет, цена та же, что у строки
  const bySameSize = new Map();
  for(const l of lines) if(prices.has(l.id)) bySameSize.set(l.shipmentId + '|' + l.sizeId, prices.get(l.id));
  const out = [];
  for(const l of lines){
    if(!l.collected) continue;
    const ts = Number(l.collectedTs) || Number(shs.get(l.shipmentId).createdTs) || 0;
    const k = l.shipmentId + '|' + l.sizeId;
    const price = prices.has(l.id) ? prices.get(l.id) : bySameSize.has(k) ? bySameSize.get(k) : (Number((models[l.modelId] || {}).price) || 0);
    out.push({ts, modelId: l.modelId, sizeId: l.sizeId, qty: Number(l.qty) || 0, price});
  }
  return out;
}

/* средняя закупка, взвешенная по принятому количеству; нет цен прихода — из карточки, иначе null */
async function anCostIndex(){
  const prices = new Map((await getAll('linePrices')).filter(p=> !p.deletedAt && p.doc === 'приход').map(p=> [p.lineId, Number(p.price) || 0]));
  const recs = new Map((await getAll('receipts')).filter(r=> !r.deletedAt).map(r=> [r.id, r]));
  const acc = {};
  for(const l of await getAll('receiptLines')){
    if(l.deletedAt || !prices.has(l.id)) continue;
    const r = recs.get(l.receiptId); if(!r || r.kind === 'ожидается') continue;
    const q = Number(l.doneQty) || 0; if(q <= 0) continue;
    for(const k of [l.sizeId, l.modelId]){ const a = acc[k] || (acc[k] = {q: 0, sum: 0}); a.q += q; a.sum += q * prices.get(l.id); }
  }
  const privs = new Map((await getAll('privates')).map(p=> [p.modelId, Number(p.cost) || 0]));
  const sizeModel = new Map((await getAll('sizes')).map(s=> [s.id, s.modelId]));
  return id=>{
    const a = acc[id]; if(a && a.q) return Math.round(a.sum / a.q * 100) / 100;
    const mid = sizeModel.get(id) || id;
    const m = acc[mid]; if(m && m.q) return Math.round(m.sum / m.q * 100) / 100;
    const c = privs.get(mid); return c ? c : null;
  };
}
async function avgCost(id){ return (await anCostIndex())(id); }

/* когда размер впервые пришёл на склад (для «без движения» — товар должен лежать дольше 60 дней) */
async function anFirstArrival(){
  const first = {};
  for(const op of await getAll('ops')){
    if(op.deletedAt || op.rejected || !(Number(op.delta) > 0)) continue;
    const t = Number(op.ts) || 0;
    if(!first[op.sizeId] || t < first[op.sizeId]) first[op.sizeId] = t;
  }
  return first;
}

async function analysisSummary(o){
  const days = (o && o.days) || 30, now = (o && o.now) || Date.now();
  const sales = await supplierSales(), cost = await anCostIndex(), counts = await supplierCounts(), first = await anFirstArrival();
  const inWin = (s, d)=> s.ts > now - d * AN_DAY && s.ts <= now;
  const win = sales.filter(s=> inWin(s, days));
  let soldQty = 0, revenue = 0, costSum = 0, costUnknown = false;
  const byModel = {};
  for(const s of win){
    soldQty += s.qty; revenue += s.qty * s.price;
    const c = cost(s.sizeId); if(c === null) costUnknown = true; else costSum += s.qty * c;
    const t = byModel[s.modelId] || (byModel[s.modelId] = {modelId: s.modelId, qty: 0, revenue: 0});
    t.qty += s.qty; t.revenue += s.qty * s.price;
  }
  const sold30 = {}, lastSale = {};
  for(const s of sales){
    if(inWin(s, 30)) sold30[s.sizeId] = (sold30[s.sizeId] || 0) + s.qty;
    if(s.ts <= now) lastSale[s.sizeId] = Math.max(lastSale[s.sizeId] || 0, s.ts);
  }
  const sizes = new Set([...counts.keys(), ...Object.keys(sold30)]);
  let frozen = 0;
  const stale = [], runningOut = [], restock = [];
  for(const id of sizes){
    const c = counts.get(id) || {stock: 0, incoming: 0};
    const stock = Math.max(0, c.stock), sold = sold30[id] || 0;
    const uc = cost(id); if(uc !== null) frozen += stock * uc;
    if(stock > 0 && !(lastSale[id] > now - AN_STALE_DAYS * AN_DAY) && first[id] && first[id] <= now - AN_STALE_DAYS * AN_DAY) stale.push({sizeId: id, stock});
    if(sold > 0){
      const daysLeft = Math.floor(stock / (sold / 30));
      if(daysLeft <= AN_RUNOUT_DAYS) runningOut.push({sizeId: id, daysLeft});
      const need = sold - stock - Math.max(0, c.incoming || 0);
      if(need > 0) restock.push({sizeId: id, qty: need});
    }
  }
  const r2 = n=> Math.round(n * 100) / 100;
  return {days, soldQty, revenue: r2(revenue), cost: r2(costSum), costUnknown, profit: r2(revenue - costSum), frozen: r2(frozen),
    top: Object.values(byModel).sort((a, b)=> b.qty - a.qty || b.revenue - a.revenue).slice(0, 5),
    stale: stale.sort((a, b)=> b.stock - a.stock), runningOut: runningOut.sort((a, b)=> a.daysLeft - b.daysLeft), restock: restock.sort((a, b)=> b.qty - a.qty),
    rows: win.map(s=> ({ts: s.ts, qty: s.qty, revenue: s.qty * s.price}))};
}

/* подсказки текстом — по правилам, без ИИ */
function analysisHints(sum, names){
  const sz = id=> (names.sizes || {})[id] || '', md = id=> (names.models || {})[id] || '';
  const out = [];
  for(const r of sum.runningOut){
    const need = sum.restock.find(x=> x.sizeId === r.sizeId);
    out.push(`${sz(r.sizeId)} ${r.daysLeft ? 'закончится через ' + r.daysLeft + ' ' + ruPlural(r.daysLeft, 'день', 'дня', 'дней') : 'уже закончился'}${need ? ' — довезите ' + need.qty + ' шт.' : ''}`);
  }
  for(const r of sum.restock) if(!sum.runningOut.some(x=> x.sizeId === r.sizeId)) out.push(`${sz(r.sizeId)}: на месяц не хватит — довезите ${r.qty} шт.`);
  for(const s of sum.stale) out.push(`${sz(s.sizeId)} не продаётся ${AN_STALE_DAYS} дней — ${s.stock} шт. на складе`);
  if(sum.top[0]) out.push(`Лучше всего продаётся: ${md(sum.top[0].modelId)} — ${sum.top[0].qty} шт. за ${sum.days} ${ruPlural(sum.days, 'день', 'дня', 'дней')}`);
  return out;
}
async function anNames(){
  const models = await modelsMap(), sizes = {};
  for(const s of await getAll('sizes')) sizes[s.id] = modelName(models[s.modelId] || {}) + ' ' + s.sizeLabel;
  return {sizes, models: Object.fromEntries(Object.values(models).map(m=> [m.id, modelName(m)]))};
}

/* --- экран --- */
let anDays = 30;
function anSetDays(d){ anDays = d; renderSupplierAnalysis(); }
async function renderSupplierAnalysis(){
  const box = document.getElementById('analysisBox');
  if(!box) return;
  const sum = await analysisSummary({days: anDays}), names = await anNames();
  const tile = (label, value, note)=> `<div class="an-tile"><div class="an-label">${label}</div><div class="an-value">${value}</div>${note ? `<div class="an-note">${note}</div>` : ''}</div>`;
  const hints = analysisHints(sum, names);
  const list = (title, rows)=> rows.length ? `<div class="card"><div class="rname" style="margin-bottom:6px;">${title}</div>${rows.join('')}</div>` : '';
  const row = (a, b)=> `<div class="row-item"><div class="rmain">${escapeHtml(a)}</div><div class="rside"><b>${escapeHtml(b)}</b></div></div>`;
  const chart = typeof barChartSvg === 'function' && typeof bucketize === 'function'
    ? barChartSvg(bucketize(sum.rows, anDays > 30 ? 'week' : 'day', 'qty'), 'шт.') : '';
  box.innerHTML = `<div class="an-seg" role="group" aria-label="Период">${[7, 30, 90].map(d=> `<button type="button" data-days="${d}" class="${d === anDays ? 'on' : ''}" onclick="anSetDays(${d})">${d} дней</button>`).join('')}</div>
    <div class="an-tiles">
      ${tile('Продано, шт.', fmtNum(sum.soldQty))}
      ${tile('Выручка', fmtMoney(sum.revenue))}
      ${tile('Себестоимость', fmtMoney(sum.cost), sum.costUnknown ? 'не у всех товаров есть цена закупки' : '')}
      ${tile('Прибыль', fmtMoney(sum.profit), 'плата складу появится позже')}
      ${tile('Заморожено в остатках', fmtMoney(sum.frozen), 'остаток × средняя закупка')}
    </div>
    <div class="card"><div class="rname" style="margin-bottom:6px;">Продажи по ${anDays > 30 ? 'неделям' : 'дням'}</div>${chart}</div>
    ${hints.length ? `<div class="card an-hints">${hints.map(h=> `<div class="an-hint">${escapeHtml(h)}</div>`).join('')}</div>` : ''}
    ${list('Заканчивается', sum.runningOut.map(r=> row(names.sizes[r.sizeId] || '', r.daysLeft + ' ' + ruPlural(r.daysLeft, 'день', 'дня', 'дней'))))}
    ${list('Довезти на месяц', sum.restock.map(r=> row(names.sizes[r.sizeId] || '', r.qty + ' шт.')))}
    ${list('Без движения 60 дней', sum.stale.map(r=> row(names.sizes[r.sizeId] || '', r.stock + ' шт.')))}
    ${list('Лучшие товары', sum.top.map(t=> row(names.models[t.modelId] || '', t.qty + ' шт. · ' + fmtMoney(t.revenue))))}
    <p class="hint" style="margin:10px 4px;">Советы ИИ — скоро.</p>`;
}
