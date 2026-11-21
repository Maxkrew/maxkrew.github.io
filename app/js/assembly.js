/* Fulbro: «Сборка» на экране «Отправки» у склада (по образцу, который показал владелец,
   24.10.2026): фильтр по поставщикам с числом заказов, «собрано X / Y, осталось N», большая
   кнопка «Собран» на заказе, «Выбрать» — собрать несколько разом, «Собранные сегодня». */
let shFilter = '';                 // поставщик в фильтре; '' — все
let shSelectMode = false;          // режим «Выбрать»
let shModelFilter = '';            // товар в фильтре; '' — все
let shVisible = [];                // заказы, которые сейчас на экране (с учётом фильтров)
let shCarrierFilter = '';          // служба в фильтре; '' — все
let shFiltersHtml = '';            // содержимое шторки «Фильтр» (собирает assemblyHeader)
const shSelected = new Set();

/* Когда отправку собрали: последняя отметка «Собрано» её строк. */
async function shCollectedAt(s){
  let t = 0;
  for(const l of await shipmentLines(s.id)) if(l.collected) t = Math.max(t, Number(l.collectedTs) || 0);
  return t;
}
async function shCollectedToday(list){
  const from = dayStart(Date.now()), out = [];   // dayStart — js/analytics.js
  for(const s of list) if(s.status === 'собрана' && await shCollectedAt(s) >= from) out.push(s);
  return out;
}

