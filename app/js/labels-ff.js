/* Fulbro: единый сканер и наклейки (план 21.11.2026, п. 3).
   Сканер: одна кнопка — камера или пистолет; код сам распознаётся: товар (штрихкод размера) →
   карточка товара; трек заказа → «Отправки» с этим заказом; наклейка ячейки («CELL-…») → ячейка.
   Наклейки: штрихкод Code128 (читают и пистолеты, и камера), термоэтикетка 58×40 или лист A4.
   Товар без штрихкода получает свой (EAN-13 с «2» — внутренний диапазон магазинов). */

/* ---------------- Code128 ---------------- */
const C128W = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112'];
/* текст → коды символов Code128 (B, а длинные цифры — C), с контрольной суммой и «стоп» */
function code128Codes(text){
  const s = String(text || '');
  if(!s || /[^\x20-\x7E]/.test(s)) return null;
  const codes = [];
  const digits = /^\d+$/.test(s);
  if(digits && s.length >= 4){
    let i = 0;
    if(s.length % 2){ codes.push(104, s.charCodeAt(0) - 32, 99); i = 1; }   // нечётное — первая цифра в B, дальше C
    else codes.push(105);
    for(; i < s.length; i += 2) codes.push(Number(s.substr(i, 2)));
  } else {
    codes.push(104);
    for(const ch of s) codes.push(ch.charCodeAt(0) - 32);
  }
  let sum = codes[0];
  for(let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  return codes;
}
/* SVG штрихкода: ширина в модулях, по высоте растягивается */
function code128Svg(text){
  const codes = code128Codes(text);
  if(!codes) return '';
  const quiet = 10; let x = quiet, rects = '';
  for(const c of codes){
    const w = C128W[c];
    for(let k = 0; k < w.length; k++){ const n = Number(w[k]); if(k % 2 === 0) rects += `<rect x="${x}" y="0" width="${n}" height="1"/>`; x += n; }
  }
  const total = x + quiet;
  return `<svg class="c128" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 1" preserveAspectRatio="none" shape-rendering="crispEdges" data-code="${escapeAttr(text)}"><rect x="0" y="0" width="${total}" height="1" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

/* ---------------- свой штрихкод товару ---------------- */
function ean13Check(d12){ let s = 0; for(let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1); return (10 - s % 10) % 10; }
async function ffNewBarcode(){
  for(let t = 0; t < 30; t++){
    let d = '29'; for(let i = 0; i < 10; i++) d += Math.floor(Math.random() * 10);
    const code = d + ean13Check(d);
    if(!(await sizesByBarcode(code)).length) return code;
  }
  throw new Error('Не получилось придумать штрихкод — попробуйте ещё раз');
}
/* размерам без штрихкода — свой; вернёт, сколько выдали */
async function ffEnsureBarcodes(sizes){
  let n = 0;
  for(const s of sizes){
    if(String(s.barcode || '').trim()) continue;
    const x = await get('sizes', s.id); if(!x || x.deletedAt) continue;
    x.barcode = await ffNewBarcode(); await put('sizes', x); s.barcode = x.barcode; n++;
  }
  if(n && window.Sync && Sync.syncNow && typeof ffSoft === 'function') ffSoft(()=> Sync.syncNow('штрихкоды'));
  return n;
}

/* ---------------- ячейки: код наклейки ---------------- */
const CELL_LAT = {'П': 'P', 'Б': 'B', 'Я': 'YA', 'А': 'A', 'В': 'V', 'С': 'S', 'К': 'K', 'Р': 'R', 'О': 'O', 'М': 'M', 'Н': 'N', 'Т': 'T', 'Е': 'E', 'Х': 'H'};
const cellCode = n=> 'CELL-' + String(n).toUpperCase().split('').map(c=> CELL_LAT[c] || c).join('').replace(/[^\x20-\x7E]/g, '');
async function cellByCode(code){
  const k = String(code || '').trim().toUpperCase();
  if(!k.startsWith('CELL-')) return null;
  return (await getAll('cells')).find(c=> !c.deletedAt && cellCode(c.number) === k) || null;
}

/* ---------------- лист наклеек ---------------- */
const lblState = {items: [], fmt: 'thermo', copies: 'one', kind: 'product'};
try{ const f = localStorage.getItem('ffLabelFmt'); if(f === 'a4' || f === 'thermo') lblState.fmt = f; }catch(e){}
function lblHtml(it){
  const svg = code128Svg(it.code);
  return `<div class="fl${it.cell ? ' fl-cell' : ''}">
    ${it.cell ? `<div class="fl-big">${escapeHtml(it.title)}</div>` : `<div class="fl-nm">${escapeHtml(it.title)}</div>${it.sub ? `<div class="fl-sub">${escapeHtml(it.sub)}</div>` : ''}`}
    <div class="fl-bc">${svg || '<span class="fl-bad">Код не печатается</span>'}</div>
    <div class="fl-cd">${escapeHtml(it.code)}</div></div>`;
}
function lblRender(){
  const ov = document.getElementById('labelSheetOverlay'), grid = document.getElementById('labelSheetGrid');
  const list = [];
  for(const it of lblState.items){ const n = lblState.copies === 'stock' ? Math.max(0, it.stock || 0) : 1; for(let i = 0; i < n; i++) list.push(it); }
  grid.className = 'label-sheet ff-labels fmt-' + lblState.fmt;
  grid.innerHTML = list.map(lblHtml).join('') || '<div class="hint" style="padding:16px;">Печатать нечего — на складе 0 шт.</div>';
  let bar = document.getElementById('ffLblBar');
  if(!bar){ bar = document.createElement('div'); bar.id = 'ffLblBar'; ov.insertBefore(bar, grid); }
  const seg = (k, opts)=> `<div class="period-seg fl-seg">${opts.map(([v, t])=> `<button type="button" data-${k}="${v}" class="${lblState[k] === v ? 'active' : ''}" onclick="lblSet('${k}','${v}')">${t}</button>`).join('')}</div>`;
  bar.innerHTML = `<div class="fl-bar-row"><button type="button" class="icon-btn" onclick="closeFFLabels()" aria-label="Назад"><svg class="icon"><use href="#i-arrow-left"/></svg></button>
      <b class="fl-count">${list.length} ${ruPlural(list.length, 'наклейка', 'наклейки', 'наклеек')}</b>
      <button type="button" class="btn primary sm" id="ffLblPrint" style="width:auto;" onclick="window.print()"${list.length ? '' : ' disabled'}><svg class="icon"><use href="#i-printer"/></svg>Печать</button></div>
    ${seg('fmt', [['thermo', 'Этикетка 58×40'], ['a4', 'Лист A4']])}
    ${lblState.kind === 'product' ? seg('copies', [['one', 'По 1 штуке'], ['stock', 'Сколько на складе']]) : ''}`;
  let st = document.getElementById('ffLblPage');
  if(!st){ st = document.createElement('style'); st.id = 'ffLblPage'; document.head.appendChild(st); }
  st.textContent = lblState.fmt === 'thermo' ? '@media print{@page{size:58mm 40mm;margin:0}}' : '@media print{@page{size:A4;margin:6mm}}';
  ov.classList.add('ff-lbl-on');
}
function lblSet(k, v){ lblState[k] = v; if(k === 'fmt') try{ localStorage.setItem('ffLabelFmt', v); }catch(e){} lblRender(); }
function openFFLabels(items, kind){
  lblState.items = items; lblState.kind = kind || 'product'; lblState.copies = 'one';
  const ov = document.getElementById('labelSheetOverlay'); if(!ov) return;
  lblRender();
  ov.hidden = false; document.body.classList.add('labels-open');
  try{ ov.scrollTo(0, 0); }catch(e){}
}
function closeFFLabels(){
  const ov = document.getElementById('labelSheetOverlay'); if(ov){ ov.hidden = true; ov.classList.remove('ff-lbl-on'); }
  document.body.classList.remove('labels-open');
}

/* наклейки товаров: modelIds — какие; без штрихкода — выдаём свой */
async function ffPrintModelLabels(modelIds){
  const models = await modelsMap();
  const sizes = (await getAll('sizes')).filter(s=> !s.deletedAt && modelIds.includes(s.modelId) && models[s.modelId] && !models[s.modelId].deletedAt)
    .sort((a, b)=> modelName(models[a.modelId]).localeCompare(modelName(models[b.modelId]), 'ru') || sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel));
  if(!sizes.length){ toast('Нет товаров для наклеек'); return; }
  let given = 0;
  try{ given = await ffEnsureBarcodes(sizes); }catch(e){ toast(e.message); return; }
  const items = [];
  for(const s of sizes){
    const m = models[s.modelId];
    items.push({title: modelName(m), sub: [s.sizeLabel && s.sizeLabel !== 'Единый' ? s.sizeLabel : '', m.sku || ''].filter(Boolean).join(' · '), code: String(s.barcode).trim(), stock: typeof ffSizeStock === 'function' ? await ffSizeStock(s.id) : 0});
  }
  openFFLabels(items, 'product');
  if(given) toast('Товарам без штрихкода выдан свой: ' + given);
}
/* наклейки ячеек (склад) */
async function ffPrintCellLabels(){
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt).sort((a, b)=> typeof cmpCellNumber === 'function' ? cmpCellNumber(a.number, b.number) : String(a.number).localeCompare(String(b.number), 'ru', {numeric: true}));
  if(!cells.length){ toast('Ячеек пока нет'); return; }
  openFFLabels(cells.map(c=> ({title: (typeof isFloorCell === 'function' && isFloorCell(c) ? 'Пол ' : '') + c.number, code: cellCode(c.number), cell: true})), 'cell');
}
/* все товары с экрана «Товары» (у склада — с учётом выбранного поставщика) */
async function ffPrintAllLabels(){
  const owner = typeof isOwnerRole === 'function' && isOwnerRole();
  const sup = owner ? ((document.getElementById('ffSupplierFilter') || {}).value || '') : Sync.mySupplierId();
  const ids = Object.values(await modelsMap()).filter(m=> !m.deletedAt && (!sup || m.supplierId === sup)).map(m=> m.id);
  return ffPrintModelLabels(ids);
}

/* ---------------- единый сканер ---------------- */
async function ffScanAny(raw){
  const code = String(raw || '').trim();
  if(!code) return {ok: false};
  // 1) ячейка
  const cell = await cellByCode(code);
  if(!cell && /^CELL-/i.test(code) && !(typeof isOwnerRole === 'function' && isOwnerRole())) return ffScanMiss('Это наклейка ячейки — она для склада');
  if(cell){
    if(!(typeof isOwnerRole === 'function' && isOwnerRole())) return ffScanMiss('Это наклейка ячейки ' + cell.number + ' — она для склада');
    ffScanHit(); closeFFScanner();
    showSection('cells'); if(typeof openCellModal === 'function') await openCellModal(cell.number);
    return {ok: true, kind: 'cell', id: cell.number};
  }
  // 2) товар
  const sz = typeof sizeByBarcode === 'function' ? await sizeByBarcode(code, typeof isSupplierRole === 'function' && isSupplierRole() ? Sync.mySupplierId() : null) : null;
  if(sz){
    const m = await get('models', sz.modelId);
    if(m && !m.deletedAt){
      ffScanHit(); closeFFScanner();
      showSection('stock'); await openModelModal(m.id);
      const n = typeof ffSizeStock === 'function' ? await ffSizeStock(sz.id) : null;
      toast(modelName(m) + (sz.sizeLabel && sz.sizeLabel !== 'Единый' ? ' ' + sz.sizeLabel : '') + (n !== null ? ' — на складе ' + n + ' шт.' : ''));
      return {ok: true, kind: 'product', id: m.id};
    }
  }
  // 3) трек заказа
  const k = trackKey(code);
  if(k.length >= 6){
    const sh = (await getAll('shipments')).filter(s=> !s.deletedAt && trackKey(s.track) === k).sort((a, b)=> (b.createdTs || 0) - (a.createdTs || 0))[0];
    if(sh){
      ffScanHit(); closeFFScanner();
      showSection('shipments'); if(typeof renderShipments === 'function') await renderShipments();
      const inp = document.getElementById('shSearch'); if(inp){ inp.value = sh.track; if(typeof arRefresh === 'function') await arRefresh(); else await renderShipments(); }
      toast('Заказ ' + sh.track + (sh.status ? ' — ' + sh.status : ''));
      return {ok: true, kind: 'shipment', id: sh.id};
    }
  }
  return ffScanMiss('По коду ' + code + ' ничего не нашлось');
}
function ffScanHit(){ try{ if(typeof playSound === 'function') playSound('Приход'); }catch(e){} }
function ffScanMiss(msg){ try{ if(typeof playErrorSound === 'function') playErrorSound(); }catch(e){} toast(msg); const r = document.getElementById('ffScanRes'); if(r) r.textContent = msg; return {ok: false, msg}; }

/* окно сканера: камера + поле (для пистолета и ручного ввода) */
let ffScanReader = null;
async function openFFScanner(){
  let bg = document.getElementById('ffScanBg');
  if(!bg){
    bg = document.createElement('div'); bg.id = 'ffScanBg'; bg.className = 'modal-bg'; bg.setAttribute('data-close', 'closeFFScanner');
    bg.innerHTML = `<div class="modal ff-scan">
      <div class="modal-grip"></div>
      <div class="head-row modal-head"><button type="button" class="icon-btn" data-back onclick="closeFFScanner()" aria-label="Назад"><svg class="icon"><use href="#i-arrow-left"/></svg></button><h3 style="flex:1;margin:0 0 0 8px;">Сканер</h3></div>
      <video id="ffScanVideo" playsinline muted></video>
      <p class="hint">Наведите камеру на штрихкод товара, трек заказа или наклейку ячейки</p>
      <form class="field-row" onsubmit="event.preventDefault();const i=document.getElementById('ffScanInput');ffScanAny(i.value);i.value='';">
        <input type="text" id="ffScanInput" placeholder="или введите / отсканируйте пистолетом" autocomplete="off" enterkeyhint="go" aria-label="Код">
        <button type="submit" class="btn primary" style="width:auto;">Найти</button></form>
      <div class="hint" id="ffScanRes" aria-live="polite"></div></div>`;
    document.body.appendChild(bg);
  }
  document.getElementById('ffScanRes').textContent = '';
  bg.classList.add('show'); document.documentElement.classList.add('sheet-open');
  if(!window.ZXing || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)){ document.getElementById('ffScanVideo').hidden = true; try{ document.getElementById('ffScanInput').focus(); }catch(e){} return; }
  document.getElementById('ffScanVideo').hidden = false;
  ffScanReader = new ZXing.BrowserMultiFormatReader();
  let last = '', lastAt = 0, busy = false;
  try{
    await ffScanReader.decodeFromVideoDevice(null, 'ffScanVideo', async result=>{
      if(!result || busy) return;
      const t = result.getText(), now = Date.now();
      if(t === last && now - lastAt < 2000) return;
      last = t; lastAt = now; busy = true;
      try{ await ffScanAny(t); } finally{ busy = false; }
    });
  }catch(e){ document.getElementById('ffScanVideo').hidden = true; const r = document.getElementById('ffScanRes'); if(r) r.textContent = 'Камера недоступна — введите код в поле'; }
}
function closeFFScanner(){
  if(ffScanReader){ try{ ffScanReader.reset(); }catch(e){} ffScanReader = null; }
  const bg = document.getElementById('ffScanBg'); if(bg) bg.classList.remove('show');
  if(!document.querySelector('.modal-bg.show')) document.documentElement.classList.remove('sheet-open');
}
