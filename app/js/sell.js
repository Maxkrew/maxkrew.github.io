/* «Fulbro», этап 2б: «Продал» — заказ складу со скриншотом штрихкода Авито (ОПИСАНИЕ §11в).
   Раньше поставщик слал в чат скриншот, фото и подписывал цену и количество — теперь это поля
   заказа. Цена продажи — только у поставщика (line_prices). Скриншоты удаляются через 30 дней
   после «Собрано». */

const SELL_AVITO = 'Авито Доставка';
const SELL_NEED_BARCODE = 'Приложите скриншот штрихкода Авито';
const BARCODE_KEEP_DAYS = 30;

/* --- данные --- */
async function submitSale(o){
  const lines = (o && o.lines) || [];
  if(!lines.length) return {ok:false, error:'Добавьте товар'};
  const carrier = o.carrier || SELL_AVITO;
  if(carrier === SELL_AVITO && !o.barcode) return {ok:false, error: SELL_NEED_BARCODE};
  // проверяем всё заранее: плохая строка не создаёт полузаказ
  const need = {};
  for(const l of lines){
    const q = sanitizeQty(l.qty); if(q.error) return {ok:false, error:q.error};
    need[l.sizeId] = (need[l.sizeId] || 0) + q.n;
  }
  for(const [sizeId, n] of Object.entries(need)){
    const free = await freeQty(sizeId);
    if(n > free) return {ok:false, error:'Не хватает ' + (n - Math.max(0, free)) + ' шт. ' + await sizeLabelOf(sizeId) + ' — свободно ' + Math.max(0, free)};
  }
  // картинки сжимаем до заказа: не открылась (HEIC и т.п.) — заказа нет, человек видит причину
  let barcode = null, photo = null;
  try{
    if(o.barcode) barcode = await compressImage(o.barcode);
    if(o.photo) photo = await compressImage(o.photo);
  }catch(e){ return {ok:false, error:'Не получилось открыть картинку — сохраните её как JPEG или PNG'}; }
  if(o.barcode && !barcode) return {ok:false, error:'Не получилось открыть картинку — сохраните её как JPEG или PNG'};
  const id = await newShipment({carrier, comment: o.comment || ''});
  const supplierId = Sync.mySupplierId();
  // заказ уходит на сервер только после своих картинок (shipmentReady в sync)
  if(barcode) await addPhoto({supplierId, kind:'штрихкод', shipmentId:id}, barcode, true);
  if(photo) await addPhoto({supplierId, kind:'заказ', shipmentId:id}, photo, true);
  for(const l of lines){
    const r = await addSupplierOrderLine(id, l.modelId, l.sizeId, l.qty);
    if(!r.ok){ await sellRollback(id); return r; }
    if(l.price !== undefined && l.price !== null && String(l.price).trim() !== '') await setLinePrice(r.id, 'продажа', l.price);
  }
  return {ok:true, id};
}
async function sellRollback(id){
  for(const l of await shipmentLines(id)){ l.deletedAt = Date.now(); await put('shipmentLines', l); }
  for(const p of (await getAll('photos')).filter(p=> p.shipmentId === id)){ p.deletedAt = Date.now(); await put('photos', p); }
  const sh = await get('shipments', id); if(sh){ sh.deletedAt = Date.now(); await put('shipments', sh); }
}
/* Можно ли отправлять заказ на сервер: все его картинки уже ушли (файл загружен, строка отправлена). */
async function shipmentReady(shipmentId){
  for(const p of (await getAll('photos')).filter(p=> p.shipmentId === shipmentId && !p.deletedAt && !p.rejected)){
    if(p.dirty || !(await photoReady(p))) return false;
  }
  return true;
}
window.shipmentReady = shipmentReady;
async function shipmentPhotos(shipmentId){
  return (await getAll('photos')).filter(p=> !p.deletedAt && p.shipmentId === shipmentId).sort((a, b)=> (a.kind === 'штрихкод' ? 0 : 1) - (b.kind === 'штрихкод' ? 0 : 1));
}
/* Фото товара — одно на карточку (новое заменяет старое); кладут и склад, и поставщик. */
async function setModelPhoto(modelId, file){
  const m = await get('models', modelId); if(!m) return null;
  const old = (await getAll('photos')).filter(p=> !p.deletedAt && p.kind === 'товар' && p.modelId === modelId);
  const id = await addPhoto({supplierId: m.supplierId, kind:'товар', modelId}, file);
  for(const p of old){ p.deletedAt = Date.now(); await put('photos', p); }
  return id;
}

