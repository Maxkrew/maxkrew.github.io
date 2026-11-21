/* «ФФ»: Ячейки — «шахматка» склада (только хозяин). Номер, поставщик, модель, какие
   размеры класть, вместимость, бронь, под-ячейки. Правила — ОПИСАНИЕ §5. */

/* Остаток ячеек по подписям размеров: {номер: {L: 2, XL: 1}} */
async function cellStockByLabel(){
  const labels = Object.fromEntries((await getAll('sizes')).map(s=> [s.id, s.sizeLabel]));
  const out = {};
  for(const [num, bySize] of Object.entries(await ffCellStockMap())){
    for(const [sid, q] of Object.entries(bySize)){
      if(!q) continue;
      const l = labels[sid] || sid;
      (out[num] || (out[num] = {}))[l] = ((out[num] || {})[l] || 0) + q;
    }
  }
  return out;
}
async function modelsMap(){ return Object.fromEntries((await getAll('models')).map(m=> [m.id, m])); }

async function renderCells(){
  const box = document.getElementById('cellsBox');
  if(!box) return;
  try{ await ffFreeEmptyCells(); }catch(e){}   // ячейки, где товара уже нет, освобождаются (в том числе после синхронизации)
  const models = await modelsMap(), sups = await ffSuppliersMap(), stock = await cellStockByLabel();
  /* удалённая ячейка, в которой по операциям ещё лежит товар (П1 у FoG, 19.11.2026), — видна: иначе
     товар «пропадал» из ячеек, а итог по товару его считал. Открыть и «Сохранить» — вернуть ячейку. */
  /* 20.11.2026 (владелец): удалённые — не в общей сетке, а по «⋯ → Показать удалённые»; без длинной фразы */
  const all = await getAll('cells');
  const goneWithStock = all.filter(c=> c.deletedAt && cellTotal(stock[c.number]));
  const live = all.filter(c=> !c.deletedAt);
  const cells = live.concat(cellsShowGone ? goneWithStock : []).sort((a, b)=> cmpCellNumber(a.number, b.number));
  const goneInfo = await goneCellsStock();
  const gone = c=> c.deletedAt ? ' · <span class="cell-gone">удалена</span>' : '';
  const empty = live.filter(c=> !c.modelId && !cellTotal(stock[c.number])).length;
  const bySizeId = await ffCellStockMap(), modelOf = Object.fromEntries((await getAll('sizes')).map(z=> [z.id, z.modelId]));
  /* шапка в одну строку: крупно «60 ячеек», мелко «5 пустых»; редкое — в «⋯» */
  const head = `<div class="card cells-head"><div class="ch-count"><b>${live.length} ${ruPlural(live.length, 'ячейка', 'ячейки', 'ячеек')}</b><span>· ${empty} ${ruPlural(empty, 'пустая', 'пустых', 'пустых')}</span></div>
    <button class="btn primary sm cells-add" onclick="openCellModal()"><svg class="icon"><use href="#i-plus"/></svg>Ячейка</button>
    <button type="button" class="icon-btn cells-more-btn" id="cellsMoreBtn" aria-label="Ещё" aria-haspopup="menu" aria-expanded="${cellsMoreOpen ? 'true' : 'false'}" onclick="event.stopPropagation();cellsMoreToggle()"><svg class="icon"><use href="#i-dots"/></svg></button>
    <div class="cells-more" id="cellsMore" role="menu"${cellsMoreOpen ? '' : ' hidden'}>
      ${goneWithStock.length ? `<button type="button" class="cm-item" id="cellsShowGone" onclick="cellsToggleGone()">${cellsShowGone ? 'Скрыть удалённые ячейки' : 'Показать удалённые ячейки (' + goneWithStock.length + ')'}</button>` : ''}
      <button type="button" class="cm-item danger" id="cellsWriteOffGone" onclick="clearGoneCellsUI()"${goneInfo.pieces > 0 ? '' : ' hidden'}>Списать из удалённых: ${goneInfo.pieces} шт.</button>
      <button type="button" class="cm-item danger" id="cellsDelAll" onclick="cellsDeleteAll()"${live.length ? '' : ' hidden'}>Удалить все ячейки</button>
    </div></div>`;
  if(!cells.length){
    box.innerHTML = head + emptyState('i-grid', 'Ячеек пока нет', 'Назначьте ячейки поставщику в «Поставщиках» («1-12») или добавьте кнопкой «Ячейка».');
    return;
  }
  box.innerHTML = head + '<div class="cell-grid">' + cells.map(c=>{
    const m = c.modelId ? models[c.modelId] : null;
    // что лежит кроме модели ячейки: другие цвета (на полу — что угодно)
    const inside = [...new Set(Object.entries(bySizeId[c.number] || {}).filter(([, q])=> q).map(([sid])=> modelOf[sid]).filter(id=> id && id !== c.modelId))];
    if(isFloorCell(c)){
      const lyingF = cellTotal(stock[c.number]);
      return `<button type="button" class="cell-tile floor${lyingF < 0 ? ' over' : ''}" data-cell="${escapeAttr(c.number)}" onclick="openCellModal(${jsArg(c.number)})">
      <b>Пол${/^П\d/.test(c.number) ? ' ' + escapeHtml(c.number) : ''}</b><span class="ct-sup">${escapeHtml((sups[c.supplierId] || {}).name || '')}</span>
      <span class="ct-model">${inside.length ? 'товаров: ' + inside.length : '—'}</span>
      <span class="ct-qty">${lyingF} шт.${lyingF < 0 ? ' · в минусе' : ''}${gone(c)}</span></button>`;
    }
    const free = cellFree(c, stock[c.number], models);
    const lying = cellTotal(stock[c.number]);
    const cap = cellCapacity(c, models);
    const state = free.overBy ? 'over' : (!m && !lying ? 'empty' : (c.reserved && !lying ? 'reserved' : (free.free === 0 ? 'full' : 'busy')));
    const label = {empty:'пустая', reserved:'бронь', full:'полная', busy:'есть место', over:'переполнена на ' + free.overBy}[state];
    const pct = Math.min(100, Math.round(lying / Math.max(1, cap) * 100));
    return `<button type="button" class="cell-tile ${state}" data-cell="${escapeAttr(c.number)}" onclick="openCellModal(${jsArg(c.number)})">
      <b>Ячейка ${escapeHtml(c.number)}</b>
      <span class="ct-sup">${escapeHtml((sups[c.supplierId] || {}).name || 'без поставщика')}</span>
      <span class="ct-model">${m ? escapeHtml(modelName(m)) + ' · ' + escapeHtml(sizesLabel(c.allowedSizes)) : '—'}${inside.length ? ' + ' + inside.map(id=> escapeHtml((models[id] || {}).color || modelName(models[id] || {}))).join(', ') : ''}</span>
      <span class="ct-qty">${lying} / ${cap} · ${label}${gone(c)}</span>
      <span class="bar"><i style="width:${pct}%"></i></span>
    </button>`;
  }).join('') + '</div>';
}

