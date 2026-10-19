/* Fulbro, этап 2: «Изменить остаток» (корректировка), «Переложить» (из ячейки в ячейку, в т.ч.
   «Вернуть из брака») и ячейка брака поставщика «Б1». Правила — ОПИСАНИЕ §5, §6, §6.2, §6.5.
   Склад правит остаток в конкретной ячейке; поставщик — без ячеек, правка уходит складу
   в «Проверить» (действует сразу, пометка «на проверке»). */

/* Номер ячейки брака поставщика; нет — заводит следующую свободную «Б<n>». */
async function defectCellFor(supplierId){
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
  const mine = cells.filter(c=> isDefectCell(c) && c.supplierId === supplierId).sort((a, b)=> cmpCellNumber(a.number, b.number));
  if(mine.length) return mine[0].number;
  const used = new Set((await getAll('cells')).map(c=> String(c.number)));   // и удалённые: номер мог быть занят
  let n = 1; while(used.has('Б' + n)) n++;
  const number = 'Б' + n;
  await put('cells', {number, supplierId, modelId: null, allowedSizes: null, capacity: null, reserved: false, kind: 'брак'});
  return number;
}

/* Сколько этого размера лежит в ячейке (у склада). */
async function cellSizeQty(cellNumber, sizeId){
  return Number(((await ffCellStockMap())[cellNumber] || {})[sizeId]) || 0;
}

/* Новый остаток «можно продать» размера. Склад: изменение ложится в ячейку cellNumber
   (обязательна, если у модели есть ячейки). Поставщик: без ячейки, «на проверке». */
async function correctStock(o){
  const size = await get('sizes', o.sizeId);
  if(!size || size.deletedAt) return {ok:false, error:'Нет такого размера'};
  const want = parseInt(o.newQty, 10);
  if(isNaN(want) || want < 0) return {ok:false, error:'Укажите новый остаток — 0 или больше'};
  if(want > 10000) return {ok:false, error:'Слишком много — не больше 10 000'};
  const idx = await ffStockIndex();
  const delta = want - (idx.sellableBySize[size.id] || 0);
  if(!delta) return {ok:true, unchanged:true};
  const owner = ffRole() === 'owner';
  let cellNumber = null;
  if(owner){
    const modelCells = (await getAll('cells')).filter(c=> !c.deletedAt && !isDefectCell(c) && c.modelId === size.modelId);
    cellNumber = o.cellNumber || (modelCells.length ? null : '');
    if(cellNumber === null) return {ok:false, error:'Выберите ячейку, где поменялось количество'};
    if(cellNumber){
      const c = await get('cells', cellNumber);
      if(!c || c.deletedAt || isDefectCell(c) || c.supplierId !== size.supplierId) return {ok:false, error:'Эта ячейка не подходит'};
      if(c.modelId && c.modelId !== size.modelId) return {ok:false, error:'В ячейке ' + cellNumber + ' другая модель'};
      if(delta < 0 && await cellSizeQty(cellNumber, size.id) < -delta) return {ok:false, error:'В ячейке ' + cellNumber + ' нет столько — там ' + await cellSizeQty(cellNumber, size.id) + ' шт.'};
      if(delta > 0 && !c.modelId){ c.modelId = size.modelId; c.reserved = false; await putRaw('cells', c); }   // привяжет сервер вместе с операцией
    }
  }
  const op = await ffLogOp({supplierId: size.supplierId, modelId: size.modelId, sizeId: size.id, cellNumber: cellNumber || null,
    type: 'Корректировка', qty: Math.abs(delta), delta});
  return {ok:true, uid: op.uid, delta};
}

/* Переложить qty шт. размера из ячейки в ячейку (только склад). Из ячейки брака в обычную —
   «Вернуть из брака»: брак уменьшается, «можно продать» растёт. */
async function moveStock(o){
  if(ffRole() !== 'owner') return {ok:false, error:'Перекладывает только склад'};
  const size = await get('sizes', o.sizeId);
  const qty = parseInt(o.qty, 10);
  if(!size || !(qty > 0)) return {ok:false, error:'Укажите, сколько штук переложить'};
  if(o.fromCell === o.toCell) return {ok:false, error:'Выберите другую ячейку'};
  const from = await get('cells', o.fromCell), to = await get('cells', o.toCell);
  if(!from || !to || to.deletedAt) return {ok:false, error:'Нет такой ячейки'};
  if(to.supplierId !== size.supplierId) return {ok:false, error:'Ячейка ' + to.number + ' — другого поставщика'};
  if(!isDefectCell(to)){
    if(to.modelId && to.modelId !== size.modelId) return {ok:false, error:'В ячейке ' + to.number + ' другая модель'};
    if(!sizeAllowed(to, size.sizeLabel)) return {ok:false, error:'В ячейку ' + to.number + ' этот размер не кладут'};
  }
  const have = await cellSizeQty(from.number, size.id);
  if(have < qty) return {ok:false, error:'В ячейке ' + from.number + ' только ' + have + ' шт.'};
  const id = newUid(), common = {supplierId: size.supplierId, modelId: size.modelId, sizeId: size.id, type: 'Перекладка', qty};
  await ffLogOp(Object.assign({uid: id + ':out', cellNumber: from.number, delta: -qty, defect: isDefectCell(from)}, common));
  if(!isDefectCell(to) && !to.modelId){ to.modelId = size.modelId; to.reserved = false; await putRaw('cells', to); }
  await ffLogOp(Object.assign({uid: id + ':in', cellNumber: to.number, delta: qty, defect: isDefectCell(to)}, common));
  return {ok:true};
}

