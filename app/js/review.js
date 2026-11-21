/* «Fulbro»: список «Проверить» (ОПИСАНИЕ §6.4). Поставщик поправил количество — правка
   действует сразу, но без ячейки и с пометкой «на проверке». Склад смотрит в коробку:
   «Подтвердить» (в какой ячейке поменялось) или «Отменить» (остаток вернётся у обоих). */

async function reviewItems(){
  return (await getAll('ops')).filter(o=> !o.deletedAt && !o.rejected && o.review === 'на проверке').sort((a, b)=> (a.ts || 0) - (b.ts || 0));
}

/* '__floor' — «Пол» (FoG, 18.11.2026): ячейки не указаны или их нет — правка поставщика ложится на пол его склада */
const REVIEW_FLOOR = '__floor';
/* ячейка по умолчанию: минус — откуда взять (planPick), плюс — куда положить (planPlacement); нет ячейки — пол */
async function reviewDefaultCell(op){
  const label = await sizeLabelOf(op.sizeId);
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
  const stock = await cellStockByLabel();
  if(op.delta < 0){
    const p = planPick({sizeId: op.sizeId, qty: -op.delta}, cells, await ffCellStockMap());
    return (p.find(x=> x.cell) || {}).cell || REVIEW_FLOOR;
  }
  const p = planPlacement({supplierId: op.supplierId, modelId: op.modelId, sizeLabel: label, qty: op.delta}, cells, stock, await modelsMap());
  return ((p.steps || p || []).find(x=> x.cell && !x.isNew && !x.floor) || {}).cell || REVIEW_FLOOR;
}

async function confirmReview(uid, cellNumber){
  const op = await get('ops', uid);
  if(!op || op.deletedAt) return {ok:false, error:'Поставщик уже убрал эту правку'};
  if(op.review !== 'на проверке') return {ok:true, already:true};
  let num = String(cellNumber || '').trim();
  /* ячейка не выбрана или её нет — пол поставщика (заводим, если ещё нет); на полу минус бывает — недостача */
  const auto = !num || num === REVIEW_FLOOR;
  if(auto) num = await floorCellFor(op.supplierId);
  const c = await get('cells', num);
  if(!c || c.deletedAt || isDefectCell(c) || c.supplierId !== op.supplierId) return {ok:false, error:'Ячейка ' + num + ' не подходит'};
  if(!isFloorCell(c) && !(await cellTakesModel(c, op.modelId))) return {ok:false, error:'В ячейке ' + num + ' другая модель'};
  if(op.delta < 0){
    const have = await cellSizeQty(num, op.sizeId);
    if(!auto && have < -op.delta) return {ok:false, error:'В ячейке ' + num + ' нет столько — там ' + have + ' шт.'};
  } else if(!isFloorCell(c)){
    const free = cellFree(c, (await cellStockByLabel())[num], await modelsMap()).free;
    if(free < op.delta) return {ok:false, error:'Ячейка ' + num + ' не вмещает — свободно ' + Math.max(0, free) + ' шт.'};
  }
  if(op.delta > 0 && !c.modelId && !isFloorCell(c)){ c.modelId = op.modelId; c.reserved = false; await putRaw('cells', c); }   // привяжет сервер вместе с операцией
  op.cellNumber = num; op.review = 'подтверждено';
  await put('ops', op);
  return {ok:true};
}

async function rejectReview(uid){
  const op = await get('ops', uid);
  if(!op || op.deletedAt) return {ok:true};          // поставщик уже убрал сам
  op.review = 'отменено'; op.deletedAt = Date.now();
  await put('ops', op);
  return {ok:true};
}

let rvOpen = false;   // свёрнутый список «Проверить» раскрыт
async function renderReviewBlock(){
  const items = await reviewItems();
  if(!items.length) return '<div id="reviewBox"></div>';
  const sups = await ffSuppliersMap(), models = await modelsMap(), idx = await ffStockIndex();
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt && !isDefectCell(c)).sort((a, b)=> cmpCellNumber(a.number, b.number));
  const rows = [];
  for(const op of items){
    const now = idx.sellableBySize[op.sizeId] || 0;
    const def = await reviewDefaultCell(op);
    const mine = cells.filter(c=> c.supplierId === op.supplierId && (isFloorCell(c) || !c.modelId || sameItem(models[c.modelId], models[op.modelId])));
    const hasFloor = mine.some(isFloorCell);
    const opts = mine.map(c=> `<option value="${escapeAttr(c.number)}"${c.number === def ? ' selected' : ''}>${isFloorCell(c) ? 'Пол' : 'Ячейка ' + escapeHtml(c.number)}</option>`).join('')
      + (hasFloor ? '' : `<option value="${REVIEW_FLOOR}"${def === REVIEW_FLOOR ? ' selected' : ''}>Пол</option>`);
    rows.push(`<div class="row-item review-row" data-review="${escapeAttr(op.uid)}"><div class="rmain">${escapeHtml((sups[op.supplierId] || {}).name || '')}, ${escapeHtml(modelName(models[op.modelId] || {}))} ${escapeHtml(await sizeLabelOf(op.sizeId))}: <b>${now - op.delta} → ${now}</b></div>
      <div class="rside review-acts"><select data-review-cell="${escapeAttr(op.uid)}" aria-label="В какой ячейке">${opts}</select>
        <button class="btn primary sm" style="width:auto;" data-review-ok="${escapeAttr(op.uid)}" onclick="rvConfirm(${jsArg(op.uid)})">Подтвердить</button>
        <button class="btn ghost sm" style="width:auto;" data-review-no="${escapeAttr(op.uid)}" onclick="rvReject(${jsArg(op.uid)})">Отменить</button></div></div>`);
  }
  /* 21.11.2026 (проект v3): больше трёх правок — одна строка «Проверить · N», раскрывается нажатием (не занимает весь экран) */
  const fold = items.length > 3;
  return `<div id="reviewBox"><${fold ? 'details' : 'div'} class="card review-card${fold ? ' rv-fold' : ''}"${fold && rvOpen ? ' open' : ''}${fold ? ' ontoggle="rvOpen = this.open"' : ''}>${fold ? `<summary class="rname rv-sum">Проверить <b class="rv-n">${items.length}</b><span class="hint">поставщики поправили количество</span></summary>` : `<div class="rname" style="margin-bottom:6px;">Проверить (${items.length})</div>`}
    <p class="hint" style="margin:0 0 6px;">Поставщик поправил количество. Посмотрите в ячейке и подтвердите или отмените.</p>${rows.join('')}</${fold ? 'details' : 'div'}></div>`;
}
async function rvConfirm(uid){
  const sel = document.querySelector('[data-review-cell="' + CSS.escape(uid) + '"]');
  const r = await confirmReview(uid, sel ? sel.value : '');
  if(!r.ok){ toast(r.error); return; }
  toast('Подтверждено'); await renderShipments();
}
async function rvReject(uid){
  await rejectReview(uid);
  toast('Правка отменена — остаток вернулся'); await renderShipments();
}
