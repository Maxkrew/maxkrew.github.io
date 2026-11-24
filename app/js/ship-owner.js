/* Fulbro: «Отправки» у склада по проекту v3 (владелец, 21.11.2026: «не 50 кнопок, как пульт от самолёта»).
   — каждая отправка — одна строка: служба, трек, статус; ниже поставщик, сколько товаров, время, маленькие фото;
     нажал — раскрылась (галочки, ячейки, «Собран»); смахнул вправо — «Собран»;
   — сверху переключатель «Собрать · Готово · История» и плашки включённых фильтров;
   — внизу у большого пальца: поиск, «Фильтр» (поставщик, служба, товар, «Выбрать несколько»), «+» — новая отправка.
   Старые кнопки и поля остались с теми же id — переехали в шторки. */

const shOpenIds = new Set();   // какие отправки раскрыты
function shToggleOpen(id){ if(shOpenIds.has(id)) shOpenIds.delete(id); else shOpenIds.add(id); renderShipments(); }

async function renderShipmentsOwner(box, list, open, done, q){
  const sups = await ffSuppliersMap();
  const bySup = l=> shFilter ? l.filter(s=> s.supplierId === shFilter) : l;
  const byCar = l=> shCarrierFilter ? l.filter(s=> s.carrier === shCarrierFilter) : l;
  const byModel = async (l, onlyOpenLines)=>{
    if(!shModelFilter) return l;
    const has = new Set((await getAll('shipmentLines')).filter(x=> !x.deletedAt && (!onlyOpenLines || !x.collected) && x.modelId === shModelFilter).map(x=> x.shipmentId));
    return l.filter(s=> has.has(s.id));
  };
  const shown = await byModel(byCar(bySup(open)), true);
  shVisible = shown.map(s=> s.id);
  for(const id of [...shSelected]) if(!shVisible.includes(id)) shSelected.delete(id);
  const today = await shCollectedToday(bySup(list));
  const recent = await byModel(byCar(today.length ? today : bySup(done)), false);
  const progress = await assemblyHeader(open, list);   // заодно собирает shFiltersHtml для шторки «Фильтр»
  const sub = document.querySelector('#sec-shipments .page-head p');
  if(sub) sub.hidden = true;   // цифры — в полосе «собрано X / Y» и на переключателе

  const parts = [];
  const seg = (v, label, n)=> `<button type="button" role="tab" aria-selected="${shView === v}" class="${shView === v ? 'on' : ''}" data-sh-view="${v}" onclick="shSetView('${v}')">${label}${n !== null ? ' <em>' + n + '</em>' : ''}</button>`;
  parts.push(`<div class="sh-seg glass" role="tablist">${seg('work', 'Собрать', shown.length)}${seg('done', 'Готово', today.length)}${seg('history', 'История', null)}</div>`);
  // включённые фильтры — плашками с крестиком
  const act = [];
  if(shFilter) act.push(`<button type="button" class="sh-af" onclick="shSetFilter('')">${escapeHtml((sups[shFilter] || {}).name || 'Поставщик')}</button>`);
  if(shCarrierFilter) act.push(`<button type="button" class="sh-af" onclick="shSetCarrier('')">${escapeHtml(shCarrierFilter)}</button>`);
  if(shModelFilter){ const m = (await modelsMap())[shModelFilter]; act.push(`<button type="button" class="sh-af" onclick="shSetModel('')">${escapeHtml(m ? modelName(m) : 'Товар')}</button>`); }
  if(act.length && shView !== 'history') parts.push(`<div class="sh-afs">${act.join('')}</div>`);

  if(shView === 'history'){
    parts.push(await renderArchive());
  } else if(q.trim()){
    const hits = (await shMatches(list, q)).slice(0, SH_RECENT);
    for(const s of hits) parts.push(await shItem(s, s.status !== 'собрана'));
    if(!hits.length) parts.push('<div class="hint">Ничего не найдено</div>');
  } else if(shView === 'done'){
    if(typeof statsCard === 'function') parts.push(await statsCard(shFilter));   // статистика и начисления за период
    if(recent.length){
      parts.push('<div class="grp-title">' + (today.length ? 'Собранные сегодня · ' + recent.length : 'Собраны недавно') + '</div>');
      for(const s of recent) parts.push(await shItem(s, false));
    } else parts.push(emptyState('i-check', 'Сегодня ещё ничего не собрали', 'Собранные отправки появятся здесь.'));
  } else {
    if(typeof renderReviewBlock === 'function') parts.push(await renderReviewBlock());
    parts.push(progress);
    /* 21.11.2026: сборка «один заказ на весь экран» (js/pick-run.js) */
    if(shown.length && !shSelectMode) parts.push(`<button class="btn primary pr-start" id="prStartBtn" onclick="prStart()"><svg class="icon"><use href="#i-check"/></svg>Собирать по одному · ${shown.length}</button>`);
    for(const s of shown) parts.push(await shItem(s, true));
    if(!shown.length) parts.push(emptyState('i-out', 'Несобранных отправок нет', 'Нажмите «+» внизу — новая отправка.'));
  }
  // внизу у большого пальца: поиск, фильтр, «+»
  const nf = (shFilter ? 1 : 0) + (shCarrierFilter ? 1 : 0) + (shModelFilter ? 1 : 0);
  parts.push(`<div class="sh-dock" id="shDock">${shView === 'history' ? '<span class="sh-dock-sp"></span>' : `<label class="sh-sbox glass"><svg class="icon"><use href="#i-search"/></svg><input type="search" id="shSearch" class="sh-search" placeholder="Трек, товар, комментарий" value="${escapeAttr(q)}" oninput="arRefresh()" aria-label="Поиск отправок"></label>
    <button type="button" class="sh-dbtn glass" id="shFilterBtn" onclick="shOpenFilters()" aria-label="Фильтр"><svg class="icon"><use href="#i-filter"/></svg>${nf ? '<sup>' + nf + '</sup>' : ''}</button>`}
    <button type="button" class="sh-dbtn sh-plus" id="shNewBtn" onclick="shOpenNew()" aria-label="Новая отправка"><svg class="icon"><use href="#i-plus"/></svg></button></div>`);
  ffSetHtmlKeepFocus(box, parts.join(''));   // поле поиска не пересоздаём
  wireFFScanInputs();
  if(typeof fillPhotoThumbs === 'function') fillPhotoThumbs(box);
  shInitSwipes(box);
  const fb = document.getElementById('shFilterBody'); if(fb) fb.innerHTML = shFiltersHtml;
}