/* Шапка сборки: фильтр, счётчик, «Выбрать». open — несобранные (все поставщики). */
async function assemblyHeader(open, all){
  const sups = await ffSuppliersMap();
  const count = {}; for(const s of open) count[s.supplierId] = (count[s.supplierId] || 0) + 1;
  // все действующие поставщики (и без открытых заказов — для статистики); сначала те, у кого есть заказы
  const ids = Object.values(sups).filter(s=> !s.deletedAt && !s.archived).map(s=> s.id)
    .sort((a, b)=> ((count[b] || 0) > 0) - ((count[a] || 0) > 0) || String((sups[a] || {}).name).localeCompare(String((sups[b] || {}).name), 'ru'));
  if(shFilter && !ids.includes(shFilter)) ids.push(shFilter);
  const chip = (id, label, n)=> `<button type="button" class="as-chip${shFilter === id ? ' on' : ''}" data-as-filter="${escapeAttr(id)}" onclick="shSetFilter(${jsArg(id)})">${escapeHtml(label)} <b>${n}</b></button>`;
  const chips = chip('', 'Все', open.length) + ids.map(id=> chip(id, (sups[id] || {}).name || 'Поставщик', count[id] || 0)).join('');
  const mine = list=> list.filter(s=> (!shFilter || s.supplierId === shFilter) && (!shCarrierFilter || s.carrier === shCarrierFilter));
  const left = mine(open).length, done = (await shCollectedToday(mine(all))).length, total = left + done;
  const pct = total ? Math.round(done / total * 100) : 0;
  const dis = shSelected.size ? '' : ' disabled', allOn = shVisible.length && shVisible.every(id=> shSelected.has(id));
  const selBar = shSelectMode ? `<div class="as-selbar"><span>Выбрано: <b>${shSelected.size}</b></span>
      <div class="as-selbtns"><button class="btn ghost sm" style="width:auto;" id="asSelectAll" onclick="shSelectAll()">${allOn ? 'Снять все' : 'Выбрать все'}</button>
      <button class="btn ghost sm" style="width:auto;" id="asPrintSel" onclick="shPrintSelected()"${dis}>🖨 Печать</button>
      <button class="btn ghost sm" style="width:auto;" id="asSaveSel" onclick="shSaveBarcodes()"${dis}>В галерею</button>
      <button class="btn primary" style="width:auto;" id="asCollectSel" onclick="shCollectSelected()"${dis}>Собрать выбранные</button></div></div>` : '';
  // фильтр по службе — службы, у которых есть несобранные заказы (с учётом поставщика)
  const inSup = open.filter(s=> !shFilter || s.supplierId === shFilter), byCarrier = {};
  for(const s of inSup) byCarrier[s.carrier] = (byCarrier[s.carrier] || 0) + 1;
  if(shCarrierFilter && !byCarrier[shCarrierFilter]) byCarrier[shCarrierFilter] = 0;
  const cChip = (id, label, n)=> `<button type="button" class="as-chip${shCarrierFilter === id ? ' on' : ''}" data-as-carrier="${escapeAttr(id)}" onclick="shSetCarrier(${jsArg(id)})">${escapeHtml(label)} <b>${n}</b></button>`;
  const cChips = cChip('', 'Все службы', inSup.length) + Object.keys(byCarrier).sort((a, b)=> a.localeCompare(b, 'ru')).map(c=> cChip(c, c, byCarrier[c])).join('');
  // фильтр по товару — все модели склада (с учётом поставщика) и сколько несобранных заказов с ними
  const models = await modelsMap(), byModel = {};
  const openIds = new Set(mine(open).map(s=> s.id));
  for(const l of await getAll('shipmentLines')) if(!l.deletedAt && !l.collected && openIds.has(l.shipmentId)) (byModel[l.modelId] || (byModel[l.modelId] = new Set())).add(l.shipmentId);
  const n = id=> (byModel[id] || {size: 0}).size;
  const mOpts = Object.values(models).filter(m=> !m.deletedAt && (!shFilter || m.supplierId === shFilter) || m.id === shModelFilter)
    .sort((a, b)=> (n(b.id) > 0) - (n(a.id) > 0) || modelName(a).localeCompare(modelName(b), 'ru'))
    .map(m=> `<option value="${escapeAttr(m.id)}" data-n="${n(m.id)}"${shModelFilter === m.id ? ' selected' : ''}>${escapeHtml(modelName(m))} — ${n(m.id)}</option>`).join('');
  const modelSel = `<select id="asModel" data-products="filter" onchange="shSetModel(this.value)"><option value="">Все товары</option>${mOpts}</select>`;
  /* 21.11.2026 (проект v3): фильтры и «Выбрать» — в шторке «Фильтр» (кнопка у поиска внизу), на экране — только счётчик */
  shFiltersHtml = `<div class="sh-f-title">Поставщик</div><div class="as-chips">${chips}</div><div class="sh-f-title">Служба</div><div class="as-chips as-carriers">${cChips}</div><div class="sh-f-title">Товар</div><div class="field as-model">${modelSel}</div>
    <div class="sh-f-title">Действия</div><div class="as-tools"><button type="button" class="btn ghost${shSelectMode ? ' on' : ''}" id="asSelectBtn" onclick="uiSheetClose();shToggleSelect()">${shSelectMode ? 'Отменить выбор' : '☑ Выбрать несколько — печать, собрать разом'}</button></div>`;
  return `<div class="card as-progress"><b class="as-count">${done} / ${total}</b><span class="bar"><i style="width:${pct}%"></i></span><span class="rmeta">осталось ${left}</span></div>${selBar}`;
}
async function shSetFilter(id){ shFilter = id; await renderShipments(); }
async function shSetModel(id){ shModelFilter = id; await renderShipments(); }
async function shSetCarrier(id){ shCarrierFilter = id; await renderShipments(); }
async function shToggleSelect(){ shSelectMode = !shSelectMode; shSelected.clear(); await renderShipments(); }
async function shSelectOne(id, on){
  if(on) shSelected.add(id); else shSelected.delete(id);
  shSelBarSync();
}
function shSelBarSync(){
  for(const id of ['asCollectSel', 'asPrintSel', 'asSaveSel']){ const b = document.getElementById(id); if(b) b.disabled = !shSelected.size; }
  const n = document.querySelector('.as-selbar b'); if(n) n.textContent = shSelected.size;
  const a = document.getElementById('asSelectAll'); if(a) a.textContent = shVisible.length && shVisible.every(id=> shSelected.has(id)) ? 'Снять все' : 'Выбрать все';
  document.querySelectorAll('input[data-select]').forEach(c=> { c.checked = shSelected.has(c.dataset.select); });
}
/* «Выбрать все заказы» — те, что сейчас на экране: фильтры по поставщику, службе и товару действуют (FoG, 17.11.2026) */
function shSelectAll(){
  if(shVisible.length && shVisible.every(id=> shSelected.has(id))) shVisible.forEach(id=> shSelected.delete(id));
  else shVisible.forEach(id=> shSelected.add(id));
  shSelBarSync();
}

