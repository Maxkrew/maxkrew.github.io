/* «ФФ»: Отправки (этап 1 — создаёт склад). Строка → «возьми из Ячейки N» (сначала менее
   заполненная) → галочка «Собрано» = штука списана из ячейки (операция «Отправка»).
   Пока строка не собрана, товар в резерве. Правила — ОПИСАНИЕ §5.2, §6.3. */
const DEFAULT_CARRIERS = ['СДЭК', 'Почта России', 'Boxberry', 'Яндекс Доставка', '5Post', 'Ozon', 'Wildberries', 'Авито Доставка', 'Достависта', 'Самовывоз (Ясенево)'];
function carrierList(){
  const c = (window.settings && Array.isArray(settings.carriers) && settings.carriers.length) ? settings.carriers : DEFAULT_CARRIERS;
  return c.filter(x=> !/\bDPD\b/i.test(x));      // DPD не возим (ТЗ владельца)
}

async function newShipment(o){
  const id = newUid();
  await put('shipments', {id, supplierId: o.supplierId, carrier: o.carrier || carrierList()[0], comment: o.comment || '', status: 'новая', createdBy: 'owner', createdTs: Date.now()});
  return id;
}
async function shipmentLines(shipmentId){
  return (await new Promise((res, rej)=>{ const r = tx('shipmentLines').index('byShipment').getAll(shipmentId); r.onsuccess = ()=> res(r.result || []); r.onerror = rej; }))
    .filter(l=> !l.deletedAt);
}
/* Несобранные строки живых отправок: {ячейка: {подпись: штук}} и по размеру. */
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

