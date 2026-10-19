/* «Fulbro»: список «Проверить» (ОПИСАНИЕ §6.4). Поставщик поправил количество — правка
   действует сразу, но без ячейки и с пометкой «на проверке». Склад смотрит в коробку:
   «Подтвердить» (в какой ячейке поменялось) или «Отменить» (остаток вернётся у обоих). */

async function reviewItems(){
  return (await getAll('ops')).filter(o=> !o.deletedAt && !o.rejected && o.review === 'на проверке').sort((a, b)=> (a.ts || 0) - (b.ts || 0));
}

/* ячейка по умолчанию: минус — откуда взять (planPick), плюс — куда положить (planPlacement) */
async function reviewDefaultCell(op){
  const label = await sizeLabelOf(op.sizeId);
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
  const stock = await cellStockByLabel();
  if(op.delta < 0){
    const p = planPick({modelId: op.modelId, sizeLabel: label, qty: -op.delta}, cells, stock);
    return (p.find(x=> x.cell) || {}).cell || '';
  }
  const p = planPlacement({supplierId: op.supplierId, modelId: op.modelId, sizeLabel: label, qty: op.delta}, cells, stock, await modelsMap());
  return ((p.steps || p || []).find(x=> x.cell && !x.isNew) || {}).cell || '';
}

async function confirmReview(uid, cellNumber){
  const op = await get('ops', uid);
  if(!op || op.deletedAt) return {ok:false, error:'Поставщик уже убрал эту правку'};
  if(op.review !== 'на проверке') return {ok:true, already:true};
  const num = String(cellNumber || '').trim();
  if(!num) return {ok:false, error:'Выберите ячейку'};
  const c = await get('cells', num);
  if(!c || c.deletedAt || isDefectCell(c) || c.supplierId !== op.supplierId) return {ok:false, error:'Ячейка ' + num + ' не подходит'};
  if(c.modelId && c.modelId !== op.modelId) return {ok:false, error:'В ячейке ' + num + ' другая модель'};
  if(op.delta < 0){
    const have = await cellSizeQty(num, op.sizeId);
    if(have < -op.delta) return {ok:false, error:'В ячейке ' + num + ' нет столько — там ' + have + ' шт.'};
  } else {
    const free = cellFree(c, (await cellStockByLabel())[num], await modelsMap()).free;
    if(free < op.delta) return {ok:false, error:'Ячейка ' + num + ' не вмещает — свободно ' + Math.max(0, free) + ' шт.'};
  }
  if(op.delta > 0 && !c.modelId){ c.modelId = op.modelId; c.reserved = false; await putRaw('cells', c); }   // привяжет сервер вместе с операцией
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

async function renderReviewBlock(){
  const items = await reviewItems();
  if(!items.length) return '<div id="reviewBox"></div>';
  const sups = await ffSuppliersMap(), models = await modelsMap(), idx = await ffStockIndex();
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt && !isDefectCell(c)).sort((a, b)=> cmpCellNumber(a.number, b.number));
  const rows = [];
  for(const op of items){
    const now = idx.sellableBySize[op.sizeId] || 0;
    const def = await reviewDefaultCell(op);
    const opts = cells.filter(c=> c.supplierId === op.supplierId && (!c.modelId || c.modelId === op.modelId))
      .map(c=> `<option value="${escapeAttr(c.number)}"${c.number === def ? ' selected' : ''}>Ячейка ${escapeHtml(c.number)}</option>`).join('');
    rows.push(`<div class="row-item review-row" data-review="${escapeAttr(op.uid)}"><div class="rmain">${escapeHtml((sups[op.supplierId] || {}).name || '')}, ${escapeHtml(modelName(models[op.modelId] || {}))} ${escapeHtml(await sizeLabelOf(op.sizeId))}: <b>${now - op.delta} → ${now}</b></div>
      <div class="rside review-acts"><select data-review-cell="${escapeAttr(op.uid)}" aria-label="В какой ячейке">${opts || '<option value="">нет ячеек</option>'}</select>
        <button class="btn primary sm" style="width:auto;" data-review-ok="${escapeAttr(op.uid)}" onclick="rvConfirm(${jsArg(op.uid)})">Подтвердить</button>
        <button class="btn ghost sm" style="width:auto;" data-review-no="${escapeAttr(op.uid)}" onclick="rvReject(${jsArg(op.uid)})">Отменить</button></div></div>`);
  }
  return `<div id="reviewBox"><div class="card review-card"><div class="rname" style="margin-bottom:6px;">Проверить (${items.length})</div>
    <p class="hint" style="margin:0 0 6px;">Поставщик поправил количество. Посмотрите в ячейке и подтвердите или отмените.</p>${rows.join('')}</div></div>`;
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
