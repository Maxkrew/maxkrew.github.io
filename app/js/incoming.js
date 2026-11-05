/* «Fulbro», этап 2б: приход поставщика = «Ожидается поставка» (ОПИСАНИЕ §11в, §6.1).
   Поставщик набирает черновик (вручную или из Excel) → «Отправить на склад» → у него «едет»,
   у склада «Ожидается поставка». Склад «Принять» → обычная приёмка с фактическим количеством;
   остаток растёт только после раскладки. Расхождение «ждали N — пришло M» видят оба. */

const INC_LATE = 'Склад уже принимает поставку';

/* --- данные --- */
async function newIncoming(ret){
  const id = newUid();
  await put('receipts', Object.assign({id, supplierId: Sync.mySupplierId(), kind: 'ожидается', weightKg: null, status: 'ожидается', createdTs: Date.now()},
    ret ? {isReturn: true, carrier: ret.carrier || '', track: String(ret.track || '').trim().slice(0, 60), comment: String(ret.comment || '').slice(0, 500),
      returnCode: String(ret.returnCode || '').trim().slice(0, 60), pickupAddress: String(ret.pickupAddress || '').trim().slice(0, 300)} : {}));
  return id;
}
async function addIncomingLine(receiptId, modelId, sizeId, qty, buyPrice){
  const r = await get('receipts', receiptId);
  if(!r || r.deletedAt || r.kind !== 'ожидается') return {ok:false, error: INC_LATE};
  const q = sanitizeQty(qty); if(q.error) return {ok:false, error:q.error};
  const id = newUid();
  await put('receiptLines', {id, receiptId, supplierId: r.supplierId, modelId, sizeId, qty: q.n, expectedQty: q.n, plan: null, doneQty: 0, defect: false});
  if(buyPrice !== undefined && buyPrice !== null && String(buyPrice).trim() !== '') await setLinePrice(id, 'приход', buyPrice);
  return {ok:true, id};
}
/* Весь черновик одной поставкой: строки проверяются заранее — плохая строка не создаёт полпоставки. */
async function submitIncoming(lines){
  if(!lines || !lines.length) return {ok:false, error:'Добавьте хотя бы один товар'};
  for(const l of lines){ const q = sanitizeQty(l.qty); if(q.error) return {ok:false, error:q.error}; }
  const id = await newIncoming();
  for(const l of lines) await addIncomingLine(id, l.modelId, l.sizeId, l.qty, l.price);
  return {ok:true, id};
}
/* Возврат от поставщика (FoG, 03.11.2026): покупатель вернул — товар едет на склад. Как поставка,
   но со службой, треком и скриншотом штрихкода: по нему склад забирает возврат в пункте выдачи.
   Склад «Принять» → обычный возврат склада (раскладка, брак). */
