/* «Склад»: Возвраты, сканер и камера, проведение операций, начисления партнёрам. */
/* ============================================================
   ВОЗВРАТЫ
   Покупатель вернул товар — он снова физически на складе, но выручку
   и комиссию партнёрам за него один раз уже посчитали в первой продаже.
   Поэтому и приход, и обратное списание при повторной отправке пишутся
   Корректировкой (она не считается в «Расходах»/ABC и не создаёт
   начисление), а не Приходом/Расходом. Метка isReturn — прямо в snap
   (jsonb, уходит в синк как есть), список «Возвраты» — это просто
   Корректировки с этой меткой, у которых ещё нет закрывающей пары.
   ============================================================ */
async function getOpenReturns(){
  const hist = await getAllLive('history');
  const closedRefs = new Set(
    hist.filter(h=> h.snap && h.snap.returnClose && h.snap.returnRef).map(h=> h.snap.returnRef)
  );
  return hist
    .filter(h=> h.type==='Корректировка' && h.snap && h.snap.isReturn && !h.snap.returnClose && !closedRefs.has(h.uid))
    .sort((a,b)=> b.timestamp - a.timestamp);
}
async function getDamagedReturns(){
  const hist = await getAllLive('history');
  return hist
    .filter(h=> h.type==='Корректировка' && h.snap && h.snap.returnClose && h.snap.returnAction==='damaged')
    .sort((a,b)=> b.timestamp - a.timestamp);
}
/* Сколько штук каждого товара — возвраты (ещё не отправлены снова) и
   повреждённые. Обе группы сидят в остатке, но «нормальными» не являются:
   на «Складе» их показываем отдельно. */
function returnsBySku(){ return cachedByVersion('returnsBySku', computeReturnsBySku); }
async function computeReturnsBySku(){
  const hist = await getAllLive('history');
  const seen = new Set(), live = [];
  hist.forEach(h=>{ const k = h.uid || ('#'+h.id); if(!seen.has(k)){ seen.add(k); live.push(h); } });
  const closedRefs = new Set(live.filter(h=> h.snap && h.snap.returnClose && h.snap.returnRef).map(h=> h.snap.returnRef));
  const out = {};
  const slot = sku=> out[sku] = out[sku] || {ret:0, dmg:0};
  for(const h of live){
    if(h.type !== 'Корректировка' || !h.snap) continue;
    if(h.snap.isReturn && !h.snap.returnClose && !closedRefs.has(h.uid)) slot(h.sku).ret += Math.abs(Number(h.delta)||0);
    else if(h.snap.returnClose && h.snap.returnAction === 'damaged') slot(h.sku).dmg += Math.abs(Number(h.qty)||0);
  }
  return out;
}
/* нормальные штуки = остаток минус возвраты и повреждённые */
function normalStock(p, rb){
  const r = rb && rb[p.sku];
  return (Number(p.totalStock)||0) - (r ? r.ret + r.dmg : 0);
}

