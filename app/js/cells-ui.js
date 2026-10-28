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
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt).sort((a, b)=> cmpCellNumber(a.number, b.number));
  const models = await modelsMap(), sups = await ffSuppliersMap(), stock = await cellStockByLabel();
  const bySizeId = await ffCellStockMap(), modelOf = Object.fromEntries((await getAll('sizes')).map(z=> [z.id, z.modelId]));
  const head = `<div class="card head-row"><span class="rmeta">Ячеек: ${cells.length} · пустых: ${cells.filter(c=> !c.modelId && !cellTotal(stock[c.number])).length}</span>
    <span style="display:flex;gap:6px;"><button class="btn danger sm" style="width:auto;" id="cellsDelAll" onclick="cellsDeleteAll()"${cells.length ? '' : ' hidden'}><svg class="icon"><use href="#i-trash"/></svg>Удалить все</button>
    <button class="btn primary sm" style="width:auto;" onclick="openCellModal()"><svg class="icon"><use href="#i-plus"/></svg>Ячейка</button></span></div>`;
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
      <b>Пол</b><span class="ct-sup">${escapeHtml((sups[c.supplierId] || {}).name || '')}</span>
      <span class="ct-model">${inside.length ? 'товаров: ' + inside.length : '—'}</span>
      <span class="ct-qty">${lyingF} шт.${lyingF < 0 ? ' · в минусе' : ''}</span></button>`;
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
      <span class="ct-qty">${lying} / ${cap} · ${label}</span>
      <span class="bar"><i style="width:${pct}%"></i></span>
    </button>`;
  }).join('') + '</div>';
}

/* Разметить ячейку. Возвращает {ok, warning?} или {ok:false, error}. */
async function saveCell(form){
  const number = String(form.number || '').trim();
  if(!/^[БП]?\d+(\.\d+)?$/.test(number)) return {ok:false, error:'Номер — число, например 4 или 4.1'};
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

/* Под-ячейка рядом (4 → 4.1 → 4.2): тот же поставщик и модель. */
async function createSubCell(number){
  const c = await get('cells', number);
  if(!c || c.deletedAt) return {ok:false, error:'Нет такой ячейки'};
  const all = (await getAll('cells')).filter(x=> !x.deletedAt).map(x=> x.number);
  const n = nextSubCell(number, all);
  await put('cells', {number: n, supplierId: c.supplierId, modelId: c.modelId, allowedSizes: null, capacity: c.capacity || null, reserved: false});
  return {ok:true, number: n};
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
  const clr = document.getElementById('cmClear'); clr.hidden = !(c && lying); clr.textContent = 'Очистить ячейку (списать ' + lying + ' шт.)';
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
async function cmSubCell(){
  if(!cmEditing){ toast('Сначала сохраните ячейку'); return; }
  const r = await createSubCell(cmEditing);
  if(!r.ok){ toast(r.error); return; }
  closeCellModal(); toast('Создана ячейка ' + r.number); await renderCells();
}

/* Очистить ячейку, даже если в ней товар (владелец, 28.10.2026): остаток каждого размера в ней
   уходит в ноль корректировкой (видно в «Истории»), ячейка освобождается (del — удаляется).
   Несобранные строки отправок, бравшие из неё, теряют ячейку — «откуда взять» подберётся заново.
   Минус в ячейке (отправляли в минус) списывается без ячейки: в удалённую ячейку класть нельзя. */
async function clearCell(number, del){
  const c = await get('cells', number);
  if(!c || c.deletedAt) return {ok:false, error:'Нет такой ячейки'};
  const by = (await ffCellStockMap())[number] || {};
  const sizes = Object.fromEntries((await getAll('sizes')).map(s=> [s.id, s]));
  let n = 0;
  for(const [sid, q] of Object.entries(by)){
    const s = sizes[sid]; if(!q || !s) continue;
    await ffLogOp({supplierId: s.supplierId, modelId: s.modelId, sizeId: sid, cellNumber: q > 0 ? number : null,
      type: 'Корректировка', qty: Math.abs(q), delta: -q, defect: q > 0 && isDefectCell(c)});
    if(q > 0) n += q;
  }
  for(const l of (await getAll('shipmentLines')).filter(l=> !l.deletedAt && !l.collected && l.cellNumber === number)){
    l.cellNumber = null; await put('shipmentLines', l);
  }
  /* в ячейку положили товар, а на сервер он ещё не ушёл — удалённую ячейку сервер не примет:
     такую ячейку не удаляем, а только очищаем */
  const pending = (await getAll('ops')).some(o=> o.cellNumber === number && o.dirty && !o.deletedAt && Number(o.delta) > 0);
  if(del && !pending) c.deletedAt = Date.now();
  else { c.modelId = null; c.reserved = false; c.allowedSizes = null; }
  await put('cells', c);
  return {ok:true, n, kept: !!(del && pending)};
}
/* «Удалить все»: сначала резервная копия на сервере, потом все ячейки — с товаром в них. */
async function clearAllCells(){
  let backup = false;
  try{ if(window.Sync && Sync.takeSnapshot){ const r = await Sync.takeSnapshot('manual'); backup = !!(r && r.ok !== false); } }catch(e){}
  try{ if(window.Sync && Sync.syncNow) await Sync.syncNow('перед удалением ячеек'); }catch(e){}   // сначала всё на сервер
  let cells = 0, pieces = 0, kept = 0;
  for(const c of (await getAll('cells')).filter(c=> !c.deletedAt)){
    const r = await clearCell(c.number, true);
    if(r.ok){ if(r.kept) kept++; else cells++; pieces += r.n; }
  }
  return {ok:true, cells, pieces, backup, kept};
}
async function cmClear(del){
  const lying = cellTotal((await cellStockByLabel())[cmEditing]);
  if(!confirm((del ? 'Удалить ячейку ' : 'Очистить ячейку ') + cmEditing + '?' + (lying ? ' Товар в ней (' + lying + ' шт.) спишется со склада — это будет видно в «Истории».' : ''))) return;
  if(del) try{ if(window.Sync && Sync.syncNow) await Sync.syncNow('перед удалением ячейки'); }catch(e){}
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
