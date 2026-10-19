/* Fulbro: Отправки. Склад: строка → «возьми из Ячейки N» (сначала менее заполненная) → галочка
   «Собрано» = штука списана из ячейки (операция «Отправка»). Поставщик (этап 2): создаёт заказ
   без ячеек, отменяет, пока склад ничего не собрал; склад назначает ячейки и собирает.
   Пока строка не собрана, товар в резерве. Правила — ОПИСАНИЕ §5.2, §6.3. */
const DEFAULT_CARRIERS = ['СДЭК', 'Почта России', 'Boxberry', 'Яндекс Доставка', '5Post', 'Ozon', 'Wildberries', 'Авито Доставка', 'Достависта', 'Самовывоз (Ясенево)'];
function carrierList(){
  const c = (window.settings && Array.isArray(settings.carriers) && settings.carriers.length) ? settings.carriers : DEFAULT_CARRIERS;
  return c.filter(x=> !/\bDPD\b/i.test(x));      // DPD не возим (ТЗ владельца)
}
const shIsSupplier = ()=> ffRole() === 'supplier';
const CANCEL_LATE = 'Склад уже начал собирать — отменить нельзя';

async function newShipment(o){
  const id = newUid(), sup = shIsSupplier();
  await put('shipments', {id, supplierId: sup ? Sync.mySupplierId() : o.supplierId, carrier: o.carrier || carrierList()[0], comment: o.comment || '',
    status: 'новая', createdBy: sup ? 'supplier' : 'owner', createdTs: Date.now()});
  return id;
}
async function shipmentLines(shipmentId){
  return (await new Promise((res, rej)=>{ const r = tx('shipmentLines').index('byShipment').getAll(shipmentId); r.onsuccess = ()=> res(r.result || []); r.onerror = rej; }))
    .filter(l=> !l.deletedAt);
}
/* Несобранные строки живых отправок: {ячейка: {подпись: штук}} и по размеру (с ячейкой и без). */
async function reservedMaps(){
  const live = new Set((await getAll('shipments')).filter(s=> !s.deletedAt && s.status !== 'отменена').map(s=> s.id));
  const labels = Object.fromEntries((await getAll('sizes')).map(s=> [s.id, s.sizeLabel]));
  const byCell = {}, bySize = {};
  for(const l of await getAll('shipmentLines')){
    if(l.deletedAt || l.collected || !live.has(l.shipmentId)) continue;
    const lab = labels[l.sizeId] || l.sizeId;
    if(l.cellNumber) (byCell[l.cellNumber] || (byCell[l.cellNumber] = {}))[lab] = ((byCell[l.cellNumber] || {})[lab] || 0) + l.qty;
    bySize[l.sizeId] = (bySize[l.sizeId] || 0) + l.qty;
  }
  return {byCell, bySize};
}
async function reservedQty(sizeId){ return (await reservedMaps()).bySize[sizeId] || 0; }
/* Свободно для заказа: «можно продать» − резерв несобранных строк. */
async function freeQty(sizeId){
  return ((await ffStockIndex()).sellableBySize[sizeId] || 0) - await reservedQty(sizeId);
}
/* Остаток по ячейкам за вычетом резерва (для «откуда взять»). */
async function freeCellStock(){
  const stock = JSON.parse(JSON.stringify(await cellStockByLabel()));
  const res = await reservedMaps();
  for(const [cell, by] of Object.entries(res.byCell)) for(const [lab, q] of Object.entries(by)) if(stock[cell]) stock[cell][lab] = (stock[cell][lab] || 0) - q;
  return stock;
}
const sanitizeQty = qty=>{
  const n = Math.max(0, parseInt(qty, 10) || 0);
  if(!n) return {error:'Укажите количество'};
  if(n > 10000) return {error:'Слишком много в одной строке — не больше 10 000'};
  return {n};
};

