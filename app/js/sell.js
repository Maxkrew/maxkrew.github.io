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
  // проверяем всё заранее: плохая строка не создаёт полузаказ; больше, чем есть, — можно (в минус)
  for(const l of lines){ const q = sanitizeQty(l.qty); if(q.error) return {ok:false, error:q.error}; }
  // картинки сжимаем до заказа: не открылась (HEIC и т.п.) — заказа нет, человек видит причину
  let barcode = null, photo = null;
  try{
    if(o.barcode) barcode = await compressImage(o.barcode);
    if(o.photo) photo = await compressImage(o.photo);
  }catch(e){ return {ok:false, error:'Не получилось открыть картинку — сохраните её как JPEG или PNG'}; }
  if(o.barcode && !barcode) return {ok:false, error:'Не получилось открыть картинку — сохраните её как JPEG или PNG'};
  const id = await newShipment({carrier, comment: o.comment || '', track: o.track || ''});
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
  if(!modelId){
    const prev = mmPendingPhoto ? `<span class="ph-thumb"><img alt="Фото товара" src="${escapeAttr(URL.createObjectURL(mmPendingPhoto))}"></span>` : '';
    box.innerHTML = '<label>Фото товара</label><div class="mm-photo">' + prev + `<label class="btn ghost sm" style="width:auto;"><svg class="icon"><use href="#i-camera"/></svg>${mmPendingPhoto ? 'Заменить' : 'Добавить фото'}<input type="file" id="mmPhotoFile" accept="image/*" hidden onchange="mmPendingPick(this)"></label>` +
      (mmPendingPhoto ? '<button type="button" class="btn ghost sm" id="mmPhotoDel" style="width:auto;" onclick="mmPendingPhoto = null; mmRenderPhoto(null)"><svg class="icon"><use href="#i-trash"/></svg>Убрать</button>' : '') + '</div>';
    return;
  }
  const p = await modelPhoto(modelId);
  const pick = (t)=> `<label class="btn ghost sm" style="width:auto;cursor:pointer;"><svg class="icon"><use href="#i-camera"/></svg>${t}<input type="file" id="mmPhotoFile" accept="image/*" hidden onchange="mmPhotoPick(${jsArg(modelId)}, this)"></label>`;
  box.innerHTML = '<label>Фото товара</label><div class="mm-photo">' + (p
    ? photoThumb(p.id, 'Фото товара') + pick('Заменить') + `<button type="button" class="btn ghost sm" id="mmPhotoDel" style="width:auto;" onclick="mmPhotoDelete(${jsArg(modelId)})"><svg class="icon"><use href="#i-trash"/></svg>Удалить</button>`
    : pick('Добавить фото')) + '</div>';
  fillPhotoThumbs(box);
}
/* фото нового товара: держим до «Сохранить» */
let mmPendingPhoto = null;
function mmPendingPick(input){ const f = input.files && input.files[0]; if(f){ mmPendingPhoto = f; mmRenderPhoto(null); } }
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

/* --- штрихкод со скриншота: служба и трек определяются сами --- */
const BARCODE_READ_SIDE = 2000;
/* Code 128 — им Авито, СДЭК, Яндекс и Почта рисуют штрихкод. ZXing такие скриншоты не читает,
   поэтому разбираем сами: полосы строки картинки → символы, контрольная сумма отсекает ошибки. */