/* Склад: скриншоты штрихкодов собранных заказов старше 30 дней — файл из хранилища и строку. */
async function cleanupOldBarcodes(now){
  if(!isOwnerRole()) return 0;
  const edge = (now || Date.now()) - BARCODE_KEEP_DAYS * 86400000;
  const shs = new Map((await getAll('shipments')).map(s=> [s.id, s]));
  let n = 0;
  for(const p of (await getAll('photos')).filter(p=> !p.deletedAt && p.kind === 'штрихкод' && p.shipmentId)){
    const sh = shs.get(p.shipmentId);
    if(!sh || sh.status !== 'собрана') continue;
    const lines = await shipmentLines(sh.id);
    if(!lines.length || !lines.every(l=> l.collected && l.collectedTs)) continue;
    if(Math.max(...lines.map(l=> Number(l.collectedTs))) >= edge) continue;
    if(!(await Sync.removePhotoFiles([p.path]))) continue;     // файл не удалился — попробуем в следующий раз
    p.deletedAt = Date.now(); await put('photos', p);
    try{ await del('photoBlobs', p.id); }catch(e){}
    n++;
  }
  return n;
}
let barcodeCleanTs = 0;
async function ffAfterSync(){
  if(!isOwnerRole() || Date.now() - barcodeCleanTs < 3600000) return;
  barcodeCleanTs = Date.now();
  try{ await cleanupOldBarcodes(Date.now()); }catch(e){}
}

/* --- миниатюры и просмотр --- */
function photoThumb(id, label){
  return `<button type="button" class="ph-thumb" data-photo="${escapeAttr(id)}" onclick="event.stopPropagation();openPhoto(${jsArg(id)})" aria-label="${escapeAttr(label || 'Фото')}"><img alt="" data-ph-src="${escapeAttr(id)}"></button>`;
}
/* ссылки на картинки — после отрисовки, чтобы список не ждал сеть */
async function fillPhotoThumbs(root){
  for(const img of (root || document).querySelectorAll('img[data-ph-src]')){
    const id = img.getAttribute('data-ph-src'); img.removeAttribute('data-ph-src');
    try{ const u = await photoUrl(id); if(u) img.src = u; }catch(e){}
  }
}
let pvLock = null, pvCurrent = null;
async function openPhoto(id){
  const ph = await get('photos', id); pvCurrent = ph || null;
  document.getElementById('pvReplace').hidden = !(ph && ph.kind === 'товар');
  const v = document.getElementById('photoViewer');
  const img = document.getElementById('pvImg');
  img.removeAttribute('src');
  v.classList.add('show');
  const u = await photoUrl(id);
  if(u) img.src = u; else toast('Фото ещё не загрузилось');
  // экран не гаснет, пока показываем штрихкод (яркость браузер менять не умеет)
  try{ if(navigator.wakeLock) pvLock = await navigator.wakeLock.request('screen'); }catch(e){}
}
async function pvReplacePick(input){
  const f = input.files && input.files[0]; input.value = ''; if(!f || !pvCurrent || !pvCurrent.modelId) return;
  try{ const id = await setModelPhoto(pvCurrent.modelId, f); toast('Фото заменено'); await openPhoto(id); }
  catch(e){ toast('Не получилось: ' + e.message); }
  if(typeof renderStockFF === 'function') renderStockFF();
}
async function deleteModelPhoto(modelId){
  for(const p of (await getAll('photos')).filter(p=> !p.deletedAt && p.kind === 'товар' && p.modelId === modelId)){ p.deletedAt = Date.now(); await put('photos', p); }
}
/* блок «Фото товара» в карточке товара */
async function mmRenderPhoto(modelId){
  const box = document.getElementById('mmPhotoBox'); if(!box) return;
  if(!modelId){ box.innerHTML = '<label>Фото товара</label><div class="hint">Фото можно добавить после сохранения товара</div>'; return; }
  const p = await modelPhoto(modelId);
  const pick = (t)=> `<label class="btn ghost sm" style="width:auto;cursor:pointer;"><svg class="icon"><use href="#i-camera"/></svg>${t}<input type="file" id="mmPhotoFile" accept="image/*" hidden onchange="mmPhotoPick(${jsArg(modelId)}, this)"></label>`;
  box.innerHTML = '<label>Фото товара</label><div class="mm-photo">' + (p
    ? photoThumb(p.id, 'Фото товара') + pick('Заменить') + `<button type="button" class="btn ghost sm" id="mmPhotoDel" style="width:auto;" onclick="mmPhotoDelete(${jsArg(modelId)})"><svg class="icon"><use href="#i-trash"/></svg>Удалить</button>`
    : pick('Добавить фото')) + '</div>';
  fillPhotoThumbs(box);
}
async function mmPhotoPick(modelId, input){
  const f = input.files && input.files[0]; if(!f) return;
  try{ await setModelPhoto(modelId, f); toast('Фото сохранено'); }catch(e){ toast('Не получилось: ' + e.message); }
  await mmRenderPhoto(modelId); if(typeof renderStockFF === 'function') renderStockFF();
}
async function mmPhotoDelete(modelId){
  if(!confirm('Удалить фото товара?')) return;
  await deleteModelPhoto(modelId); toast('Фото удалено');
  await mmRenderPhoto(modelId); if(typeof renderStockFF === 'function') renderStockFF();
}
function closePhoto(){
  document.getElementById('photoViewer').classList.remove('show');
  try{ if(pvLock) pvLock.release(); }catch(e){} pvLock = null;
}

