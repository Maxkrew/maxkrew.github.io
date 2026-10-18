/* «Склад»: Товары, склад, инвентаризация, история, накладные поставщику. */
/* ============================================================
   ЭКОНОМИКА ОПЕРАЦИИ
   Раньше прибыль за прошлые периоды считалась по ЦЕНАМ ИЗ КАРТОЧКИ ТОВАРА
   НА СЕЙЧАС: подняли цену — и выручка позапрошлого месяца в отчётах тоже
   выросла, а удалили товар — его продажи вовсе пропадали из статистики.
   Теперь каждая операция несёт снимок своих цен и ставок, и отчёты за
   закрытый период больше не меняются задним числом.
   ============================================================ */
function priceSnapshot(p){
  return {
    price: Number(p.price)||0,
    cost: Number(p.cost)||0,
    taxPercent: Number(p.taxPercent)||0,
    commissionPercent: Number(p.commissionPercent)||0,
    packaging: Number(p.packaging)||0,
    deliveryDiscount: Number(p.deliveryDiscount)||0
  };
}

/* Считает деньги по одной записи истории. Источник цен: снимок в самой
   записи, а если его нет (операция сделана до этого обновления) — текущая
   карточка товара, как было раньше. Если нет ни того, ни другого —
   вернёт null, и запись в расчёте не участвует. */
function opEconomics(h, product){
  const src = h.snap || product;
  if(!src) return null;
  const qty = Number(h.qty)||0;
  const revenue = qty*(Number(src.price)||0);
  const cost = qty*(Number(src.cost)||0);
  const gross = revenue - cost;
  const tax = revenue*((Number(src.taxPercent)||0)/100);
  const comm = revenue*((Number(src.commissionPercent)||0)/100);
  const pack = qty*(Number(src.packaging)||0);
  const delivDiscount = qty*(Number(src.deliveryDiscount)||0);
  return {qty, revenue, cost, gross, tax, comm, pack, delivDiscount,
          net: gross - tax - comm - pack - delivDiscount};
}

async function logHistory(type, barcode, p, qty, opts){
  opts = opts || {};
  const now = new Date();
  const delta = (opts.delta !== undefined)
      ? opts.delta
      : (type === 'Расход' ? -Math.abs(qty) : Math.abs(qty));
  const uid = newUid();
  /* opts.extra — доп. метки прямо в снимке (jsonb, уходит в синк как есть),
     не задевая расчёт денег: opEconomics читает только свои поля снимка. */
  const snap = opts.extra ? Object.assign(priceSnapshot(p), opts.extra) : priceSnapshot(p);
  await put('history', {
    uid,
    date: now.toLocaleDateString('ru-RU'),
    time: now.toLocaleTimeString('ru-RU'),
    timestamp: now.getTime(),
    type, barcode, sku:p.sku, name:p.name, qty,
    delta,
    legacy: false,
    stockAfter: (Number(p.totalStock)||0) + delta,
    snap
  });
  return uid;
}

/* Порядок на «Складе» — у каждого телефона свой, запоминается. */
function stockSort(){
  try{ const v = localStorage.getItem('ff-stock-sort'); return ['name','asc','desc'].includes(v) ? v : 'name'; }catch(e){ return 'name'; }
}
function setStockSort(v){
  try{ localStorage.setItem('ff-stock-sort', v); }catch(e){}
  renderStock();
}