const C128 = '212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232'.split(',');
const C128_INDEX = new Map(C128.map((p, i)=> [p, i]));
function c128Symbol(runs, i){
  if(i + 6 > runs.length) return -1;
  const part = runs.slice(i, i + 6), sum = part.reduce((a, b)=> a + b, 0);
  const v = C128_INDEX.get(part.map(w=> Math.round(w * 11 / sum)).join(''));
  return v === undefined ? -1 : v;
}
/* runs — ширины полос, начиная с чёрной; symbols — значения от старта до контрольной суммы включительно */
function c128Text(symbols){
  let set = symbols[0] - 103, out = '';   // 0 — A, 1 — B, 2 — C
  const body = symbols.slice(1, -1);
  for(const v of body){
    if(v === 99 && set !== 2){ set = 2; continue; }
    if(v === 100 && set !== 1){ set = 1; continue; }
    if(v === 101 && set !== 0){ set = 0; continue; }
    if(v >= 102 || v === 98) continue;
    if(set === 2) out += String(v).padStart(2, '0');
    else if(set === 1) out += String.fromCharCode(v + 32);
    else out += String.fromCharCode(v < 64 ? v + 32 : v - 64);
  }
  return out;
}
function c128FromRuns(runs){
  for(let i = 0; i + 6 <= runs.length; i += 2){
    const start = c128Symbol(runs, i);
    if(start < 103 || start > 105) continue;
    const symbols = [start];
    for(let j = i + 6; ; j += 6){
      const stop = runs.slice(j, j + 7);
      if(stop.length === 7){
        const sum = stop.reduce((a, b)=> a + b, 0);
        if(stop.map(w=> Math.round(w * 13 / sum)).join('') === '2331112'){
          const check = symbols.slice(1, -1).reduce((a, v, k)=> a + v * (k + 1), symbols[0]) % 103;
          if(symbols.length > 2 && check === symbols[symbols.length - 1]) return c128Text(symbols);
          break;
        }
      }
      const v = c128Symbol(runs, j);
      if(v < 0 || v > 102) break;
      symbols.push(v);
    }
  }
  return null;
}
function c128FromCanvas(c){
  const g = c.getContext('2d');
  for(let n = 1; n < 60; n++){
    const data = g.getImageData(0, Math.floor(c.height * n / 60), c.width, 1).data;
    let lo = 255, hi = 0;
    for(let x = 0; x < c.width; x++){ const v = data[x * 4 + 1]; if(v < lo) lo = v; if(v > hi) hi = v; }
    if(hi - lo < 60) continue;
    const mid = (lo + hi) / 2, runs = [];
    let cur = false, w = 0;   // первая полоса — белая и в счёт не идёт
    for(let x = 0; x < c.width; x++){
      const black = data[x * 4 + 1] < mid;
      if(black === cur) w++; else { if(cur) runs.push(w); else if(runs.length) runs.push(w); cur = black; w = 1; }
    }
    const text = c128FromRuns(runs);
    if(text) return text;
  }
  return null;
}
async function barcodeFromImage(file){
  let bm;
  try{ bm = await createImageBitmap(file); }catch(e){ return null; }
  if(window.BarcodeDetector){
    try{ const f = await new BarcodeDetector().detect(bm); if(f.length && f[0].rawValue) return f[0].rawValue; }catch(e){}
  }
  const k = Math.min(1, BARCODE_READ_SIDE / Math.max(bm.width, bm.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bm, 0, 0, c.width, c.height);
  const own = c128FromCanvas(c);
  if(own) return own;
  if(!window.ZXing) return null;
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]));
  for(const Bin of [ZXing.HybridBinarizer, ZXing.GlobalHistogramBinarizer]){
    try{ return reader.decode(new ZXing.BinaryBitmap(new Bin(new ZXing.HTMLCanvasElementLuminanceSource(c)))).getText(); }catch(e){}
  }
  return null;
}
/* Трек — только похожее на номер: ссылка из QR-кода или длинный текст им не считаются. */
const trackFromCode = code=>{ const t = String(code || '').trim(); return t && t.length <= 60 && /^[0-9A-Za-zА-Яа-я-]+$/.test(t) ? t : ''; };
const barcodeDetectText = (track, carrier)=> !track ? 'Штрихкод не прочитался — выберите службу и впишите трек сами'
  : carrier ? 'Определено по штрихкоду: ' + carrier + ', трек ' + trackGroups(track).join(' ')
  : 'Трек прочитан, службу выберите сами';
function sellSetDetect(text){ document.getElementById('sellDetect').textContent = text; }
async function sellSetBarcode(file){
  sell.barcode = file;
  const job = sell.detecting = (async ()=>{
    const code = await barcodeFromImage(file);
    if(job !== sell.detecting) return;   // уже выбрали другой скриншот или закрыли окно
    const track = trackFromCode(code), el = document.getElementById('sellTrack');
    if(track && (!el.value.trim() || sell.trackAuto)){ el.value = track; sell.trackAuto = true; }
    const carrier = carrierByTrack(el.value);
    if(carrier) document.getElementById('sellCarrier').value = carrier;
    sellSetDetect(barcodeDetectText(track && el.value, carrier));
  })();
  await sellRender();
  await job;
}
function sellTrackInput(v){
  sell.trackAuto = false;
  const carrier = carrierByTrack(v);
  if(carrier) document.getElementById('sellCarrier').value = carrier;
}