/* ---------------- блок «Остатки» в карточке модели ---------------- */
async function renderModelStockBox(modelId){
  const box = document.getElementById('mmStockBox');
  if(!box) return;
  const v = modelId ? await modelView(modelId) : null;
  if(!v || !v.sizes.length){ box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;
  const owner = ffRole() === 'owner';
  const rows = v.sizes.map(s=> `<div class="row-item"><div class="rmain"><b>${escapeHtml(s.label)}</b> — ${s.stock} шт.${s.defect ? ` · <span class="warn">брак ${s.defect}</span>` : ''}${s.pending ? ' · <span class="hint">на проверке</span>' : ''}</div>
      <div class="rside"><button type="button" class="btn ghost sm" style="width:auto;" data-act="correct" data-size="${escapeAttr(s.id)}" onclick="mmCorrectForm(${jsArg(modelId)}, ${jsArg(s.id)})">Изменить остаток</button></div></div>`);
  const cells = owner ? (v.cells || []).filter(c=> c.stock > 0).map(c=> `<div class="row-item"><div class="rmain">${c.defect ? 'Брак · ' : ''}Ячейка ${escapeHtml(c.number)} — ${Object.entries(c.bySize).map(([l, q])=> escapeHtml(l) + ' ' + q).join(', ')}</div>
      <div class="rside"><button type="button" class="btn ghost sm" style="width:auto;" data-act="move" data-cell="${escapeAttr(c.number)}" onclick="mmMoveForm(${jsArg(modelId)}, ${jsArg(c.number)})">${c.defect ? 'Вернуть из брака' : 'Переложить'}</button></div></div>`) : [];
  box.innerHTML = `<div class="grp-title">Остатки</div>${rows.join('')}${cells.length ? '<div class="grp-title">По ячейкам</div>' + cells.join('') : ''}<div id="mmStockForm"></div>`;
}
/* поля ячеек для формы: ячейки модели и пустые ячейки поставщика */
async function mmCellOptions(modelId, exceptCell){
  const m = await get('models', modelId);
  return (await getAll('cells')).filter(c=> !c.deletedAt && c.number !== exceptCell && c.supplierId === m.supplierId && !isDefectCell(c) && (!c.modelId || c.modelId === modelId))
    .sort((a, b)=> cmpCellNumber(a.number, b.number)).map(c=> `<option value="${escapeAttr(c.number)}">Ячейка ${escapeHtml(c.number)}${c.modelId ? '' : ' (пустая)'}</option>`).join('');
}
async function mmCorrectForm(modelId, sizeId){
  const owner = ffRole() === 'owner';
  const s = (await modelView(modelId)).sizes.find(x=> x.id === sizeId);
  const cellSel = owner ? `<select id="corrCell"><option value="">— ячейка —</option>${await mmCellOptions(modelId)}</select>` : '';
  document.getElementById('mmStockForm').innerHTML = `<div class="card inline-form"><div class="head-row"><button type="button" class="icon-btn" onclick="mmCloseStockForm()" aria-label="Назад"><svg class="icon"><use href="#i-arrow-left"/></svg></button>
      <b>${escapeHtml(s.label)}: сейчас ${s.stock} шт.</b></div>
    <div class="field-row"><input type="number" id="corrQty" min="0" placeholder="Новый остаток">${cellSel}
      <button type="button" class="btn primary" style="width:auto;" id="corrSave" onclick="mmCorrectSave(${jsArg(modelId)}, ${jsArg(sizeId)})">Сохранить</button></div>
    ${owner ? '' : '<div class="hint">Склад проверит правку. Пока проверяет — она уже действует.</div>'}</div>`;
}
async function mmCorrectSave(modelId, sizeId){
  const cellEl = document.getElementById('corrCell');
  const r = await correctStock({sizeId, newQty: document.getElementById('corrQty').value, cellNumber: cellEl ? cellEl.value : undefined});
  if(!r.ok){ toast(r.error); return; }
  toast(ffRole() === 'owner' ? 'Остаток изменён' : 'Остаток изменён — склад проверит');
  await renderModelStockBox(modelId);
  if(typeof renderStockFF === 'function') renderStockFF();
}
async function mmMoveForm(modelId, fromCell){
  const v = await modelView(modelId);
  const c = (v.cells || []).find(x=> x.number === fromCell) || {bySize: {}};
  const sizes = v.sizes.filter(s=> c.bySize[s.label]);
  document.getElementById('mmStockForm').innerHTML = `<div class="card inline-form"><div class="head-row"><button type="button" class="icon-btn" onclick="mmCloseStockForm()" aria-label="Назад"><svg class="icon"><use href="#i-arrow-left"/></svg></button>
      <b>Из ячейки ${escapeHtml(fromCell)}</b></div>
    <div class="field-row"><select id="moveSize">${sizes.map(s=> `<option value="${escapeAttr(s.id)}">${escapeHtml(s.label)} (${c.bySize[s.label]} шт.)</option>`).join('')}</select>
      <input type="number" id="moveQty" min="1" value="1"></div>
    <div class="field-row"><select id="moveTo">${await mmCellOptions(modelId, fromCell)}</select>
      <button type="button" class="btn primary" style="width:auto;" id="moveSave" onclick="mmMoveSave(${jsArg(modelId)}, ${jsArg(fromCell)})">Переложить</button></div></div>`;
}
async function mmMoveSave(modelId, fromCell){
  const r = await moveStock({sizeId: document.getElementById('moveSize').value, fromCell, toCell: document.getElementById('moveTo').value, qty: document.getElementById('moveQty').value});
  if(!r.ok){ toast(r.error); return; }
  toast('Переложено');
  await renderModelStockBox(modelId);
}
function mmCloseStockForm(){ const f = document.getElementById('mmStockForm'); if(f) f.innerHTML = ''; }
