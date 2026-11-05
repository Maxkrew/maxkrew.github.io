/* Fulbro: Отправки. Склад: строка → «возьми из Ячейки N» (сначала менее заполненная) → галочка
   «Собрано» = штука списана из ячейки (операция «Отправка»). Поставщик (этап 2): создаёт заказ
   без ячеек, отменяет, пока склад ничего не собрал; склад назначает ячейки и собирает.
   Пока строка не собрана, товар в резерве. Правила — ОПИСАНИЕ §5.2, §6.3. */
const DEFAULT_CARRIERS = ['СДЭК', 'Почта России', 'Boxberry', 'Яндекс Доставка', '5Post', 'Ozon', 'Wildberries', 'Авито Доставка', 'Достависта', 'Самовывоз (Ясенево)'];
function carrierList(){
  const c = (window.settings && Array.isArray(settings.carriers) && settings.carriers.length) ? settings.carriers : DEFAULT_CARRIERS;
  return c.filter(x=> !/\bDPD\b/i.test(x));      // DPD не возим (ТЗ владельца)
}
/* Служба по формату трек-номера (образцы владельца, 01.11.2026). Нашли — вернём название из списка служб, иначе null. */
const TRACK_RULES = [
  [/^\d{10}$/, /авито/i],                 // 513 097 4601
  [/^103\d{8}$/, /сдэк|cdek/i],           // 103 426 84587: всегда начинается со 103
  [/^\d{14}$/, /почта/i],                 // 805 135 253 33813
  [/^[A-Z]{2}\d{9}[A-Z]{2}$/, /почта/i],  // международный: RA123456789RU
  [/^[РPR]\d{6,}$/, /яндекс/i]            // P07 223 919 648
];
function carrierByTrack(track){
  const t = String(track || '').trim().toUpperCase();
  const rule = TRACK_RULES.find(r=> r[0].test(t));
  return rule ? carrierList().find(c=> rule[1].test(c)) || null : null;
}
/* Трек по три цифры, как на штрихкоде; одна оставшаяся цифра — к последней группе (513 103 6105).
   Разрыв рисует стиль, а не пробел: номер скопируется целиком и вставится на сайте службы. */
function trackGroups(track){
  const t = String(track || '');
  if(!/^[РPR]?\d{4,}$/i.test(t)) return [t];
  const g = t.match(/.{1,3}/g);
  if(g[g.length - 1].length === 1) g.push(g.splice(-2).join(''));
  return g;
}
const trackHtml = track=> trackGroups(track).map(p=> '<span class="trk-g">' + escapeHtml(p) + '</span>').join('');
const shIsSupplier = ()=> ffRole() === 'supplier';
const CANCEL_LATE = 'Склад уже начал собирать — отменить нельзя';

