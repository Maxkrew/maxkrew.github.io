/* «ФФ»: Склад — модели и размеры, алфавитная «шпаргалка», карточка модели.
   Склад видит все модели и ячейки; поставщик — свои модели без ячеек (ОПИСАНИЕ §4, §9). */
const SIZE_SET = ['XS','S','M','L','XL','2XL','3XL','4XL'];
/* готовые категории; любую другую поставщик или склад пишет сам («+ Своя категория») — товары бывают любые */
const DEFAULT_CATEGORIES = ['Одежда', 'Обувь / пуховики', 'Электроника', 'Бытовая техника', 'Автотовары', 'Дом и сад', 'Красота и здоровье', 'Детские товары', 'Спорт и отдых', 'Аксессуары', 'Другое'];
let ffAbcLetter = '';

function ffCategories(){
  const c = (window.settings && Array.isArray(settings.categories) && settings.categories.length) ? settings.categories : DEFAULT_CATEGORIES;
  return c;
}
/* список для выбора: готовые + те, что уже есть у товаров */
async function ffCategoryList(){
  const used = (await getAll('models')).filter(m=> !m.deletedAt && m.category).map(m=> String(m.category).trim()).filter(Boolean);
  return [...new Set(ffCategories().concat(used))];
}
function mmCategoryChanged(){
  const own = document.getElementById('mmCategory').value === '__own';
  const el = document.getElementById('mmCategoryOwn'); el.hidden = !own; if(own) try{ el.focus(); }catch(e){}
}
function modelName(m){ return [m.brand, m.title, m.color].filter(Boolean).join(' ').trim() || 'Без названия'; }
/* ['3XL','4XL'] → «3XL–4XL»; ['L'] → «L»; пусто → «все» */
function sizesLabel(list){
  if(!list || !list.length) return 'все';
  const s = list.slice().sort((a, b)=> sizeOrder(a) - sizeOrder(b));
  return s.length === 1 ? s[0] : s[0] + '–' + s[s.length - 1];
}

async function ffSuppliersMap(){
  return Object.fromEntries((await getAll('suppliers')).map(s=> [s.id, s]));
}

