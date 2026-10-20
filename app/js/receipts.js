/* «ФФ»: Приёмка (только склад). Список пришедшего → задания «что в какую ячейку» →
   галочка на строке = товар лёг в ячейку (операция «Приход»). Правила — ОПИСАНИЕ §5.1, §6.1.
   Галочка повторно и с двух телефонов даёт одну операцию: uid шага задан заранее. */

async function newReceipt(supplierId, kind){
  const id = newUid();
  await put('receipts', {id, supplierId, kind: kind === 'возврат' ? 'возврат' : 'приёмка', weightKg: null, status: 'черновик', createdTs: Date.now()});
  return id;
}
/* defect — строка возврата «брак»: ляжет в ячейку брака поставщика (этап 2, §6.2) */
async function addReceiptLine(receiptId, modelId, sizeId, qty, defect){
  const n = Math.max(0, parseInt(qty, 10) || 0);
  if(!n) return {ok:false, error:'Укажите количество'};
  if(n > 10000) return {ok:false, error:'Слишком много в одной строке — не больше 10 000'};
  const id = newUid();
  await put('receiptLines', {id, receiptId, modelId, sizeId, qty: n, plan: null, doneQty: 0, defect: !!defect});
  return {ok:true, id};
}
async function receiptLines(receiptId){
  return (await new Promise((res, rej)=>{ const r = tx('receiptLines').index('byReceipt').getAll(receiptId); r.onsuccess = ()=> res(r.result || []); r.onerror = rej; }))
    .filter(l=> !l.deletedAt);
}
const sizeLabelOf = async sizeId => ((await get('sizes', sizeId)) || {}).sizeLabel || '';
function joinRu(list){ return list.length <= 1 ? list.join('') : list.slice(0, -1).join(', ') + ' и ' + list[list.length - 1]; }

/* Раскладка всех строк приёмки с учётом друг друга (вторая строка видит то, что
   запланировала первая). Возвращает {confirm:[{modelId, question}]}. */
async function finishReceipt(receiptId, weightKg){
  const r = await get('receipts', receiptId);
  if(!r) throw new Error('Нет такой приёмки');
  const models = await modelsMap();
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt).map(c=> Object.assign({}, c));
  const virtual = JSON.parse(JSON.stringify(await cellStockByLabel()));
  const confirm = [];
  for(const line of await receiptLines(receiptId)){
    if(line.defect){   // брак — одним шагом в ячейку брака, мест не считаем
      line.plan = [{cell: await defectCellFor(r.supplierId), qty: line.qty, uid: line.id + ':0', done: false, defect: true}];
      await put('receiptLines', line);
      continue;
    }
    const label = await sizeLabelOf(line.sizeId);
    const res = planPlacement({supplierId: r.supplierId, modelId: line.modelId, sizeLabel: label, qty: line.qty}, cells, virtual, models);
    line.plan = res.steps.map((s, i)=> Object.assign({}, s, {uid: line.id + ':' + i, done: false}));
    for(const s of res.steps){
      (virtual[s.cell] || (virtual[s.cell] = {}))[label] = ((virtual[s.cell] || {})[label] || 0) + s.qty;
      if(s.isNew) cells.push({number: s.cell, supplierId: r.supplierId, modelId: line.modelId, allowedSizes: null, capacity: null, reserved: false});
      if(s.bind){ const c = cells.find(x=> x.number === s.cell); if(c) c.modelId = line.modelId; }
    }
    if(res.needsConfirm){
      const m = models[line.modelId];
      confirm.push({modelId: line.modelId, question: 'Товар новый. Закрепить модель «' + modelName(m) + '» за ячейками ' +
        joinRu(res.steps.map(s=> s.cell + ' (' + s.qty + ' шт.)')) + '?'});
    }
    await put('receiptLines', line);
  }
  if(weightKg !== undefined && weightKg !== null && weightKg !== '') r.weightKg = Number(String(weightKg).replace(',', '.')) || null;
  r.status = confirm.length ? 'ждёт подтверждения' : 'раскладка';
  await put('receipts', r);
  if(!confirm.length) await applyPlanCells(receiptId);
  return {confirm};
}