/* ---- окошко фильтра: сортировка + поставщик за одной кнопкой ---- */
const STOCK_SORT_NAMES = {name:'А–Я', asc:'Меньше штук', desc:'Больше штук'};
var stockSupplierList = [];
function toggleStockFilter(e, force){
  if(e) e.stopPropagation();
  const pop = document.getElementById('stockFilterPop'), btn = document.getElementById('stockFilterBtn');
  if(!pop) return;
  const open = force !== undefined ? force : pop.hidden;
  pop.hidden = !open;
  if(btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function setStockSupplier(v){
  document.getElementById('supplierFilter').value = v;
  renderStock();
}
function resetStockFilter(){
  try{ localStorage.setItem('ff-stock-sort', 'name'); }catch(e){}
  document.getElementById('supplierFilter').value = '';
  toggleStockFilter(null, false);
  renderStock();
}
function renderStockFilter(suppliers, sort, supplier){
  const opt = (active, onclick, label)=>
    `<button type="button" class="filter-opt ${active ? 'on' : ''}" onclick="${onclick}"><span>${label}</span>${active ? '<svg class="icon"><use href="#i-check"/></svg>' : ''}</button>`;
  const so = document.getElementById('stockSortOpts');
  if(so) so.innerHTML = Object.keys(STOCK_SORT_NAMES).map(k=> opt(k === sort, `setStockSort('${k}')`, STOCK_SORT_NAMES[k])).join('');
  const sp = document.getElementById('stockSupplierOpts');
  stockSupplierList = suppliers;
  if(sp) sp.innerHTML = opt(!supplier, `setStockSupplier('')`, 'Все поставщики')
    + suppliers.map((s, i)=> opt(s === supplier, `setStockSupplier(stockSupplierList[${i}])`, escapeHtml(s))).join('');
  const parts = [];
  if(sort !== 'name') parts.push(STOCK_SORT_NAMES[sort]);
  if(supplier) parts.push(escapeHtml(supplier));
  const dot = document.getElementById('stockFilterDot');
  if(dot) dot.hidden = !parts.length;
  const sum = document.getElementById('stockFilterSum');
  if(sum){
    sum.hidden = !parts.length;
    sum.innerHTML = parts.length ? `<span>${parts.join(' · ')}</span><button type="button" onclick="resetStockFilter()" aria-label="Сбросить фильтр"><svg class="icon"><use href="#i-x"/></svg>Сбросить</button>` : '';
  }
}
document.addEventListener('click', (e)=>{
  const pop = document.getElementById('stockFilterPop');
  if(pop && !pop.hidden && !e.target.closest('.filter-pop-wrap')) toggleStockFilter(null, false);
});
document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') toggleStockFilter(null, false); });

/* «Стоп» — товары, которые сейчас не продаются (кончился сезон), но
   удалять их не хочется: история и остатки остаются, вернуть — в одно
   касание. Партнёрам «Стоп» не показывается. */
var stockTab = 'active';
function setStockTab(v){
  if(v === stockTab) return;
  stockTab = v;
  invoiceSelection.clear();
  renderStock();
}
async function moveSelectedToStop(toStop){
  const skus = [...invoiceSelection];
  if(!skus.length){ toast('Сначала отметьте товары галочками'); return; }
  for(const sku of skus){
    const p = await get('products', sku);
    if(!p || p.deletedAt) continue;
    p.stopped = !!toStop;
    await put('products', p);
  }
  invoiceSelection.clear();
  toast((toStop ? 'В «Стоп»: ' : 'Вернули в продажу: ') + skus.length + ' ' + pluralTovar(skus.length));
  await renderStock();
}

async function renderStock(){
  const emp = isEmployee();
  const everything = await getAllLive('products');
  const tab = emp ? 'active' : stockTab;
  const cntStop = everything.filter(p=> p.stopped).length;
  const setCnt = (id, n)=>{ const el = document.getElementById(id); if(el) el.textContent = n ? n : ''; };
  setCnt('stockCntActive', everything.length - cntStop); setCnt('stockCntStop', cntStop);
  const seg = document.getElementById('stockTabSeg');
  if(seg){
    seg.hidden = emp;
    seg.querySelectorAll('button').forEach(b=> b.classList.toggle('active', b.dataset.v === tab));
  }
  const all = everything.filter(p=> tab === 'stop' ? p.stopped : !p.stopped);
  const sort = stockSort();
  const byName = (a,b)=> a.name.localeCompare(b.name,'ru');
  const rb = await returnsBySku();
  const qty = p=> normalStock(p, rb);
  all.sort(sort === 'asc'  ? (a,b)=> qty(a) - qty(b) || byName(a,b)
         : sort === 'desc' ? (a,b)=> qty(b) - qty(a) || byName(a,b)
         : byName);
  const q = (document.getElementById('stockSearch').value||'').toLowerCase();

  const supplierSel = document.getElementById('supplierFilter');
  const prevSupplierValue = supplierSel.value;
  const suppliers = [...new Set(all.map(p=>(p.supplier||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  supplierSel.innerHTML = '<option value="">Все поставщики</option>' + suppliers.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if(suppliers.includes(prevSupplierValue)) supplierSel.value = prevSupplierValue;
  const supplierFilterVal = supplierSel.value;
  renderStockFilter(emp ? [] : suppliers, sort, supplierFilterVal);

  const allSkus = new Set(all.map(p=>p.sku));
  [...invoiceSelection].forEach(sku=>{ if(!allSkus.has(sku)) invoiceSelection.delete(sku); });

  const filtered = all.filter(p=>
    (!q || p.name.toLowerCase().includes(q) || String(p.sku).toLowerCase().includes(q) || String(p.barcode).toLowerCase().includes(q))
    && (!supplierFilterVal || (p.supplier||'').trim() === supplierFilterVal)
  );
  const list = document.getElementById('stockList');
  if(all.length===0){
    list.innerHTML = tab === 'stop'
      ? emptyState('i-pause','В «Стопе» пусто','Отметьте товары галочками во вкладке «В продаже» и в меню ⋮ выберите «Добавить в стоп».')
      : emptyState('i-box','Товаров пока нет','Добавьте первый товар кнопкой ниже или импортируйте список из Настроек.');
    await updateProductCountPill();
    updateInvoiceSelCount();
    return;
  }
  if(filtered.length===0){
    list.innerHTML = emptyState('i-search','Ничего не найдено','Попробуйте изменить запрос поиска или фильтр поставщика.');
    updateInvoiceSelCount();
    return;
  }
  const fc = emp ? {} : await computeForecast();
  list.innerHTML = filtered.map(p=>{
    const f = fc[p.sku];
    const fcHint = f && (f.status === 'order' || f.status === 'out')
      ? `<div class="rmeta fc-hint"><svg class="icon"><use href="#i-alert"/></svg>${f.status === 'out' ? 'Закончился · заказать' : ('~' + Math.floor(f.daysLeft) + ' ' + pluralDney(Math.floor(f.daysLeft)) + ' · заказать')}</div>`
      : '';
    /* крупно — нормальные штуки; синим под ними — возвраты (и повреждённые),
       которые тоже лежат на складе, но нормальными не считаются */
    const normal = qty(p), r = rb[p.sku] || {ret:0, dmg:0};
    let cls='';
    if(normal<=0) cls='zero'; else if(normal<=settings.lowStock) cls='low';
    const extra = [r.ret ? `<span class="q-ret">${r.ret} возвр.</span>` : '', r.dmg ? `<span class="q-dmg">${r.dmg} повр.</span>` : ''].filter(Boolean).join('');
    const qtyHtml = `<div class="stock-qty"><span class="rval ${cls}">${normal} шт</span>${extra ? `<div class="q-extra">${extra}</div>` : ''}</div>`;
    if(emp){
      /* Кабинет сотрудника: только просмотр. Видно название, остаток и
         цену продажи; себестоимость, поставщик и правка скрыты. */
      return `<div class="row-item">
        <div class="rmain">
          <div class="rname">${escapeHtml(p.name)}</div>
          <div class="rmeta">${escapeHtml(p.sku)}${p.barcode?' · '+escapeHtml(p.barcode):''}</div>
        </div>
        <div class="rside">
          ${qtyHtml}
          <span class="t-caption" style="white-space:nowrap;">${Math.round(p.price)} ₽</span>
        </div>
      </div>`;
    }
    return `<div class="row-item">
      <input type="checkbox" class="inv-chk" aria-label="Выбрать для накладной" data-sku="${escapeAttr(p.sku)}" ${invoiceSelection.has(p.sku)?'checked':''} onchange="toggleInvoiceSelection(${jsArg(p.sku)}, this.checked)">
      <div class="rmain">
        <div class="rname">${escapeHtml(p.name)}</div>
        <div class="rmeta">${escapeHtml(p.sku)} · ${p.barcode?escapeHtml(p.barcode):'без штрихкода'}${p.supplier?' · '+escapeHtml(p.supplier):''}</div>
        ${fcHint}
      </div>
      <div class="rside">
        ${qtyHtml}
        <button class="icon-btn in" onclick="openQuickPrihod(${jsArg(p.sku)})" aria-label="Быстрый приход"><svg class="icon"><use href="#i-in"/></svg></button>
        <button class="icon-btn out" onclick="openQuickRashod(${jsArg(p.sku)})" aria-label="Быстрый расход"><svg class="icon"><use href="#i-out"/></svg></button>
        <button class="icon-btn edit" onclick="editProduct(${jsArg(p.sku)})" aria-label="Изменить"><svg class="icon"><use href="#i-edit"/></svg></button>
      </div>
    </div>`;
  }).join('');
  await updateProductCountPill();
  updateInvoiceSelCount();
  if(!emp) renderReorderCard(fc);
}

/* ---- выбор товаров галочками для накладной поставщику ---- */
var invoiceSelection = new Set();
function toggleInvoiceSelection(sku, checked){
  if(checked) invoiceSelection.add(sku); else invoiceSelection.delete(sku);
  updateInvoiceSelCount();
}
function clearInvoiceSelection(){
  invoiceSelection.clear();
  document.querySelectorAll('.inv-chk').forEach(cb=>cb.checked=false);
  updateInvoiceSelCount();
}
function updateInvoiceSelCount(){
  const el = document.getElementById('invoiceSelCount');
  if(el) el.textContent = 'Выбрано: '+invoiceSelection.size+' '+pluralTovar(invoiceSelection.size);
}
function pluralTovar(n){
  const m = n%100;
  if(m>=11 && m<=14) return 'товаров';
  const l = n%10;
  if(l===1) return 'товар';
  if(l>=2 && l<=4) return 'товара';
  return 'товаров';
}
async function deleteSelectedProducts(){
  if(invoiceSelection.size===0){
    toast('Сначала отметьте товары галочками в списке склада');
    return;
  }
  const skus = [...invoiceSelection];
  if(!confirm('Удалить '+skus.length+' '+pluralTovar(skus.length)+' со склада? Это действие необратимо.')) return;
  for(const sku of skus){ await softDelete('products', sku); }
  invoiceSelection.clear();
  toast('Удалено: '+skus.length+' '+pluralTovar(skus.length));
  await renderStock();
}

/* Одна строка вместо блока на пол-экрана — для виджетов внутри карточек.
   Иконка здесь только мешала: в 15 пикселей она читается как безымянный
   прямоугольник и внимание забирает, а смысла не добавляет. */
function emptyLine(icon, text){
  return `<div class="empty-line">${text}</div>`;
}
function emptyState(icon, title, sub){
  return `<div class="empty-state">
    <svg class="icon-lg"><use href="#${icon}"/></svg>
    <div class="et1">${title}</div>
    <div class="et2">${sub}</div>
  </div>`;
}

function openProductModal(){
  document.getElementById('productModalTitle').textContent='Новый товар';
  ['pmSku','pmName','pmCategory','pmSupplier','pmBarcode','pmCost','pmPrice','pmCommission','pmTax','pmPackaging','pmDeliveryDiscount','pmStock'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('pmSkuOriginal').value='';
  document.getElementById('pmSku').disabled=false;
  document.getElementById('pmStock').dataset.shown = '';
  clearFormErrors();
  document.getElementById('productModalBg').classList.add('show');
}
/* Пока карточка открыта, остаток мог измениться (продажа с другого
   телефона). Если человек поле «Остаток» не трогал — показываем свежее число. */
async function refreshOpenProductStock(){
  const bg = document.getElementById('productModalBg'), inp = document.getElementById('pmStock');
  const sku = document.getElementById('pmSkuOriginal').value;
  if(!bg || !bg.classList.contains('show') || !sku || inp.dataset.shown === '' || inp.dataset.shown === undefined) return;
  if(inp.value !== inp.dataset.shown || document.activeElement === inp) return;
  const p = await get('products', sku);
  if(!p) return;
  inp.value = p.totalStock||0;
  inp.dataset.shown = String(p.totalStock||0);
}
async function editProduct(sku){
  const p = await get('products', sku);
  if(!p) return;
  document.getElementById('productModalTitle').textContent='Изменить товар';
  document.getElementById('pmSkuOriginal').value=p.sku;
  /* SKU можно переименовать: история переезжает на новый код вместе
     с товаром, см. renameSku(). Раньше поле было просто заблокировано. */
  document.getElementById('pmSku').value=p.sku; document.getElementById('pmSku').disabled=false;
  document.getElementById('pmName').value=p.name;
  document.getElementById('pmCategory').value=p.category||'';
  document.getElementById('pmSupplier').value=p.supplier||'';
  document.getElementById('pmBarcode').value=p.barcode||'';
  document.getElementById('pmCost').value=p.cost||0;
  document.getElementById('pmPrice').value=p.price||0;
  document.getElementById('pmCommission').value=p.commissionPercent||0;
  document.getElementById('pmTax').value=p.taxPercent||0;
  document.getElementById('pmPackaging').value=p.packaging||0;
  document.getElementById('pmDeliveryDiscount').value=p.deliveryDiscount||0;
  document.getElementById('pmStock').value=p.totalStock||0;
  document.getElementById('pmStock').dataset.shown = String(p.totalStock||0);
  clearFormErrors();
  document.getElementById('productModalBg').classList.add('show');
}
function closeProductModal(){ document.getElementById('productModalBg').classList.remove('show'); }
function clearFormErrors(){
  document.getElementById('errSku').textContent = 'Укажите SKU';
  document.getElementById('errSku').classList.remove('show');
  document.getElementById('errName').classList.remove('show');
  document.getElementById('pmSku').classList.remove('invalid');
  document.getElementById('pmName').classList.remove('invalid');
}
function validateProductForm(){
  const sku = document.getElementById('pmSku').value.trim();
  const name = document.getElementById('pmName').value.trim();
  document.getElementById('errSku').classList.toggle('show', !sku);
  document.getElementById('pmSku').classList.toggle('invalid', !sku);
  document.getElementById('errName').classList.toggle('show', !name);
  document.getElementById('pmName').classList.toggle('invalid', !name);
  return Boolean(sku && name);
}
/* Смена SKU — это переезд, а не переименование поля: код товара лежит в
   ключе карточки, в каждой строке истории и в списке инвентаризации.
   Новая карточка к этому моменту уже сохранена, здесь переносим остальное
   и гасим старую. Все правки помечаются как несохранённые, поэтому
   на другие устройства переезд уедет целиком. */
async function renameSku(oldSku, newSku){
  const rows = await getAll('history');
  for(const h of rows){
    if(String(h.sku) === String(oldSku)){ h.sku = newSku; await put('history', h); }
  }
  const inv = await get('inventory', oldSku);
  if(inv){ inv.sku = newSku; await put('inventory', inv); await del('inventory', oldSku); }
  await softDelete('products', oldSku);
}

async function saveProduct(){
  if(!validateProductForm()){ toast('Заполните обязательные поля'); return; }
  const sku = document.getElementById('pmSku').value.trim();
  const name = document.getElementById('pmName').value.trim();
  const p = {
    sku, name,
    category: document.getElementById('pmCategory').value.trim(),
    supplier: document.getElementById('pmSupplier').value.trim(),
    barcode: document.getElementById('pmBarcode').value.trim(),
    cost: Number(document.getElementById('pmCost').value)||0,
    price: Number(document.getElementById('pmPrice').value)||0,
    commissionPercent: Number(document.getElementById('pmCommission').value)||0,
    taxPercent: Number(document.getElementById('pmTax').value)||0,
    packaging: Number(document.getElementById('pmPackaging').value)||0,
    deliveryDiscount: Number(document.getElementById('pmDeliveryDiscount').value)||0,
    updatedAt: Date.now(),
  };

  const originalSku = document.getElementById('pmSkuOriginal').value.trim();
  const isNew = !originalSku;
  const renaming = !isNew && originalSku !== sku;
  /* При переименовании остаток и историю берём у прежней карточки —
     иначе товар вышел бы из правки с нулём и без продаж. */
  const existing = await get('products', renaming ? originalSku : sku);

  if(renaming){
    const taken = await get('products', sku);
    if(taken && !taken.deletedAt){
      document.getElementById('errSku').textContent = 'Этот SKU уже занят товаром «' + taken.name + '»';
      document.getElementById('errSku').classList.add('show');
      document.getElementById('pmSku').classList.add('invalid');
      toast('Такой SKU уже есть на складе');
      return;
    }
    const moved = (await getAll('history')).filter(h=> String(h.sku) === originalSku && !h.deletedAt).length;
    if(!confirm('Сменить SKU: «' + originalSku + '» → «' + sku + '»?\n\n'
              + 'Вместе с товаром переедет вся его история — ' + moved + ' записей.\n'
              + 'Старый код освободится.')) return;
  }

  /* Раньше новый товар с уже занятым SKU молча затирал старую карточку —
     вместе с ценами и поставщиком, а история продаж оставалась висеть на
     нём же и отчёты разъезжались. Теперь так сделать нельзя. */
  if(isNew && existing && !existing.deletedAt){
    document.getElementById('errSku').textContent = 'Этот SKU уже занят товаром «' + existing.name + '»';
    document.getElementById('errSku').classList.add('show');
    document.getElementById('pmSku').classList.add('invalid');
    toast('Такой SKU уже есть на складе');
    return;
  }

  /* Одинаковый штрихкод у двух товаров — скрытая беда: сканер всегда будет
     попадать в один и тот же, а второй останется без движения. */
  if(p.barcode){
    const all = await getAllLive('products');
    const twin = all.find(x=> String(x.barcode).trim() === p.barcode && x.sku !== sku && x.sku !== originalSku);
    if(twin && !confirm('Такой штрихкод уже у товара «'+twin.name+'».\n\nПри сканировании будет открываться он. Всё равно сохранить?')) return;
  }

  /* отметка «Стоп» в форме не редактируется — сохраняем, как была */
  if(existing && existing.stopped) p.stopped = true;

  const stockInput = document.getElementById('pmStock');
  const wantedStock = Number(stockInput.value)||0;
  const shownAtOpen = stockInput.dataset.shown;
  /* Остаток задаётся операцией, а не полем: иначе правка карточки на одном
     устройстве затёрла бы приходы и расходы, сделанные на другом. */
  p.totalStock = existing ? (Number(existing.totalStock)||0) : 0;
  await put('products', p);
  if(renaming) await renameSku(originalSku, sku);

  /* У существующего товара записываем ТОЛЬКО то, что человек сам изменил в
     поле «Остаток» (новое число минус показанное при открытии). Раньше
     бралась разница с остатком на момент сохранения — и продажа, сделанная
     (здесь или на другом телефоне), пока карточка была открыта, тут же
     «отменялась» корректировкой: расход −5 → через секунду «+5». */
  const diff = (existing && shownAtOpen !== undefined && shownAtOpen !== '')
    ? wantedStock - Number(shownAtOpen)
    : wantedStock - p.totalStock;
  if(diff !== 0){
    await logHistory(existing ? 'Корректировка' : 'Начальный остаток', p.barcode, p, Math.abs(diff), {delta: diff});
  }
  await recalcStock(sku);

  closeProductModal();
  await renderStock();
  toast('Товар сохранён');
}

async function renderCard(){
  const q = document.getElementById('cardSearch').value.trim();
  const box = document.getElementById('cardResult');
  if(!q){ box.innerHTML = emptyState('i-search','Начните вводить запрос','Штрихкод, SKU или часть названия товара.'); return; }
  const all = await getAllLive('products');
  const ql = q.toLowerCase();
  const p = all.find(x=> String(x.barcode)===q || String(x.sku)===q || x.name.toLowerCase().includes(ql));
  if(!p){ box.innerHTML = emptyState('i-alert','Ничего не найдено','Проверьте штрихкод или добавьте товар на «Складе».'); return; }

  if(isEmployee()){
    /* Кабинет сотрудника: без себестоимости и статистики продаж. */
    box.innerHTML = `
      <div class="row-item"><div class="rmain"><div class="rname">${escapeHtml(p.name)}</div></div><span class="rval">${p.totalStock} шт</span></div>
      <div class="row-item"><div class="rmain">SKU</div><span class="rval">${escapeHtml(p.sku)}</span></div>
      <div class="row-item"><div class="rmain">Штрихкод</div><span class="rval">${escapeHtml(p.barcode||'—')}</span></div>
      <div class="row-item"><div class="rmain">Категория</div><span class="rval">${escapeHtml(p.category||'—')}</span></div>
      <div class="row-item"><div class="rmain">Цена продажи</div><span class="rval">${p.price} ₽</span></div>
    `;
    return;
  }

  const hist = await getAllLive('history');
  const forSku = hist.filter(h=>h.sku===p.sku);
  const prihodOps = forSku.filter(h=>h.type==='Приход');
  const rashodOps = forSku.filter(h=>h.type==='Расход');
  const soldTotal = rashodOps.reduce((s,h)=>s+h.qty,0);
  const lastPrihod = prihodOps.length ? prihodOps[prihodOps.length-1].date : '—';
  const lastRashod = rashodOps.length ? rashodOps[rashodOps.length-1].date : '—';

  box.innerHTML = `
    <div class="row-item"><div class="rmain"><div class="rname">${escapeHtml(p.name)}</div></div><span class="rval">${p.totalStock} шт</span></div>
    <div class="row-item"><div class="rmain">SKU</div><span class="rval">${escapeHtml(p.sku)}</span></div>
    <div class="row-item"><div class="rmain">Штрихкод</div><span class="rval">${escapeHtml(p.barcode||'—')}</span></div>
    <div class="row-item"><div class="rmain">Категория</div><span class="rval">${escapeHtml(p.category||'—')}</span></div>
    <div class="row-item"><div class="rmain">Все поставщики</div><span class="rval">${escapeHtml(p.supplier||'—')}</span></div>
    <div class="row-item"><div class="rmain">Себестоимость</div><span class="rval">${p.cost} ₽</span></div>
    <div class="row-item"><div class="rmain">Цена продажи</div><span class="rval">${p.price} ₽</span></div>
    <div class="row-item"><div class="rmain">Последний приход</div><span class="rval">${lastPrihod}</span></div>
    <div class="row-item"><div class="rmain">Последний расход</div><span class="rval">${lastRashod}</span></div>
    <div class="row-item"><div class="rmain">Продано всего</div><span class="rval">${soldTotal} шт</span></div>
    <div class="row-item"><div class="rmain">Оборот</div><span class="rval">${soldTotal*p.price} ₽</span></div>
  `;
}

async function startInventory(){
  const all = await getAllLive('products');
  if(all.length===0){ toast('Сначала добавьте товары на склад'); return; }
  await clearStore('inventory');
  for(const p of all){
    await put('inventory', {sku:p.sku, name:p.name, barcode:p.barcode, baseQty:p.totalStock, factQty:0});
  }
  inventoryActive = true;
  syncInvActionUI();
  focusForScanner(document.getElementById('invScanInput'));
  toast('Инвентаризация начата: '+all.length+' позиций');
  await renderInvList();
}
async function cancelInventory(){
  if(!inventoryActive){ toast('Инвентаризация не запущена'); return; }
  await clearStore('inventory');
  inventoryActive = false;
  stopInvCamera();
  syncInvActionUI();
  await renderInvList();
  toast('Инвентаризация отменена');
}
function showInvStatus(msg, ok){
  const wrap = document.getElementById('invStatusMsgWrap');
  const el = document.getElementById('invStatusMsg');
  const icon = document.getElementById('invStatusMsgIcon');
  wrap.style.display = 'flex';
  wrap.className = 'alert '+(ok?'success':'error');
  el.textContent = msg;
  icon.innerHTML = ok ? '<use href="#i-check-circle"/>' : '<use href="#i-alert"/>';
}
async function handleInventoryScan(barcode){
  const all = await getAll('inventory');
  const code = String(barcode).trim(), low = code.toLowerCase();
  const item = all.find(i=> String(i.barcode).trim() === code)
            || all.find(i=> String(i.sku).trim().toLowerCase() === low);   // руками удобнее по SKU
  if(!item){ playErrorSound(); showInvStatus('Не в списке инвентаризации: '+barcode, false); return; }
  playSound();   // до await'ов — пока «жест» на iOS ещё в силе
  item.factQty += 1;
  await put('inventory', item);
  showInvStatus('Посчитано: '+item.name+' ('+item.factQty+' шт)', true);
  await renderInvList();
}

/* ---- камера инвентаризации (отдельная от Панели, +1 за скан) ---- */
let invZxingReader = null, invCamOn = false;
function switchInvInputTab(tab){
  const isCam = tab==='camera';
  document.getElementById('invTabScannerBtn').classList.toggle('active', !isCam);
  document.getElementById('invTabCameraBtn').classList.toggle('active', isCam);
  document.getElementById('invScannerStage').style.display = isCam ? 'none' : 'block';
  document.getElementById('invCameraStage').style.display = isCam ? 'block' : 'none';
  if(isCam){ startInvCamera(); } else { stopInvCamera(); focusForScanner(document.getElementById('invScanInput')); }
}
async function startInvCamera(){
  if(invCamOn) return;
  invCamOn = true;
  invZxingReader = new ZXing.BrowserMultiFormatReader();
  let lastCode='', lastTime=0;
  try{
    await invZxingReader.decodeFromVideoDevice(null, 'invCamVideo', (result, err)=>{
      if(result){
        const text = result.getText();
        const now = Date.now();
        if(text===lastCode && (now-lastTime)<1500) return;
        lastCode=text; lastTime=now;
        handleInventoryScan(text);
      }
    });
  }catch(e){
    toast('Камера недоступна: '+e.message);
    switchInvInputTab('scanner');
  }
}
function stopInvCamera(){
  invCamOn = false;
  if(invZxingReader){ try{ invZxingReader.reset(); }catch(e){} }
}

async function renderInvStatus(){
  const all = await getAll('inventory');
  const diffs = all.filter(i=>i.factQty !== i.baseQty).length;
  const block = document.getElementById('invStatusBlock');
  if(block){
    block.innerHTML = inventoryActive
      ? `<div class="t-body" style="color:var(--accent);font-weight:600;">Активна · ${all.length} позиций · расхождений: ${diffs}</div>`
      : emptyState('i-clipboard','Инвентаризация не запущена','Нажмите «Начать» — все товары со склада скопируются в список пересчёта.');
  }
  return all;
}
async function renderInvList(){
  const all = await renderInvStatus();
  const list = document.getElementById('invList');
  if(all.length===0){ list.innerHTML = emptyLine('i-inbox','Список пуст — начните инвентаризацию'); return; }
  list.innerHTML = all.map(i=>{
    const diff = i.factQty - i.baseQty;
    const cls = diff===0 ? '' : (diff>0 ? 'pos' : 'neg');
    return `<div class="row-item">
      <div class="rmain"><div class="rname">${escapeHtml(i.name)}</div><div class="rmeta">база ${i.baseQty} · факт ${i.factQty}</div></div>
      <span class="rval ${cls}">${diff>0?'+':''}${diff}</span>
    </div>`;
  }).join('');
}
async function finishInventory(){
  if(!inventoryActive){ toast('Инвентаризация не запущена'); return; }
  const all = await getAll('inventory');
  let changed=0;
  for(const i of all){
    if(i.factQty === i.baseQty) continue;
    const p = await get('products', i.sku);
    if(!p) continue;
    /* Приводим остаток к пересчитанному, а не к тому, что лежал в списке
       инвентаризации: пока шёл пересчёт, на другом устройстве могли
       появиться свои операции. */
    const current = await recalcStock(i.sku);
    const diff = i.factQty - current;
    if(diff === 0) continue;
    await logHistory('Корректировка', i.barcode, p, Math.abs(diff), {delta: diff});
    await recalcStock(i.sku);
    changed++;
  }
  await clearStore('inventory');
  inventoryActive = false;
  stopInvCamera();
  syncInvActionUI();
  await renderInvList(); await renderStock(); await renderHistory();
  toast('Инвентаризация завершена. Скорректировано: '+changed);
}

async function renderHistory(){
  let all = await getAllLive('history');
  /* Партнёр видит только приход/расход и только с даты отсечки
     (Настройки владельца → Баланс). Корректировки и начальный остаток
     ему не показываем. */
  if(isEmployee()){
    const from = partnerFromTs();
    all = all.filter(h=> (h.type === 'Приход' || h.type === 'Расход') && (h.timestamp || 0) >= from);
  }
  all.sort((a,b)=> b.timestamp - a.timestamp);
  const typeFilter = document.getElementById('historyFilter').value;
  const q = (document.getElementById('historySearch').value || '').trim().toLowerCase();

  let filtered = typeFilter ? all.filter(h=>h.type===typeFilter) : all;
  if(q){
    filtered = filtered.filter(h=>
      (h.name||'').toLowerCase().includes(q) || String(h.sku||'').toLowerCase().includes(q));
  }
  if(historyRange){
    filtered = filtered.filter(h=> h.timestamp>=historyRange.start && h.timestamp<=historyRange.end);
  }
  updateHistoryRangeLabel();
  const list = document.getElementById('historyList');

  const allIds = new Set(all.map(h=>h.id));
  [...historySelection].forEach(id=>{ if(!allIds.has(id)) historySelection.delete(id); });
  updateHistorySelCount();

  if(filtered.length===0){
    list.innerHTML = (typeFilter || q || historyRange)
      ? emptyLine('i-search','Под этот фильтр операций не попало')
      : emptyState('i-clock','Операций пока нет','Отсканируйте первый товар на «Панели», и он появится здесь.');
    return;
  }
  const emp = isEmployee();
  list.innerHTML = filtered.slice(0,200).map(h=>{
    let display, cls;
    if(h.type==='Расход'){ display = '−'+Math.abs(h.qty); cls='neg'; }
    else if(h.type==='Приход'){ display = '+'+Math.abs(h.qty); cls='pos'; }
    else {
      /* Корректировка / Начальный остаток: знак и цвет — по delta (со знаком),
         а не по qty (оно всегда положительное). Минусовая корректировка
         должна быть «−N» красным, а не «+N» зелёным. */
      const d = historyDelta(h);
      display = (d < 0 ? '−' : (d > 0 ? '+' : '')) + Math.abs(d);
      cls = d < 0 ? 'neg' : 'pos';
    }
    const skuLine = `<div class="rmeta" style="font-family:var(--font-mono);color:var(--text-secondary);">${escapeHtml(h.sku || '—')}</div>`;
    const dtLine  = `<div class="rmeta">${h.date} · ${h.time} · ${h.type}</div>`;
    /* Нажатие на количество — показать остаток товара на момент ЭТОЙ операции
       (а не текущий), чтобы можно было сверить прошлые записи между собой. */
    const valSpan = `<span class="rval ${cls}" style="cursor:pointer;" onclick="toggleHistoryStock(event,this,${h.id},${jsArg(h.sku)})">${display} шт</span>`;
    if(emp){
      return `
      <div class="row-item">
        <div class="rmain"><div class="rname">${escapeHtml(h.name)}</div>${skuLine}${dtLine}</div>
        <div class="rside">${valSpan}</div>
      </div>`;
    }
    return `
    <div class="row-item">
      <input type="checkbox" class="hist-chk" aria-label="Выбрать запись" ${historySelection.has(h.id)?'checked':''} onchange="toggleHistorySelection(${h.id}, this.checked)">
      <div class="rmain"><div class="rname">${escapeHtml(h.name)}</div>${skuLine}${dtLine}</div>
      <div class="rside">
        ${valSpan}
        <button class="icon-btn" onclick="deleteHistoryEntry(${h.id})" aria-label="Удалить запись"><svg class="icon"><use href="#i-trash"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

/* Остаток товара ПЕРЕД этой операцией (а не после и не сейчас) — чтобы
   сверить саму запись: было столько-то, применили +N/−N из этой строки.
   Считаем так же, как «источник правды» остатка вообще: сумма приращений
   живых (не удалённых, не legacy) операций по этому товару в хронологическом
   порядке, но останавливаемся, не доходя до самой этой записи. */
async function stockBeforeHistoryId(id, sku){
  const ops = (await historyBySku(sku)).filter(o=> !o.legacy && !o.deletedAt);
  ops.sort((a,b)=> (a.timestamp - b.timestamp) || (a.id - b.id));
  let stock = 0;
  for(const op of ops){
    if(op.id === id) return stock;   // остаток до этой записи, саму её не прибавляем
    stock += historyDelta(op);
  }
  return null;   // сама запись не участвует в сумме (удалена/legacy)
}

/* Показывает/убирает рядом с количеством операции остаток, который был
   ДО неё, — не уходя со «Склада» и обратно, чтобы свериться. */
async function toggleHistoryStock(e, el, id, sku){
  if(e) e.stopPropagation();
  if(el.dataset.showingStock === '1'){
    el.textContent = el.dataset.baseText;
    delete el.dataset.showingStock;
    return;
  }
  el.dataset.baseText = el.textContent;
  const stock = await stockBeforeHistoryId(id, sku);
  el.textContent = el.dataset.baseText + (stock === null ? ' · было неизвестно' : (' · было: ' + stock + ' шт'));
  el.dataset.showingStock = '1';
}

/* ---- выбор записей истории галочками для массового исправления ---- */
let historySelection = new Set();
function toggleHistorySelection(id, checked){
  if(checked) historySelection.add(id); else historySelection.delete(id);
  updateHistorySelCount();
}
function clearHistorySelection(){
  historySelection.clear();
  document.querySelectorAll('.hist-chk').forEach(cb=>cb.checked=false);
  updateHistorySelCount();
}
function updateHistorySelCount(){
  const el = document.getElementById('historySelCount');
  if(el) el.textContent = 'Выбрано: '+historySelection.size+' '+pluralZapis(historySelection.size);
}
function pluralZapis(n){
  const m = n%100;
  if(m>=11 && m<=14) return 'записей';
  const l = n%10;
  if(l===1) return 'запись';
  if(l>=2 && l<=4) return 'записи';
  return 'записей';
}

/* Удаляет отмеченные записи истории и, ВМЕСТО автоматического пересчёта по
   каждой операции, спрашивает реальное количество на складе для каждого
   затронутого товара — это надёжнее, когда вперемешку тестировали и приход,
   и расход, и по отдельности их уже не восстановить. */
async function deleteSelectedHistoryWithCorrection(){
  if(historySelection.size===0){ toast('Сначала отметьте записи галочками'); return; }
  const ids = [...historySelection];
  const allHist = await getAllLive('history');
  const selectedEntries = allHist.filter(h=> ids.includes(h.id));

  const bySku = {};
  selectedEntries.forEach(h=>{ (bySku[h.sku] = bySku[h.sku] || []).push(h); });

  let touched = 0, skippedSkus = [];

  for(const sku in bySku){
    const entries = bySku[sku];
    const p = await get('products', sku);
    const name = p ? p.name : (entries[0].name || sku);
    const currentStock = p ? p.totalStock : 0;

    const input = prompt('Сколько реально сейчас на складе товара «'+name+'»? (сейчас в приложении: '+currentStock+' шт)', String(currentStock));
    if(input === null){ skippedSkus.push(name); continue; }
    const newQty = Math.round(Number(input));
    if(isNaN(newQty) || newQty < 0){ toast('Некорректное число для «'+name+'» — пропущено'); skippedSkus.push(name); continue; }

    for(const h of entries){
      await softDelete('history', h.id);
      if(h.type === 'Расход') await removeSaleCommission(h.uid);
    }
    await new Promise(r=> setTimeout(r, 0));   // удаления должны зафиксироваться до пересчёта

    if(p){
      const current = await recalcStock(p.sku);
      const diff = newQty - current;
      if(diff !== 0){
        await logHistory('Корректировка', p.barcode, p, Math.abs(diff), {delta: diff});
      }
      await recalcStock(p.sku);
    }
    touched++;
  }

  historySelection.clear();
  if(touched>0) toast('Готово: остаток исправлен для '+touched+' '+(touched===1?'товара':'товаров'));
  if(skippedSkus.length>0) toast('Пропущено без изменений: '+skippedSkus.join(', '));
  await renderHistory();
  await renderStock();
  await renderStats();
}
async function deleteHistoryEntry(id){
  const entry = await get('history', id);
  if(!entry) return;
  const extra = (entry.type === 'Расход')
    ? '\n\nНачисление партнёру по этой продаже тоже уберётся — у него оно пропадёт при синхронизации.'
    : '';
  if(!confirm('Удалить запись «'+entry.name+'» ('+entry.date+' '+entry.time+')? Остаток товара будет пересчитан так, будто этой операции не было.'+extra)) return;

  /* Остаток больше не нужно «откручивать» руками: он считается по
     операциям, поэтому достаточно убрать запись и пересчитать. */
  await softDelete('history', id);
  if(entry.type === 'Расход') await removeSaleCommission(entry.uid);   // и связанное начисление партнёрам
  await new Promise(r=> setTimeout(r, 0));   // транзакция удаления должна зафиксироваться до пересчёта остатка
  const p = await recalcStock(entry.sku);
  toast(p !== null ? 'Запись удалена, остаток пересчитан' : 'Запись удалена (товар уже удалён со склада)');
  await renderHistory();
  await renderStock();
  await renderStats();
}
function exportHistoryCSV(){
  getAllLive('history').then(all=>{
    all.sort((a,b)=>b.timestamp-a.timestamp);
    let csv = 'Дата;Время;Операция;Штрихкод;SKU;Название;Количество;Остаток после\n';
    all.forEach(h=>{ csv += [h.date,h.time,h.type,h.barcode,h.sku,h.name,h.qty,h.stockAfter].join(';')+'\n'; });
    downloadFile('istoriya.csv', csv, 'text/csv;charset=utf-8');
  });
}

/* Накладная — самостоятельный HTML-документ со своими стилями: он должен
   одинаково открываться и в браузере телефона, и на компьютере, и уходить
   в мессенджер одним файлом. Колонка «Заказ» намеренно пустая — её
   заполняют от руки или в поставщицкой форме. */
function buildSupplierInvoiceHtml(products, supplier, now){
  const dateStr = now.toLocaleDateString('ru-RU');
  const timeStr = now.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});

  /* Количество, проставленное перед выгрузкой, печатается в графе. Если
     его не задали, графа остаётся пустой — под заполнение от руки. */
  let ordered = 0, sum = 0;
  const rows = products.map((p, i)=>{
    const qty = Number(p.orderQty) || 0;
    if(qty > 0){ ordered += qty; sum += qty * (Number(p.cost) || 0); }
    return `
      <tr>
        <td class="c">${i+1}</td>
        <td class="mono">${escapeHtml(p.sku)}</td>
        <td class="order${qty > 0 ? ' filled' : ''}">${qty > 0 ? qty : ''}</td>
        <td class="r">${Math.round(p.cost || 0)} ₽</td>
      </tr>`;
  }).join('');

  const totalLine = ordered > 0
      ? `Позиций: <b>${products.length}</b> · всего штук: <b>${ordered}</b> · на сумму <b>${Math.round(sum)} ₽</b>`
      : `Позиций в заявке: <b>${products.length}</b>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Накладная поставщику ${escapeHtml(dateStr)}</title>
<style>
  *{box-sizing:border-box;}
  body{margin:0;padding:20px 16px 40px;background:#f5f6f8;color:#1c2029;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
       font-size:15px;line-height:1.5;-webkit-text-size-adjust:100%;}
  .sheet{max-width:900px;margin:0 auto;background:#fff;border-radius:10px;padding:24px 20px;
         box-shadow:0 1px 3px rgba(20,25,40,.12);}
  h1{margin:0 0 4px;font-size:21px;}
  .meta{color:#5d6577;font-size:13.5px;margin-bottom:20px;}
  .meta b{color:#1c2029;}
  .scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}
  table{border-collapse:collapse;width:100%;font-size:14px;}
  th,td{border:1px solid #d9dde5;padding:9px 10px;vertical-align:top;}
  th{background:#eef1f6;text-align:left;font-size:12.5px;text-transform:uppercase;
     letter-spacing:.04em;color:#4a5162;white-space:nowrap;}
  td.c{text-align:center;white-space:nowrap;}
  td.r{text-align:right;white-space:nowrap;}
  td.mono{font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:13px;white-space:nowrap;}
  td.order{background:#fcfbf3;min-width:80px;text-align:center;}
  td.order.filled{font-weight:700;font-size:15px;color:#1c2029;}
  tbody tr:nth-child(even) td{background:#fafbfd;}
  tbody tr:nth-child(even) td.order{background:#f8f7ef;}
  .total{margin-top:18px;font-size:14px;color:#4a5162;}
  .total b{color:#1c2029;font-size:16px;}

  /* Четыре колонки помещаются даже на узком телефоне, поэтому таблица
     остаётся таблицей — карточный режим больше не нужен. */
  @media (max-width:420px){
    body{padding:12px 10px 30px;}
    .sheet{padding:16px 12px;}
    th,td{padding:8px 6px;font-size:13px;}
  }

  @media print{
    body{background:#fff;padding:0;font-size:12pt;}
    .sheet{box-shadow:none;border-radius:0;padding:0;max-width:none;}
  }
</style>
</head>
<body>
<div class="sheet">
  <h1>Накладная поставщику</h1>
  <div class="meta">
    от <b>${escapeHtml(dateStr)}</b>, ${escapeHtml(timeStr)}<br>
    Поставщик: <b>${escapeHtml(supplier || 'не указан')}</b>
  </div>

  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th>№</th><th>SKU</th><th>Заказ, шт</th><th>Цена</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
  </div>

  <div class="total">${totalLine}</div>
</div>
</body>
</html>`;
}

async function exportSupplierInvoice(){
  if(invoiceSelection.size===0){
    toast('Сначала отметьте товары галочками в списке склада');
    return;
  }
  const all = await getAllLive('products');
  const selected = all.filter(p=> invoiceSelection.has(p.sku));

  /* Каждому поставщику — свой файл. Одним документом нельзя: накладная
     уходит поставщику, и он не должен видеть позиции и цены остальных. */
  const groups = new Map();
  selected.forEach(p=>{
    const key = (p.supplier || '').trim() || 'Без поставщика';
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });

  orderGroups = [...groups.keys()].sort((a,b)=> a.localeCompare(b,'ru')).map(supplier=>({
    supplier,
    items: groups.get(supplier).sort((a,b)=> String(a.sku).localeCompare(String(b.sku),'ru'))
  }));
  openOrderQty();
}

/* ---- ввод количеств перед выгрузкой ----
   Заполнять графу в уже скачанном HTML бессмысленно: набранное живёт
   только в открытой вкладке и в файл не попадает, поставщик получит
   пустые клетки. Поэтому количество спрашиваем здесь. */
var orderGroups = [];

function openOrderQty(){
  const box = document.getElementById('orderQtyRows');
  box.innerHTML = orderGroups.map((g, gi)=>`
    <div class="order-group">
      <h4>${escapeHtml(g.supplier)}</h4>
      ${g.items.map((p, ii)=>`
        <div class="order-row">
          <span class="osku">${escapeHtml(p.sku)}</span>
          <span class="oprice">${Math.round(p.cost || 0)} ₽</span>
          <input type="number" min="0" step="1" inputmode="numeric" placeholder="0"
                 data-g="${gi}" data-i="${ii}" oninput="updateOrderTotal()">
        </div>`).join('')}
    </div>`).join('');
  updateOrderTotal();
  document.getElementById('orderQtyModalBg').classList.add('show');
}
function closeOrderQty(){
  document.getElementById('orderQtyModalBg').classList.remove('show');
}
function updateOrderTotal(){
  let qty = 0, sum = 0, positions = 0;
  document.querySelectorAll('#orderQtyRows input').forEach(inp=>{
    const n = Math.max(0, Math.round(Number(inp.value) || 0));
    if(n <= 0) return;
    const g = orderGroups[Number(inp.dataset.g)];
    const p = g && g.items[Number(inp.dataset.i)];
    if(!p) return;
    positions++; qty += n; sum += n * (Number(p.cost) || 0);
  });
  const el = document.getElementById('orderQtyTotal');
  el.innerHTML = qty > 0
      ? `Позиций: <b>${positions}</b> · штук: <b>${qty}</b> · на сумму <b>${Math.round(sum)} ₽</b>`
      : 'Количество не проставлено — графа «Заказ» останется пустой';
}

async function buildInvoicesFromOrder(){
  // переносим введённое в товары
  orderGroups.forEach(g=> g.items.forEach(p=>{ p.orderQty = 0; }));
  document.querySelectorAll('#orderQtyRows input').forEach(inp=>{
    const g = orderGroups[Number(inp.dataset.g)];
    const p = g && g.items[Number(inp.dataset.i)];
    if(p) p.orderQty = Math.max(0, Math.round(Number(inp.value) || 0));
  });

  const anyQty = orderGroups.some(g=> g.items.some(p=> p.orderQty > 0));
  const now = new Date();
  const dateSlug = now.toISOString().slice(0,10);

  /* HTML, а не .txt: текстовый файл на телефоне открывать обычно нечем,
     а .html открывает любой браузер — и заодно документ выглядит
     накладной, а не строчками, и его можно распечатать или отправить. */
  pendingInvoices = [];
  orderGroups.forEach(g=>{
    // если количества проставлены, в накладную идут только заказанные позиции
    const items = anyQty ? g.items.filter(p=> p.orderQty > 0) : g.items;
    if(!items.length) return;
    const slug = g.supplier.toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'_').replace(/^_+|_+$/g,'') || 'postavshchik';
    pendingInvoices.push({
      supplier: g.supplier,
      count: items.length,
      filename: 'nakladnaya_' + slug + '_' + dateSlug + '.html',
      html: buildSupplierInvoiceHtml(items, g.supplier, now)
    });
  });

  closeOrderQty();
  clearInvoiceSelection();
  await renderStock();

  if(!pendingInvoices.length){ toast('Не выбрано ни одной позиции'); return; }

  // один поставщик — сохраняем сразу, список ради одной строки не нужен
  if(pendingInvoices.length === 1){
    downloadFile(pendingInvoices[0].filename, pendingInvoices[0].html, 'text/html');
    toast('Накладная сохранена: ' + pendingInvoices[0].count + ' ' + pluralTovar(pendingInvoices[0].count));
    return;
  }
  openInvoiceList();
}

/* ---- список готовых накладных ----
   Скачать несколько файлов подряд нельзя: браузер разрешает первый, а
   остальные молча отбрасывает — поэтому каждую забирают нажатием, и это
   уже жест пользователя, который блокировкой не считается. */
var pendingInvoices = [];   // var — чтобы список был виден снаружи при разборе

function openInvoiceList(){
  const rows = document.getElementById('invoiceListRows');
  document.getElementById('invoiceListCount').textContent =
      pendingInvoices.length + ' ' + pluralNakladnaya(pendingInvoices.length);

  const canShare = Boolean(navigator.canShare && navigator.share);
  rows.innerHTML = pendingInvoices.map((inv, i)=>`
    <div class="row-item">
      <div class="rmain">
        <div class="rname">${escapeHtml(inv.supplier)}</div>
        <div class="rmeta">${inv.count} ${pluralTovar(inv.count)}</div>
      </div>
      <div class="rside">
        ${canShare ? `<button class="icon-btn" onclick="shareInvoice(${i})" aria-label="Отправить накладную"><svg class="icon"><use href="#i-upload"/></svg></button>` : ''}
        <button class="btn primary sm" style="width:auto;" onclick="downloadInvoice(${i}, this)"><svg class="icon"><use href="#i-download"/></svg>Скачать</button>
      </div>
    </div>`).join('');
  document.getElementById('invoiceListModalBg').classList.add('show');
}
function closeInvoiceList(){
  document.getElementById('invoiceListModalBg').classList.remove('show');
}
function downloadInvoice(i, btn){
  const inv = pendingInvoices[i];
  if(!inv) return;
  downloadFile(inv.filename, inv.html, 'text/html');
  if(btn){
    btn.innerHTML = '<svg class="icon"><use href="#i-check"/></svg>Сохранено';
    btn.classList.remove('primary');
    btn.classList.add('ghost');
  }
}
/* Забрать всё разом. Работает, если браузеру разрешено сохранять
   несколько файлов подряд — разрешение выдаётся один раз на сайт, но
   действует только в этом браузере, поэтому список с кнопками остаётся. */
async function downloadAllInvoices(btn){
  if(!pendingInvoices.length) return;
  if(btn){ btn.disabled = true; btn.innerHTML = 'Сохраняем…'; }

  const buttons = document.querySelectorAll('#invoiceListRows .row-item .btn');
  for(let i=0; i<pendingInvoices.length; i++){
    downloadInvoice(i, buttons[i]);
    // без паузы браузер отбрасывает файлы, идущие подряд
    if(i < pendingInvoices.length - 1) await new Promise(r=> setTimeout(r, 600));
  }

  if(btn){
    btn.disabled = false;
    btn.innerHTML = '<svg class="icon"><use href="#i-check"/></svg>Готово';
  }
  toast('Сохранено накладных: ' + pendingInvoices.length);
}

/* Отправка сразу в мессенджер — накладную всё равно шлют поставщику. */
async function shareInvoice(i){
  const inv = pendingInvoices[i];
  if(!inv) return;
  try{
    const file = new File([inv.html], inv.filename, {type:'text/html'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:'Накладная — '+inv.supplier});
      return;
    }
    await navigator.share({title:'Накладная — '+inv.supplier, text:'Накладная для поставщика '+inv.supplier});
  }catch(e){
    if(e && e.name === 'AbortError') return;   // человек передумал
    toast('Отправить не вышло, но файл можно скачать');
  }
}
function pluralNakladnaya(n){
  const m = n%100;
  if(m>=11 && m<=14) return 'накладных';
  const l = n%10;
  if(l===1) return 'накладная';
  if(l>=2 && l<=4) return 'накладные';
  return 'накладных';
}

const CAT_PALETTE = ['#4A7DFF','#FF6B78','#8C7EF2','#FFA35C','#2FBFAE','#FFC94D'];
function pluralProdazha(n){
  const m = n%100;
  if(m>=11 && m<=14) return 'продаж';
  const l = n%10;
  if(l===1) return 'продажа';
  if(l>=2 && l<=4) return 'продажи';
  return 'продаж';
}

/* Выручка по месяцам (для героя-карточки на «Статистике») */
async function computeMonthlyNetProfit(monthsBack){
  const hist = await getAllLive('history');
  const products = await getAllLive('products');
  const adspend = await getAllLive('adspend');
  const now = new Date();
  const buckets = [];
  for(let i=monthsBack-1;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const label = d.toLocaleDateString('ru-RU',{month:'short'}).replace('.','');
    buckets.push({year:d.getFullYear(), month:d.getMonth(), label, netProfit:0});
  }
  hist.filter(h=>h.type==='Расход').forEach(h=>{
    const d = new Date(h.timestamp);
    const b = buckets.find(x=>x.year===d.getFullYear() && x.month===d.getMonth());
    if(!b) return;
    const e = opEconomics(h, products.find(x=>x.sku===h.sku));
    if(!e) return;
    b.netProfit += e.net;
  });
  adspend.forEach(a=>{
    const d = new Date(a.timestamp);
    const b = buckets.find(x=>x.year===d.getFullYear() && x.month===d.getMonth());
    if(b) b.netProfit -= (a.amount||0);
  });
  // комиссия партнёрам — тоже расход, вычитаем из чистой прибыли
  (await getAllLive('orders')).forEach(o=>{
    const d = new Date(o.timestamp);
    const b = buckets.find(x=>x.year===d.getFullYear() && x.month===d.getMonth());
    if(b) b.netProfit -= (Number(o.commission)||0);
  });
  return buckets;
}

/* Начислено партнёрам за период (для «Расходов» и «Статистики»). */
async function computePartnerCommission(days){
  const orders = await getAllLive('orders');
  if(days === null || days === undefined){
    return orders.reduce((s,o)=> s + (Number(o.commission)||0), 0);
  }
  const range = getPeriodRange(days);
  if(!range) return orders.reduce((s,o)=> s + (Number(o.commission)||0), 0);
  return orders
    .filter(o=> o.timestamp >= range.start && o.timestamp <= range.end)
    .reduce((s,o)=> s + (Number(o.commission)||0), 0);
}

async function renderStatsHero(){
  const buckets = await computeMonthlyNetProfit(7);
  const current = buckets[buckets.length-1];
  const prev = buckets[buckets.length-2];
  const growth = (prev && prev.netProfit>0) ? ((current.netProfit-prev.netProfit)/prev.netProfit*100) : null;

  document.getElementById('heroPeriodLabel').textContent = 'Чистая прибыль · ' + new Date().toLocaleDateString('ru-RU',{month:'long', year:'numeric'});
  document.getElementById('heroAmount').textContent = Math.round(current.netProfit) + ' ₽';

  const growthEl = document.getElementById('heroGrowth');
  if(growth === null){
    growthEl.style.display = 'none';
  } else {
    growthEl.style.display = 'flex';
    growthEl.className = 'hero-growth ' + (growth>=0 ? 'up' : 'down');
    growthEl.innerHTML = `<svg class="icon"><use href="#i-${growth>=0?'in':'out'}"/></svg>${growth>=0?'+':''}${growth.toFixed(1)}% к прошлому месяцу`;
  }

  const maxAbs = Math.max(...buckets.map(b=>Math.abs(b.netProfit)), 1);
  document.getElementById('heroBars').innerHTML = buckets.map((b,i)=>{
    const h = Math.max(4, Math.round(Math.abs(b.netProfit)/maxAbs*64));
    const color = b.netProfit < 0 ? '#FF6B78' : CAT_PALETTE[i % CAT_PALETTE.length];
    const barCls = b===current ? 'hero-bar current' : 'hero-bar';
    const lblCls = b===current ? 'hero-bar-lbl current-lbl' : 'hero-bar-lbl';
    return `<div class="hero-bar-col"><div class="${barCls}" style="height:${h}px;background:${color};"></div><div class="${lblCls}">${b.label}</div></div>`;
  }).join('');
}

async function renderStats(){
  await renderStatsHero();

  const hist = await getAllLive('history');
  const todayStr = new Date().toLocaleDateString('ru-RU');
  const today = hist.filter(h=>h.date===todayStr);
  const soldQty = today.filter(h=>h.type==='Расход').reduce((s,h)=>s+h.qty,0);
  const receivedQty = today.filter(h=>h.type==='Приход').reduce((s,h)=>s+h.qty,0);
  const products = await getAllLive('products');
  const totalStock = products.reduce((s,p)=>s+p.totalStock,0);

  const potential = computeStockPotential(products);
  const partnerToday = await computePartnerCommission(1);
  const partnerMonth = await computePartnerCommission(30);

  const salesBySku = {};
  today.filter(h=>h.type==='Расход').forEach(h=> salesBySku[h.sku]=(salesBySku[h.sku]||0)+h.qty );
  let bestName='—', bestQty=0;
  for(const sku in salesBySku){ if(salesBySku[sku]>bestQty){bestQty=salesBySku[sku]; const p=products.find(x=>x.sku===sku); bestName=(p?p.name:sku)+' ('+bestQty+')';} }

  document.getElementById('statGrid').innerHTML = `
    <div class="stat-tile" style="--tile-color:#E8598A" title="Себестоимость товаров на складе"><div class="val">${Math.round(potential.cost)} ₽</div><div class="lbl">СТС</div></div>
    <div class="stat-tile" style="--tile-color:#4A7DFF" title="Потенциальная чистая прибыль товаров на складе"><div class="val">${Math.round(potential.netProfit)} ₽</div><div class="lbl">ПЧП</div></div>
    <div class="stat-tile" style="--tile-color:#8C7EF2"><div class="val">${soldQty}</div><div class="lbl">Продано, шт</div></div>
    <div class="stat-tile" style="--tile-color:#2BBE85"><div class="val">${receivedQty}</div><div class="lbl">Принято, шт</div></div>
    <div class="stat-tile" style="--tile-color:#FFA35C"><div class="val">${totalStock}</div><div class="lbl">Остаток склада</div></div>
    <div class="stat-tile" style="--tile-color:#2FBFAE"><div class="val small">${escapeHtml(bestName)}</div><div class="lbl">Топ товар дня</div></div>
    <div class="stat-tile" style="--tile-color:#E86F2E" title="Начислено партнёрам за сегодня"><div class="val">${Math.round(partnerToday)} ₽</div><div class="lbl">Партнёрам сегодня</div></div>
    <div class="stat-tile" style="--tile-color:#E86F2E" title="Начислено партнёрам за 30 дней"><div class="val">${Math.round(partnerMonth)} ₽</div><div class="lbl">Партнёрам за месяц</div></div>
    <div class="stat-tile wide" style="--tile-color:#FFC94D"><span class="lbl">Потенциальная выручка склада</span><span class="val">${Math.round(potential.revenue)} ₽</span></div>
  `;
}

/* Потенциальная стоимость/прибыль всего товара, лежащего сейчас на складе
   (если бы весь остаток был продан по текущим ценам и ставкам товара) */
function computeStockPotential(products){
  let revenue=0, cost=0, netProfit=0;
  products.forEach(p=>{
    const qty = p.totalStock||0;
    if(qty<=0) return;
    const rev = qty*p.price;
    const cst = qty*(p.cost||0);
    const gross = rev - cst;
    const tax = rev*((p.taxPercent||0)/100);
    const comm = rev*((p.commissionPercent||0)/100);
    const pack = qty*(p.packaging||0);
    const delivDiscount = qty*(p.deliveryDiscount||0);
    revenue += rev; cost += cst; netProfit += (gross - tax - comm - pack - delivDiscount);
  });
  return {revenue, cost, netProfit};
}

async function generateReport(label, days){
  const hist = await getAllLive('history');
  const products = await getAllLive('products');
  const end = new Date(); const start = new Date(); start.setDate(start.getDate()-(days-1));
  start.setHours(0,0,0,0);
  const filtered = hist.filter(h=> h.timestamp >= start.getTime() && h.timestamp <= end.getTime());
  const prihodOps = filtered.filter(h=>h.type==='Приход').length;
  const rashodOps = filtered.filter(h=>h.type==='Расход').length;
  const soldQty = filtered.filter(h=>h.type==='Расход').reduce((s,h)=>s+h.qty,0);
  const receivedQty = filtered.filter(h=>h.type==='Приход').reduce((s,h)=>s+h.qty,0);
  const salesBySku = {};
  filtered.filter(h=>h.type==='Расход').forEach(h=> salesBySku[h.sku]=(salesBySku[h.sku]||0)+h.qty );
  let revenue=0, bestSku='', bestQty=0;
  for(const sku in salesBySku){
    const p = products.find(x=>x.sku===sku);
    if(p) revenue += salesBySku[sku]*p.price;
    if(salesBySku[sku]>bestQty){bestQty=salesBySku[sku]; bestSku=sku;}
  }
  const bestP = products.find(x=>x.sku===bestSku);
  const bestName = bestP ? bestP.name+' ('+bestQty+' шт)' : '—';
  await put('reports', {
    label, start:start.toLocaleDateString('ru-RU'), end:end.toLocaleDateString('ru-RU'),
    prihodOps, rashodOps, soldQty, receivedQty, revenue, bestName,
    generatedAt: new Date().toLocaleString('ru-RU')
  });
  toast('Отчёт сформирован: '+label);
  await renderReports();
}
async function renderReports(){
  const all = await getAll('reports');
  all.sort((a,b)=>b.id-a.id);
  const list = document.getElementById('reportsList');
  if(all.length===0){ list.innerHTML = emptyLine('i-chart','Отчётов пока нет — выберите период выше'); return; }
  list.innerHTML = all.slice(0,10).map(r=>`
    <div class="row-item">
      <div class="rmain"><div class="rname">${r.label} (${r.start}–${r.end})</div><div class="rmeta">${r.prihodOps} прих. · ${r.rashodOps} расх. · выручка ${r.revenue} ₽ · топ: ${escapeHtml(r.bestName)}</div></div>
    </div>`).join('');
}