/* --- окно «Продал» --- */
/* mode 'return' — то же окно для возврата (FoG, 03.11.2026): без цены и без «свободно» — товар едет на склад */
const sell = {cart: [], modelId: '', sizeId: '', barcode: null, photo: null, trackAuto: false, detecting: null, mode: 'sell'};
const sellIsReturn = ()=> sell.mode === 'return';
async function sellStart(mode){
  Object.assign(sell, {cart: [], modelId: '', sizeId: '', barcode: null, photo: null, editId: null, priceTouched: false, trackAuto: false, detecting: null, mode: mode === 'return' ? 'return' : 'sell'});
  document.getElementById('sellTrack').value = ''; sellSetDetect('');
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
  const ret = sellIsReturn();
  document.getElementById('sellTitle').textContent = edit ? 'Изменить заказ' : (ret ? 'Возврат' : 'Продал');
  document.getElementById('sellSendText').textContent = edit ? 'Сохранить изменения' : 'Отправить складу';
  document.getElementById('sellPriceBox').style.display = ret ? 'none' : '';
  document.getElementById('sellAddText').textContent = ret ? 'Ещё товар в этот возврат' : 'Ещё товар в этот заказ';
  document.getElementById('sellComment').placeholder = ret ? 'Комментарий: причина возврата' : 'Комментарий: номер заказа, адрес';
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
  document.getElementById('sellTrack').value = s.track || '';
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
  for(const l of lines){ const q = sanitizeQty(l.qty); if(q.error) return {ok:false, error:q.error}; }
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
  const phByModel = new Map();   // последнее фото товара
  for(const p of (await getAll('photos')).filter(p=> !p.deletedAt && p.kind === 'товар').sort((a, b)=> (a.createdTs || 0) - (b.createdTs || 0))) phByModel.set(p.modelId, p);
  const modelsBox = document.getElementById('sellModels');
  modelsBox.innerHTML = ms.slice(0, 60).map(m=> `<button type="button" class="chip${m.id === sell.modelId ? ' on' : ''}" data-model="${escapeAttr(m.id)}" onclick="sellPickModel(${jsArg(m.id)})">${phByModel.has(m.id) ? `<img alt="" data-ph-src="${escapeAttr(phByModel.get(m.id).id)}">` : ''}<span>${escapeHtml(modelName(m))}</span></button>`).join('') || '<span class="hint">Товаров нет — добавьте их через «Приход»</span>';
  fillPhotoThumbs(modelsBox);
  const sz = [];
  if(sell.modelId){
    for(const s of (await getAll('sizes')).filter(s=> s.modelId === sell.modelId && !s.deletedAt).sort((a, b)=> sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel))){
      if(sellIsReturn()){ sz.push(`<button type="button" data-size-id="${escapeAttr(s.id)}" class="${s.id === sell.sizeId ? 'on' : ''}" onclick="sellPickSize(${jsArg(s.id)})">${escapeHtml(sizeText(s.sizeLabel))}</button>`); continue; }
      const inCart = sell.cart.filter(c=> c.sizeId === s.id).reduce((n, c)=> n + c.qty, 0);
      const free = Math.max(0, await freeQty(s.id) - inCart);
      sz.push(`<button type="button" data-size-id="${escapeAttr(s.id)}" class="${s.id === sell.sizeId ? 'on' : ''}" onclick="sellPickSize(${jsArg(s.id)})">${escapeHtml(sizeText(s.sizeLabel))} · ${free ? 'свободно ' + free : 'нет на складе'}</button>`);
    }
  }
  document.getElementById('sellSizes').innerHTML = sz.join('') || '<span class="hint">' + (sell.modelId ? 'Нет размеров' : 'Выберите товар') + '</span>';
  const rows = [], used = {};
  for(let i = 0; i < sell.cart.length; i++){
    const c = sell.cart[i];
    // сколько из строки сверх свободного (у изменяемого заказа его собственные штуки — свои)
    let minus = 0;
    if(!sellIsReturn()){
      if(!(c.sizeId in used)) used[c.sizeId] = await freeQty(c.sizeId) + (sell.editId ? (await shipmentLines(sell.editId)).filter(l=> l.sizeId === c.sizeId).reduce((n, l)=> n + (Number(l.qty) || 0), 0) : 0);
      minus = Math.min(c.qty, Math.max(0, c.qty - Math.max(0, used[c.sizeId])));
      used[c.sizeId] -= c.qty;
    }
    rows.push(`<div class="row-item"><div class="rmain">${escapeHtml(modelName(models[c.modelId] || {}))} · <b>${escapeHtml(await sizeLabelOf(c.sizeId))}</b> × ${c.qty}${c.price !== null ? ' · ' + fmtMoney(c.price) : ''}${minus ? ` <span class="warn">в минус ${minus} — ждёт поставки</span>` : ''}</div>
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
async function sellPickSize(id){ sell.sizeId = sell.sizeId === id ? '' : id; await sellRender(); }
/* выбранный, но ещё не добавленный товар — тоже в заказ */
function sellPending(){
  if(!sell.modelId || !sell.sizeId) return null;
  const q = sanitizeQty(document.getElementById('sellQty').value || 1);
  if(q.error) return {error: q.error};
  const pr = String(document.getElementById('sellPrice').value || '').replace(/\s/g, '').replace(',', '.');
  const price = pr === '' || sellIsReturn() || (Sync.isStaff && Sync.isStaff()) ? null : Number(pr);   // сотрудник цен не видит
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
  if(kind === 'barcode'){ await sellSetBarcode(f); return; }
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
    if(sell.detecting) await sell.detecting;   // скриншот ещё читается — дождёмся трека
    const o = {lines, carrier: document.getElementById('sellCarrier').value, track: document.getElementById('sellTrack').value, comment: document.getElementById('sellComment').value, barcode: sell.barcode, photo: sell.photo};
    const r = sellIsReturn() ? await submitReturn(o) : sell.editId ? await replaceSale(sell.editId, o) : await submitSale(o);
    if(!r.ok){ err.textContent = r.error; return; }
    closeSell(); toast(sellIsReturn() ? 'Возврат отправлен складу' : sell.editId ? 'Заказ изменён — склад видит новый вариант' : 'Заказ отправлен складу');
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
  e.preventDefault(); sellSetBarcode(item.getAsFile());
});