function switchReturnsSubTab(tab){
  const isDamaged = tab==='damaged';
  const openBtn = document.getElementById('retSubBtnOpen');
  const damBtn = document.getElementById('retSubBtnDamaged');
  const openPanel = document.getElementById('retSubOpen');
  const damPanel = document.getElementById('retSubDamaged');
  if(openBtn) openBtn.classList.toggle('active', !isDamaged);
  if(damBtn) damBtn.classList.toggle('active', isDamaged);
  if(openPanel) openPanel.hidden = isDamaged;
  if(damPanel) damPanel.hidden = !isDamaged;
}
async function renderReturns(){
  const emp = isEmployee();
  let open = await getOpenReturns();
  let damaged = await getDamagedReturns();
  if(emp){
    const from = partnerFromTs();
    open = open.filter(h=> (h.timestamp||0) >= from);
    damaged = damaged.filter(h=> (h.timestamp||0) >= from);
  }
  const sub = document.getElementById('returnsSub');
  if(sub) sub.textContent = emp
    ? 'Товары, которые вы вернули — пока не отправлены покупателю снова'
    : 'Товары, которые вернул покупатель — до повторной отправки';

  const list = document.getElementById('returnsList');
  if(open.length===0){
    list.innerHTML = emptyState('i-inbox','Возвратов нет', emp ? 'Пока ничего не возвращали.' : 'Нажмите «+», чтобы добавить товар, который вернул покупатель.');
  } else {
    /* Партнёру — без галочки «отправлено снова» и без удаления (это делает
       владелец), но с молоточком: пометить повреждённым он может сам. */
    list.innerHTML = open.map(h=> emp ? `
      <div class="row-item">
        <div class="rmain">
          <div class="rname">${escapeHtml(h.name)}</div>
          <div class="rmeta">${escapeHtml(h.sku)} · ${h.date} ${h.time}</div>
        </div>
        <div class="rside">
          <span class="rval pos">+${Math.abs(h.delta)} шт</span>
          <button class="icon-btn" onclick="markReturnDamaged(${h.id})" aria-label="Повреждён"><svg class="icon"><use href="#i-hammer"/></svg></button>
        </div>
      </div>` : `
      <div class="row-item">
        <input type="checkbox" class="inv-chk" aria-label="Отправлено покупателю снова" onchange="resolveReturn(${h.id}, this.checked, this)">
        <div class="rmain">
          <div class="rname">${escapeHtml(h.name)}</div>
          <div class="rmeta">${escapeHtml(h.sku)} · ${h.date} ${h.time}</div>
        </div>
        <div class="rside">
          <span class="rval pos">+${Math.abs(h.delta)} шт</span>
          <button class="icon-btn" onclick="markReturnDamaged(${h.id})" aria-label="Повреждён"><svg class="icon"><use href="#i-hammer"/></svg></button>
          <button class="icon-btn" onclick="deleteReturnEntry(${h.id})" aria-label="Удалить"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>
      </div>`).join('');
  }

  const dlist = document.getElementById('damagedList');
  if(dlist){
    dlist.innerHTML = damaged.length===0
      ? emptyState('i-hammer','Повреждённых нет', 'Молоточек на товаре в «Возвратах» переносит его сюда.')
      : damaged.map(h=> emp ? `
        <div class="row-item">
          <input type="checkbox" class="inv-chk" aria-label="Заменили — вернуть в возвраты" onchange="restoreFromDamaged(${h.id}, this.checked)">
          <div class="rmain">
            <div class="rname">${escapeHtml(h.name)}</div>
            <div class="rmeta">${escapeHtml(h.sku)} · ${h.date} ${h.time}</div>
          </div>
          <div class="rside">
            <span class="rval">${Math.abs(h.qty)} шт</span>
          </div>
        </div>` : `
        <div class="row-item">
          <input type="checkbox" class="inv-chk" aria-label="Заменили — вернуть в возвраты" onchange="restoreFromDamaged(${h.id}, this.checked)">
          <div class="rmain">
            <div class="rname">${escapeHtml(h.name)}</div>
            <div class="rmeta">${escapeHtml(h.sku)} · ${h.date} ${h.time}</div>
          </div>
          <div class="rside">
            <span class="rval">${Math.abs(h.qty)} шт</span>
          </div>
        </div>`).join('');
  }
}

/* Возврат оказался повреждённым: товар физически никуда не делся — просто
   переезжает из списка «Возвраты» в «Повреждённые» (это чисто учёт по
   факту, для памяти, что этот экземпляр ждёт замены). На остаток склада
   это НЕ влияет — закрывающая запись пишется с нулевой дельтой, только
   чтобы закрыть исходную запись в «Возвратах» и перечислить товар сюда. */
async function markReturnDamaged(id){
  const h = await get('history', id);
  if(!h){ await renderReturns(); return; }
  if(isEmployee()){
    /* партнёр — через сервер: сам он в данные склада не пишет */
    const r = await Sync.partnerMarkDamaged(h.uid);
    toast(r.ok ? (h.name + ' — перенесено в «Повреждённые»') : ('Не вышло: ' + r.error));
    await renderReturns();
    return;
  }
  const qty = Math.abs(h.delta);
  const p = await get('products', h.sku);
  await logHistory('Корректировка', h.barcode, p || {sku:h.sku, name:h.name, totalStock:0}, qty, {
    delta: 0,
    extra: {isReturn:true, returnClose:true, returnRef: h.uid, returnAction:'damaged'}
  });
  if(window.Sync && Sync.syncNow) Sync.syncNow('возврат помечен повреждённым');
  toast(h.name + ' — перенесено в «Повреждённые», на складе без изменений');
  await renderReturns();
}