/* --- окно «Продал» --- */
const sell = {cart: [], modelId: '', sizeId: '', barcode: null, photo: null};
async function sellStart(){
  Object.assign(sell, {cart: [], modelId: '', sizeId: '', barcode: null, photo: null, editId: null, priceTouched: false});
  sellSetMode(false);
  document.getElementById('sellSearch').value = '';
  document.getElementById('sellComment').value = '';
  document.getElementById('sellPrice').value = ''; document.getElementById('sellQty').value = '1';
  document.getElementById('sellBarcode').value = ''; document.getElementById('sellPhoto').value = '';
  const c = document.getElementById('sellCarrier');
  c.innerHTML = carrierList().map(x=> `<option${x === SELL_AVITO ? ' selected' : ''}>${escapeHtml(x)}</option>`).join('');
  document.getElementById('sellModalBg').classList.add('show');
  await sellRender();
}
function closeSell(){ document.getElementById('sellModalBg').classList.remove('show'); sell.editId = null; }
function sellSetMode(edit){
  document.getElementById('sellTitle').textContent = edit ? 'Изменить заказ' : 'Продал';
  document.getElementById('sellSendText').textContent = edit ? 'Сохранить изменения' : 'Отправить складу';
}

/* --- изменить заказ (карандаш) ---
   Склад раскладывает заказ по ячейкам, как только его увидел, и строки поставщику уже не
   поменять (правило сервера). Поэтому «изменить» = старый заказ отменить, новый — вместо него,
   с теми же картинками. Только со связью: сначала сервер подтверждает отмену, потом новый. */