async function newShipment(o){
  const id = newUid(), sup = shIsSupplier();
  await put('shipments', {id, supplierId: sup ? Sync.mySupplierId() : o.supplierId, carrier: o.carrier || carrierList()[0], comment: o.comment || '',
    track: String(o.track || '').trim().slice(0, 60),
    status: 'новая', createdBy: sup ? 'supplier' : 'owner', createdTs: Date.now()});
  return id;
}
async function shipmentLines(shipmentId){
  return (await new Promise((res, rej)=>{ const r = tx('shipmentLines').index('byShipment').getAll(shipmentId); r.onsuccess = ()=> res(r.result || []); r.onerror = rej; }))
    .filter(l=> !l.deletedAt);
}
/* Несобранные строки живых отправок: {ячейка: {sizeId: штук}} и по размеру (с ячейкой и без). */
async function reservedMaps(){
  const live = new Set((await getAll('shipments')).filter(s=> !s.deletedAt && s.status !== 'отменена').map(s=> s.id));
  const byCell = {}, bySize = {};
  for(const l of await getAll('shipmentLines')){
    if(l.deletedAt || l.collected || !live.has(l.shipmentId)) continue;
    if(l.cellNumber) (byCell[l.cellNumber] || (byCell[l.cellNumber] = {}))[l.sizeId] = ((byCell[l.cellNumber] || {})[l.sizeId] || 0) + l.qty;
    bySize[l.sizeId] = (bySize[l.sizeId] || 0) + l.qty;
  }
  return {byCell, bySize};
}
async function reservedQty(sizeId){ return (await reservedMaps()).bySize[sizeId] || 0; }
/* Свободно для заказа: «можно продать» − резерв несобранных строк. */
async function freeQty(sizeId){
  return ((await ffStockIndex()).sellableBySize[sizeId] || 0) - await reservedQty(sizeId);
}
/* Остаток по ячейкам за вычетом резерва (для «откуда взять»): {ячейка: {sizeId: штук}}. */
async function freeCellStock(){
  const stock = await ffCellStockMap();
  const res = await reservedMaps();
  for(const [cell, by] of Object.entries(res.byCell)) for(const [sid, q] of Object.entries(by)) (stock[cell] || (stock[cell] = {}))[sid] = ((stock[cell] || {})[sid] || 0) - q;
  return stock;
}
/* Откуда взять строку; allowMinus — чего нет на складе, «возьми с пола» в минус (склад так решил). */
async function pickForLine(supplierId, sizeId, qty, allowMinus){
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
  const pick = planPick({sizeId, qty}, cells, await freeCellStock());
  const short = pick.find(p=> p.cell === null);
  if(short && allowMinus){
    const floor = await floorCellFor(supplierId);
    const same = pick.find(p=> p.cell === floor);
    if(same){ same.qty += short.qty; pick.splice(pick.indexOf(short), 1); } else short.cell = floor;
  }
  return pick;
}
const sanitizeQty = qty=>{
  const n = Math.max(0, parseInt(qty, 10) || 0);
  if(!n) return {error:'Укажите количество'};
  if(n > 10000) return {error:'Слишком много в одной строке — не больше 10 000'};
  return {n};
};

async function addShipmentLine(shipmentId, modelId, sizeId, qty, allowMinus){
  const q = sanitizeQty(qty); if(q.error) return {ok:false, error:q.error};
  const sh = await get('shipments', shipmentId);
  if(!sh) return {ok:false, error:'Нет такой отправки'};
  const pick = await pickForLine(sh.supplierId, sizeId, q.n, allowMinus);
  const short = pick.find(p=> p.cell === null);
  if(short) return {ok:false, short: short.qty, error:'Не хватает ' + short.qty + ' шт. на складе (с учётом резерва)'};
  const ids = [];
  for(const p of pick){
    const id = newUid();
    await put('shipmentLines', {id, shipmentId, modelId, sizeId, qty: p.qty, cellNumber: p.cell, collected: false});
    ids.push(id);
  }
  return {ok:true, lines: ids};
}
/* Поставщик: строка заказа без ячейки. Можно и больше, чем есть (FoG, 04.11.2026): поставка едет,
   а заказы падают сегодня — склад видит «не хватает N шт. — ждёт поставки». */