/* одна отправка: раскрытая — полная карточка, иначе — строка */
async function shItem(s, editable){
  /* 21.11.2026 (владелец): у склада — полная карточка с большими фото товаров (сборщику нужны фото); строка shRow — запасная */
  return await shipmentCard(s, editable);
}
async function shRow(s){
  const sups = await ffSuppliersMap(), lines = await shipmentLines(s.id);
  const n = lines.reduce((a, l)=> a + (Number(l.qty) || 0), 0);
  const waits = lines.some(l=> !l.collected && !l.cellNumber);
  const canCollect = s.status !== 'собрана' && lines.length && lines.some(l=> !l.collected) && lines.every(l=> l.collected || l.cellNumber);
  const st = s.status === 'собрана' ? ['done', 'собран'] : !lines.length ? ['warn', 'пусто'] : waits ? ['warn', 'ждёт'] : ['new', 'заброн'];
  const cd = s.createdTs ? new Date(s.createdTs) : null, p2 = x=> String(x).padStart(2, '0');
  const isToday = cd && dayStart(cd.getTime()) === dayStart(Date.now());
  const when = cd ? (isToday ? p2(cd.getHours()) + ':' + p2(cd.getMinutes()) : p2(cd.getDate()) + '.' + p2(cd.getMonth() + 1)) : '';
  const mins = [];
  if(typeof modelPhoto === 'function') for(const mid of [...new Set(lines.map(l=> l.modelId))].slice(0, 3)){ const mp = await modelPhoto(mid); if(mp) mins.push('<span class="sh-mini-ph"><img alt="" data-ph-src="' + escapeAttr(mp.id) + '"></span>'); }
  const meta = [`<b>${escapeHtml((sups[s.supplierId] || {}).name || '')}</b>`, n + ' ' + uiWord(n, 'товар', 'товара', 'товаров'), when].concat(s.createdBy === 'supplier' ? ['от поставщика'] : []).filter(Boolean).join(' · ');
  return `<div class="card sh-row" data-shipment="${escapeAttr(s.id)}" data-row${canCollect ? ' data-can-collect' : ''}>
    <div class="sh-swipe-under" aria-hidden="true"><svg class="icon"><use href="#i-check"/></svg>Собран</div>
    <div class="sh-row-in" role="button" tabindex="0" onclick="shToggleOpen(${jsArg(s.id)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();shToggleOpen(${jsArg(s.id)})}" aria-expanded="false" aria-label="Открыть отправку">
      <span class="sh-row-main">${carrierBadge(s.carrier)}<span class="sh-row-track">${s.track ? trackHtml(s.track) : 'Трека нет'}</span>${shIsDup(s) ? '<span class="sh-dup" data-dup>Дубль ❗</span>' : ''}<span class="sh-status st-${st[0]}">${st[1]}</span></span>
      <span class="sh-row-sub"><span class="sh-row-meta">${meta}</span>${mins.length ? '<span class="sh-mini">' + mins.join('') + '</span>' : ''}</span>
    </div></div>`;
}