/* Партнёры заменили повреждённый товар — галочка в «Повреждённых» возвращает
   его обратно в «Возвраты». Как и при переносе туда, на остаток склада это
   не влияет (закрывающая запись и так была с нулевой дельтой) — просто
   убираем её (softDelete), и исходная запись возврата, на которую она
   ссылалась, снова окажется «открытой» и всплывёт в списке. */
async function restoreFromDamaged(id, checked){
  if(!checked) return;
  const h = await get('history', id);
  if(!h){ await renderReturns(); return; }
  if(isEmployee()){
    const r = await Sync.partnerRestoreDamaged(h.uid);
    toast(r.ok ? (h.name + ' — возвращено в «Возвраты»') : ('Не вышло: ' + r.error));
    await renderReturns();
    return;
  }
  await softDelete('history', id);
  if(window.Sync && Sync.syncNow) Sync.syncNow('повреждённый возвращён в возвраты');
  toast(h.name + ' — возвращено в «Возвраты», на складе без изменений');
  await renderReturns();
}

/* Выбор товара из склада для возврата — тап по строке сразу добавляет 1 шт. */
function openReturnPick(){
  document.getElementById('returnPickSearch').value = '';
  renderReturnPickList();
  document.getElementById('returnPickModalBg').classList.add('show');
  fitReturnPickList();
}
function closeReturnPick(){
  document.getElementById('returnPickModalBg').classList.remove('show');
}
/* Список занимает ровно место между поиском и клавиатурой: visualViewport —
   это видимая часть экрана без клавиатуры (на iPhone окно под неё не сжимается). */
function fitReturnPickList(){
  const bg = document.getElementById('returnPickModalBg'), list = document.getElementById('returnPickList');
  if(!bg || !list || !bg.classList.contains('show')) return;
  const vv = window.visualViewport;
  const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const top = list.getBoundingClientRect().top;
  list.style.maxHeight = Math.max(120, Math.floor(visibleBottom - top - 16)) + 'px';
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', fitReturnPickList);
  window.visualViewport.addEventListener('scroll', fitReturnPickList);
}
async function renderReturnPickList(){
  const q = (document.getElementById('returnPickSearch').value||'').toLowerCase();
  const all = await getAllLive('products');
  all.sort((a,b)=> a.name.localeCompare(b.name,'ru'));
  const filtered = all.filter(p=> !q || p.name.toLowerCase().includes(q) || String(p.sku).toLowerCase().includes(q));
  const list = document.getElementById('returnPickList');
  if(filtered.length===0){ list.innerHTML = emptyLine('i-search','Ничего не найдено'); return; }
  const rb = await returnsBySku();
  list.innerHTML = filtered.map(p=>{ const r = rb[p.sku]; return `
    <div class="row-item" style="cursor:pointer;" onclick="selectReturnProduct(${jsArg(p.sku)})">
      <div class="rmain">
        <div class="rname">${escapeHtml(p.name)}</div>
        <div class="rmeta">${escapeHtml(p.sku)} · на складе: ${normalStock(p, rb)} шт${r && r.ret ? ` <span class="q-ret-inline">+ ${r.ret} возвр.</span>` : ''}</div>
      </div>
    </div>`; }).join('');
}

/* Тап по товару = сразу +1 шт в «Возвраты», без отдельного шага с
   количеством — вернули больше одной штуки, тапаем по товару ещё раз.
   Список остаётся открытым, чтобы можно было продолжать так же по другим
   товарам подряд. */
async function selectReturnProduct(sku){
  const p = await get('products', sku);
  if(!p) return;
  await logHistory('Корректировка', p.barcode, p, 1, {delta: 1, extra:{isReturn:true}});
  await new Promise(r=> setTimeout(r, 0));
  await recalcStock(p.sku);
  if(window.Sync && Sync.syncNow) Sync.syncNow('добавлен возврат');
  toast(p.name + ' — возврат +1 шт добавлен');
  await renderReturns();
  await renderStock();
  await renderReturnPickList();   // обновить «на складе: N шт» в самом списке
}