/* Разметить ячейку. Возвращает {ok, warning?} или {ok:false, error}. */
async function saveCell(form){
  const number = String(form.number || '').trim();
  if(!number) return {ok:false, error:'Укажите номер ячейки (поле «Номер» вверху)'};   // FoG: вводил 10 во «Вместимость», номер был пуст
  // дробных номеров (4.1) больше нет; старые, что уже есть, править можно
  if(!/^[БП]?\d+$/.test(number) && !(/^[БП]?\d+\.\d+$/.test(number) && await get('cells', number))) return {ok:false, error:'Номер — целое число, например 4'};
  const models = await modelsMap(), sups = await ffSuppliersMap();
  const m = form.modelId ? models[form.modelId] : null;
  if(form.modelId && !m) return {ok:false, error:'Модель не найдена'};
  if(m && form.supplierId && m.supplierId !== form.supplierId) return {ok:false, error:'Это модель другого поставщика — в ячейку ' + number + ' её не положить'};
  const supplierId = form.supplierId || (m && m.supplierId) || null;
  const stock = (await cellStockByLabel())[number] || {};
  const lying = cellTotal(stock);
  const cur = await get('cells', number);
  if(cur && !cur.deletedAt && lying){
    if(cur.supplierId && supplierId !== cur.supplierId) return {ok:false, error:'В ячейке ' + number + ' лежит товар ' + ((sups[cur.supplierId] || {}).name || 'другого поставщика')};
    if(cur.modelId && form.modelId !== cur.modelId && !sameItem(models[cur.modelId], m)) return {ok:false, error:'В ячейке ' + number + ' лежит другая модель — сначала переложите'};
  }
  const allowed = (form.allowedSizes && form.allowedSizes.length) ? form.allowedSizes.slice() : null;
  const cell = Object.assign({}, cur || {}, {number, supplierId, modelId: form.modelId || null, allowedSizes: allowed,
    capacity: form.capacity ? Math.min(1000, Math.max(1, parseInt(form.capacity, 10) || 1)) : null, reserved: cur ? !!cur.reserved : false, deletedAt: undefined});
  if(cur && isFloorCell(cur)){ cell.kind = 'пол'; cell.modelId = null; cell.allowedSizes = null; }   // пол остаётся полом
  else if(form.defect !== undefined){ cell.kind = form.defect ? 'брак' : 'обычная'; if(form.defect){ cell.modelId = null; cell.allowedSizes = null; } }
  await put('cells', cell);
  const wrong = sizesConflict(cell, stock);
  const warning = wrong.length ? 'В ячейке ' + number + ' лежат ' + wrong.map(w=> w.sizeLabel + ' — ' + w.qty + ' шт.').join(', ') + ', переложите' : '';
  return warning ? {ok:true, warning} : {ok:true};
}