async function renderStockFF(){
  const list = document.getElementById('ffStockList');
  if(!list) return;
  const owner = isOwnerRole();
  // у поставщика — «Мои товары» с кнопками «Приход» и «Продал» (этап 2б)
  document.getElementById('ffStockTitle').textContent = owner ? 'Склад' : 'Мои товары';
  document.getElementById('ffStockSub').textContent = owner ? 'Товары, размеры и остатки' : 'Что на складе, что едет и что ждёт отправки';
  document.getElementById('homeActions').hidden = owner;
  const sups = await ffSuppliersMap();
  // фильтр поставщиков — только складу
  const sel = document.getElementById('ffSupplierFilter');
  if(sel){
    sel.hidden = !owner;
    const cur = sel.value;
    const opts = Object.values(sups).filter(s=> !s.deletedAt && !s.archived).sort((a, b)=> String(a.name).localeCompare(String(b.name), 'ru'));
    sel.innerHTML = '<option value="">Все поставщики</option>' + opts.map(s=> `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    sel.value = opts.some(s=> s.id === cur) ? cur : '';
  }
  const supFilter = owner && sel ? sel.value : '';
  const q = (document.getElementById('ffStockSearch').value || '').trim().toLowerCase();
  const mySup = owner ? null : Sync.mySupplierId();
  let models = (await getAll('models')).filter(m=> !m.deletedAt && (!supFilter || m.supplierId === supFilter) && (owner || m.supplierId === mySup));
  const allSizes = (await getAll('sizes')).filter(s=> !s.deletedAt);
  if(q){
    const codeHit = new Set(allSizes.filter(s=> (s.barcode || '').toLowerCase().includes(q)).map(s=> s.modelId));
    models = models.filter(m=> codeHit.has(m.id) || (modelName(m) + ' ' + (m.sku || '')).toLowerCase().includes(q));
  }
  // фильтр по категории (вместо букв: «П», «Х» были непонятны — владелец, 20.10.2026)
  const cats = [...new Set(models.map(m=> String(m.category || '').trim()).filter(Boolean))].sort((a, b)=> a.localeCompare(b, 'ru'));
  if(ffAbcLetter && !cats.includes(ffAbcLetter)) ffAbcLetter = '';
  const catSel = document.getElementById('ffCategoryFilter');
  if(catSel){
    catSel.innerHTML = '<option value="">Все категории</option>' + cats.map(c=> `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
    catSel.value = ffAbcLetter;
  }
  if(ffAbcLetter) models = models.filter(m=> String(m.category || '').trim() === ffAbcLetter);
  const phByModel = new Map();   // последнее фото товара
  for(const p of (await getAll('photos')).filter(p=> !p.deletedAt && p.kind === 'товар').sort((a, b)=> (a.createdTs || 0) - (b.createdTs || 0))) phByModel.set(p.modelId, p);
  const collator = new Intl.Collator('ru');
  const names = new Map(models.map(m=> [m.id, modelName(m)]));
  models.sort((a, b)=> collator.compare(names.get(a.id), names.get(b.id)));

  if(!models.length){
    list.innerHTML = emptyState('i-box', q || ffAbcLetter ? 'Ничего не найдено' : 'Товаров пока нет', owner ? 'Добавьте товар кнопкой «Товар» или через приёмку.' : 'Добавьте товар кнопкой «+ Товар».');
    if(typeof renderExpected === 'function') await renderExpected();
    return;
  }
  /* Один проход по данным на весь экран, а не по модели: размеры по моделям,
     остатки из общего индекса, ячейки по моделям. Показываем порциями. */
  const idx = await ffStockIndex();
  const counts = owner ? null : await supplierCounts();
  const sizesByModel = {};
  for(const s of allSizes) (sizesByModel[s.modelId] || (sizesByModel[s.modelId] = [])).push(s);
  const cellsByModel = {};
  if(owner){
    const labelOf = Object.fromEntries(allSizes.map(s=> [s.id, s.sizeLabel]));
    for(const c of (await getAll('cells')).filter(c=> !c.deletedAt && c.modelId)){
      let stock = 0;
      for(const [sid, qn] of Object.entries(idx.byCell[c.number] || {})) if(labelOf[sid] !== undefined) stock += qn;
      (cellsByModel[c.modelId] || (cellsByModel[c.modelId] = [])).push({number: c.number, allowedSizes: c.allowedSizes, reserved: c.reserved, stock});
    }
  }
  const shown = models.slice(0, ffStockLimit);
  const parts = [];
  for(const m of shown){
    const sz = (sizesByModel[m.id] || []).slice().sort((a, b)=> sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel));
    // в остатке — «можно продать»; брак отдельно (этап 2)
    const v = {sizes: sz.map(s=> ({label: s.sizeLabel, stock: idx.sellableBySize[s.id] || 0, defect: idx.defectBySize[s.id] || 0})),
               cells: (cellsByModel[m.id] || []).sort((a, b)=> cmpCellNumber(a.number, b.number))};
    const total = v.sizes.reduce((s, x)=> s + x.stock, 0);
    const sizesLine = !v.sizes.length ? '<span class="hint">размеров нет</span>'
      : !owner ? sz.map(s=> supplierSizeLine(s.sizeLabel, counts.get(s.id))).join('<br>')
      : v.sizes.map(s=> `<span class="sz">${escapeHtml(s.label)} <b>${s.stock}</b>${s.defect ? ` <span class="warn">брак ${s.defect}</span>` : ''}</span>`).join(' · ');
    const cellsLine = (owner && v.cells.length)
      ? '<div class="cells-line">' + v.cells.map(c=> `Ячейка ${escapeHtml(c.number)} (${escapeHtml(sizesLabel(c.allowedSizes))}) — ${c.stock} шт.${c.reserved && !c.stock ? ' · бронь' : ''}`).join(' · ') + '</div>'
      : '';
    const sup = owner ? `<span class="rmeta">${escapeHtml((sups[m.supplierId] || {}).name || '')}${m.sku ? ' · ' + escapeHtml(m.sku) : ''} · ${escapeHtml(m.category || '')}</span>` : (m.sku ? `<span class="rmeta">${escapeHtml(m.sku)}</span>` : '');
    parts.push(`<div class="card model-card" data-model="${escapeAttr(m.id)}" onclick="openModelModal(${jsArg(m.id)})">
      <div class="model-head"><div style="display:flex;align-items:center;">${photoCell(m.id, phByModel.get(m.id))}<div><div class="rname">${escapeHtml(modelName(m))}</div>${sup}</div></div><div class="big-num">${total}<span> шт.</span></div></div>
      <div class="sizes-line">${sizesLine}</div>${cellsLine}
    </div>`);
  }
  if(models.length > shown.length) parts.push(`<button class="btn ghost" id="ffStockMore" onclick="ffStockLimit += 200; renderStockFF()">Показать ещё (${models.length - shown.length})</button>`);
  list.innerHTML = parts.join('');
  if(typeof fillPhotoThumbs === 'function') fillPhotoThumbs(list);
  if(typeof renderExpected === 'function') await renderExpected();
}
function photoCell(modelId, p){
  if(typeof photoThumb !== 'function') return '';
  return `<span class="model-photo" data-act="photo" onclick="event.stopPropagation()">${p ? photoThumb(p.id, 'Фото товара') : `<label class="ph-add" aria-label="Добавить фото товара"><svg class="icon"><use href="#i-plus"/></svg><input type="file" accept="image/*" hidden onchange="ffModelPhotoPick(${jsArg(modelId)}, this)"></label>`}</span>`;
}
async function ffModelPhotoPick(modelId, input){
  const f = input.files && input.files[0]; if(!f) return;
  try{ await setModelPhoto(modelId, f); toast('Фото сохранено'); }catch(e){ toast('Не получилось: ' + e.message); }
  await renderStockFF();
}
let ffStockLimit = 200;
function ffSetCategory(c){ ffAbcLetter = c; ffStockLimit = 200; renderStockFF(); }