/* Отправили этот же возврат покупателю снова: списываем со склада
   Корректировкой (не Расходом — иначе выручка и комиссия партнёрам
   посчитались бы во второй раз), закрывающая запись ссылается на
   исходную через returnRef, ряд уходит из списка. */
async function resolveReturn(id, checked, checkboxEl){
  if(!checked) return;
  const h = await get('history', id);
  if(!h){ await renderReturns(); return; }
  const qty = Math.abs(h.delta);
  const p = await get('products', h.sku);
  const closeUid = await logHistory('Корректировка', h.barcode, p || {sku:h.sku, name:h.name, totalStock:0}, qty, {
    delta: -qty,
    extra: {isReturn:true, returnClose:true, returnRef: h.uid, returnAction:'reship'}
  });
  /* Строка в «Балансе» — только для журнала (см. createReturnBalanceEntry):
     выплата 0 ₽, комиссию за эту продажу уже начислили в первый раз. */
  await createReturnBalanceEntry(p || {sku:h.sku, name:h.name}, qty, closeUid);
  await new Promise(r=> setTimeout(r, 0));
  if(p) await recalcStock(p.sku);
  if(window.Sync && Sync.syncNow) Sync.syncNow('возврат отправлен снова');
  toast(h.name + ' — возврат отправлен, списано ' + qty + ' шт');
  await renderReturns();
  await renderStock();
  const activeSec = document.querySelector('main section.active');
  if(activeSec && activeSec.id === 'sec-balance') await renderBalance(currentBalancePeriod, null);
}

/* Убрать возврат, добавленный по ошибке (ещё не отправлен снова) —
   обычное удаление записи истории: остаток пересчитается сам. */
async function deleteReturnEntry(id){
  await deleteHistoryEntry(id);
  await renderReturns();
}

function switchInputTab(tab){
  const isCam = tab==='camera';
  document.getElementById('tabScannerBtn').classList.toggle('active', !isCam);
  document.getElementById('tabCameraBtn').classList.toggle('active', isCam);
  document.getElementById('scannerStage').style.display = isCam ? 'none' : 'block';
  document.getElementById('cameraStage').style.display = isCam ? 'block' : 'none';
  if(isCam){ startCamera(); } else { stopCamera(); focusForScanner(document.getElementById('scanInput')); }
}

let zxingReader = null, camOn = false;
async function startCamera(){
  if(camOn) return;
  camOn = true;
  zxingReader = new ZXing.BrowserMultiFormatReader();
  let lastCode='', lastTime=0;
  try{
    await zxingReader.decodeFromVideoDevice(null, 'camVideo', async (result, err)=>{
      if(result){
        const text = result.getText();
        const now = Date.now();
        if(text===lastCode && (now-lastTime)<1500) return;
        lastCode=text; lastTime=now;

        if(pendingCam) return; // ждём подтверждения предыдущего скана
        const p = await findProductByBarcode(text);
        if(!p){
          playErrorSound();
          showStatus('Не найден: '+text+'. Ни штрихкода, ни SKU такого нет на «Складе».', 'error');
          return;
        }
        showCamConfirm(p, text);
      }
    });
  }catch(e){
    toast('Камера недоступна: '+e.message);
    switchInputTab('scanner');
  }
}
function stopCamera(){
  camOn = false;
  if(zxingReader){ try{ zxingReader.reset(); }catch(e){} }
  cancelCamConfirm();
}

/* ---- сканер: захват штрихкода в произвольное поле формы ---- */
let scannerCaptureCallback = null;
function openScannerCapture(onResult){
  scannerCaptureCallback = onResult;
  document.getElementById('scanCaptureModalBg').classList.add('show');
  const inp = document.getElementById('scanCaptureInput');
  inp.value = '';
  setTimeout(()=>inp.focus(), 50);
}
function closeScannerCapture(){
  document.getElementById('scanCaptureModalBg').classList.remove('show');
  scannerCaptureCallback = null;
}