async function submitReturn(o){
  const lines = (o && o.lines) || [];
  if(!lines.length) return {ok:false, error:'Добавьте товар'};
  for(const l of lines){ const q = sanitizeQty(l.qty); if(q.error) return {ok:false, error:q.error}; }
  let barcode = null, photo = null;
  try{
    if(o.barcode) barcode = await compressImage(o.barcode);
    if(o.photo) photo = await compressImage(o.photo);
  }catch(e){ barcode = null; }
  if((o.barcode && !barcode) || (o.photo && !photo)) return {ok:false, error:'Не получилось открыть картинку — сохраните её как JPEG или PNG'};
  const id = await newIncoming({carrier: o.carrier, track: o.track, comment: o.comment, returnCode: o.returnCode, pickupAddress: o.pickupAddress});
  const supplierId = Sync.mySupplierId();
  if(barcode) await addPhoto({supplierId, kind:'штрихкод', receiptId:id}, barcode, true);
  if(photo) await addPhoto({supplierId, kind:'заказ', receiptId:id}, photo, true);
  for(const l of lines) await addIncomingLine(id, l.modelId, l.sizeId, l.qty);
  return {ok:true, id};
}
async function receiptPhotos(receiptId){
  return (await getAll('photos')).filter(p=> !p.deletedAt && p.receiptId === receiptId).sort((a, b)=> (a.kind === 'штрихкод' ? 0 : 1) - (b.kind === 'штрихкод' ? 0 : 1));
}
/* Возвраты, которые едут на склад (у поставщика — только свои). */
async function returnsOnTheWay(){
  const mine = isOwnerRole() ? null : Sync.mySupplierId();
  return (await getAll('receipts')).filter(r=> !r.deletedAt && r.kind === 'ожидается' && r.isReturn && (!mine || r.supplierId === mine)).sort((a, b)=> (b.createdTs || 0) - (a.createdTs || 0));
}
/* Карточка возврата: служба, трек, комментарий, скриншот, товары. tools — кнопки снизу. */
async function returnCard(r, head, tools){
  const models = await modelsMap(), rows = [];
  for(const l of await receiptLines(r.id)) rows.push(`<div class="row-item"><div class="rmain">${escapeHtml(modelName(models[l.modelId] || {}))} · <b>${escapeHtml(await sizeLabelOf(l.sizeId))}</b></div><div class="rside"><b>${l.qty} шт.</b></div></div>`);
  const phs = (await receiptPhotos(r.id)).map(p=> photoThumb(p.id, p.kind === 'штрихкод' ? 'Скриншот штрихкода' : 'Фото к возврату'));
  const when = new Date(r.createdTs || Date.now()).toLocaleString('ru-RU', {day:'numeric', month:'long', hour:'2-digit', minute:'2-digit'});
  return `<div class="card ret-card" data-expected="${escapeAttr(r.id)}"><div class="rname sh-head"><span class="sh-carrier">${escapeHtml(r.carrier || 'Возврат')}</span><span class="sh-status st-new">${head}</span></div>
    <div class="rmeta">${when}${r.comment ? ' · ' + escapeHtml(r.comment) : ''}</div>
    ${r.track ? '<div class="rmeta sh-track">Трек: <b data-track>' + trackHtml(r.track) + '</b></div>' : ''}
    ${r.returnCode ? '<div class="rmeta">Код на возврат: <b>' + escapeHtml(r.returnCode) + '</b></div>' : ''}
    ${r.pickupAddress ? '<div class="rmeta">Пункт выдачи: ' + escapeHtml(r.pickupAddress) + '</div>' : ''}
    ${phs.length ? '<div class="ph-row">' + phs.join('') + '</div>' : ''}<div class="rc-lines">${rows.join('')}</div>${tools}</div>`;
}
async function retCancel(id){
  if(!confirm('Отменить возврат?')) return;
  const r = await cancelIncoming(id); if(!r.ok){ toast(r.error); return; }
  toast('Возврат отменён'); if(typeof renderShipments === 'function') await renderShipments();
}
async function updateIncomingLine(lineId, qty){
  const l = await get('receiptLines', lineId); if(!l || l.deletedAt) return {ok:false, error:'Нет такой строки'};
  const r = await get('receipts', l.receiptId);
  if(!r || r.kind !== 'ожидается') return {ok:false, error: INC_LATE};
  const q = sanitizeQty(qty); if(q.error) return {ok:false, error:q.error};
  l.qty = q.n; l.expectedQty = q.n; await put('receiptLines', l);
  return {ok:true};
}
async function removeIncomingLine(lineId){
  const l = await get('receiptLines', lineId); if(!l) return {ok:true};
  const r = await get('receipts', l.receiptId);
  if(!r || r.kind !== 'ожидается') return {ok:false, error: INC_LATE};
  l.deletedAt = Date.now(); await put('receiptLines', l);
  return {ok:true};
}
async function cancelIncoming(id){
  const r = await get('receipts', id); if(!r || r.deletedAt) return {ok:true};
  if(r.kind !== 'ожидается') return {ok:false, error: INC_LATE};
  for(const l of await receiptLines(id)){ l.deletedAt = Date.now(); await put('receiptLines', l); }
  r.deletedAt = Date.now(); await put('receipts', r);
  return {ok:true};
}

/* --- склад --- */
/* «Принять»: та же запись становится черновиком приёмки — второй телефон или повторное
   нажатие дают ту же приёмку, а не вторую. */