/* ---------------- карточка модели ---------------- */
let mmPicked = [];          // выбранные размеры (подписи)
let mmBarcodes = {};        // подпись → штрихкод

function mmRenderSizes(){
  const all = [...new Set(SIZE_SET.concat(mmPicked))].sort((a, b)=> sizeOrder(a) - sizeOrder(b));
  document.getElementById('mmSizePick').innerHTML = all.map(s=>
    `<button type="button" data-size="${escapeAttr(s)}" class="${mmPicked.includes(s) ? 'on' : ''}" onclick="mmToggleSize(${jsArg(s)})">${escapeHtml(s)}</button>`).join('');
  document.getElementById('mmSizeBarcodes').innerHTML = mmPicked.length
    ? '<div class="hint" style="margin:6px 0 4px;">Штрихкоды размеров — по желанию</div>' + mmPicked.slice().sort((a, b)=> sizeOrder(a) - sizeOrder(b)).map(s=>
      `<div class="field-row bc-row"><span class="sz-tag">${escapeHtml(s)}</span><input type="text" data-bc="${escapeAttr(s)}" value="${escapeAttr(mmBarcodes[s] || '')}" placeholder="штрихкод" oninput="mmBarcodes[this.dataset.bc]=this.value"></div>`).join('')
    : '';
}
function mmToggleSize(s){
  mmPicked = mmPicked.includes(s) ? mmPicked.filter(x=> x !== s) : mmPicked.concat([s]);
  mmRenderSizes();
}
function mmAddCustomSize(){
  const el = document.getElementById('mmSizeCustom');
  const v = (el.value || '').trim().toUpperCase();
  if(!v) return;
  if(!mmPicked.includes(v)) mmPicked.push(v);
  el.value = '';
  mmRenderSizes();
}