/* Создать новые под-ячейки и привязать пустые ячейки к моделям — по плану приёмки. */
async function applyPlanCells(receiptId){
  const r = await get('receipts', receiptId);
  for(const line of await receiptLines(receiptId)){
    for(const s of (line.plan || [])){
      if(s.done) continue;
      const c = await get('cells', s.cell);
      if(s.isNew && (!c || c.deletedAt)){
        await put('cells', {number: s.cell, supplierId: r.supplierId, modelId: line.modelId, allowedSizes: null, capacity: null, reserved: false});
      } else if((s.bind || s.isNew) && c && !c.modelId){
        c.modelId = line.modelId; c.reserved = false; c.allowedSizes = null; c.supplierId = c.supplierId || r.supplierId;
        await put('cells', c);
      }
    }
  }
}
async function confirmReceiptPlan(receiptId){
  await applyPlanCells(receiptId);
  const r = await get('receipts', receiptId);
  r.status = 'раскладка'; await put('receipts', r);
  return {ok:true};
}

/* Шаг выполнен, если его операция есть и сервер её не отверг. Флаг done в строке —
   только подсказка: строку целиком пишут оба телефона, и галочка одного могла пропасть. */
async function stepIsDone(step){
  const op = step && step.uid ? await get('ops', step.uid) : null;
  return !!(op && !op.deletedAt && !op.rejected);
}
async function receiptIsDone(receiptId){
  const lines = await receiptLines(receiptId);
  if(!lines.length) return false;
  for(const l of lines){
    if(!l.plan || !l.plan.length) return false;
    for(const s of l.plan) if(!(await stepIsDone(s))) return false;
  }
  return true;
}

/* Годится ли ещё ячейка шага: своя, пустая или этой модели, размер разрешён. */
async function stepStillValid(r, line, step){
  const c = await get('cells', step.cell);
  if(!c || c.deletedAt || c.supplierId !== r.supplierId) return false;
  if(step.defect || isDefectCell(c)) return !!step.defect && isDefectCell(c);
  if(c.modelId && c.modelId !== line.modelId) return false;
  return sizeAllowed(c, await sizeLabelOf(line.sizeId));
}

async function tickReceiptStep(lineId, idx){
  const line = await get('receiptLines', lineId);
  if(!line || !line.plan || !line.plan[idx]) return {ok:false, error:'Нет такого задания'};
  const step = line.plan[idx];
  if(await stepIsDone(step)) return {ok:true, already:true};
  const r = await get('receipts', line.receiptId);
  if(!(await stepStillValid(r, line, step))){
    // план устарел (ячейку освободили/отдали другой модели) — раскладываем этот шаг заново
    const models = await modelsMap();
    const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
    const label = await sizeLabelOf(line.sizeId);
    const res = step.defect ? {steps: [{cell: await defectCellFor(r.supplierId), qty: step.qty, defect: true}]}
      : planPlacement({supplierId: r.supplierId, modelId: line.modelId, sizeLabel: label, qty: step.qty}, cells, await cellStockByLabel(), models);
    const fresh = res.steps.map(s=> Object.assign({}, s, {uid: line.id + ':' + newUid(), done: false}));
    line.plan.splice(idx, 1, ...fresh);
    await put('receiptLines', line);
    await applyPlanCells(line.receiptId);
    toast('План устарел — ячейка ' + step.cell + ' занята. Разложил заново.');
    return {ok:false, replanned:true};
  }
  /* Привязку пустой ячейки делает сервер вместе с операцией (и откажет, если ячейку уже
     отдали другой модели). Здесь — только для показа на этом телефоне, на сервер не шлём. */
  const c = await get('cells', step.cell);
  if(!c.modelId && !isDefectCell(c)){ c.modelId = line.modelId; c.reserved = false; await putRaw('cells', c); }
  await ffLogOp({uid: step.uid, supplierId: r.supplierId, modelId: line.modelId, sizeId: line.sizeId, cellNumber: step.cell,
                 type: r.kind === 'возврат' ? 'Возврат' : 'Приход', qty: step.qty, taskRef: line.id, defect: !!step.defect});
  step.done = true;
  line.doneQty = line.plan.filter(s=> s.done).reduce((n, s)=> n + s.qty, 0);
  await put('receiptLines', line);
  if(await receiptIsDone(r.id)){ r.status = 'разложено'; await put('receipts', r); }
  return {ok:true};
}