async function shipmentEditable(s){
  if(!s || s.deletedAt || s.status !== 'новая' || s.createdBy !== 'supplier') return false;
  return !(await shipmentLines(s.id)).some(l=> l.collected);
}
async function photoBlobOf(p){
  const b = await get('photoBlobs', p.id);
  if(b && b.blob) return b.blob;
  const u = await photoUrl(p.id); if(!u) return null;
  try{ const r = await fetch(u); return r.ok ? await r.blob() : null; }catch(e){ return null; }
}
async function sellEditStart(id){
  const s = await get('shipments', id);
  if(!(await shipmentEditable(s))){ toast(CANCEL_LATE); return; }
  await sellStart();
  sell.editId = id; sellSetMode(true);
  // строку, которую склад разделил по ячейкам, показываем одной
  const bySize = new Map();
  for(const l of await shipmentLines(id)){
    const k = l.modelId + '|' + l.sizeId, c = bySize.get(k) || {modelId: l.modelId, sizeId: l.sizeId, qty: 0, price: null};
    c.qty += Number(l.qty) || 0;
    if(c.price === null){ const p = await linePrice(l.id); if(p !== null) c.price = p; }
    bySize.set(k, c);
  }
  sell.cart = [...bySize.values()];
  const c = document.getElementById('sellCarrier'); if(![...c.options].some(o=> o.value === s.carrier)) c.insertAdjacentHTML('beforeend', `<option>${escapeHtml(s.carrier)}</option>`);
  c.value = s.carrier;
  document.getElementById('sellComment').value = s.comment || '';
  for(const p of await shipmentPhotos(id)){
    const b = await photoBlobOf(p);
    if(b && p.kind === 'штрихкод') sell.barcode = b;
    if(b && p.kind === 'заказ') sell.photo = b;
  }
  await sellRender();
}
async function replaceSale(oldId, o){
  if(!navigator.onLine) return {ok:false, error:'Изменить заказ можно только со связью — склад должен сразу узнать об изменении'};
  const old = await get('shipments', oldId);
  if(!(await shipmentEditable(old))) return {ok:false, error: CANCEL_LATE};
  const lines = (o && o.lines) || [];
  if(!lines.length) return {ok:false, error:'Добавьте товар'};
  if((o.carrier || SELL_AVITO) === SELL_AVITO && !o.barcode) return {ok:false, error: SELL_NEED_BARCODE};
  // проверяем заранее, с учётом того, что старый заказ освободит
  const mine = {}, need = {};
  for(const l of await shipmentLines(oldId)) mine[l.sizeId] = (mine[l.sizeId] || 0) + (Number(l.qty) || 0);
  for(const l of lines){ const q = sanitizeQty(l.qty); if(q.error) return {ok:false, error:q.error}; need[l.sizeId] = (need[l.sizeId] || 0) + q.n; }
  for(const [sizeId, n] of Object.entries(need)){
    const free = await freeQty(sizeId) + (mine[sizeId] || 0);
    if(n > free) return {ok:false, error:'Не хватает ' + (n - Math.max(0, free)) + ' шт. ' + await sizeLabelOf(sizeId) + ' — свободно ' + Math.max(0, free)};
  }
  try{ if(o.barcode) await compressImage(o.barcode); if(o.photo) await compressImage(o.photo); }
  catch(e){ return {ok:false, error:'Не получилось открыть картинку — сохраните её как JPEG или PNG'}; }
  const c = await cancelShipment(oldId);
  if(!c.ok) return c;
  await Sync.syncNow('изменение заказа');
  const after = await get('shipments', oldId);
  if(!after || after.status !== 'отменена' || after.dirty){
    const noNet = !!after && after.status === 'отменена';
    if(noNet){ after.status = 'новая'; await put('shipments', after); }   // сервер не узнал — оставляем как было
    return {ok:false, error: noNet ? 'Нет связи с сервером — заказ не изменён' : CANCEL_LATE};
  }
  const r = await submitSale(o);
  if(r.ok) try{ await Sync.syncNow('изменённый заказ'); }catch(e){}
  return r;
}
async function sellRecentModels(){
  const mine = new Set((await getAll('shipments')).filter(s=> !s.deletedAt && s.supplierId === Sync.mySupplierId()).map(s=> s.id));
  const ts = new Map((await getAll('shipments')).map(s=> [s.id, s.createdTs || 0]));
  const out = [];
  for(const l of (await getAll('shipmentLines')).filter(l=> !l.deletedAt && mine.has(l.shipmentId)).sort((a, b)=> ts.get(b.shipmentId) - ts.get(a.shipmentId))){
    if(!out.includes(l.modelId)) out.push(l.modelId);
    if(out.length >= 6) break;
  }
  return out;
}
async function sellRender(){
  const models = await modelsMap(), mySup = Sync.mySupplierId();
  const q = xlsNormSafe(document.getElementById('sellSearch').value);
  let ms = Object.values(models).filter(m=> !m.deletedAt && m.supplierId === mySup).sort((a, b)=> modelName(a).localeCompare(modelName(b), 'ru'));
  if(q) ms = ms.filter(m=> xlsNormSafe(modelName(m) + ' ' + (m.sku || '')).includes(q));
  else { const rec = await sellRecentModels(); ms = rec.map(id=> models[id]).filter(Boolean).concat(ms.filter(m=> !rec.includes(m.id))); }
  document.getElementById('sellModels').innerHTML = ms.slice(0, 60).map(m=> `<button type="button" class="chip${m.id === sell.modelId ? ' on' : ''}" data-model="${escapeAttr(m.id)}" onclick="sellPickModel(${jsArg(m.id)})">${escapeHtml(modelName(m))}</button>`).join('') || '<span class="hint">Товаров нет — добавьте их через «Приход»</span>';
  const sz = [];
  if(sell.modelId){
    for(const s of (await getAll('sizes')).filter(s=> s.modelId === sell.modelId && !s.deletedAt).sort((a, b)=> sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel))){
      const inCart = sell.cart.filter(c=> c.sizeId === s.id).reduce((n, c)=> n + c.qty, 0);
      const free = Math.max(0, await freeQty(s.id) - inCart);
      sz.push(`<button type="button" data-size-id="${escapeAttr(s.id)}" class="${s.id === sell.sizeId ? 'on' : ''}"${free ? '' : ' disabled'} onclick="sellPickSize(${jsArg(s.id)})">${escapeHtml(s.sizeLabel)} · свободно ${free}</button>`);
    }
  }
  document.getElementById('sellSizes').innerHTML = sz.join('') || '<span class="hint">' + (sell.modelId ? 'Нет размеров' : 'Выберите товар') + '</span>';
  const rows = [];
  for(let i = 0; i < sell.cart.length; i++){
    const c = sell.cart[i];
    rows.push(`<div class="row-item"><div class="rmain">${escapeHtml(modelName(models[c.modelId] || {}))} · <b>${escapeHtml(await sizeLabelOf(c.sizeId))}</b> × ${c.qty}${c.price !== null ? ' · ' + fmtMoney(c.price) : ''}</div>
      <div class="rside"><button class="icon-btn" onclick="sellRemove(${i})" aria-label="Убрать"><svg class="icon"><use href="#i-trash"/></svg></button></div></div>`);
  }
  document.getElementById('sellCart').innerHTML = rows.join('');
  const th = document.getElementById('sellBarcodeThumb');
  th.innerHTML = sell.barcode ? `<img alt="Скриншот штрихкода" src="${escapeAttr(URL.createObjectURL(sell.barcode))}">` : '';
  document.getElementById('sellPhotoThumb').innerHTML = sell.photo ? `<img alt="Фото к заказу" src="${escapeAttr(URL.createObjectURL(sell.photo))}">` : '';
  document.getElementById('sellErr').textContent = '';
}
const xlsNormSafe = s=> String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
async function sellPickModel(id){
  sell.modelId = id; sell.sizeId = '';
  const m = await get('models', id);
  // цену из карточки подставляем, только если человек не вписал свою
  if(!sell.priceTouched) document.getElementById('sellPrice').value = m && m.price ? String(m.price) : '';
  await sellRender();
}
async function sellPickSize(id){ sell.sizeId = id; await sellRender(); }
/* выбранный, но ещё не добавленный товар — тоже в заказ */
function sellPending(){
  if(!sell.modelId || !sell.sizeId) return null;
  const q = sanitizeQty(document.getElementById('sellQty').value || 1);
  if(q.error) return {error: q.error};
  const pr = String(document.getElementById('sellPrice').value || '').replace(/\s/g, '').replace(',', '.');
  const price = pr === '' ? null : Number(pr);
  if(price !== null && (!isFinite(price) || price < 0)) return {error: 'Цена — число'};
  return {modelId: sell.modelId, sizeId: sell.sizeId, qty: q.n, price};
}
async function sellAdd(){
  const p = sellPending();
  if(!p){ toast('Выберите товар и размер'); return; }
  if(p.error){ toast(p.error); return; }
  sell.cart.push(p); sell.sizeId = ''; document.getElementById('sellQty').value = '1';
  await sellRender();
}
async function sellRemove(i){ sell.cart.splice(i, 1); await sellRender(); }
async function sellPickFile(input, kind){
  const f = input.files && input.files[0]; if(!f) return;
  sell[kind] = f; await sellRender();
}
async function sellSend(){
  const err = document.getElementById('sellErr');
  const lines = sell.cart.slice();
  const p = sellPending();
  if(p && p.error){ err.textContent = p.error; return; }
  if(p) lines.push(p);
  const btn = document.getElementById('sellSend'); btn.disabled = true;
  try{
    const o = {lines, carrier: document.getElementById('sellCarrier').value, comment: document.getElementById('sellComment').value, barcode: sell.barcode, photo: sell.photo};
    const r = sell.editId ? await replaceSale(sell.editId, o) : await submitSale(o);
    if(!r.ok){ err.textContent = r.error; return; }
    closeSell(); toast(sell.editId ? 'Заказ изменён — склад видит новый вариант' : 'Заказ отправлен складу');
    if(typeof renderShipments === 'function') await renderShipments();
  } catch(e){ err.textContent = 'Не получилось: ' + e.message; }
  finally { btn.disabled = false; }
}
/* скриншот можно вставить из буфера (Ctrl+V / «Вставить») */
document.addEventListener('paste', e=>{
  const bg = document.getElementById('sellModalBg');
  if(!bg || !bg.classList.contains('show')) return;
  const item = [...((e.clipboardData && e.clipboardData.items) || [])].find(i=> i.type && i.type.startsWith('image/'));
  if(!item) return;
  e.preventDefault(); sell.barcode = item.getAsFile(); sellRender();
});