async function openModelModal(id){
  const owner = isOwnerRole();
  const m = id ? await get('models', id) : null;
  const priv = (!owner && id) ? await get('privates', id) : null;
  const sups = Object.values(await ffSuppliersMap()).filter(s=> !s.deletedAt && !s.archived);
  document.getElementById('mmTitleHead').textContent = m ? modelName(m) : 'Новый товар';
  document.getElementById('mmId').value = m ? m.id : '';
  if(typeof mmPendingPhoto !== 'undefined') mmPendingPhoto = null;
  if(typeof mmRenderPhoto === 'function') mmRenderPhoto(m ? m.id : null);
  const supSel = document.getElementById('mmSupplier');
  supSel.innerHTML = sups.map(s=> `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  if(m) supSel.value = m.supplierId;
  else if(owner && document.getElementById('ffSupplierFilter').value) supSel.value = document.getElementById('ffSupplierFilter').value;
  supSel.disabled = !!m;               // модель не переезжает к другому поставщику
  document.getElementById('mmSupplierRow').hidden = !owner;
  const cats = await ffCategoryList();
  if(m && m.category && !cats.includes(m.category)) cats.push(m.category);
  document.getElementById('mmCategory').innerHTML = cats.map(c=> `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('') + '<option value="__own">+ Своя категория…</option>';
  document.getElementById('mmCategoryOwn').value = ''; document.getElementById('mmCategoryOwn').hidden = true;
  const setv = (k, v)=>{ const el = document.getElementById(k); if(el) el.value = (v === undefined || v === null) ? '' : v; };
  setv('mmBrand', m && m.brand); setv('mmTitle', m && m.title); setv('mmColor', m && m.color);
  setv('mmCategory', (m && m.category) || ffCategories()[0]); setv('mmCapacity', (m && m.capacity) || 7);
  setv('mmLen', m && m.lenCm); setv('mmWid', m && m.widCm); setv('mmHei', m && m.heiCm);
  setv('mmSku', m && m.sku); setv('mmPrice', m && m.price); setv('mmCalcPrice', m && m.calcPrice);
  setv('mmBuyFrom', priv && priv.buyFrom); setv('mmCost', priv && priv.cost); setv('mmCommission', priv && priv.commissionPercent);
  setv('mmTax', priv && priv.taxPercent); setv('mmPackaging', priv && priv.packaging); setv('mmDelivery', priv && priv.deliveryDiscount);
  document.getElementById('mmCalcPriceRow').hidden = !owner;
  document.getElementById('mmPrivate').hidden = owner;     // личные цифры поставщика складу не показываем вовсе
  const sizes = m ? (await getAll('sizes')).filter(s=> s.modelId === m.id && !s.deletedAt) : [];
  mmPicked = sizes.map(s=> s.sizeLabel);
  mmBarcodes = Object.fromEntries(sizes.map(s=> [s.sizeLabel, s.barcode || '']));
  mmRenderSizes();
  document.getElementById('mmError').classList.remove('show');
  document.getElementById('mmDeleteBtn').hidden = !m;
  await renderModelStockBox(m ? m.id : null);
  document.getElementById('modelModalBg').classList.add('show');
}
function closeModelModal(){ document.getElementById('modelModalBg').classList.remove('show'); }

/* Сохранить модель. form — как поля карточки; возвращает id модели. */
async function saveModel(form){
  const owner = isOwnerRole();
  const supplierId = owner ? form.supplierId : Sync.mySupplierId();
  if(!supplierId) throw new Error('Выберите поставщика');
  if(!String(form.brand || '').trim() && !String(form.title || '').trim()) throw new Error('Укажите бренд или название');
  const existing = form.id ? await get('models', form.id) : null;
  const m = Object.assign({}, existing || {id: newUid(), supplierId}, {
    brand: String(form.brand || '').trim(), title: String(form.title || '').trim(), color: String(form.color || '').trim(),
    category: String(form.category || '').trim() || 'Другое', capacity: Math.min(1000, Math.max(1, parseInt(form.capacity, 10) || 7)),
    lenCm: parseDim(form.lenCm), widCm: parseDim(form.widCm), heiCm: parseDim(form.heiCm),
    sku: String(form.sku || '').trim(), price: Number(form.price) || 0
  });
  if(owner) m.calcPrice = (form.calcPrice === '' || form.calcPrice === undefined || form.calcPrice === null) ? null : Number(form.calcPrice);
  await put('models', m);
  if(!owner){
    const p = Object.assign({}, await get('privates', m.id) || {modelId: m.id, supplierId}, {
      buyFrom: String(form.buyFrom || '').trim(), cost: Number(form.cost) || 0, commissionPercent: Number(form.commissionPercent) || 0,
      taxPercent: Number(form.taxPercent) || 0, packaging: Number(form.packaging) || 0, deliveryDiscount: Number(form.deliveryDiscount) || 0
    });
    await put('privates', p);
  }
  // размеры: новые — добавить, снятые — удалить, если по ним ничего не лежит
  const have = (await getAll('sizes')).filter(s=> s.modelId === m.id && !s.deletedAt);
  for(const label of form.sizes || []) await saveSize(m.id, label, (form.barcodes || {})[label]);
  for(const s of have){
    if((form.sizes || []).includes(s.sizeLabel)) continue;
    if(await ffSizeStock(s.id)) continue;            // с остатком размер не убираем
    s.deletedAt = Date.now(); await put('sizes', s);
  }
  return m.id;
}
async function saveSize(modelId, label, barcode){
  const m = await get('models', modelId);
  const s0 = (await getAll('sizes')).find(s=> s.modelId === modelId && s.sizeLabel === label && !s.deletedAt);
  const s = Object.assign({}, s0 || {id: newUid(), modelId, supplierId: m.supplierId, sizeLabel: label}, {sortKey: sizeOrder(label)});
  if(barcode !== undefined) s.barcode = String(barcode || '').trim();
  if(!s0 || s0.barcode !== s.barcode || s0.sortKey !== s.sortKey) await put('sizes', s);
  return s.id;
}
/* parseDim — из js/boxes? Здесь своя: «20,5» → 20.5, пусто/0/минус → null */
function parseDim(v){
  if(v === null || v === undefined) return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return (isFinite(n) && n > 0) ? n : null;
}
async function saveModelFromForm(){
  const g = id=> (document.getElementById(id) || {}).value;
  if(g('mmCategory') === '__own' && !String(g('mmCategoryOwn') || '').trim()){ const err = document.getElementById('mmError'); err.textContent = 'Напишите свою категорию'; err.classList.add('show'); return; }
  try{
    const savedId = await saveModel({
      id: g('mmId') || null, supplierId: g('mmSupplier'), brand: g('mmBrand'), title: g('mmTitle'), color: g('mmColor'),
      category: g('mmCategory') === '__own' ? String(g('mmCategoryOwn') || '').trim() : g('mmCategory'), capacity: g('mmCapacity'), lenCm: g('mmLen'), widCm: g('mmWid'), heiCm: g('mmHei'),
      sku: g('mmSku'), price: g('mmPrice'), calcPrice: g('mmCalcPrice'), buyFrom: g('mmBuyFrom'), cost: g('mmCost'),
      commissionPercent: g('mmCommission'), taxPercent: g('mmTax'), packaging: g('mmPackaging'), deliveryDiscount: g('mmDelivery'),
      sizes: mmPicked.length ? mmPicked.slice() : ['Единый'],   // товар без размеров (пылесос) — один вариант
      barcodes: Object.assign({}, mmBarcodes)
    });
    if(typeof mmPendingPhoto !== 'undefined' && mmPendingPhoto){ const f = mmPendingPhoto; mmPendingPhoto = null; try{ await setModelPhoto(savedId, f); }catch(e){ toast('Фото не сохранилось: ' + e.message); } }
  }catch(e){
    const err = document.getElementById('mmError'); err.textContent = e.message; err.classList.add('show');
    return;
  }
  closeModelModal();
  toast('Модель сохранена');
  await renderStockFF();
  await updateProductCountPill();
}

/* Удалить модель можно, только когда её нет на складе. Ячейки освобождаются. */
async function deleteModelFF(id){
  const m = await get('models', id);
  if(!m || m.deletedAt) return {ok:false, error:'Модель не найдена'};
  const sizes = (await getAll('sizes')).filter(s=> s.modelId === id && !s.deletedAt);
  const idx = await ffStockIndex();
  const left = sizes.reduce((n, s)=> n + (idx.bySize[s.id] || 0), 0);
  if(left) return {ok:false, error:'На складе ещё ' + left + ' шт. этого товара'};
  for(const c of (await getAll('cells')).filter(c=> c.modelId === id && !c.deletedAt)){ c.modelId = null; c.reserved = false; c.allowedSizes = null; await put('cells', c); }
  for(const s of sizes){ s.deletedAt = Date.now(); await put('sizes', s); }
  m.deletedAt = Date.now(); await put('models', m);
  return {ok:true};
}
async function deleteModelUI(){
  const id = document.getElementById('mmId').value;
  if(!id || !confirm('Удалить товар? Восстановить будет нельзя.')) return;
  const r = await deleteModelFF(id);
  if(!r.ok){ toast(r.error); return; }
  closeModelModal(); toast('Модель удалена'); await renderStockFF(); await updateProductCountPill();
}

/* Старые экраны «Склада» вызывают renderStock — теперь это склад «ФФ». */
window.renderStock = renderStockFF;