/* Сервер не принял галочку (ячейку уже отдали другой модели, неверные данные): задание
   снова открыто, приёмка снова в списке — товар физически в коробке, его надо переложить. */
async function ffOnRejected(store, op, msg){
  if(store === 'shipments' && typeof ffShipmentRejected === 'function'){ await ffShipmentRejected(store, op, msg); return; }
  if((store === 'receipts' || store === 'receiptLines') && typeof ffIncomingRejected === 'function'){ await ffIncomingRejected(store, op, msg); return; }
  if(store !== 'ops' || !op.taskRef) return;
  const rl = await get('receiptLines', op.taskRef);
  if(rl && rl.plan){
    const st = rl.plan.find(s=> s.uid === op.uid);
    if(st){ st.done = false; await put('receiptLines', rl); }
    const r = await get('receipts', rl.receiptId);
    if(r && r.status !== 'раскладка'){ r.status = 'раскладка'; await put('receipts', r); }
    toast('Сервер не принял: ' + msg + '. Откройте «Приёмку» и разложите эту строку заново.');
  }
  const sl = await get('shipmentLines', op.taskRef);
  if(sl && sl.collected){
    sl.collected = false; await put('shipmentLines', sl);
    const sh = await get('shipments', sl.shipmentId); if(sh && sh.status !== 'новая'){ sh.status = 'новая'; await put('shipments', sh); }
    toast('Сервер не принял отметку «Собрано»: ' + msg);
  }
}
window.ffOnRejected = ffOnRejected;