/* Скриншоты штрихкодов выбранных заказов: [{shipment, photos:[blob-url]}] */
async function shBarcodeSheets(ids){
  const sups = await ffSuppliersMap(), models = await modelsMap(), out = [];
  for(const id of ids){
    const s = await get('shipments', id); if(!s || s.deletedAt) continue;
    const imgs = [];
    for(const p of await shipmentPhotos(id)) if(p.kind === 'штрихкод'){ const u = await photoUrl(p.id); if(u) imgs.push({id: p.id, url: u}); }
    const items = [];
    for(const l of await shipmentLines(id)) items.push(modelName(models[l.modelId] || {}) + ' ' + sizeText(((await get('sizes', l.sizeId)) || {}).sizeLabel || '') + ' × ' + l.qty);
    out.push({shipment: s, supplier: (sups[s.supplierId] || {}).name || '', imgs, items});
  }
  return out;
}
/* «Печать»: все выбранные заказы — по странице на заказ: штрихкод крупно, под ним служба, трек, что внутри. */
async function shPrintSelected(){
  const ids = [...shSelected];
  if(!ids.length){ toast('Сначала выберите заказы'); return; }
  const sheets = await shBarcodeSheets(ids), withCode = sheets.filter(x=> x.imgs.length);
  if(!withCode.length){ toast('У выбранных заказов нет скриншота штрихкода'); return; }
  const old = document.getElementById('printSheet'); if(old) old.remove();
  const el = document.createElement('div'); el.id = 'printSheet';
  el.innerHTML = withCode.map(x=> `<section class="ps-page" data-print-shipment="${escapeAttr(x.shipment.id)}">
      ${x.imgs.map(i=> `<img src="${escapeAttr(i.url)}" alt="Штрихкод">`).join('')}
      <div class="ps-meta"><b>${escapeHtml(x.shipment.carrier || '')}</b>${x.supplier ? ' · ' + escapeHtml(x.supplier) : ''}${x.shipment.track ? '<br>Трек: <b data-track data-copy="' + escapeAttr(String(x.shipment.track).trim()) + '" role="button">' + escapeHtml(x.shipment.track) + '</b>' : ''}<br>${x.items.map(escapeHtml).join('<br>')}</div></section>`).join('');
  document.body.appendChild(el);
  await Promise.all([...el.querySelectorAll('img')].map(i=> i.complete ? 0 : new Promise(res=> { i.onload = i.onerror = res; setTimeout(res, 4000); })));
  const skipped = sheets.length - withCode.length;
  if(skipped) toast('Без штрихкода пропущено: ' + skipped);
  const done = ()=> { const p = document.getElementById('printSheet'); if(p) p.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  try{ window.print(); }catch(e){ toast('Печать недоступна на этом устройстве — используйте «В галерею»'); done(); }
  return {pages: withCode.length, skipped};
}
/* «В галерею»: картинки штрихкодов выбранных заказов — в «Поделиться» телефона («Сохранить изображения»); нет — скачиваются. */
async function shBarcodeFiles(ids){
  const files = [];
  for(const x of await shBarcodeSheets(ids)){
    let k = 0;
    for(const i of x.imgs){
      try{
        const blob = await (await fetch(i.url)).blob();
        const name = (String(x.shipment.carrier || 'заказ') + '-' + (x.shipment.track || x.shipment.id.slice(0, 6)) + (x.imgs.length > 1 ? '-' + (++k) : '')).replace(/[^0-9A-Za-zА-Яа-я_-]+/g, '_') + '.jpg';
        files.push(new File([blob], name, {type: blob.type || 'image/jpeg'}));
      }catch(e){}
    }
  }
  return files;
}
async function shSaveBarcodes(){
  const ids = [...shSelected];
  if(!ids.length){ toast('Сначала выберите заказы'); return; }
  const files = await shBarcodeFiles(ids);
  if(!files.length){ toast('У выбранных заказов нет скриншота штрихкода'); return; }
  try{
    if(navigator.canShare && navigator.canShare({files})){ await navigator.share({files}); toast('Выберите «Сохранить изображения» — штрихкоды лягут в галерею'); return files.length; }
  }catch(e){ if(e && e.name === 'AbortError') return 0; }
  for(const f of files){ const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); await new Promise(r=> setTimeout(r, 250)); }
  toast('Скачано штрихкодов: ' + files.length);
  return files.length;
}
/* «Собран»: отметить все строки отправки. Строке без ячейки (товара не хватает) — нельзя. */
async function shCollectAll(id){
  const lines = (await shipmentLines(id)).filter(l=> !l.collected);
  if(lines.some(l=> !l.cellNumber)) return {ok:false, error:'В отправке есть товар, которого нет на складе — отправьте его в минус или уберите'};
  for(const l of lines){ const r = await tickCollected(l.id, true); if(!r.ok) return r; }
  return {ok:true, n: lines.length};
}
async function shCollect(id){
  const r = await shCollectAll(id);
  if(!r.ok){ toast(r.error); return; }
  toast('Собрано'); await renderShipments();
}
async function shCollectSelected(){
  let ok = 0, bad = 0;
  for(const id of [...shSelected]){ const r = await shCollectAll(id); if(r.ok) ok++; else bad++; }
  shSelected.clear(); shSelectMode = false;
  toast('Собрано: ' + ok + (bad ? ' · не собрано ' + bad + ' — не хватает товара' : ''));
  await renderShipments();
}