async function addShipmentLine(shipmentId, modelId, sizeId, qty){
  const n = Math.max(0, parseInt(qty, 10) || 0);
  if(!n) return {ok:false, error:'Укажите количество'};
  if(n > 10000) return {ok:false, error:'Слишком много в одной строке — не больше 10 000'};
  const label = await sizeLabelOf(sizeId);
  const stock = JSON.parse(JSON.stringify(await cellStockByLabel()));
  const res = await reservedMaps();
  for(const [cell, by] of Object.entries(res.byCell)) for(const [lab, q] of Object.entries(by)) if(stock[cell]) stock[cell][lab] = (stock[cell][lab] || 0) - q;
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
  const pick = planPick({modelId, sizeLabel: label, qty: n}, cells, stock);
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

async function tickCollected(lineId, on){
  const l = await get('shipmentLines', lineId);
  if(!l) return {ok:false, error:'Нет такой строки'};
  const sh = await get('shipments', l.shipmentId);
  if(on === undefined) on = !l.collected;
  if(on){
    await ffLogOp({uid: lineId, supplierId: sh.supplierId, modelId: l.modelId, sizeId: l.sizeId, cellNumber: l.cellNumber, type: 'Отправка', qty: l.qty, taskRef: lineId});
    l.collected = true;
  } else {
    const op = await get('ops', lineId);
    if(op && !op.deletedAt){ op.deletedAt = Date.now(); await put('ops', op); }
    l.collected = false;
  }
  await put('shipmentLines', l);
  const all = await shipmentLines(sh.id);
  const status = all.length && all.every(x=> x.collected) ? 'собрана' : 'новая';
  if(sh.status !== status){ sh.status = status; await put('shipments', sh); }
  return {ok:true};
}

/* ---------------- экран «Отправки» ---------------- */
async function renderShipments(){
  const box = document.getElementById('shipmentsBox');
  if(!box) return;
  const sups = Object.values(await ffSuppliersMap()).filter(s=> !s.deletedAt && !s.archived).sort((a, b)=> String(a.name).localeCompare(String(b.name), 'ru'));
  const list = (await getAll('shipments')).filter(s=> !s.deletedAt && s.status !== 'отменена').sort((a, b)=> b.createdTs - a.createdTs);
  const open = list.filter(s=> s.status !== 'собрана');
  const done = list.filter(s=> s.status === 'собрана').slice(0, 10);
  const parts = [`<div class="card">
      <div class="field-row"><select id="shSupplier">${sups.map(s=> `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('')}</select>
        <select id="shCarrier">${carrierList().map(c=> `<option>${escapeHtml(c)}</option>`).join('')}</select></div>
      <div class="field-row" style="margin-top:8px;"><input type="text" id="shComment" placeholder="Комментарий: номер заказа, адрес">
        <button class="btn primary" style="width:auto;white-space:nowrap;" onclick="shStart()"><svg class="icon"><use href="#i-plus"/></svg>Новая отправка</button></div>
    </div>`];
  for(const s of open) parts.push(await shipmentCard(s, true));
  if(!open.length) parts.push(emptyState('i-out', 'Несобранных отправок нет', 'Выберите поставщика и службу, нажмите «Новая отправка».'));
  if(done.length){ parts.push('<div class="grp-title">Собраны недавно</div>'); for(const s of done) parts.push(await shipmentCard(s, false)); }
  box.innerHTML = parts.join('');
  wireFFScanInputs();
}
async function shipmentCard(s, editable){
  const sups = await ffSuppliersMap(), models = await modelsMap();
  const lines = await shipmentLines(s.id);
  const rows = [];
  for(const l of lines){
    rows.push(`<label class="task${l.collected ? ' done' : ''}"><input type="checkbox"${l.collected ? ' checked' : ''} onchange="shTick(${jsArg(l.id)}, this.checked)">
      <span><b>${escapeHtml(modelName(models[l.modelId] || {}))} ${escapeHtml(await sizeLabelOf(l.sizeId))}</b> — ${l.qty} шт.<br>
      <span class="go">➡ возьми из Ячейки ${escapeHtml(l.cellNumber || '?')}</span>${l.collected ? ' · <b>Собрано</b>' : ''}</span></label>`);
  }
  let add = '';
  if(editable){
    const ms = Object.values(models).filter(m=> !m.deletedAt && m.supplierId === s.supplierId).sort((a, b)=> modelName(a).localeCompare(modelName(b), 'ru'));
    add = `<div class="field-row scan-row" style="margin-top:8px;"><input type="text" data-scan-shipment="${escapeAttr(s.id)}" placeholder="Скан: отметить собранным" autocomplete="off">
      <button class="btn ghost sm" style="width:auto;" onclick="openCameraScan(c=> ffScanShipment(${jsArg(s.id)}, c))">Камера</button></div>
      <div class="field-row" style="margin-top:8px;"><select id="shModel-${escapeAttr(s.id)}" onchange="shFillSizes(${jsArg(s.id)})"><option value="">— модель —</option>${ms.map(m=> `<option value="${escapeAttr(m.id)}">${escapeHtml(modelName(m))}</option>`).join('')}</select></div>
      <div class="size-pick" id="shSizes-${escapeAttr(s.id)}" style="margin-top:6px;"></div>
      <div class="field-row" style="margin-top:6px;"><input type="number" id="shQty-${escapeAttr(s.id)}" min="1" value="1"><button class="btn ghost" style="width:auto;" onclick="shAddLine(${jsArg(s.id)})">Добавить</button></div>`;
  }
  return `<div class="card sh-card" data-shipment="${escapeAttr(s.id)}"><div class="rname">${escapeHtml((sups[s.supplierId] || {}).name || '')} · ${escapeHtml(s.carrier)}</div>
    <div class="rmeta">${escapeHtml(s.comment || '')}${s.comment ? ' · ' : ''}${escapeHtml(s.status)}</div>
    <div class="tasks">${rows.join('') || '<div class="hint">Строк пока нет</div>'}</div>${add}</div>`;
}
async function shStart(){
  const sup = document.getElementById('shSupplier').value;
  if(!sup){ toast('Выберите поставщика'); return; }
  await newShipment({supplierId: sup, carrier: document.getElementById('shCarrier').value, comment: document.getElementById('shComment').value});
  await renderShipments();
}
async function shFillSizes(sid){
  const mid = document.getElementById('shModel-' + sid).value;
  const sizes = mid ? (await getAll('sizes')).filter(s=> s.modelId === mid && !s.deletedAt).sort((a, b)=> sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel)) : [];
  const parts = [];
  for(const s of sizes) parts.push(`<button type="button" data-size-id="${escapeAttr(s.id)}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${escapeHtml(s.sizeLabel)} · ${await ffSizeStock(s.id)}</button>`);
  document.getElementById('shSizes-' + sid).innerHTML = parts.join('');
}
async function shAddLine(sid){
  const mid = document.getElementById('shModel-' + sid).value;
  const sz = document.querySelector('#shSizes-' + CSS.escape(sid) + ' button.on');
  if(!mid || !sz){ toast('Выберите модель и размер'); return; }
  const r = await addShipmentLine(sid, mid, sz.dataset.sizeId, document.getElementById('shQty-' + sid).value);
  if(!r.ok){ toast(r.error); return; }
  await renderShipments();
}
async function shTick(lineId, on){ await tickCollected(lineId, on); await renderShipments(); }