/* Пустая ячейка: оставить бронь за моделью или освободить совсем. */
async function cellAction(number, action){
  const c = await get('cells', number);
  if(!c || c.deletedAt) return {ok:false, error:'Нет такой ячейки'};
  const lying = cellTotal((await cellStockByLabel())[number]);
  if(lying) return {ok:false, error:'В ячейке ещё ' + lying + ' шт. — сначала заберите товар'};
  if(action === 'reserve'){ if(!c.modelId) return {ok:false, error:'Ячейка не привязана к модели'}; c.reserved = true; }
  else if(action === 'free'){ c.modelId = null; c.reserved = false; c.allowedSizes = null; }
  else if(action === 'delete'){ c.deletedAt = Date.now(); }
  else return {ok:false, error:'Неизвестное действие'};
  await put('cells', c);
  return {ok:true};
}

/* ---------------- окно ячейки ---------------- */
let cmEditing = null;
async function openCellModal(number){
  cmEditing = number || null;
  const c = number ? await get('cells', number) : null;
  const sups = Object.values(await ffSuppliersMap()).filter(s=> !s.deletedAt && !s.archived);
  document.getElementById('cmHead').textContent = c ? 'Ячейка ' + c.number : 'Новая ячейка';
  const num = document.getElementById('cmNumber'); num.value = c ? c.number : ''; num.disabled = !!c;
  document.getElementById('cmSupplier').innerHTML = '<option value="">—</option>' + sups.map(s=> `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  document.getElementById('cmSupplier').value = c && c.supplierId || '';
  await cmFillModels(c && c.modelId);
  await cmFillSizes(c && c.allowedSizes);
  document.getElementById('cmCapacity').value = c && c.capacity || '';
  const lying = c ? cellTotal((await cellStockByLabel())[c.number]) : 0;
  document.getElementById('cmEmptyActions').hidden = !(c && !lying && c.modelId);
  // удалить и очистить можно и ячейку с товаром — товар спишется (владелец, 28.10.2026)
  document.getElementById('cmDelete').hidden = !c;
  const clr = document.getElementById('cmClear'); clr.hidden = !(c && lying); clr.textContent = lying < 0 ? 'Обнулить ячейку (убрать минус ' + lying + ' шт.)' : 'Очистить ячейку (списать ' + lying + ' шт.)';
  document.getElementById('cmDefect').checked = !!(c && isDefectCell(c));
  document.getElementById('cmWarn').hidden = true;
  document.getElementById('cmError').classList.remove('show');
  document.getElementById('cellModalBg').classList.add('show');
}
function closeCellModal(){ document.getElementById('cellModalBg').classList.remove('show'); }
async function cmFillModels(selected){
  const sup = document.getElementById('cmSupplier').value;
  const ms = (await getAll('models')).filter(m=> !m.deletedAt && (!sup || m.supplierId === sup)).sort((a, b)=> modelName(a).localeCompare(modelName(b), 'ru'));
  const sel = document.getElementById('cmModel');
  const keep = selected !== undefined ? selected : sel.value;
  sel.innerHTML = '<option value="">— пустая —</option>' + ms.map(m=> `<option value="${escapeAttr(m.id)}">${escapeHtml(modelName(m))}</option>`).join('');
  sel.value = ms.some(m=> m.id === keep) ? keep : '';
  if(selected === undefined) cmFillSizes();
}
async function cmFillSizes(checked){
  const mid = document.getElementById('cmModel').value;
  const labels = mid ? (await getAll('sizes')).filter(s=> s.modelId === mid && !s.deletedAt).map(s=> s.sizeLabel).sort((a, b)=> sizeOrder(a) - sizeOrder(b)) : [];
  const on = new Set(checked || []);
  document.getElementById('cmSizes').innerHTML = labels.length
    ? labels.map(l=> `<button type="button" data-size="${escapeAttr(l)}" class="${on.has(l) ? 'on' : ''}" onclick="this.classList.toggle('on')">${escapeHtml(sizeText(l))}</button>`).join('')
    : '<span class="hint">Выберите модель</span>';
}
async function saveCellFromForm(){
  const r = await saveCell({
    number: cmEditing || document.getElementById('cmNumber').value,
    supplierId: document.getElementById('cmSupplier').value || null,
    modelId: document.getElementById('cmModel').value || null,
    allowedSizes: [...document.querySelectorAll('#cmSizes button.on')].map(b=> b.dataset.size),
    capacity: document.getElementById('cmCapacity').value,
    defect: document.getElementById('cmDefect').checked
  });
  if(!r.ok){ const e = document.getElementById('cmError'); e.textContent = r.error; e.classList.add('show'); return; }
  if(r.warning){ const w = document.getElementById('cmWarn'); w.textContent = r.warning; w.hidden = false; toast(r.warning); await renderCells(); return; }
  closeCellModal(); toast('Ячейка сохранена'); await renderCells();
}
async function cmAction(action){
  const r = await cellAction(cmEditing, action);
  if(!r.ok){ toast(r.error); return; }
  closeCellModal(); toast(action === 'reserve' ? 'Ячейка ждёт этот товар' : action === 'delete' ? 'Ячейка удалена' : 'Ячейка свободна'); await renderCells();
}

/* Очистить ячейку, даже если в ней товар (владелец, 28.10.2026): остаток каждого размера в ней
   уходит в ноль корректировкой (видно в «Истории»), ячейка освобождается (del — удаляется).
   Несобранные строки отправок, бравшие из неё, теряют ячейку — «откуда взять» подберётся заново.
   Минус в ячейке (отправляли в минус) списывается без ячейки: в удалённую ячейку класть нельзя. */
async function clearCell(number, del){
  const c = await get('cells', number);
  if(!c) return {ok:false, error:'Нет такой ячейки'};
  /* удалённая ячейка, где по операциям ещё числится товар (FoG, 19.11.2026), — тоже чистится; остаётся удалённой */
  const gone = !!c.deletedAt;
  const by = (await ffCellStockMap())[number] || {};
  const sizes = Object.fromEntries((await getAll('sizes')).map(s=> [s.id, s]));
  let n = 0;
  for(const [sid, q] of Object.entries(by)){
    const s = sizes[sid]; if(!q || !s) continue;
    /* минус гасим плюсом В ЭТОЙ ЖЕ ячейке (иначе в ней остаётся минус, а «без ячейки» растёт);
       только если ячейку сейчас удаляем — без ячейки: в удалённую класть нельзя */
    if(q < 0){ await ffZeroBucket(s, number, isDefectCell(c), {noPlus: !!del || gone}); continue; }   // минус: плюсом, а не принимает сервер — убрать сами минусовые записи
    await ffLogOp({supplierId: s.supplierId, modelId: s.modelId, sizeId: sid, cellNumber: number,
      type: 'Корректировка', qty: Math.abs(q), delta: -q, defect: isDefectCell(c)});
    if(q > 0) n += q;
  }
  for(const l of (await getAll('shipmentLines')).filter(l=> !l.deletedAt && !l.collected && l.cellNumber === number)){
    l.cellNumber = null; await put('shipmentLines', l);
  }
  if(gone) return {ok:true, n, kept:false};
  /* в ячейку положили товар, а на сервер он ещё не ушёл — удалённую ячейку сервер не примет:
     такую ячейку не удаляем, а только очищаем */
  const pending = (await getAll('ops')).some(o=> o.cellNumber === number && o.dirty && !o.deletedAt && Number(o.delta) > 0);
  if(del && !pending) c.deletedAt = Date.now();
  else { c.modelId = null; c.reserved = false; c.allowedSizes = null; }
  await put('cells', c);
  return {ok:true, n, kept: !!(del && pending)};
}
/* Ждём сеть не дольше FF_SYNC_WAIT_MS (8 с): зависшая синхронизация не должна «подвешивать» кнопку
   (FoG, 17.11.2026: «Удалить все» не реагировала). Не дождались — продолжаем, всё уйдёт позже. */
function ffSoft(promiseFn){
  const ms = window.FF_SYNC_WAIT_MS || 8000;
  return Promise.race([
    (async ()=>{ try{ return await promiseFn(); }catch(e){ return null; } })(),
    new Promise(res=> setTimeout(()=> res(null), ms))
  ]);
}
/* «Удалить все»: сначала резервная копия на сервере, потом все ячейки — с товаром в них. */
async function clearAllCells(){
  let backup = false;
  if(window.Sync && Sync.takeSnapshot){ const r = await ffSoft(()=> Sync.takeSnapshot('manual')); backup = !!(r && r.ok !== false); }
  if(window.Sync && Sync.syncNow) await ffSoft(()=> Sync.syncNow('перед удалением ячеек'));   // сначала всё на сервер
  let cells = 0, pieces = 0, kept = 0;
  for(const c of (await getAll('cells')).filter(c=> !c.deletedAt)){
    const r = await clearCell(c.number, true);
    if(r.ok){ if(r.kept) kept++; else cells++; pieces += r.n; }
  }
  return {ok:true, cells, pieces, backup, kept};
}
/* Товар, который числится в удалённых ячейках (у FoG — старый «пол» П1 и дробные ячейки: после
   инвентаризации его нет, а поставщик его видит), — списать одной кнопкой, с резервной копией. */
let cellsShowGone = false, cellsMoreOpen = false;
function cellsMoreToggle(){ cellsMoreOpen = !cellsMoreOpen; const m = document.getElementById('cellsMore'); if(m) m.hidden = !cellsMoreOpen; const b = document.getElementById('cellsMoreBtn'); if(b) b.setAttribute('aria-expanded', cellsMoreOpen ? 'true' : 'false'); }
async function cellsToggleGone(){ cellsShowGone = !cellsShowGone; cellsMoreOpen = false; await renderCells(); }
document.addEventListener('click', e=>{
  if(!cellsMoreOpen) return;
  const m = document.getElementById('cellsMore');
  if(m && m.contains(e.target) && !e.target.closest('.cm-item')) return;
  cellsMoreOpen = false; if(m) m.hidden = true;
  const b = document.getElementById('cellsMoreBtn'); if(b) b.setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && cellsMoreOpen){ cellsMoreOpen = false; const m = document.getElementById('cellsMore'); if(m) m.hidden = true; } });
async function goneCellsStock(){
  const stock = await cellStockByLabel();
  const cells = (await getAll('cells')).filter(c=> c.deletedAt && Object.values(stock[c.number] || {}).some(q=> q));
  return {cells, pieces: cells.reduce((n, c)=> n + Object.values(stock[c.number]).reduce((a, q)=> a + (q > 0 ? q : 0), 0), 0)};
}
async function clearGoneCells(){
  const {cells} = await goneCellsStock();
  let backup = false, pieces = 0;
  if(window.Sync && Sync.takeSnapshot){ const r = await ffSoft(()=> Sync.takeSnapshot('manual')); backup = !!(r && r.ok !== false); }
  for(const c of cells){ const r = await clearCell(c.number, false); if(r.ok) pieces += r.n; }
  if(window.Sync && Sync.syncNow) ffSoft(()=> Sync.syncNow('списание из удалённых ячеек'));
  return {ok:true, cells: cells.length, pieces, backup};
}
async function clearGoneCellsUI(){
  const g = await goneCellsStock();
  if(!g.cells.length){ toast('В удалённых ячейках товара нет'); return; }
  if(!confirm('Списать товар из удалённых ячеек (' + g.cells.map(c=> c.number).join(', ') + ') — ' + g.pieces + ' шт.?\n\nЭтих ячеек на складе уже нет, а товар в них числится и виден поставщикам. Перед списанием сделаю резервную копию, в «Истории» будет видно.')) return;
  const r = await clearGoneCells();
  toast('Списано из удалённых ячеек: ' + r.pieces + ' шт.' + (r.backup ? ' · копия сделана' : ''));
  await renderCells();
}
async function cmClear(del){
  const lying = cellTotal((await cellStockByLabel())[cmEditing]);
  if(!confirm((del ? 'Удалить ячейку ' : 'Очистить ячейку ') + cmEditing + '?' + (lying ? ' Товар в ней (' + lying + ' шт.) спишется со склада — это будет видно в «Истории».' : ''))) return;
  if(del && window.Sync && Sync.syncNow) await ffSoft(()=> Sync.syncNow('перед удалением ячейки'));
  const r = await clearCell(cmEditing, !!del);
  if(!r.ok){ toast(r.error); return; }
  closeCellModal(); toast((del && !r.kept ? 'Ячейка удалена' : (r.kept ? 'Нет связи — ячейка очищена, удалите её позже' : 'Ячейка очищена')) + (r.n ? ' · списано ' + r.n + ' шт.' : '')); await renderCells();
}
async function cellsDeleteAll(){
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
  if(!cells.length){ toast('Ячеек нет'); return; }
  const stock = await cellStockByLabel();
  const pieces = cells.reduce((n, c)=> n + Math.max(0, cellTotal(stock[c.number])), 0);
  if(!confirm('Удалить ВСЕ ячейки (' + cells.length + ')?' + (pieces ? ' Весь товар в них — ' + pieces + ' шт. — спишется со склада.' : '') + ' Перед этим сделаю резервную копию.')) return;
  if(!confirm('Точно удалить все ячейки? Отменить можно только восстановлением копии в «Настройках».')) return;
  const r = await clearAllCells();
  toast('Удалено ячеек: ' + r.cells + (r.pieces ? ' · списано ' + r.pieces + ' шт.' : '') + (r.backup ? ' · копия сделана' : '') + (r.kept ? ' · ' + r.kept + ' только очищены (нет связи)' : ''));
  await renderCells();
}
