/* «ФФ»: сканер по желанию (ОПИСАНИЕ §6.4). Сканер-пистолет печатает штрихкод в поле и жмёт
   Enter; камера телефона читает его через ZXing. Без штрихкодов всё работает галочками.
   В приёмке скан размера добавляет штуку в строку, в отправке — отмечает строку «Собрано». */

/* Один заводской штрихкод бывает у разных поставщиков: ищем сначала среди «своих» размеров. */
async function sizesByBarcode(code){
  const c = String(code || '').trim();
  if(!c) return [];
  return (await getAll('sizes')).filter(s=> !s.deletedAt && s.barcode && String(s.barcode).trim() === c);
}
async function sizeByBarcode(code, supplierId){
  const all = await sizesByBarcode(code);
  return all.find(s=> !supplierId || s.supplierId === supplierId) || all[0] || null;
}

async function scanIntoReceipt(receiptId, code){
  const r = await get('receipts', receiptId);
  if(!r) return {ok:false, error:'Нет такой приёмки'};
  if(r.status !== 'черновик') return {ok:false, error:'Приёмка уже разложена — начните новую'};
  const s = await sizeByBarcode(code, r.supplierId);
  if(!s) return {ok:false, error:'Штрихкод ' + code + ' не найден'};
  if(s.supplierId !== r.supplierId) return {ok:false, error:'Это товар другого поставщика'};
  const line = (await receiptLines(receiptId)).find(l=> l.sizeId === s.id);
  if(line){ line.qty += 1; await put('receiptLines', line); }
  else await addReceiptLine(receiptId, s.modelId, s.id, 1);
  return {ok:true, sizeId: s.id};
}

async function scanIntoShipment(shipmentId, code){
  const cands = new Set((await sizesByBarcode(code)).map(s=> s.id));
  if(!cands.size) return {ok:false, error:'Штрихкод ' + code + ' не найден'};
  const line = (await shipmentLines(shipmentId)).find(l=> cands.has(l.sizeId) && !l.collected);
  if(!line) return {ok:false, error:'Этого размера нет в отправке (или уже собран)'};
  await tickCollected(line.id, true);
  return {ok:true, lineId: line.id, cell: line.cellNumber};
}

/* Поля сканирования в карточках приёмки и отправки — перерисовываются, поэтому
   подключаем их после каждой отрисовки. */
function wireFFScanInputs(){
  document.querySelectorAll('input[data-scan-receipt]:not([data-wired])').forEach(el=>{
    el.dataset.wired = '1';
    wireScanInput(el, code=> ffScanReceipt(el.dataset.scanReceipt, code));
  });
  document.querySelectorAll('input[data-scan-shipment]:not([data-wired])').forEach(el=>{
    el.dataset.wired = '1';
    wireScanInput(el, code=> ffScanShipment(el.dataset.scanShipment, code));
  });
}
async function ffScanReceipt(receiptId, code){
  const r = await scanIntoReceipt(receiptId, code);
  if(r.ok){ try{ playSound('Приход'); }catch(e){} toast('+1 · ' + code); }
  else { try{ playErrorSound(); }catch(e){} toast(r.error); }
  await renderReceipts();
  const el = document.querySelector('input[data-scan-receipt="' + CSS.escape(receiptId) + '"]'); if(el) el.focus();
}
async function ffScanShipment(shipmentId, code){
  const r = await scanIntoShipment(shipmentId, code);
  if(r.ok){ try{ playSound('Приход'); }catch(e){} toast('Собрано · ' + (/^П/.test(String(r.cell)) ? 'с пола' : 'ячейка ' + r.cell)); }
  else { try{ playErrorSound(); }catch(e){} toast(r.error); }
  await renderShipments();
  const el = document.querySelector('input[data-scan-shipment="' + CSS.escape(shipmentId) + '"]'); if(el) el.focus();
}

/* ---- камера телефона ---- */
let ffCamReader = null;
async function openCameraScan(onCode){
  let bg = document.getElementById('ffCamBg');
  if(!bg){
    bg = document.createElement('div');
    bg.id = 'ffCamBg'; bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal"><h3>Камера</h3><video id="ffCamVideo" playsinline muted style="width:100%;border-radius:12px;background:#000;max-height:50vh;"></video>' +
      '<p class="hint">Наведите камеру на штрихкод</p><button class="btn ghost" onclick="closeCameraScan()">Закрыть</button></div>';
    document.body.appendChild(bg);
  }
  bg.classList.add('show');
  if(!window.ZXing){ toast('Камера недоступна'); return; }
  ffCamReader = new ZXing.BrowserMultiFormatReader();
  let last = '', lastAt = 0;
  try{
    await ffCamReader.decodeFromVideoDevice(null, 'ffCamVideo', (result)=>{
      if(!result) return;
      const text = result.getText(), now = Date.now();
      if(text === last && now - lastAt < 1500) return;   // тот же код не чаще раза в 1,5 с
      last = text; lastAt = now;
      onCode(text);
    });
  }catch(e){ toast('Камера недоступна: ' + e.message); closeCameraScan(); }
}
function closeCameraScan(){
  if(ffCamReader){ try{ ffCamReader.reset(); }catch(e){} ffCamReader = null; }
  const bg = document.getElementById('ffCamBg'); if(bg) bg.classList.remove('show');
}