/* смахнуть строку вправо — «Собран» (как в Things 3) */
function shInitSwipes(box){
  box.querySelectorAll('.sh-row').forEach(row=>{
    const inner = row.querySelector('.sh-row-in'); if(!inner) return;
    let x0 = null, y0 = 0, dx = 0, drag = false;
    inner.addEventListener('touchstart', e=>{ x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; drag = false; }, {passive: true});
    inner.addEventListener('touchmove', e=>{
      if(x0 === null) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if(!drag && Math.abs(my) > Math.abs(mx)){ x0 = null; return; }
      if(mx > 8) drag = true;
      if(drag){ dx = Math.max(0, Math.min(mx, 140)); inner.style.transform = `translateX(${dx}px)`; row.classList.add('sw-on'); row.classList.toggle('sw-go', dx > 90); }
    }, {passive: true});
    inner.addEventListener('touchend', async e=>{
      if(x0 === null) return; x0 = null;
      inner.style.transform = ''; row.classList.remove('sw-go', 'sw-on');
      if(!drag) return;
      e.preventDefault();
      if(dx > 90){
        if(row.hasAttribute('data-can-collect')) await shCollect(row.dataset.shipment);
        else toast('Сначала откройте отправку: товары не готовы к сборке');
      }
    });
  });
}