/* Сканер шлёт штрихкод, а руками удобнее набрать SKU — он короче и его
   видно на карточке товара. Поэтому ищем и так, и так: сначала по
   штрихкоду (его присылает сканер), потом по SKU. */
/* Сканер для системы — клавиатура, и обычно он просто печатает в поле.
   Но в режиме «Всегда» поле закрыто от системной клавиатуры, и тогда
   символы в value не попадают — сканирование бы отвалилось. Поэтому
   собираем их сами и на Enter берём то, что есть: сначала поле, а если
   оно пустое — накопленное. */
function wireScanInput(input, onScan){
  if(!input) return;
  let buf = '', at = 0;
  input.addEventListener('keydown', (e)=>{
    const now = Date.now();
    if(now - at > 1000) buf = '';   // долгая пауза — прежний набор не в счёт
    at = now;
    if(e.key === 'Enter'){
      e.preventDefault();
      const val = (input.value.trim() || buf.trim());
      buf = '';
      if(val){ onScan(val); input.value = ''; }
      return;
    }
    if(e.key === 'Escape'){ buf = ''; return; }
    if(e.key === 'Backspace'){ buf = buf.slice(0, -1); return; }
    if(e.key && e.key.length === 1) buf += e.key;
  });
}

async function findProductByBarcode(code){
  const all = await getAllLive('products');
  code = String(code).trim();
  if(!code) return null;
  const byBarcode = all.find(p=> String(p.barcode).trim() === code);
  if(byBarcode) return byBarcode;
  const low = code.toLowerCase();
  return all.find(p=> String(p.sku).trim().toLowerCase() === low) || null;
}

let lastScanSku = null, lastScanMode = null, lastScanCount = 0;

async function handleScan(barcode){
  const p = await findProductByBarcode(barcode);
  if(!p){
    playErrorSound();
    showStatus('Не найден: '+barcode+'. Ни штрихкода, ни SKU такого нет на «Складе».', 'error');
    lastScanSku = null; lastScanCount = 0;
    return;
  }
  /* Приход — это приёмка партии, поэтому спрашиваем количество.
     Расход уходит поштучно и применяется сразу. */
  if(currentMode === 'Приход'){
    lastScanSku = null; lastScanMode = null; lastScanCount = 0;
    if(pendingPrihod){
      /* Тот же товар — просто плюс штука. Другой — набранное по прежнему
         записываем, чтобы не потерялось, и спрашиваем про новый. */
      if(pendingPrihod.barcode === String(barcode).trim()){ bumpPrihodQty(); return; }
      await confirmPrihodScan();
    }
    showPrihodConfirm(p, barcode);
    return;
  }

  if(p.sku === lastScanSku && currentMode === lastScanMode){
    lastScanCount++;
  } else {
    lastScanSku = p.sku; lastScanMode = currentMode; lastScanCount = 1;
  }
  const ok = await applyStockOperation(p, barcode, 1, {displayQty: lastScanCount});
  if(!ok){ lastScanSku = null; lastScanCount = 0; }
}

async function applyStockOperation(p, barcode, qty, opts){
  opts = opts || {};
  qty = Math.max(1, Math.round(Number(qty)||1));
  const displayQty = opts.displayQty !== undefined ? opts.displayQty : qty;
  const sign = currentMode === 'Расход' ? '−' : '+';

  /* Остаток берём из базы, а не из объекта в памяти: карточка могла быть
     прочитана до предыдущего скана или до прилёта чужой операции. */
  const current = await recalcStock(p.sku);
  if(current === null) return false;

  if(currentMode === 'Расход' && settings.blockNeg && (current - qty < 0)){
    playErrorSound();
    showStatus('Недостаточно товара «'+p.name+'». На складе осталось: '+current+' шт.', 'error');
    return false;
  }

  /* Звук — сразу, до записи в базу: на iOS «окно жеста» закрывается за
     доли секунды, а дальше идут await'ы к IndexedDB. Запись ниже на
     практике не срывается, а отклик по скану должен быть мгновенным. */
  playSound(currentMode);

  const histUid = await logHistory(currentMode, barcode, p, qty);
  /* Каждый «Расход» = продажа, с неё партнёрам идёт процент. Начисление
     создаётся тут же и появляется у партнёров в «Балансе». */
  if(currentMode === 'Расход') await createSaleCommission(p, qty, histUid, !!opts.singleOrder);
  p.totalStock = await recalcStock(p.sku);
  showLastProduct(p);
  showStatus(p.name+' — '+currentMode.toLowerCase()+' '+sign+displayQty+' шт.', currentMode==='Расход' ? 'danger' : 'success');
  await renderStock();
  const bal = document.querySelector('main section.active');
  if(bal && bal.id === 'sec-balance') renderBalance(currentBalancePeriod, null);
  return true;
}