async function acceptExpected(receiptId){
  const r = await get('receipts', receiptId);
  if(!r || r.deletedAt) return null;
  if(r.kind === 'ожидается'){ r.kind = r.isReturn ? 'возврат' : 'приёмка'; r.status = 'черновик'; await put('receipts', r); }
  return r.id;
}
/* Где пришло не столько, сколько ждали (до раскладки «пришло» — то, что вписал склад). */
async function deliveryDiff(receiptId){
  return (await receiptLines(receiptId))
    .filter(l=> l.expectedQty !== null && l.expectedQty !== undefined && Number(l.expectedQty) !== Number(l.qty))
    .map(l=> ({modelId: l.modelId, sizeId: l.sizeId, expected: Number(l.expectedQty), actual: Number(l.qty)}));
}
async function expectedList(){
  return (await getAll('receipts')).filter(r=> !r.deletedAt && r.kind === 'ожидается' && !r.isReturn).sort((a, b)=> (a.createdTs || 0) - (b.createdTs || 0));
}
async function renderExpected(){
  const box = document.getElementById('expectedBox');
  if(!box) return;
  if(!isOwnerRole()){ box.innerHTML = ''; return; }
  const sups = await ffSuppliersMap(), parts = [];
  const supF = (document.getElementById('ffSupplierFilter') || {}).value;
  for(const r of (await expectedList()).filter(r=> !supF || r.supplierId === supF)){
    const n = (await receiptLines(r.id)).reduce((s, l)=> s + (Number(l.qty) || 0), 0);
    parts.push(`<div class="row-item exp-row" data-expected="${escapeAttr(r.id)}"><div class="rmain"><span class="exp-sup">${escapeHtml((sups[r.supplierId] || {}).name || '')}</span> <span class="exp-qty">${n} шт.</span><div class="rmeta">${new Date(r.createdTs || Date.now()).toLocaleDateString('ru-RU', {day:'numeric', month:'long'})}</div></div>
      <div class="rside"><button class="btn primary sm" style="width:auto;" data-accept="${escapeAttr(r.id)}" onclick="rcAcceptExpected(${jsArg(r.id)})">Принять</button></div></div>`);
  }
  // возвраты от поставщиков: штрихкод на виду — по нему забирают в пункте выдачи
  const rets = [];
  for(const r of (await returnsOnTheWay()).filter(r=> !supF || r.supplierId === supF))
    rets.push(await returnCard(r, escapeHtml((sups[r.supplierId] || {}).name || ''), `<label class="check-row ret-got"><input type="checkbox" data-accept="${escapeAttr(r.id)}" onchange="retGot(${jsArg(r.id)})"><span>Забрал — всё в порядке</span></label>`));
  // заголовок — над карточкой; в строке только поставщик и сколько штук
  box.innerHTML = (rets.length ? '<div class="exp-title">Ожидается возврат</div>' + rets.join('') : '') +
    (parts.length ? `<div class="exp-title">Ожидается поставка</div><div class="card">${parts.join('')}</div>` : '');
  if(rets.length) fillPhotoThumbs(box);
}
/* Склад забрал возврат в пункте выдачи — галочка (FoG, 05.11.2026): возврат уходит в «Приёмку» на раскладку. */
async function retGot(id){
  if(!(await acceptExpected(id))) return;
  toast('Возврат забран — разложите его в «Приёмке»');
  await renderExpected();
}
async function rcAcceptExpected(id){
  const rid = await acceptExpected(id);
  if(!rid) return;
  if(typeof rcCurrent !== 'undefined') rcCurrent = rid;
  showSection('receipts');
}
/* Склад вписывает, сколько пришло на самом деле. */
async function rcSetQty(lineId, qty){
  const l = await get('receiptLines', lineId); if(!l) return;
  const q = sanitizeQty(qty); if(q.error){ toast(q.error); return; }
  l.qty = q.n; await put('receiptLines', l);
}

/* Правку поставщика сервер не принял (склад уже принимает): берём версию сервера. */
async function ffIncomingRejected(store, row, msg){
  if(store !== 'receipts' && store !== 'receiptLines') return false;
  row.rejected = 0; row.rejectReason = ''; row.dirty = 0;
  row.updatedAt = 0;   // любая версия с сервера новее — приедет при приёме
  await put(store, row, {fromSync:true});
  try{ await Sync.refetch(store, row.id); }catch(e){}   // строка на сервере могла не меняться — берём её сами
  return true;
}

/* --- экран поставщика «Приход» --- */
const INC_DRAFT_KEY = 'incDraft';
async function incDraft(){ const r = await get('settings', INC_DRAFT_KEY); return (r && Array.isArray(r.value)) ? r.value : []; }
async function incSaveDraft(list){ await putRaw('settings', {key: INC_DRAFT_KEY, value: list}); }