async function addShipmentLine(shipmentId, modelId, sizeId, qty){
  const q = sanitizeQty(qty); if(q.error) return {ok:false, error:q.error};
  const n = q.n;
  const label = await sizeLabelOf(sizeId);
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
  const pick = planPick({modelId, sizeLabel: label, qty: n}, cells, await freeCellStock());
  const short = pick.find(p=> p.cell === null);
  if(short) return {ok:false, error:'Не хватает ' + short.qty + ' шт. на складе (с учётом резерва)'};
  const ids = [];
  for(const p of pick){
    const id = newUid();
    await put('shipmentLines', {id, shipmentId, modelId, sizeId, qty: p.qty, cellNumber: p.cell, collected: false});
    ids.push(id);
  }
  return {ok:true, lines: ids};
}
/* Поставщик: строка заказа без ячейки, по свободному остатку (без брака, минус резерв). */
async function addSupplierOrderLine(shipmentId, modelId, sizeId, qty){
  const q = sanitizeQty(qty); if(q.error) return {ok:false, error:q.error};
  const sh = await get('shipments', shipmentId);
  if(!sh || sh.status !== 'новая') return {ok:false, error:'Заказ уже не меняется'};
  const free = await freeQty(sizeId);
  if(q.n > free) return {ok:false, error:'Не хватает ' + (q.n - Math.max(0, free)) + ' шт. — свободно ' + Math.max(0, free)};
  const id = newUid();
  await put('shipmentLines', {id, shipmentId, modelId, sizeId, qty: q.n, cellNumber: null, collected: false});
  return {ok:true, id};
}
async function cancelShipment(shipmentId){
  const sh = await get('shipments', shipmentId);
  if(!sh || sh.status === 'отменена') return {ok:true};
  if((await shipmentLines(shipmentId)).some(l=> l.collected)) return {ok:false, error:CANCEL_LATE};
  sh.status = 'отменена'; await put('shipments', sh);
  return {ok:true};
}
/* Склад: строкам заказов поставщика без ячейки — «откуда взять». Хватает — строка делится
   по ячейкам; не хватает — остаётся без ячейки (на экране «не хватает N шт.»). */
async function assignCellsForOrders(){
  if(shIsSupplier()) return 0;
  const live = new Map((await getAll('shipments')).filter(s=> !s.deletedAt && s.status === 'новая').map(s=> [s.id, s]));
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
  let done = 0;
  for(const l of (await getAll('shipmentLines')).filter(l=> !l.deletedAt && !l.collected && !l.cellNumber && live.has(l.shipmentId))){
    const pick = planPick({modelId: l.modelId, sizeLabel: await sizeLabelOf(l.sizeId), qty: l.qty}, cells, await freeCellStock());
    if(pick.some(p=> p.cell === null)) continue;
    l.cellNumber = pick[0].cell; l.qty = pick[0].qty; await put('shipmentLines', l);
    for(const p of pick.slice(1)) await put('shipmentLines', {id: newUid(), shipmentId: l.shipmentId, modelId: l.modelId, sizeId: l.sizeId, qty: p.qty, cellNumber: p.cell, collected: false});
    done++;
  }
  return done;
}
/* Недостача строки без ячейки: сколько не покрывает свободный остаток по ячейкам. */
async function lineShortage(l){
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
  const pick = planPick({modelId: l.modelId, sizeLabel: await sizeLabelOf(l.sizeId), qty: l.qty}, cells, await freeCellStock());
  return (pick.find(p=> p.cell === null) || {}).qty || 0;
}

async function tickCollected(lineId, on){
  const l = await get('shipmentLines', lineId);
  if(!l) return {ok:false, error:'Нет такой строки'};
  if(shIsSupplier()) return {ok:false, error:'«Собрано» отмечает склад'};
  if(!l.cellNumber) return {ok:false, error:'Сначала нужна ячейка — товара не хватает'};
  const sh = await get('shipments', l.shipmentId);
  if(on === undefined) on = !l.collected;
  if(on){
    await ffLogOp({uid: lineId, supplierId: sh.supplierId, modelId: l.modelId, sizeId: l.sizeId, cellNumber: l.cellNumber, type: 'Отправка', qty: l.qty, taskRef: lineId});
    l.collected = true; l.collectedTs = Date.now();
  } else {
    const op = await get('ops', lineId);
    if(op && !op.deletedAt){ op.deletedAt = Date.now(); await put('ops', op); }
    l.collected = false; l.collectedTs = null;
  }
  await put('shipmentLines', l);
  const all = await shipmentLines(sh.id);
  const status = all.length && all.every(x=> x.collected) ? 'собрана' : 'новая';
  if(sh.status !== status){ sh.status = status; await put('shipments', sh); }
  return {ok:true};
}

/* Сервер не принял отмену (склад уже собирал): заказ снова в работе — статус приедет с сервера. */
async function ffShipmentRejected(store, row, msg){
  if(store !== 'shipments') return false;
  row.rejected = 0; row.rejectReason = ''; row.dirty = 0;
  if(row.status === 'отменена') row.status = 'новая';
  row.updatedAt = 0;   // любая версия с сервера новее — приедет при приёме
  await put('shipments', row, {fromSync:true});
  if(typeof toast === 'function') toast(/уже начал собирать/.test(msg) ? CANCEL_LATE : 'Сервер не принял заказ: ' + msg);
  return true;
}