async function addSupplierOrderLine(shipmentId, modelId, sizeId, qty){
  const q = sanitizeQty(qty); if(q.error) return {ok:false, error:q.error};
  const sh = await get('shipments', shipmentId);
  if(!sh || sh.status !== 'новая') return {ok:false, error:'Заказ уже не меняется'};
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
async function assignLineCells(l, sh, allowMinus){
  const pick = await pickForLine(sh.supplierId, l.sizeId, l.qty, allowMinus);
  if(pick.some(p=> p.cell === null)) return false;
  l.cellNumber = pick[0].cell; l.qty = pick[0].qty; await put('shipmentLines', l);
  for(const p of pick.slice(1)) await put('shipmentLines', {id: newUid(), shipmentId: l.shipmentId, modelId: l.modelId, sizeId: l.sizeId, qty: p.qty, cellNumber: p.cell, collected: false});
  return true;
}
async function assignCellsForOrders(){
  if(shIsSupplier()) return 0;
  const live = new Map((await getAll('shipments')).filter(s=> !s.deletedAt && s.status === 'новая').map(s=> [s.id, s]));
  let done = 0;
  for(const l of (await getAll('shipmentLines')).filter(l=> !l.deletedAt && !l.collected && !l.cellNumber && live.has(l.shipmentId))){
    if(await assignLineCells(l, live.get(l.shipmentId), false)) done++;
  }
  return done;
}
/* Склад: строку заказа поставщика, которой не хватает товара, — всё равно отправить (в минус). */
async function shipLineMinus(lineId){
  if(shIsSupplier()) return {ok:false, error:'Решает склад'};
  const l = await get('shipmentLines', lineId), sh = l && await get('shipments', l.shipmentId);
  if(!l || l.deletedAt || l.collected || l.cellNumber || !sh) return {ok:false, error:'Строка уже в работе'};
  await assignLineCells(l, sh, true);
  return {ok:true};
}
/* Недостача строки без ячейки: сколько не покрывает свободный остаток по ячейкам. */
async function lineShortage(l){
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
  const pick = planPick({sizeId: l.sizeId, qty: l.qty}, cells, await freeCellStock());
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
  if(sh.status !== status){ await shipmentSetStatus(sh, status); await put('shipments', sh); }
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
/* Трек для сравнения и поиска: без пробелов и чёрточек, заглавными. */
const trackKey = t=> String(t || '').replace(/[\s-]/g, '').toUpperCase();
/* Дубли (FoG, 05.11.2026): живые заказы с одним треком — один и тот же заказ скинули дважды. */
let shDupKeys = new Set();
function shFindDups(list){
  const seen = new Map();
  for(const s of list){ const k = trackKey(s.track); if(k) seen.set(k, (seen.get(k) || 0) + 1); }
  shDupKeys = new Set([...seen].filter(([, n])=> n > 1).map(([k])=> k));
}
const shIsDup = s=> shDupKeys.has(trackKey(s.track));
/* Поиск в «Отправках»: трек (пробелы не важны), товар, комментарий. */
async function shMatches(list, q){
  q = String(q || '').trim().toLowerCase();
  if(!q) return list;
  const models = await modelsMap(), labels = Object.fromEntries((await getAll('sizes')).map(s=> [s.id, s.sizeLabel]));
  const linesBy = {};
  for(const l of await getAll('shipmentLines')) if(!l.deletedAt) (linesBy[l.shipmentId] || (linesBy[l.shipmentId] = [])).push(l);
  const tq = trackKey(q);
  return list.filter(s=> (tq && trackKey(s.track).includes(tq)) || String(s.comment || '').toLowerCase().includes(q)
    || (linesBy[s.id] || []).some(l=> (modelName(models[l.modelId] || {}) + ' ' + sizeText(labels[l.sizeId] || '')).toLowerCase().includes(q)));
}
const SH_RECENT = 100;   // поставщик видит последние 100 заказов (FoG, 05.11.2026)
async function renderShipments(){
  const box = document.getElementById('shipmentsBox');
  if(!box) return;
  const sup = shIsSupplier();
  if(!sup) await assignCellsForOrders();
  const sups = Object.values(await ffSuppliersMap()).filter(s=> !s.deletedAt && !s.archived).sort((a, b)=> String(a.name).localeCompare(String(b.name), 'ru'));
  const list = (await getAll('shipments')).filter(s=> !s.deletedAt && s.status !== 'отменена' && (!sup || s.supplierId === Sync.mySupplierId())).sort((a, b)=> b.createdTs - a.createdTs);
  shFindDups(list);
  const open = list.filter(s=> s.status !== 'собрана');
  const done = list.filter(s=> s.status === 'собрана').slice(0, sup ? SH_RECENT : 10);
  const q = (document.getElementById('shSearch') || {}).value || '';
  const parts = [];
  // «В работе» / «История» (js/archive.js) — история отправок и возвратов, ничего не пропадает
  parts.push(`<div class="as-chips sh-view"><button type="button" class="as-chip${shView === 'work' ? ' on' : ''}" data-sh-view="work" onclick="shSetView('work')">В работе</button><button type="button" class="as-chip${shView === 'history' ? ' on' : ''}" data-sh-view="history" onclick="shSetView('history')">История</button></div>`);
  if(shView === 'history'){ parts.push(await renderArchive()); box.innerHTML = parts.join(''); if(typeof fillPhotoThumbs === 'function') fillPhotoThumbs(box); return; }
  if(!sup && typeof renderReviewBlock === 'function') parts.push(await renderReviewBlock());
  // поставщик заказывает через «Продал» (служба, скриншот, комментарий — там)
  if(sup) parts.push(`<div class="sh-sup-btns"><button class="btn primary sh-sell" id="shStart" onclick="shStart()"><svg class="icon"><use href="#i-out"/></svg>Продал — новый заказ</button>
    <button class="btn ghost sh-sell" id="shReturn" onclick="sellStart('return')"><svg class="icon"><use href="#i-in"/></svg>Возврат</button></div>`);
  else parts.push(`<div class="card">
      <div class="field-row">${sup ? '' : `<select id="shSupplier">${sups.map(s=> `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('')}</select>`}
        <select id="shCarrier">${carrierList().map(c=> `<option>${escapeHtml(c)}</option>`).join('')}</select></div>
      <div class="field-row" style="margin-top:8px;"><input type="text" id="shTrack" maxlength="60" placeholder="Трек-номер" autocomplete="off" oninput="shTrackGuess(this.value)">
        <label class="btn ghost sm" id="shBarcodeBtn" style="width:auto;white-space:nowrap;"><svg class="icon"><use href="#i-upload"/></svg>Штрихкод<input type="file" accept="image/*" hidden onchange="shPickBarcode(this)"></label></div>
      <div class="sh-new-bc"><div class="sell-thumb" id="shBarcodeThumb"></div><div class="hint sell-detect" id="shDetect" role="status"></div></div>
      <div class="field-row" style="margin-top:8px;"><input type="text" id="shComment" placeholder="Комментарий">
        <button class="btn primary" id="shStart" style="width:auto;white-space:nowrap;" onclick="shStart()"><svg class="icon"><use href="#i-plus"/></svg>${sup ? 'Новый заказ' : 'Новая отправка'}</button></div>
    </div>`);
  // поставщик: возвраты, которые едут на склад (js/incoming.js)
  if(sup) for(const r of await returnsOnTheWay()) parts.push(await returnCard(r, 'Возврат едет на склад',
    `<button class="btn ghost danger-text" style="margin-top:8px;" data-ret-cancel="${escapeAttr(r.id)}" onclick="retCancel(${jsArg(r.id)})">Отменить возврат</button>`));
  parts.push(`<input type="search" id="shSearch" class="sh-search" placeholder="Поиск: трек-номер, товар, комментарий" value="${escapeAttr(q)}" oninput="arRefresh()">`);
  // поиск — по всем живым заказам, и собранным тоже
  if(q.trim()){
    const hits = (await shMatches(list, q)).slice(0, SH_RECENT);
    for(const s of hits) parts.push(await shipmentCard(s, s.status !== 'собрана'));
    if(!hits.length) parts.push('<div class="hint">Ничего не найдено</div>');
    box.innerHTML = parts.join(''); wireFFScanInputs();
    if(typeof fillPhotoThumbs === 'function') fillPhotoThumbs(box);
    return;
  }
  // склад: «Сборка» — фильтр по поставщику, счётчик, «Выбрать» (js/assembly.js)
  if(!sup) parts.push(await assemblyHeader(open, list));
  if(!sup && typeof statsCard === 'function') parts.push(await statsCard(shFilter));   // статистика и начисления за период
  const byCarrier = list=> !sup && shCarrierFilter ? list.filter(s=> s.carrier === shCarrierFilter) : list;
  let shown = byCarrier(!sup && shFilter ? open.filter(s=> s.supplierId === shFilter) : open);
  if(!sup && shModelFilter){   // фильтр по товару: «только Суприм» — собрали, выбрали следующий
    const has = new Set((await getAll('shipmentLines')).filter(l=> !l.deletedAt && !l.collected && l.modelId === shModelFilter).map(l=> l.shipmentId));
    shown = shown.filter(s=> has.has(s.id));
  }
  for(const s of shown) parts.push(await shipmentCard(s, true));
  if(!shown.length) parts.push(emptyState('i-out', sup ? 'Заказов в работе нет' : 'Несобранных отправок нет', sup ? 'Выберите службу доставки и нажмите «Новый заказ» — склад соберёт.' : 'Выберите поставщика и службу, нажмите «Новая отправка».'));
  // склад: «Собранные сегодня» (нет сегодняшних — последние собранные)
  const today = sup ? [] : await shCollectedToday(list.filter(s=> !shFilter || s.supplierId === shFilter));
  let recent = byCarrier(today.length ? today : done.filter(s=> sup || !shFilter || s.supplierId === shFilter));
  if(!sup && shModelFilter){ const has = new Set((await getAll('shipmentLines')).filter(l=> !l.deletedAt && l.modelId === shModelFilter).map(l=> l.shipmentId)); recent = recent.filter(s=> has.has(s.id)); }
  if(recent.length){ parts.push('<div class="grp-title">' + (today.length ? 'Собранные сегодня · ' + recent.length : (sup ? 'Последние заказы · ' + recent.length : 'Собраны недавно')) + '</div>'); for(const s of recent) parts.push(await shipmentCard(s, false)); }
  // экран перерисовывается и после обмена — не теряем то, что склад уже ввёл в новую отправку
  const keep = ['shSupplier', 'shCarrier', 'shTrack', 'shComment'].map(id=> [id, (document.getElementById(id) || {}).value]);
  box.innerHTML = parts.join('');
  for(const [id, v] of keep){ const el = document.getElementById(id); if(el && v) el.value = v; }
  if(!sup) shShowBarcode();
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
    const name = `<span class="sh-item">${escapeHtml(modelName(models[l.modelId] || {}))} ${escapeHtml(await sizeLabelOf(l.sizeId))}</span> <span class="sh-qty">${l.qty} шт.</span>${pr !== null ? ' <span class="sh-price">' + fmtMoney(pr) + '</span>' : ''}`;
    // заказано больше, чем есть (FoG, 04.11.2026), — склад отправит, когда приедет поставка
    const wait = sup && !l.collected && await freeQty(l.sizeId) < 0 ? ' <span class="warn">ждёт поставки</span>' : '';
    if(sup){ rows.push(`<div class="row-item${l.collected ? ' done' : ''}"><div class="rmain">${name}${wait}${l.collected ? ' <span class="sh-done">Собрано</span>' : ''}</div></div>`); continue; }
    const del = editable && !l.collected && s.createdBy !== 'supplier'
      ? `<button type="button" class="icon-btn sh-del" data-del-line="${escapeAttr(l.id)}" onclick="event.preventDefault();event.stopPropagation();shDelLine(${jsArg(l.id)})" aria-label="Убрать строку"><svg class="icon"><use href="#i-trash"/></svg></button>` : '';
    if(!l.cellNumber && !l.collected){
      rows.push(`<div class="row-item"><div class="rmain">${name}<br><span class="warn">не хватает ${await lineShortage(l)} шт. — ждёт поставки</span></div>
        <div class="rside"><button type="button" class="btn ghost sm" style="width:auto;" data-minus="${escapeAttr(l.id)}" onclick="shMinus(${jsArg(l.id)})">Отправить в минус</button>${del}</div></div>`);
      continue;
    }
    rows.push(`<label class="task${l.collected ? ' done' : ''}"><input type="checkbox"${l.collected ? ' checked' : ''} onchange="shTick(${jsArg(l.id)}, this.checked)">
      <span>${name}<br><span class="go">➡ ${/^П/.test(l.cellNumber || '') ? 'возьми с пола' : 'возьми из Ячейки ' + escapeHtml(l.cellNumber || '?')}</span>${!l.collected && /^П/.test(l.cellNumber || '') && await cellSizeQty(l.cellNumber, l.sizeId) < l.qty ? ' <span class="over-warn">на складе нет — уйдёт в минус</span>' : ''}${l.collected ? ' <span class="sh-done">Собрано</span>' : ''}</span>${del}</label>`);
  }
  let add = '';
  if(editable){
    const mySup = sup ? Sync.mySupplierId() : s.supplierId;
    const ms = Object.values(models).filter(m=> !m.deletedAt && m.supplierId === mySup).sort((a, b)=> modelName(a).localeCompare(modelName(b), 'ru'));
    // поставщик собирает заказ в «Продал» (со скриншотом); в заказ поставщика склад тоже ничего не дописывает
    const canAdd = !sup && s.createdBy !== 'supplier';
    add = (sup ? '' : `<div class="field-row scan-row" style="margin-top:8px;"><input type="text" data-scan-shipment="${escapeAttr(s.id)}" placeholder="Скан штрихкода" autocomplete="off">
      <button class="btn ghost sm" style="width:auto;" onclick="openCameraScan(c=> ffScanShipment(${jsArg(s.id)}, c))">Камера</button></div>`) +
      (canAdd ? `<div class="field-row" style="margin-top:8px;"><select id="shModel-${escapeAttr(s.id)}" data-products="ship" data-sizes="shSizes-${escapeAttr(s.id)}" onchange="shFillSizes(${jsArg(s.id)})"><option value="">— модель —</option>${ms.map(m=> `<option value="${escapeAttr(m.id)}">${escapeHtml(modelName(m))}</option>`).join('')}</select></div>
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
  const hasBc = typeof shipmentPhotos === 'function' && (await shipmentPhotos(s.id)).some(p=> p.kind === 'штрихкод');
  const bcBtn = !sup && !hasBc ? ` <label class="btn ghost sm" style="width:auto;padding:2px 10px;" data-sh-barcode="${escapeAttr(s.id)}">Штрихкод<input type="file" accept="image/*" hidden onchange="shAddBarcodePick(${jsArg(s.id)}, this)"></label>` : '';
  const from = !sup && s.createdBy === 'supplier' ? ' · <span class="tag-sup">от поставщика</span>' : '';
  // склад: собранную отправку можно вернуть в работу (ошиблись) и удалить свою
  const doneTools = !sup && s.status === 'собрана' ? `<div class="sh-tools"><button type="button" class="icon-btn sh-edit-btn" data-reopen="${escapeAttr(s.id)}" onclick="shReopen(${jsArg(s.id)})" aria-label="Вернуть в работу"><svg class="icon"><use href="#i-edit"/></svg></button>${s.createdBy !== 'supplier' ? `<button type="button" class="icon-btn sh-del-btn" data-sh-del="${escapeAttr(s.id)}" onclick="shDeleteDone(${jsArg(s.id)})" aria-label="Удалить отправку"><svg class="icon"><use href="#i-trash"/></svg></button>` : ''}</div>` : '';
  const pencil = sup && typeof shipmentEditable === 'function' && await shipmentEditable(s)
    ? `<button type="button" class="icon-btn sh-edit" data-edit="${escapeAttr(s.id)}" onclick="sellEditStart(${jsArg(s.id)})" aria-label="Изменить заказ"><svg class="icon"><use href="#i-edit"/></svg></button>` : '';
  const time = s.createdTs ? new Date(s.createdTs).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}) : '';
  const meta = [sup ? '' : escapeHtml((sups[s.supplierId] || {}).name || ''), from ? 'от поставщика' : '', time ? '🕒 ' + time : '', escapeHtml(s.comment || '')].filter(Boolean).join(' · ');
  // склад: большая кнопка «Собран» и галочка выбора (сборка)
  const canCollect = !sup && editable && lines.length && lines.some(l=> !l.collected) && lines.every(l=> l.collected || l.cellNumber);
  const bigBtn = canCollect && !shSelectMode ? `<button class="btn primary as-collect" data-collect="${escapeAttr(s.id)}" onclick="shCollect(${jsArg(s.id)})"><svg class="icon"><use href="#i-check"/></svg>Собран</button>` : '';
  const selBox = !sup && editable && shSelectMode && canCollect ? `<label class="as-select"><input type="checkbox" data-select="${escapeAttr(s.id)}"${shSelected.has(s.id) ? ' checked' : ''} onchange="shSelectOne(${jsArg(s.id)}, this.checked)"> Выбрать</label>` : '';
  return `<div class="card sh-card" data-shipment="${escapeAttr(s.id)}">${pencil}${doneTools}<div class="rname sh-head"><span class="sh-carrier">${escapeHtml(s.carrier)}</span><span class="sh-status st-${s.status === 'собрана' ? 'done' : 'new'}">${s.deletedAt ? 'удалена' : s.status === 'новая' ? 'забронировано' : escapeHtml(s.status)}</span>${s.status !== 'отменена' && !s.deletedAt && shIsDup(s) ? '<span class="sh-dup" data-dup>Дубль ❗</span>' : ''}</div>
    ${meta ? `<div class="rmeta sh-meta">${meta}</div>` : ''}
    ${s.track || !sup ? `<div class="rmeta sh-track">${s.track ? 'Трек: <b data-track>' + trackHtml(s.track) + '</b>' : 'Трек-номера нет'}${sup ? '' : ` <button type="button" class="btn ghost sm" style="width:auto;padding:2px 10px;" data-track-edit="${escapeAttr(s.id)}" onclick="shTrackEdit(${jsArg(s.id)})">${s.track ? 'Изменить' : 'Добавить'}</button>${bcBtn}`}</div>` : ''}
    ${selBox}${phRow}<div class="tasks">${rows.join('') || '<div class="hint">Строк пока нет</div>'}</div>${bigBtn}${add}</div>`;
}
async function shStart(){
  // поставщик заказывает только через «Продал»: там скриншот штрихкода Авито обязателен
  if(shIsSupplier() && typeof sellStart === 'function'){ await sellStart(); return; }
  const supEl = document.getElementById('shSupplier');
  if(!shIsSupplier() && !(supEl && supEl.value)){ toast('Выберите поставщика'); return; }
  if(shNew.detecting) await shNew.detecting;
  let bc = null;
  if(shNew.barcode){ try{ bc = await compressImage(shNew.barcode); }catch(e){} if(!bc){ toast('Не получилось открыть картинку — сохраните её как JPEG или PNG'); return; } }
  const id = await newShipment({supplierId: supEl ? supEl.value : null, carrier: document.getElementById('shCarrier').value, comment: document.getElementById('shComment').value,
    track: (document.getElementById('shTrack') || {}).value || ''});
  if(bc) await addPhoto({supplierId: supEl.value, kind:'штрихкод', shipmentId:id}, bc, true);
  for(const f of ['shTrack', 'shComment']) document.getElementById(f).value = '';
  Object.assign(shNew, {barcode: null, detecting: null, text: ''});
  await renderShipments();
}
/* Склад: скриншот штрихкода к новой отправке — трек и служба определяются сами, как у поставщика */
const shNew = {barcode: null, detecting: null, text: ''};
function shShowBarcode(){
  const th = document.getElementById('shBarcodeThumb'), d = document.getElementById('shDetect');
  if(th) th.innerHTML = shNew.barcode ? `<img alt="Скриншот штрихкода" src="${escapeAttr(URL.createObjectURL(shNew.barcode))}">` : '';
  if(d) d.textContent = shNew.text;
}
async function shPickBarcode(input){ const f = input.files && input.files[0]; input.value = ''; if(f) await shSetBarcode(f); }
async function shSetBarcode(file){
  shNew.barcode = file; shNew.text = 'Читаю штрихкод…'; shShowBarcode();
  const job = shNew.detecting = (async ()=>{
    const track = trackFromCode(await barcodeFromImage(file));
    if(job !== shNew.detecting) return;
    const el = document.getElementById('shTrack');
    if(track && el) el.value = track;
    const carrier = carrierByTrack(track);
    if(carrier) document.getElementById('shCarrier').value = carrier;
    shNew.text = barcodeDetectText(track, carrier); shShowBarcode();
  })();
  await job;
}
/* Склад: штрихкод к готовой отправке; трека не было — подставим со скриншота */
async function shAddBarcode(id, file){
  const sh = await get('shipments', id); if(!sh) return;
  let bc = null; try{ bc = await compressImage(file); }catch(e){}
  if(!bc){ toast('Не получилось открыть картинку — сохраните её как JPEG или PNG'); return; }
  await addPhoto({supplierId: sh.supplierId, kind:'штрихкод', shipmentId:id}, bc, true);
  const track = trackFromCode(await barcodeFromImage(file)), carrier = carrierByTrack(track);
  if(track && !sh.track){ sh.track = track; if(carrier) sh.carrier = carrier; await put('shipments', sh); }
  toast(track ? barcodeDetectText(track, carrier) : 'Штрихкод добавлен');
  await renderShipments();
}
async function shAddBarcodePick(id, input){ const f = input.files && input.files[0]; input.value = ''; if(f) await shAddBarcode(id, f); }
/* склад вписал трек — служба выбирается сама */
function shTrackGuess(v){ const c = carrierByTrack(v), el = document.getElementById('shCarrier'); if(c && el) el.value = c; }
async function shFillSizes(sid){
  const mid = document.getElementById('shModel-' + sid).value;
  const sizes = mid ? (await getAll('sizes')).filter(s=> s.modelId === mid && !s.deletedAt).sort((a, b)=> sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel)) : [];
  const parts = [];
  for(const s of sizes) parts.push(`<button type="button" data-size-id="${escapeAttr(s.id)}" onclick="szPick(this)">${escapeHtml(sizeText(s.sizeLabel))} · ${Math.max(0, await freeQty(s.id))}</button>`);
  document.getElementById('shSizes-' + sid).innerHTML = parts.join('');
}
async function shAddLine(sid){
  const mid = document.getElementById('shModel-' + sid).value;
  const sz = document.querySelector('#shSizes-' + CSS.escape(sid) + ' button.on');
  if(!mid || !sz){ toast('Выберите модель и размер'); return; }
  const qty = document.getElementById('shQty-' + sid).value;
  let r = shIsSupplier() ? await addSupplierOrderLine(sid, mid, sz.dataset.sizeId, qty) : await addShipmentLine(sid, mid, sz.dataset.sizeId, qty);
  if(!r.ok && r.short && confirm('Товара нет на складе: не хватает ' + r.short + ' шт. Всё равно отправить? Остаток уйдёт в минус, следующая приёмка его закроет.'))
    r = await addShipmentLine(sid, mid, sz.dataset.sizeId, qty, true);
  if(!r.ok){ if(!r.short) toast(r.error); return; }
  await renderShipments();
}
async function shCancel(sid){
  if(!confirm('Отменить?')) return;
  const r = await cancelShipment(sid);
  if(!r.ok){ toast(r.error); return; }
  toast('Отменено'); await renderShipments();
}
/* убрать несобранную строку своей отправки (ошиблись товаром) */
async function shDelLine(lineId){
  const l = await get('shipmentLines', lineId);
  if(!l || l.deletedAt || l.collected) return;
  if(!confirm('Убрать строку из отправки?')) return;
  l.deletedAt = Date.now(); await put('shipmentLines', l);
  const sh = await get('shipments', l.shipmentId), rest = await shipmentLines(l.shipmentId);
  if(sh && rest.length && rest.every(x=> x.collected) && sh.status !== 'собрана'){ await shipmentSetStatus(sh, 'собрана'); await put('shipments', sh); }
  toast('Строка убрана'); await renderShipments();
}
/* снять «Собрано» со всех строк: товар возвращается в ячейки, отправка снова «новая» */
async function shUncollectAll(id){
  for(const l of await shipmentLines(id)) if(l.collected){ const r = await tickCollected(l.id, false); if(!r.ok) return r; }
  return {ok:true};
}
async function shReopen(id){
  if(!confirm('Вернуть отправку в работу? Отметки «Собрано» снимутся, товар вернётся в ячейки — можно поправить и собрать заново.')) return;
  const r = await shUncollectAll(id); if(!r.ok){ toast(r.error); return; }
  toast('Отправка снова в работе'); await renderShipments();
}
async function shDeleteDone(id){
  if(!confirm('Удалить отправку? Отметки «Собрано» снимутся, товар вернётся в ячейки.')) return;
  const r = await shUncollectAll(id); if(!r.ok){ toast(r.error); return; }
  const sh = await get('shipments', id); if(sh){ await shipmentSetStatus(sh, 'отменена'); await put('shipments', sh); }
  toast('Отправка удалена'); await renderShipments();
}
async function shMinus(lineId){
  if(!confirm('Отправить без товара на складе? Остаток уйдёт в минус, следующая приёмка его закроет.')) return;
  const r = await shipLineMinus(lineId); if(!r.ok){ toast(r.error); return; }
  await renderShipments();
}
/* трек-номер можно вписать и поменять и после создания (склад) */
async function shTrackEdit(id){
  const sh = await get('shipments', id); if(!sh) return;
  const v = prompt('Трек-номер отправки', sh.track || '');
  if(v === null) return;
  sh.track = String(v).trim().slice(0, 60); await put('shipments', sh);
  toast(sh.track ? 'Трек-номер сохранён' : 'Трек-номер убран'); await renderShipments();
}
async function shTick(lineId, on){ const r = await tickCollected(lineId, on); if(!r.ok) toast(r.error); await renderShipments(); }