/* ---------------- экран «Приёмка» ---------------- */
let rcCurrent = null;   // открытая приёмка
async function renderReceipts(){
  const box = document.getElementById('receiptsBox');
  if(!box) return;
  const sups = Object.values(await ffSuppliersMap()).filter(s=> !s.deletedAt && !s.archived).sort((a, b)=> String(a.name).localeCompare(String(b.name), 'ru'));
  const open = [];
  for(const r of (await getAll('receipts')).filter(r=> !r.deletedAt && r.kind !== 'ожидается').sort((a, b)=> b.createdTs - a.createdTs)){
    if(!(await receiptIsDone(r.id))) open.push(r);
  }
  if(rcCurrent && !(await get('receipts', rcCurrent))) rcCurrent = null;
  // сверху: от какого поставщика, под ним — «Приёмка» (товар приехал) и «Возврат» (покупатель вернул)
  const parts = [`<div class="card rc-start">
      <div class="field"><label for="rcSupplier">Поставщик</label><select id="rcSupplier">${sups.map(s=> `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('')}</select></div>
      <div class="rc-start-btns">
        <button class="btn primary" id="rcStartBtn" onclick="rcStart()"><svg class="icon"><use href="#i-plus"/></svg>Приёмка</button>
        <button class="btn ghost" id="rcStartReturn" onclick="rcStart('возврат')"><svg class="icon"><use href="#i-in"/></svg>Возврат</button>
      </div>
      <p class="hint rc-start-hint">«Приёмка» — товар приехал от поставщика. «Возврат» — покупатель вернул товар.</p>
    </div>`];
  if(!sups.length) parts.push(emptyState('i-users', 'Нет поставщиков', 'Сначала добавьте поставщика в «Поставщиках».'));
  for(const r of open) parts.push(await receiptCard(r));
  if(!open.length && sups.length) parts.push(emptyState('i-in', 'Открытых приёмок нет', 'Выберите поставщика и нажмите «Приёмка».'));
  box.innerHTML = parts.join('');
  wireFFScanInputs();
}
async function receiptCard(r){
  const sups = await ffSuppliersMap(), models = await modelsMap();
  const lines = await receiptLines(r.id);
  const head = `<div class="head-row"><div><div class="rname">${r.kind === 'возврат' ? 'Возврат' : 'Приёмка'} · ${escapeHtml((sups[r.supplierId] || {}).name || '')}</div>
    <div class="rmeta">${new Date(r.createdTs).toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})} · ${escapeHtml(r.status)}${r.weightKg ? ' · ' + r.weightKg + ' кг' : ''}</div></div></div>`;
  if(r.status === 'черновик'){
    const ms = Object.values(models).filter(m=> !m.deletedAt && m.supplierId === r.supplierId).sort((a, b)=> modelName(a).localeCompare(modelName(b), 'ru'));
    const lineRows = [];
    for(const l of lines) lineRows.push(`<div class="row-item"><div class="rmain">${escapeHtml(modelName(models[l.modelId] || {}))} · <b>${escapeHtml(await sizeLabelOf(l.sizeId))}</b>${l.defect ? ' · <span class="warn">брак</span>' : ''}</div><div class="rside">${l.expectedQty != null ? `<span class="rmeta">ждали ${l.expectedQty} · пришло</span> <input type="number" min="0" style="width:72px;" value="${l.qty}" data-rc-qty="${escapeAttr(l.id)}" onchange="rcSetQty(${jsArg(l.id)}, this.value)"> шт.` : `<b>${l.qty} шт.</b>`} <button class="icon-btn" onclick="rcRemoveLine(${jsArg(l.id)})" aria-label="Убрать"><svg class="icon"><use href="#i-trash"/></svg></button></div></div>`);
    return `<div class="card rc-card" data-receipt="${escapeAttr(r.id)}">${head}
      <div class="field-row scan-row"><input type="text" data-scan-receipt="${escapeAttr(r.id)}" placeholder="Скан штрихкода" autocomplete="off">
        <button class="btn ghost sm" style="width:auto;" onclick="openCameraScan(c=> ffScanReceipt(${jsArg(r.id)}, c))">Камера</button></div>
      <div class="field"><label>Модель</label><select id="rcModel-${escapeAttr(r.id)}" onchange="rcFillSizes(${jsArg(r.id)})"><option value="">— выберите —</option>${ms.map(m=> `<option value="${escapeAttr(m.id)}">${escapeHtml(modelName(m))}</option>`).join('')}</select>
        <button class="btn ghost sm" style="width:auto;margin-top:6px;" onclick="openModelModal()">+ Новая модель</button></div>
      <div class="field"><label>Размер</label><div class="size-pick" id="rcSizes-${escapeAttr(r.id)}"><span class="hint">Выберите модель</span></div></div>
      <div class="field-row"><input type="number" id="rcQty-${escapeAttr(r.id)}" min="1" placeholder="Сколько штук"><button class="btn ghost" style="width:auto;" onclick="rcAddLine(${jsArg(r.id)})">Добавить строку</button></div>
      ${r.kind === 'возврат' ? `<label class="check-row"><input type="checkbox" id="rcDefect-${escapeAttr(r.id)}" data-defect-toggle> Брак — положить в ячейку брака</label>` : ''}
      <div class="rc-lines">${lineRows.join('') || '<div class="hint">Строк пока нет</div>'}</div>
      <div class="field-row" style="margin-top:8px;"><input type="text" inputmode="decimal" id="rcWeight-${escapeAttr(r.id)}" placeholder="Вес, кг">
        <button class="btn primary" style="width:auto;" onclick="rcFinish(${jsArg(r.id)})"${lines.length ? '' : ' disabled'}><svg class="icon"><use href="#i-check"/></svg>Готово — куда класть</button></div>
    </div>`;
  }
  if(r.status === 'ждёт подтверждения'){
    return `<div class="card rc-card" data-receipt="${escapeAttr(r.id)}">${head}<div class="alert">${escapeHtml(await rcConfirmText(r.id))}</div>
      <button class="btn primary" onclick="rcConfirm(${jsArg(r.id)})"><svg class="icon"><use href="#i-check"/></svg>Подтвердить</button></div>`;
  }
  const tasks = [];
  for(const l of lines){
    const label = await sizeLabelOf(l.sizeId), name = modelName(models[l.modelId] || {});
    const doneArr = []; for(const s of (l.plan || [])) doneArr.push(await stepIsDone(s));
    (l.plan || []).forEach((s0, i)=>{
      const s = Object.assign({}, s0, {done: doneArr[i]});
      tasks.push(`<label class="task${s.done ? ' done' : ''}"><input type="checkbox"${s.done ? ' checked disabled' : ''} onchange="rcTick(${jsArg(l.id)}, ${i})">
        <span><b>${escapeHtml(name)} ${escapeHtml(label)}</b> — ${s.qty} шт.<br><span class="${s.isNew || s.defect ? 'warn' : 'go'}">➡ ${s.isNew ? 'создай ячейку ' + escapeHtml(s.cell) + ' и положи туда' : 'Ячейка ' + escapeHtml(s.cell) + (s.defect ? ' (брак)' : '')}</span></span></label>`);
    });
  }
  return `<div class="card rc-card" data-receipt="${escapeAttr(r.id)}">${head}<div class="tasks">${tasks.join('')}</div></div>`;
}
async function rcConfirmText(receiptId){
  // вопрос пересобираем по сохранённому плану
  const models = await modelsMap(); const out = [];
  for(const l of await receiptLines(receiptId)){
    if((l.plan || []).some(s=> s.bind || s.isNew) && !(await getAll('cells')).some(c=> !c.deletedAt && c.modelId === l.modelId)){
      out.push('Товар новый. Закрепить модель «' + modelName(models[l.modelId] || {}) + '» за ячейками ' + joinRu(l.plan.map(s=> s.cell + ' (' + s.qty + ' шт.)')) + '?');
    }
  }
  return out.join(' ');
}
async function rcStart(kind){
  const sup = document.getElementById('rcSupplier').value;
  if(!sup){ toast('Выберите поставщика'); return; }
  rcCurrent = await newReceipt(sup, kind);
  await renderReceipts();
}
async function rcFillSizes(rid){
  const mid = document.getElementById('rcModel-' + rid).value;
  const sizes = mid ? (await getAll('sizes')).filter(s=> s.modelId === mid && !s.deletedAt).sort((a, b)=> sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel)) : [];
  document.getElementById('rcSizes-' + rid).innerHTML = sizes.length
    ? sizes.map(s=> `<button type="button" data-size-id="${escapeAttr(s.id)}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${escapeHtml(s.sizeLabel)}</button>`).join('')
    : '<span class="hint">У модели нет размеров — добавьте их в карточке модели</span>';
}
async function rcAddLine(rid){
  const mid = document.getElementById('rcModel-' + rid).value;
  const sz = document.querySelector('#rcSizes-' + CSS.escape(rid) + ' button.on');
  const qty = document.getElementById('rcQty-' + rid).value;
  if(!mid || !sz){ toast('Выберите модель и размер'); return; }
  const defEl = document.getElementById('rcDefect-' + rid);
  const r = await addReceiptLine(rid, mid, sz.dataset.sizeId, qty, defEl && defEl.checked);
  if(!r.ok){ toast(r.error); return; }
  await renderReceipts();
}
async function rcRemoveLine(id){ const l = await get('receiptLines', id); if(l){ l.deletedAt = Date.now(); await put('receiptLines', l); } await renderReceipts(); }
async function rcFinish(rid){
  const w = (document.getElementById('rcWeight-' + rid) || {}).value;
  const res = await finishReceipt(rid, w);
  await renderReceipts();
  if(res.confirm.length) toast('Товар новый — подтвердите ячейки');
}
async function rcConfirm(rid){ await confirmReceiptPlan(rid); await renderReceipts(); }
async function rcTick(lineId, idx){
  const r = await tickReceiptStep(lineId, idx);
  if(r.ok && !r.already) toast('Положено');
  await renderReceipts();
}