async function renderIncoming(){
  const box = document.getElementById('incomingBox');
  if(!box) return;
  const models = await modelsMap(), mySup = Sync.mySupplierId();
  const ms = Object.values(models).filter(m=> !m.deletedAt && m.supplierId === mySup).sort((a, b)=> modelName(a).localeCompare(modelName(b), 'ru'));
  const draft = await incDraft();
  const draftRows = [];
  for(let i = 0; i < draft.length; i++){
    const d = draft[i];
    draftRows.push(`<div class="row-item"><div class="rmain">${escapeHtml(modelName(models[d.modelId] || {}))} · <b>${escapeHtml(await sizeLabelOf(d.sizeId))}</b>${d.price ? ' · ' + fmtMoney(d.price) : ''}</div>
      <div class="rside"><b>${d.qty} шт.</b> <button class="icon-btn" onclick="incRemoveDraft(${i})" aria-label="Убрать"><svg class="icon"><use href="#i-trash"/></svg></button></div></div>`);
  }
  const total = draft.reduce((s, d)=> s + d.qty, 0);
  const parts = [`<div class="card">
    <div class="head-row" style="margin-bottom:8px;"><button type="button" class="icon-btn" data-back onclick="showSection('stock')" aria-label="Назад"><svg class="icon"><use href="#i-arrow-left"/></svg></button>
      <div class="rname" style="flex:1;margin-left:8px;">Новый приход</div>
      <button class="btn ghost sm" id="incExcel" style="width:auto;" onclick="incOpenExcel()"><svg class="icon"><use href="#i-upload"/></svg>Загрузить Excel</button></div>
    <div class="field"><label>Товар</label><select id="incModel" onchange="incFillSizes()"><option value="">— выберите —</option>${ms.map(m=> `<option value="${escapeAttr(m.id)}">${escapeHtml(modelName(m))}</option>`).join('')}</select>
      <button class="btn ghost sm no-staff" style="width:auto;margin-top:6px;" onclick="openModelModal()">+ Новый товар</button></div>
    <div class="field"><label>Размер</label><div class="size-pick" id="incSizes"><span class="hint">Выберите товар</span></div></div>
    <div class="field-row"><input type="number" id="incQty" min="1" placeholder="Сколько штук"><input type="text" inputmode="decimal" id="incPrice" class="no-staff" placeholder="Цена закупки, ₽"></div>
    <button class="btn ghost" id="incAdd" onclick="incAdd()"><svg class="icon"><use href="#i-plus"/></svg>Добавить в приход</button>
    <div id="incDraft" class="rc-lines" style="margin-top:8px;">${draftRows.join('') || '<div class="hint">Пока пусто — добавьте товары или загрузите Excel</div>'}</div>
    <button class="btn primary" id="incSend" style="margin-top:10px;" onclick="incSend()"${draft.length ? '' : ' disabled'}><svg class="icon"><use href="#i-out"/></svg>Отправить на склад${total ? ' — ' + total + ' шт.' : ''}</button>
  </div>`];
  // прошлые поставки
  const mine = (await getAll('receipts')).filter(r=> !r.deletedAt && r.supplierId === mySup && !r.isReturn && (r.kind === 'ожидается' || (r.kind === 'приёмка' && r.createdTs)))
    .sort((a, b)=> (b.createdTs || 0) - (a.createdTs || 0)).slice(0, 30);
  const hist = [];
  for(const r of mine){
    const lines = await receiptLines(r.id);
    if(r.kind !== 'ожидается' && !lines.some(l=> l.expectedQty !== null && l.expectedQty !== undefined)) continue;   // приёмки самого склада — не «поставки»
    const n = lines.reduce((s, l)=> s + (Number(l.qty) || 0), 0);
    const when = new Date(r.createdTs).toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
    let body = '';
    if(r.kind === 'ожидается'){
      const rows = [];
      for(const l of lines) rows.push(`<div class="row-item"><div class="rmain">${escapeHtml(modelName(models[l.modelId] || {}))} · <b>${escapeHtml(await sizeLabelOf(l.sizeId))}</b></div>
        <div class="rside"><input type="number" min="1" style="width:80px;" value="${l.qty}" data-inc-qty="${escapeAttr(l.id)}" onchange="incSetQty(${jsArg(l.id)}, this.value)"> шт.</div></div>`);
      body = rows.join('') + `<button class="btn ghost sm" style="width:auto;margin-top:6px;" data-inc-cancel="${escapeAttr(r.id)}" onclick="incCancel(${jsArg(r.id)})">Отменить поставку</button>`;
    } else {
      const diff = [];
      for(const d of await deliveryDiff(r.id)) diff.push(`<div class="warn">${escapeHtml(modelName(models[d.modelId] || {}))} ${escapeHtml(await sizeLabelOf(d.sizeId))}: ждали ${d.expected} — пришло ${d.actual}</div>`);
      body = diff.join('') || '<div class="hint">Пришло всё, как ждали</div>';
    }
    hist.push(`<div class="card" data-incoming="${escapeAttr(r.id)}"><div class="head-row"><div><div class="rname">${r.kind === 'ожидается' ? 'Едет на склад' : (r.status === 'разложено' ? 'Принята складом' : 'Склад принимает')} — ${n} шт.</div>
      <div class="rmeta">${when}</div></div></div>${body}</div>`);
  }
  if(hist.length) parts.push('<div class="t-h1" style="margin:14px 0 8px;">Мои поставки</div>' + hist.join(''));
  // экран перерисовывается и после обмена — не теряем то, что человек уже выбрал и ввёл (снимаем перед самой заменой)
  const keep = {model: (document.getElementById('incModel') || {}).value || '', size: ((document.querySelector('#incSizes button.on') || {}).dataset || {}).sizeId || '',
    qty: (document.getElementById('incQty') || {}).value || '', price: (document.getElementById('incPrice') || {}).value || ''};
  box.innerHTML = parts.join('');
  if(keep.model && models[keep.model]){
    document.getElementById('incModel').value = keep.model; await incFillSizes();
    const b = keep.size && document.querySelector('#incSizes [data-size-id="' + CSS.escape(keep.size) + '"]'); if(b) b.classList.add('on');
  }
  document.getElementById('incQty').value = keep.qty; document.getElementById('incPrice').value = keep.price;
}
async function incStart(){ await renderIncoming(); const el = document.getElementById('incModel'); if(el) try{ el.focus(); }catch(e){} }
async function incFillSizes(){
  const mid = document.getElementById('incModel').value;
  const sizes = mid ? (await getAll('sizes')).filter(s=> s.modelId === mid && !s.deletedAt).sort((a, b)=> sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel)) : [];
  document.getElementById('incSizes').innerHTML = sizes.length
    ? sizes.map(s=> `<button type="button" data-size-id="${escapeAttr(s.id)}" onclick="szPick(this)">${escapeHtml(sizeText(s.sizeLabel))}</button>`).join('')
    : '<span class="hint">У товара нет размеров — добавьте их в карточке товара</span>';
  szAutoOne(document.getElementById('incSizes'));
}
async function incAdd(){
  const mid = document.getElementById('incModel').value;
  const sz = document.querySelector('#incSizes button.on');
  if(!mid || !sz){ toast('Выберите товар и размер'); return; }
  const q = sanitizeQty(document.getElementById('incQty').value); if(q.error){ toast(q.error); return; }
  const pr = String(document.getElementById('incPrice').value || '').replace(/\s/g, '').replace(',', '.');
  const price = pr === '' ? null : Number(pr);
  if(price !== null && (!isFinite(price) || price < 0)){ toast('Цена — число'); return; }
  const draft = await incDraft(); draft.push({modelId: mid, sizeId: sz.dataset.sizeId, qty: q.n, price});
  await incSaveDraft(draft);
  document.getElementById('incQty').value = ''; document.getElementById('incPrice').value = '';
  await renderIncoming();
}
async function incRemoveDraft(i){ const d = await incDraft(); d.splice(i, 1); await incSaveDraft(d); await renderIncoming(); }
async function incSend(){
  const d = await incDraft();
  const r = await submitIncoming(d);
  if(!r.ok){ toast(r.error); return; }
  await incSaveDraft([]); toast('Отправлено на склад'); await renderIncoming();
}
async function incSetQty(lineId, v){ const r = await updateIncomingLine(lineId, v); if(!r.ok) toast(r.error); await renderIncoming(); }
async function incCancel(id){ const r = await cancelIncoming(id); if(!r.ok) toast(r.error); await renderIncoming(); }
function incOpenExcel(){ if(typeof openXlsImport === 'function') openXlsImport(); else toast('Загрузка Excel — скоро'); }