/* ---------- шторки ---------- */
function shOpenFilters(){
  uiSheet({title: 'Фильтр', html: `<div id="shFilterBody" class="sh-filters">${shFiltersHtml}</div>`});
}
/* «+»: новая отправка — те же поля, что раньше были на экране (id не менялись) */
async function shOpenNew(){
  const sups = Object.values(await ffSuppliersMap()).filter(s=> !s.deletedAt && !s.archived).sort((a, b)=> String(a.name).localeCompare(String(b.name), 'ru'));
  const cars = carrierList();
  const html = `<div class="sh-new">
    <div class="field"><label>Служба</label><div class="sh-cars" role="radiogroup">${cars.map((c, i)=> `<button type="button" role="radio" aria-checked="${i === 0}" class="sh-car${i === 0 ? ' on' : ''}" data-car="${escapeAttr(c)}" onclick="shPickCar(this.dataset.car)">${carrierBadge(c)}<span>${escapeHtml(c)}</span></button>`).join('')}</div>
      <select id="shCarrier" hidden onchange="shPickCar(this.value)">${cars.map(c=> `<option>${escapeHtml(c)}</option>`).join('')}</select></div>
    <div class="field"><label for="shTrack">Трек-номер</label><div class="field-row"><input type="text" id="shTrack" maxlength="60" placeholder="Введите или загрузите скриншот" autocomplete="off" oninput="shTrackGuess(this.value)">
      <label class="btn ghost" id="shBarcodeBtn" style="width:auto;white-space:nowrap;"><svg class="icon"><use href="#i-upload"/></svg>Штрихкод<input type="file" accept="image/*" hidden onchange="shPickBarcode(this)"></label></div>
      <div class="sh-new-bc"><div class="sell-thumb" id="shBarcodeThumb"></div><div class="hint sell-detect" id="shDetect" role="status"></div></div></div>
    <div class="field"><label for="shSupplier">Поставщик</label><select id="shSupplier">${sups.map(s=> `<option value="${escapeAttr(s.id)}"${s.id === shFilter ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="shComment">Комментарий</label><input type="text" id="shComment" placeholder="Комментарий"></div>
    <button class="btn primary" id="shStart" onclick="shStart()"><svg class="icon"><use href="#i-plus"/></svg>Создать отправку</button></div>`;
  uiSheet({title: 'Новая отправка', done: 'Закрыть', html, onReady: ()=>{ shShowBarcode(); }});
}
function shPickCar(c){
  const sel = document.getElementById('shCarrier'); if(sel) sel.value = c;
  document.querySelectorAll('.sh-car').forEach(b=>{ const on = b.dataset.car === c; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
}
/* «+ Товар» в раскрытой отправке: товар, размер, количество — в шторке */
async function shOpenAddLine(sid){
  const s = await get('shipments', sid); if(!s) return;
  const models = await modelsMap();
  const ms = Object.values(models).filter(m=> !m.deletedAt && m.supplierId === s.supplierId).sort((a, b)=> modelName(a).localeCompare(modelName(b), 'ru'));
  const id = escapeAttr(sid);
  uiSheet({title: 'Добавить товар', html: `<div class="field"><label for="shModel-${id}">Товар</label><select id="shModel-${id}" data-products="ship" data-sizes="shSizes-${id}" onchange="shFillSizes(${jsArg(sid)})"><option value="">— выберите товар —</option>${ms.map(m=> `<option value="${escapeAttr(m.id)}">${escapeHtml(modelName(m))}</option>`).join('')}</select></div>
    <div class="size-pick" id="shSizes-${id}"></div>
    <div class="field"><label for="shQty-${id}">Сколько</label><div class="field-row"><input type="number" id="shQty-${id}" min="1" value="1" inputmode="numeric"><button class="btn primary" style="width:auto;" onclick="shAddLine(${jsArg(sid)})">Добавить</button></div></div>`});
}
/* «⋯» в раскрытой отправке */
async function shCardMenu(btn, sid){
  const s = await get('shipments', sid); if(!s) return;
  const lines = await shipmentLines(sid);
  const items = [{label: s.track ? 'Изменить трек-номер' : 'Добавить трек-номер', icon: 'i-edit', run: ()=> shTrackEdit(sid)}];
  /* 21.11.2026 (владелец): «Штрихкод» — в «⋯», а не кнопкой в карточке */
  const hasBc = typeof shipmentPhotos === 'function' && (await shipmentPhotos(sid)).some(p=> p.kind === 'штрихкод');
  if(!hasBc) items.push({label: 'Добавить скриншот штрихкода', icon: 'i-upload', run: ()=>{ const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = ()=> shAddBarcodePick(sid, i); i.click(); }});
  if(s.status !== 'собрана' && s.createdBy !== 'supplier') items.push({label: 'Отменить отправку', icon: 'i-x', danger: true, run: ()=> lines.some(l=> l.collected) ? toast('Часть уже собрана — сначала снимите галочки') : shCancel(sid)});
  uiMenu(btn, items);
}