/* Начисление партнёрам с одной продажи. Сумма = кол-во × цена продажи,
   ставка — по вилке (см. Настройки). Пишется снимком: смена ставок позже
   прошлые начисления не трогает. Начисление общее — его видят все партнёры.
   Несколько штук разом обычно = несколько разных покупателей, поэтому
   ставка берётся по цене одной штуки. Галочка «Единый заказ» — один
   покупатель взял всё сразу: тогда ставка по общей сумме. */
async function createSaleCommission(p, qty, opUid, singleOrder){
  const price = Number(p.price) || 0;
  const amount = price * (Number(qty) || 0);
  if(amount <= 0) return;
  const ratePercent = rateForAmount(singleOrder ? amount : price);
  const now = Date.now();
  await put('orders', {
    uid: newUid(),
    opUid: opUid || '',
    source: 'sale',
    employee: '',            // общий пул — начисление видят все партнёры
    memberId: undefined,
    amount,
    ratePercent,
    commission: Math.round(amount * ratePercent) / 100,
    note: 'Продажа: ' + p.name + (singleOrder && qty > 1 ? ' (единый заказ)' : ''),
    timestamp: now,
    dateKey: todayDateKey(),
    dateDisplay: new Date(now).toLocaleDateString('ru-RU')
  });
  if(window.Sync && Sync.syncNow) Sync.syncNow('продажа → комиссия');
}

/* Возврат отправлен покупателю повторно — строка в «Балансе» нужна только
   для отметки в журнале, что товар снова уехал. Комиссию за него уже
   заплатили при первой продаже, поэтому тут везде 0: и сумма, и ставка,
   и выплата — чтобы «Сумма продаж»/«Продажи по ставкам» тоже не задвоились. */
async function createReturnBalanceEntry(p, qty, opUid){
  const now = Date.now();
  await put('orders', {
    uid: newUid(),
    opUid: opUid || '',
    source: 'return',
    employee: '',
    memberId: undefined,
    amount: 0,
    ratePercent: 0,
    commission: 0,
    note: 'Возврат: ' + p.name,
    timestamp: now,
    dateKey: todayDateKey(),
    dateDisplay: new Date(now).toLocaleDateString('ru-RU')
  });
  if(window.Sync && Sync.syncNow) Sync.syncNow('возврат → баланс');
}

/* Убирает начисления, привязанные к операции (когда операцию удалили). */
async function removeSaleCommission(opUid){
  if(!opUid) return;
  const all = await getAllLive('orders');
  for(const o of all){
    if(o.opUid === opUid) await softDelete('orders', o.uid);
  }
  if(window.Sync && Sync.syncNow) Sync.syncNow('удалена продажа');
}

/* ---- камера: подтверждение количества перед применением ---- */
let pendingCam = null; // {product, barcode}
function showCamConfirm(p, barcode){
  pendingCam = {product:p, barcode};
  document.getElementById('camConfirmName').textContent = p.name;
  document.getElementById('camConfirmStock').textContent = 'На складе сейчас: '+p.totalStock+' шт';
  document.getElementById('camQtyInput').value = 1;
  qtyReplaceNext = true;   // первая же цифра на пультике заменит единицу, а не допишется к ней
  document.getElementById('camSingleOrder').checked = false;
  document.getElementById('camSingleOrderRow').hidden = currentMode !== 'Расход';
  const panel = document.getElementById('camConfirm');
  panel.style.display = 'block';
  if(touchQty) try{ panel.scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){}
}
function adjustCamQty(delta){
  const inp = document.getElementById('camQtyInput');
  let v = Math.max(1, Math.round(Number(inp.value)||1) + delta);
  inp.value = v;
  qtyReplaceNext = true;
}
function cancelCamConfirm(){
  pendingCam = null;
  document.getElementById('camConfirm').style.display = 'none';
}
async function confirmCamScan(){
  if(!pendingCam) return;
  const qty = Math.max(1, Math.round(Number(document.getElementById('camQtyInput').value)||1));
  await applyStockOperation(pendingCam.product, pendingCam.barcode, qty,
    {singleOrder: document.getElementById('camSingleOrder').checked});
  cancelCamConfirm();
}