/* Звук нового заказа (Настройки → «Звук новых заказов»): после обмена склад слышит сигнал
   и видит подсказку, если поставщик оформил новый заказ. Какие заказы уже видели — в памяти
   телефона: при первом запуске ничего не звенит. */
const ORDERS_SEEN_KEY = 'ff-orders-seen';
async function checkNewOrders(){
  if(!(window.Sync && Sync.role && Sync.role() === 'owner')) return [];
  const fresh = (await getAll('shipments')).filter(s=> !s.deletedAt && s.createdBy === 'supplier' && s.status === 'новая');
  let seen = null;
  try{ seen = JSON.parse(localStorage.getItem(ORDERS_SEEN_KEY) || 'null'); }catch(e){}
  const known = new Set(seen || []);
  const added = seen ? fresh.filter(s=> !known.has(s.id)) : [];
  try{ localStorage.setItem(ORDERS_SEEN_KEY, JSON.stringify([...new Set([...known, ...fresh.map(s=> s.id)])].slice(-2000))); }catch(e){}
  if(added.length && settings.orderSound){
    const sups = await ffSuppliersMap();
    toast(added.length === 1 ? 'Новый заказ от «' + ((sups[added[0].supplierId] || {}).name || 'поставщика') + '»' : 'Новых заказов: ' + added.length);
    const was = settings.sound; settings.sound = true;
    try{ beep(880, 0, 0.12, 0.12); beep(1175, 0.16, 0.12, 0.12); beep(1568, 0.32, 0.18, 0.12); }catch(e){}
    settings.sound = was;
    try{ if(navigator.vibrate) navigator.vibrate([200, 100, 200]); }catch(e){}
  }
  return added;
}
async function setOrderSound(on){
  settings.orderSound = !!on;
  await saveAppSettings();
  if(on){ const was = settings.sound; settings.sound = true; try{ beep(880, 0, 0.12, 0.12); }catch(e){} settings.sound = was; }   // разбудить звук касанием
  toast(on ? 'Звук новых заказов включён' : 'Звук новых заказов выключен');
}
