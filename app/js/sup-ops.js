/* Fulbro: «Операции» поставщика — как «Операции» в «Складе» (владелец, 22.11.2026):
   Все / Продажи / Приход / Правки, период, поиск по артикулу или названию, группы по дням,
   цена, прибыль и штуки, галочки «Выбрано: N записей», «⋯». Корзина — только у того, что поставщик
   может отменить сам: заказ, который склад ещё не начал собирать; поставка, которую склад ещё не принял;
   своя правка, которую склад ещё не проверил. */

const OPS_DAY = 86400000;
const opsState = {kind: 'all', period: 'all', from: null, to: null, q: '', sel: new Set(), limit: 200};

/* все записи журнала поставщика: {id, kind, ts, modelId, sizeId, qty (со знаком), price, profit, note, del} */
async function opsRows(){
  const sup = Sync.mySupplierId();
  const models = await modelsMap();
  const privs = new Map((await getAll('privates')).map(p=> [p.modelId, p]));
  const cost = typeof anCostIndex === 'function' ? await anCostIndex() : ()=> null;
  const prices = new Map((await getAll('linePrices')).filter(p=> !p.deletedAt).map(p=> [p.lineId, Number(p.price) || 0]));
  const mine = x=> !sup || x.supplierId === sup;
  const out = [];
  // продажи: строки заказов «Продал» и отправок склада по этому поставщику
  const shs = new Map((await getAll('shipments')).filter(s=> !s.deletedAt && s.status !== 'отменена' && mine(s)).map(s=> [s.id, s]));
  const lines = (await getAll('shipmentLines')).filter(l=> !l.deletedAt && shs.has(l.shipmentId));
  const started = new Set(lines.filter(l=> l.collected).map(l=> l.shipmentId));
  for(const l of lines){
    const s = shs.get(l.shipmentId), m = models[l.modelId] || {}, p = privs.get(l.modelId) || {};
    const q = Number(l.qty) || 0, price = prices.has(l.id) ? prices.get(l.id) : (Number(m.price) || 0);
    const c = cost(l.sizeId), rev = q * price;
    const profit = rev - (c === null ? 0 : q * c) - rev * (Number(p.commissionPercent) || 0) / 100 - rev * (Number(p.taxPercent) || 0) / 100 - q * (Number(p.packaging) || 0) - q * (Number(p.deliveryDiscount) || 0);
    out.push({id: 'sl:' + l.id, kind: 'sale', ts: Number(l.collectedTs) || Number(s.createdTs) || 0, modelId: l.modelId, sizeId: l.sizeId, qty: -q, price, profit,
      note: (l.collected ? 'собран' : 'ждёт сборки') + (s.track ? ' · ' + s.track : ''), del: s.createdBy === 'supplier' && s.status === 'новая' && !started.has(s.id) ? {type: 'sale', id: s.id} : null});
  }
  // приход: что склад принял (операции «Приход») и что едет (поставка «ожидается»)
  const ops = (await getAll('ops')).filter(o=> !o.deletedAt && !o.rejected && mine(o));
  for(const o of ops) if(o.type === 'Приход') out.push({id: 'op:' + o.uid, kind: 'in', ts: Number(o.ts) || 0, modelId: o.modelId, sizeId: o.sizeId, qty: Number(o.delta) || 0, price: null, profit: null, note: 'принято складом', del: null});
  const exp = new Map((await getAll('receipts')).filter(r=> !r.deletedAt && r.kind === 'ожидается' && !r.isReturn && mine(r)).map(r=> [r.id, r]));
  for(const l of await getAll('receiptLines')){
    if(l.deletedAt || !exp.has(l.receiptId)) continue;
    out.push({id: 'rl:' + l.id, kind: 'in', ts: Number(exp.get(l.receiptId).createdTs) || 0, modelId: l.modelId, sizeId: l.sizeId, qty: Number(l.qty) || 0, price: prices.has(l.id) ? prices.get(l.id) : null, profit: null, note: 'едет на склад', del: {type: 'incoming', id: l.id}});
  }
  // правки: корректировки (свои — «на проверке», пока склад не посмотрел) и возвраты
  for(const o of ops){
    if(o.type !== 'Корректировка' && o.type !== 'Возврат') continue;
    const own = o.authorKind === 'supplier';
    out.push({id: 'op:' + o.uid, kind: 'fix', ts: Number(o.ts) || 0, modelId: o.modelId, sizeId: o.sizeId, qty: Number(o.delta) || 0, price: null, profit: null,
      note: (o.type === 'Возврат' ? 'возврат' : own ? 'ваша правка' : 'правка склада') + (o.review === 'на проверке' ? ' · на проверке' : '') + (o.defect ? ' · брак' : ''),
      del: own && o.review === 'на проверке' ? {type: 'fix', id: o.uid} : null});
  }
  return out.sort((a, b)=> b.ts - a.ts);
}
function opsRange(){
  const t0 = dayStart(Date.now());
  if(opsState.period === 'today') return [t0, Infinity];
  if(opsState.period === 'yesterday') return [t0 - OPS_DAY, t0];
  if(opsState.period === 'week') return [t0 - 6 * OPS_DAY, Infinity];
  if(opsState.period === 'month') return [t0 - 29 * OPS_DAY, Infinity];
  if(opsState.period === 'range' && opsState.from) return [opsState.from, opsState.to];
  return [-Infinity, Infinity];
}
async function opsFiltered(){
  const [a, b] = opsRange(), models = await modelsMap();
  const q = opsState.q.trim().toLowerCase();
  return (await opsRows()).filter(r=> (opsState.kind === 'all' || r.kind === opsState.kind) && r.ts >= a && r.ts < b &&
    (!q || (modelName(models[r.modelId] || {}) + ' ' + ((models[r.modelId] || {}).sku || '')).toLowerCase().includes(q)));
}
function opsDayTitle(ts){
  const t0 = dayStart(Date.now()), d = dayStart(ts);
  return d === t0 ? 'Сегодня' : d === t0 - OPS_DAY ? 'Вчера' : new Date(ts).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'});
}
async function renderSupOps(){
  const box = document.getElementById('supOpsBox'); if(!box) return;
  const rows = await opsFiltered(), models = await modelsMap();
  const labels = Object.fromEntries((await getAll('sizes')).map(s=> [s.id, s.sizeLabel]));
  const ids = new Set(rows.map(r=> r.id)); for(const id of [...opsState.sel]) if(!ids.has(id)) opsState.sel.delete(id);
  const seg = [['all', 'Все'], ['sale', 'Продажи'], ['in', 'Приход'], ['fix', 'Правки']].map(([k, t])=> `<button type="button" data-ops-kind="${k}" class="${opsState.kind === k ? 'active' : ''}" onclick="opsSet('kind','${k}')">${t}</button>`).join('');
  const per = [['all', 'Все'], ['today', 'Сегодня'], ['yesterday', 'Вчера'], ['week', 'Неделя'], ['month', 'Месяц']].map(([k, t])=> `<button type="button" data-ops-period="${k}" class="chip${opsState.period === k ? ' on' : ''}" onclick="opsSet('period','${k}')">${t}</button>`).join('')
    + `<button type="button" class="chip ops-cal${opsState.period === 'range' ? ' on' : ''}" id="opsCalBtn" onclick="opsOpenRange()" aria-label="Свой период"><svg class="icon"><use href="#i-calendar"/></svg></button>`;
  const fmtD = ts=> new Date(ts).toLocaleDateString('ru-RU');
  const list = [];
  let day = null;
  for(const r of rows.slice(0, opsState.limit)){
    const t = opsDayTitle(r.ts); if(t !== day){ day = t; list.push(`<div class="t-eyebrow ops-day">${escapeHtml(t)}</div>`); }
    const m = models[r.modelId] || {}, lab = labels[r.sizeId] && labels[r.sizeId] !== 'Единый' ? ' ' + labels[r.sizeId] : '';
    const d = new Date(r.ts);
    list.push(`<div class="row-item ops-row ${r.qty > 0 ? 'in' : 'out'}" data-ops-row="${escapeAttr(r.id)}">
      <label class="ops-check"><input type="checkbox" ${opsState.sel.has(r.id) ? 'checked' : ''} onchange="opsToggle(${jsArg(r.id)}, this.checked)" aria-label="Выбрать"></label>
      <div class="rmain"><div class="rname">${escapeHtml(modelName(m) + lab)}</div>${m.sku ? `<div class="rmeta ops-sku">${escapeHtml(m.sku)}</div>` : ''}<div class="rmeta">${d.toLocaleDateString('ru-RU')} · ${d.toLocaleTimeString('ru-RU')} · ${escapeHtml(r.note)}</div></div>
      <div class="ops-nums">${r.price !== null ? `<span class="ops-price num">${Math.round(r.price)} ₽</span>` : ''}${r.profit !== null ? `<span class="ops-profit num ${r.profit >= 0 ? 'pos' : 'neg'}">${Math.round(r.profit)} ₽</span>` : ''}<span class="ops-qty num ${r.qty > 0 ? 'pos' : 'neg'}">${r.qty > 0 ? '+' : ''}${r.qty} шт</span></div>
      ${r.del ? `<button type="button" class="icon-btn ops-del" onclick="opsDelete([${jsArg(r.id)}])" aria-label="Отменить"><svg class="icon"><use href="#i-trash"/></svg></button>` : '<span class="ops-del-gap"></span>'}</div>`);
  }
  box.innerHTML = `<div class="period-seg ops-kinds" role="tablist">${seg}</div>
    <div class="chips ops-periods">${per}</div>
    ${opsState.period === 'range' && opsState.from ? `<div class="t-caption ops-range">Период: ${fmtD(opsState.from)} – ${fmtD(opsState.to - 1)}</div>` : ''}
    <div class="t-caption ops-selected" id="opsSelected">Выбрано: ${opsState.sel.size} ${ruPlural(opsState.sel.size, 'запись', 'записи', 'записей')}</div>
    <div class="card ops-card"><input type="search" id="opsSearch" placeholder="Поиск по артикулу или названию" value="${escapeAttr(opsState.q)}" oninput="opsSearch(this.value)">
      <div id="opsList">${list.join('') || emptyState('i-clock', 'Операций нет', 'Поменяйте период или вкладку.')}</div>
      ${rows.length > opsState.limit ? `<button class="btn ghost" onclick="opsState.limit += 200; renderSupOps()">Показать ещё (${rows.length - opsState.limit})</button>` : ''}</div>`;
}
function opsSet(k, v){ opsState[k] = v; opsState.limit = 200; renderSupOps(); }
let opsSearchT = null;
function opsSearch(v){ opsState.q = v; clearTimeout(opsSearchT); opsSearchT = setTimeout(async ()=>{ await renderSupOps(); const i = document.getElementById('opsSearch'); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }
function opsToggle(id, on){ on ? opsState.sel.add(id) : opsState.sel.delete(id); const el = document.getElementById('opsSelected'); if(el) el.textContent = 'Выбрано: ' + opsState.sel.size + ' ' + ruPlural(opsState.sel.size, 'запись', 'записи', 'записей'); }
function opsOpenRange(){
  const iso = ts=> sfKeyOps(ts), today = iso(Date.now());
  uiSheet({title: 'Свой период', html: `<div class="field-row"><input type="date" id="opsFrom" max="${today}" value="${opsState.from ? iso(opsState.from) : today}" aria-label="С"><input type="date" id="opsTo" max="${today}" value="${opsState.to ? iso(opsState.to - 1) : today}" aria-label="По"></div>
    <button type="button" class="btn primary" id="opsRangeOk"><svg class="icon"><use href="#i-check"/></svg>Показать</button>`,
    onReady: b=> b.querySelector('#opsRangeOk').onclick = ()=>{
      const f = b.querySelector('#opsFrom').value, t = b.querySelector('#opsTo').value;
      if(!f || !t){ toast('Выберите даты'); return; }
      let a = new Date(f + 'T00:00:00').getTime(), z = new Date(t + 'T00:00:00').getTime(); if(z < a) [a, z] = [z, a];
      Object.assign(opsState, {period: 'range', from: a, to: z + OPS_DAY, limit: 200}); uiSheetClose(); renderSupOps();
    }});
}
const sfKeyOps = ts=> { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
/* «⋯»: выбрать все, снять выбор, удалить выбранные (только то, что можно отменить самому) */
async function opsMoreMenu(btn){
  const rows = await opsFiltered(), canDel = rows.filter(r=> opsState.sel.has(r.id) && r.del);
  uiMenu(btn, [
    {label: 'Выбрать все (' + Math.min(rows.length, opsState.limit) + ')', icon: 'i-check', run: ()=>{ rows.slice(0, opsState.limit).forEach(r=> opsState.sel.add(r.id)); renderSupOps(); }},
    {label: 'Снять выбор', icon: 'i-x', run: ()=>{ opsState.sel.clear(); renderSupOps(); }},
    {label: 'Отменить выбранные (' + canDel.length + ')', icon: 'i-trash', danger: true, run: ()=>{ if(!canDel.length){ toast(opsState.sel.size ? 'Среди выбранных нет того, что можно отменить: склад уже принял или собрал' : 'Сначала отметьте записи галочками'); return; } opsDelete(canDel.map(r=> r.id)); }}
  ]);
}
/* отмена: заказ — целиком (склад ещё не начал), строка поставки, своя правка; внизу «Отменить» на 5 секунд */
async function opsDelete(ids){
  const rows = (await opsRows()).filter(r=> ids.includes(r.id) && r.del);
  const done = new Set(), undo = [];
  let n = 0, err = '';
  for(const r of rows){
    const key = r.del.type + ':' + r.del.id; if(done.has(key)) continue; done.add(key);
    if(r.del.type === 'sale'){ const res = await cancelShipment(r.del.id); if(res.ok){ n++; undo.push(async ()=>{ const s = await get('shipments', r.del.id); if(s && s.status === 'отменена'){ s.status = 'новая'; await put('shipments', s); } }); } else err = res.error; }
    else if(r.del.type === 'incoming'){ const res = await removeIncomingLine(r.del.id); if(res.ok){ n++; undo.push(async ()=>{ const l = await get('receiptLines', r.del.id); if(l){ delete l.deletedAt; await put('receiptLines', l); } }); } else err = res.error; }
    else if(r.del.type === 'fix'){ const o = await get('ops', r.del.id); if(o && o.review === 'на проверке' && !o.deletedAt){ o.deletedAt = Date.now(); await put('ops', o); n++; undo.push(async ()=>{ const x = await get('ops', r.del.id); if(x){ delete x.deletedAt; await put('ops', x); } }); } }
  }
  ids.forEach(id=> opsState.sel.delete(id));
  if(window.Sync && Sync.syncNow && typeof ffSoft === 'function') ffSoft(()=> Sync.syncNow('отмена в операциях'));
  await renderSupOps();
  if(err && !n){ toast(err); return; }
  if(n) uiUndo('Отменено: ' + n + ' ' + ruPlural(n, 'запись', 'записи', 'записей'), async ()=>{ for(const f of undo) await f(); if(window.Sync && Sync.syncNow && typeof ffSoft === 'function') ffSoft(()=> Sync.syncNow('вернули')); await renderSupOps(); });
}