function showStatus(msg, state){
  const wrap = document.getElementById('statusMsgWrap');
  const el = document.getElementById('statusMsg');
  const icon = document.getElementById('statusMsgIcon');
  wrap.style.display = 'flex';
  wrap.className = 'alert '+state;
  el.textContent = msg;
  icon.innerHTML = (state==='error') ? '<use href="#i-alert"/>' : '<use href="#i-check-circle"/>';
}
function showLastProduct(p){
  document.getElementById('lastProduct').style.display='flex';
  document.getElementById('lastName').textContent = p.name;
  document.getElementById('lastStock').textContent = p.totalStock+' шт';
}
/* Единый AudioContext на всё приложение — создаём/разблокируем один раз при
   первом касании/клике (иначе браузер может молча не давать звуку начаться,
   если AudioContext создан не «внутри» пользовательского жеста, либо создаём
   заново на каждый скан — а к моменту async-операций жест уже «протух»). */
let audioCtx = null;
/* iPhone со сканером — это клавиатура без касаний. Системе такого жеста
   мало, чтобы разрешить проигрывание <audio> из кода: каждый элемент нужно
   один раз «завести» коротким беззвучным воспроизведением ВНУТРИ жеста.
   Флаг помнит, что это уже сделано; сбрасывается при возврате из фона —
   iOS там разрешение снимает. */
let customSoundsPrimed = false;
function unlockAudio(){
  if(!audioCtx){
    try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){}
  }
  if(audioCtx && audioCtx.state === 'suspended'){ audioCtx.resume().catch(()=>{}); }
  primeCustomSounds();
}
/* Без {once:true}: iOS усыпляет звук, когда приложение уходит в фон или
   просто лежит без дела, и одной разблокировки на весь запуск не хватает —
   отсюда «сигнал срабатывает через раз». Вызов дешёвый, зовём на каждое
   касание и на каждый символ сканера. */
document.addEventListener('pointerdown', unlockAudio);
document.addEventListener('keydown', unlockAudio);
/* Вернулись из фона — и AudioContext, и разрешение на <audio> у iOS могли
   сброситься. Помечаем, что элементы надо завести заново при первом же
   символе сканера, и сразу будим контекст. */
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible'){
    customSoundsPrimed = false;
    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
  }
});
window.addEventListener('focus', ()=>{ customSoundsPrimed = false; });
/* Часть браузеров выдаёт постоянное хранилище только после жеста
   пользователя — поэтому пробуем ещё раз при первом касании. */
document.addEventListener('pointerdown', ()=>{ renderStorageStatus(); }, {once:true});

function beep(freq, startSec, durSec, gainVal){
  if(!settings.sound) return;
  unlockAudio();
  if(!audioCtx) return;
  const fire = ()=>{
    try{
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.frequency.value = freq; g.gain.value = gainVal;
      /* +0.03с запаса: тон, поставленный ровно на currentTime сразу после
         resume(), iOS нередко проглатывает — контекст ещё «разгоняется». */
      const t0 = audioCtx.currentTime + startSec + 0.03;
      o.start(t0); o.stop(t0 + durSec);
    }catch(e){}
  };
  /* Пробуждение звука — дело не мгновенное. Раньше сигнал ставился в
     очередь спящему звуку и пропадал: у спящего не идут часы, и время
     начала оказывалось в прошлом. Отсюда «звук через раз». */
  if(audioCtx.state === 'suspended'){
    audioCtx.resume().then(fire).catch(()=>{});
  } else {
    fire();
  }
}