/* ---------------- экран «Отправки» ---------------- */
async function renderShipments(){
  const box = document.getElementById('shipmentsBox');
  if(!box) return;
  const sup = shIsSupplier();
  if(!sup) await assignCellsForOrders();
  const sups = Object.values(await ffSuppliersMap()).filter(s=> !s.deletedAt && !s.archived).sort((a, b)=> String(a.name).localeCompare(String(b.name), 'ru'));
  const list = (await getAll('shipments')).filter(s=> !s.deletedAt && s.status !== 'отменена' && (!sup || s.supplierId === Sync.mySupplierId())).sort((a, b)=> b.createdTs - a.createdTs);
  const open = list.filter(s=> s.status !== 'собрана');
  const done = list.filter(s=> s.status === 'собрана').slice(0, 10);
  const parts = [];
  if(!sup && typeof renderReviewBlock === 'function') parts.push(await renderReviewBlock());
  // поставщик заказывает через «Продал» (служба, скриншот, комментарий — там)
  if(sup) parts.push(`<button class="btn primary sh-sell" id="shStart" onclick="shStart()"><svg class="icon"><use href="#i-out"/></svg>Продал — новый заказ</button>`);
  else parts.push(`<div class="card">
      <div class="field-row">${sup ? '' : `<select id="shSupplier">${sups.map(s=> `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('')}</select>`}
        <select id="shCarrier">${carrierList().map(c=> `<option>${escapeHtml(c)}</option>`).join('')}</select></div>
      <div class="field-row" style="margin-top:8px;"><input type="text" id="shComment" placeholder="Комментарий: номер заказа, адрес">
        <button class="btn primary" id="shStart" style="width:auto;white-space:nowrap;" onclick="shStart()"><svg class="icon"><use href="#i-plus"/></svg>${sup ? 'Новый заказ' : 'Новая отправка'}</button></div>
    </div>`);
  for(const s of open) parts.push(await shipmentCard(s, true));
  if(!open.length) parts.push(emptyState('i-out', sup ? 'Заказов в работе нет' : 'Несобранных отправок нет', sup ? 'Выберите службу доставки и нажмите «Новый заказ» — склад соберёт.' : 'Выберите поставщика и службу, нажмите «Новая отправка».'));
  if(done.length){ parts.push('<div class="grp-title">Собраны недавно</div>'); for(const s of done) parts.push(await shipmentCard(s, false)); }
  box.innerHTML = parts.join('');
  wireFFScanInputs();
  if(typeof fillPhotoThumbs === 'function') fillPhotoThumbs(box);
}
async function shipmentCard(s, editable){
  const sup = shIsSupplier();
  const sups = await ffSuppliersMap(), models = await modelsMap();
  const lines = await shipmentLines(s.id);
  const rows = [];
  for(const l of lines){
    let pr = sup && typeof linePrice === 'function' ? await linePrice(l.id) : null;
    if(sup && pr === null) for(const o of lines) if(o.id !== l.id && o.sizeId === l.sizeId){ const p = await linePrice(o.id); if(p !== null){ pr = p; break; } }   // кусок разделённой складом строки
    const name = `<b>${escapeHtml(modelName(models[l.modelId] || {}))} ${escapeHtml(await sizeLabelOf(l.sizeId))}</b> — ${l.qty} шт.${pr !== null ? ' · ' + fmtMoney(pr) : ''}`;
    if(sup){ rows.push(`<div class="row-item${l.collected ? ' done' : ''}"><div class="rmain">${name}${l.collected ? ' · <b>Собрано</b>' : ''}</div></div>`); continue; }
    if(!l.cellNumber && !l.collected){
      rows.push(`<div class="row-item"><div class="rmain">${name}<br><span class="warn">не хватает ${await lineShortage(l)} шт. — ждёт поставки</span></div></div>`);
      continue;
    }
    rows.push(`<label class="task${l.collected ? ' done' : ''}"><input type="checkbox"${l.collected ? ' checked' : ''} onchange="shTick(${jsArg(l.id)}, this.checked)">
      <span>${name}<br><span class="go">➡ возьми из Ячейки ${escapeHtml(l.cellNumber || '?')}</span>${l.collected ? ' · <b>Собрано</b>' : ''}</span></label>`);
  }
  let add = '';
  if(editable){
    const mySup = sup ? Sync.mySupplierId() : s.supplierId;
    const ms = Object.values(models).filter(m=> !m.deletedAt && m.supplierId === mySup).sort((a, b)=> modelName(a).localeCompare(modelName(b), 'ru'));
    const canAdd = !sup;   // поставщик собирает заказ в «Продал» (со скриншотом), здесь строки не дописывает
    add = (sup ? '' : `<div class="field-row scan-row" style="margin-top:8px;"><input type="text" data-scan-shipment="${escapeAttr(s.id)}" placeholder="Скан: отметить собранным" autocomplete="off">
      <button class="btn ghost sm" style="width:auto;" onclick="openCameraScan(c=> ffScanShipment(${jsArg(s.id)}, c))">Камера</button></div>`) +
      (canAdd ? `<div class="field-row" style="margin-top:8px;"><select id="shModel-${escapeAttr(s.id)}" onchange="shFillSizes(${jsArg(s.id)})"><option value="">— модель —</option>${ms.map(m=> `<option value="${escapeAttr(m.id)}">${escapeHtml(modelName(m))}</option>`).join('')}</select></div>
      <div class="size-pick" id="shSizes-${escapeAttr(s.id)}" style="margin-top:6px;"></div>
      <div class="field-row" style="margin-top:6px;"><input type="number" id="shQty-${escapeAttr(s.id)}" min="1" value="1"><button class="btn ghost" style="width:auto;" onclick="shAddLine(${jsArg(s.id)})">Добавить</button></div>` : '') +
      ((sup && s.createdBy === 'supplier') || (!sup && s.createdBy !== 'supplier') ? `<button class="btn ghost danger-text" style="margin-top:8px;" data-cancel="${escapeAttr(s.id)}" onclick="shCancel(${jsArg(s.id)})"${lines.some(l=> l.collected) ? ' disabled' : ''}>Отменить ${sup ? 'заказ' : 'отправку'}</button>` : '');
  }
  // скриншот штрихкода, фото к заказу и фото товаров — видят оба
  const phs = [];
  if(typeof shipmentPhotos === 'function'){
    for(const p of await shipmentPhotos(s.id)) phs.push(photoThumb(p.id, p.kind === 'штрихкод' ? 'Скриншот штрихкода' : 'Фото к заказу'));
    for(const mid of [...new Set(lines.map(l=> l.modelId))]){ const mp = await modelPhoto(mid); if(mp) phs.push(photoThumb(mp.id, 'Фото товара')); }
  }
  const phRow = phs.length ? '<div class="ph-row">' + phs.join('') + '</div>' : '';
  const from = !sup && s.createdBy === 'supplier' ? ' · <span class="tag-sup">от поставщика</span>' : '';
  const pencil = sup && typeof shipmentEditable === 'function' && await shipmentEditable(s)
    ? `<button type="button" class="icon-btn sh-edit" data-edit="${escapeAttr(s.id)}" onclick="sellEditStart(${jsArg(s.id)})" aria-label="Изменить заказ"><svg class="icon"><use href="#i-edit"/></svg></button>` : '';
  return `<div class="card sh-card" data-shipment="${escapeAttr(s.id)}">${pencil}<div class="rname">${sup ? '' : escapeHtml((sups[s.supplierId] || {}).name || '') + ' · '}${escapeHtml(s.carrier)}${from}</div>
    <div class="rmeta">${escapeHtml(s.comment || '')}${s.comment ? ' · ' : ''}${escapeHtml(s.status)}</div>
    ${phRow}<div class="tasks">${rows.join('') || '<div class="hint">Строк пока нет</div>'}</div>${add}</div>`;
}
async function shStart(){
  // поставщик заказывает только через «Продал»: там скриншот штрихкода Авито обязателен
  if(shIsSupplier() && typeof sellStart === 'function'){ await sellStart(); return; }
  const supEl = document.getElementById('shSupplier');
  if(!shIsSupplier() && !(supEl && supEl.value)){ toast('Выберите поставщика'); return; }
  await newShipment({supplierId: supEl ? supEl.value : null, carrier: document.getElementById('shCarrier').value, comment: document.getElementById('shComment').value});
  await renderShipments();
}
async function shFillSizes(sid){
  const mid = document.getElementById('shModel-' + sid).value;
  const sizes = mid ? (await getAll('sizes')).filter(s=> s.modelId === mid && !s.deletedAt).sort((a, b)=> sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel)) : [];
  const parts = [];
  for(const s of sizes) parts.push(`<button type="button" data-size-id="${escapeAttr(s.id)}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${escapeHtml(s.sizeLabel)} · ${Math.max(0, await freeQty(s.id))}</button>`);
  document.getElementById('shSizes-' + sid).innerHTML = parts.join('');
}
async function shAddLine(sid){
  const mid = document.getElementById('shModel-' + sid).value;
  const sz = document.querySelector('#shSizes-' + CSS.escape(sid) + ' button.on');
  if(!mid || !sz){ toast('Выберите модель и размер'); return; }
  const qty = document.getElementById('shQty-' + sid).value;
  const r = shIsSupplier() ? await addSupplierOrderLine(sid, mid, sz.dataset.sizeId, qty) : await addShipmentLine(sid, mid, sz.dataset.sizeId, qty);
  if(!r.ok){ toast(r.error); return; }
  await renderShipments();
}
async function shCancel(sid){
  if(!confirm('Отменить?')) return;
  const r = await cancelShipment(sid);
  if(!r.ok){ toast(r.error); return; }
  toast('Отменено'); await renderShipments();
}
async function shTick(lineId, on){ const r = await tickCollected(lineId, on); if(!r.ok) toast(r.error); await renderShipments(); }
