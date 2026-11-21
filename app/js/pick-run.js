/* Fulbro: сборка «один заказ на весь экран» (пункт 2 плана владельца, 21.11.2026).
   — заказы по очереди: крупно фото, товар, размер, количество, ячейка (в режиме «без ячеек» — без неё);
   — скан штрихкода отмечает строку; не тот товар — красная плашка «Не тот товар» и вибрация;
   — «Собран» — сразу следующий заказ; внизу 5 секунд «Отменить» (вместо вопросов «Точно?»);
   — «Пропустить» — заказ остаётся в работе, идём дальше. */

const prState = {ids: [], i: 0, err: ''};

/* «Отменить» вместо «Точно?»: плашка внизу на 5 секунд */
function uiUndo(text, undoFn){
  let el = document.getElementById('uiUndo');
  if(el){ clearTimeout(el._t); el.remove(); }
  el = document.createElement('div');
  el.id = 'uiUndo'; el.className = 'ui-undo'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${escapeHtml(text)}</span><button type="button">Отменить</button>`;
  document.body.appendChild(el);
  el.querySelector('button').onclick = async ()=>{ clearTimeout(el._t); el.remove(); try{ await undoFn(); }catch(e){ toast('Не получилось: ' + e.message); } };
  el._t = setTimeout(()=> el.remove(), 5000);
  requestAnimationFrame(()=> el.classList.add('show'));
}

/* можно ли собрать заказ прямо сейчас: есть несобранное, и всё несобранное — со склада */
async function prCanCollect(id){
  const ls = await shipmentLines(id);
  return ls.length && ls.some(l=> !l.collected) && ls.every(l=> l.collected || l.cellNumber);
}
async function prStart(){
  const ids = [];
  for(const id of shVisible) if(await prCanCollect(id)) ids.push(id);
  if(!ids.length){ toast('Нечего собирать: у заказов нет товара на складе'); return; }
  Object.assign(prState, {ids, i: 0, err: '', skipped: 0});
  let bg = document.getElementById('prRun');
  if(!bg){ bg = document.createElement('div'); bg.id = 'prRun'; bg.className = 'pr-run'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-label', 'Сборка заказов'); document.body.appendChild(bg); }
  bg.hidden = false; document.documentElement.classList.add('pr-open');
  await prRender();
}
function prClose(){
  const bg = document.getElementById('prRun'); if(bg) bg.hidden = true;
  document.documentElement.classList.remove('pr-open');
  renderShipments();
}
async function prRender(){
  const bg = document.getElementById('prRun'); if(!bg) return;
  if(prState.i >= prState.ids.length){
    bg.innerHTML = `<div class="pr-top"><button type="button" class="pr-x" onclick="prClose()" aria-label="Закрыть"><svg class="icon"><use href="#i-x"/></svg></button><b>Сборка</b><span></span></div>
      <div class="pr-done"><svg class="icon"><use href="#i-check"/></svg><b>Все заказы пройдены</b><span>Собрано: ${prState.ids.length - (prState.skipped || 0)} · пропущено: ${prState.skipped || 0}</span>
      <button class="btn primary" onclick="prClose()">Готово</button></div>`;
    return;
  }
  const id = prState.ids[prState.i];
  const s = await get('shipments', id), lines = await shipmentLines(id), models = await modelsMap(), sups = await ffSuppliersMap();
  const noCells = typeof ffNoCells === 'function' && ffNoCells();
  const rows = [];
  for(const l of lines){
    const m = models[l.modelId] || {};
    const mp = typeof modelPhoto === 'function' ? await modelPhoto(l.modelId) : null;
    const where = noCells ? '' : (/^П/.test(l.cellNumber || '') ? 'с пола' : 'ячейка ' + escapeHtml(l.cellNumber || '?'));
    rows.push(`<div class="pr-line${l.collected ? ' done' : ''}" data-pr-line="${escapeAttr(l.id)}">
      <div class="pr-ph">${mp ? `<img alt="" data-ph-src="${escapeAttr(mp.id)}">` : '<svg class="icon"><use href="#i-box"/></svg>'}</div>
      <div class="pr-info"><b>${escapeHtml(modelName(m))}</b><span class="pr-size">${escapeHtml(await sizeLabelOf(l.sizeId))} · ${l.qty} шт.</span>${where ? `<span class="pr-cell">${where}</span>` : ''}</div>
      <span class="pr-check">${l.collected ? '<svg class="icon"><use href="#i-check"/></svg>' : ''}</span></div>`);
  }
  const all = lines.length && lines.every(l=> l.collected);
  const n = prState.ids.length, k = prState.i + 1;
  bg.innerHTML = `<div class="pr-top"><button type="button" class="pr-x" onclick="prClose()" aria-label="Закрыть сборку"><svg class="icon"><use href="#i-x"/></svg></button>
      <b>Заказ ${k} из ${n}</b><span class="pr-bar"><i style="width:${Math.round((k - 1) / n * 100)}%"></i></span></div>
    <div class="pr-body">
      <div class="pr-head">${carrierBadge(s.carrier)}<div><b>${s.track ? trackHtml(s.track) : 'Трека нет'}</b><span class="pr-sub">${escapeHtml((sups[s.supplierId] || {}).name || '')} · ${escapeHtml(s.carrier)}${s.comment ? ' · ' + escapeHtml(s.comment) : ''}</span></div></div>
      ${prState.err ? `<div class="pr-err" role="alert">${escapeHtml(prState.err)}</div>` : ''}
      <div class="pr-lines">${rows.join('')}</div>
      <div class="field-row pr-scan"><input type="text" id="prScan" placeholder="Скан штрихкода товара" autocomplete="off" aria-label="Скан штрихкода товара">
        <button type="button" class="icon-btn" onclick="openCameraScan(c=> prScan(c))" aria-label="Сканировать камерой"><svg class="icon"><use href="#i-camera"/></svg></button></div>
    </div>
    <div class="pr-foot"><button class="btn ghost" id="prSkip" onclick="prNext(true)">Пропустить</button>
      <button class="btn primary" id="prDone" onclick="prCollect()"><svg class="icon"><use href="#i-check"/></svg>${all ? 'Дальше' : 'Собран'}</button></div>`;
  if(typeof fillPhotoThumbs === 'function') fillPhotoThumbs(bg);
  const inp = document.getElementById('prScan');
  if(inp && typeof wireScanInput === 'function') wireScanInput(inp, c=> prScan(c));
}
/* скан: нужный товар — отмечен; чужой — красная плашка и вибрация */
async function prScan(code){
  const id = prState.ids[prState.i]; if(!id) return;
  const r = await scanIntoShipment(id, code);
  if(r.ok){ prState.err = ''; try{ playSound('Приход'); }catch(e){} }
  else {
    try{ playErrorSound(); }catch(e){}
    try{ navigator.vibrate && navigator.vibrate([200, 80, 200]); }catch(e){}
    const sz = typeof sizesByBarcode === 'function' ? await sizesByBarcode(code) : [];
    const models = await modelsMap();
    const what = sz.length ? modelName(models[sz[0].modelId] || {}) + ' ' + sz[0].sizeLabel : 'штрихкод ' + code;
    prState.err = /уже собран/.test(r.error || '') && sz.length && (await shipmentLines(id)).some(l=> sz.some(x=> x.id === l.sizeId))
      ? 'Этот товар уже отмечен: ' + what
      : 'Не тот товар: ' + what + ' — в этом заказе его нет';
  }
  await prRender();
  const inp = document.getElementById('prScan'); if(inp) inp.focus();
}
async function prCollect(){
  const id = prState.ids[prState.i]; if(!id) return;
  const ls = await shipmentLines(id);
  if(ls.some(l=> !l.collected)){
    const r = await shCollectAll(id);
    if(!r.ok){ toast(r.error); return; }
    const s = await get('shipments', id);
    uiUndo('Собран · ' + (s && s.track ? s.track : s && s.carrier || 'заказ'), async ()=>{ await shUncollectAll(id); toast('Сборка отменена — заказ снова в работе'); if(!document.getElementById('prRun') || document.getElementById('prRun').hidden) renderShipments(); });
  }
  prNext(false);
}
function prNext(skip){
  if(skip) prState.skipped = (prState.skipped || 0) + 1;
  prState.i++; prState.err = '';
  prRender();
}
