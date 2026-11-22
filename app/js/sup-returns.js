/* Fulbro: «Возвраты» поставщика — как в «Складе» (владелец, 22.11.2026): «Возвраты» и «Повреждённые»,
   «+» — оформить возврат, корзина — только у возврата, который склад ещё не забрал.
   Брак определяет склад: разбирает забранный возврат, у строки «Брак» — товар в ячейку брака,
   у поставщика он сам попадает в «Повреждённые»; остальное — в «Возвратах». */

const retState = {tab: 'ret', sel: new Set()};

/* строки возвратов поставщика: {id, line, receipt, ts, modelId, sizeId, qty, status, expected, damaged} */
async function supReturns(){
  const sup = Sync.mySupplierId();
  const recs = new Map((await getAll('receipts')).filter(r=> !r.deletedAt && (r.isReturn || r.kind === 'возврат') && (!sup || r.supplierId === sup)).map(r=> [r.id, r]));
  const out = [];
  for(const l of await getAll('receiptLines')){
    if(l.deletedAt || !recs.has(l.receiptId)) continue;
    const r = recs.get(l.receiptId), expected = r.kind === 'ожидается', placed = r.status === 'разложено';
    out.push({id: l.id, line: l, receipt: r, ts: Number(r.createdTs) || 0, modelId: l.modelId, sizeId: l.sizeId, qty: Number(l.qty) || 0,
      status: expected ? 'едет на склад' : !placed ? 'склад проверяет' : l.defect ? 'склад положил в брак' : 'на складе, можно продавать', expected, damaged: !expected && !!l.defect});
  }
  return out.sort((a, b)=> b.ts - a.ts);
}
async function renderSupReturns(){
  const box = document.getElementById('supReturnsBox'); if(!box) return;
  const all = await supReturns(), models = await modelsMap();
  const labels = Object.fromEntries((await getAll('sizes')).map(s=> [s.id, s.sizeLabel]));
  const rows = all.filter(r=> retState.tab === 'ret' ? !r.damaged : r.damaged);
  for(const id of [...retState.sel]) if(!rows.some(r=> r.id === id)) retState.sel.delete(id);
  const nRet = all.filter(r=> !r.damaged).length, nDam = all.filter(r=> r.damaged).length;
  const item = r=>{
    const m = models[r.modelId] || {}, lab = labels[r.sizeId] && labels[r.sizeId] !== 'Единый' ? ' ' + labels[r.sizeId] : '';
    const d = new Date(r.ts);
    return `<div class="row-item ret-row" data-ret="${escapeAttr(r.id)}">
      <label class="ops-check"><input type="checkbox" ${retState.sel.has(r.id) ? 'checked' : ''} onchange="retToggle(${jsArg(r.id)}, this.checked)" aria-label="Выбрать"></label>
      <div class="rmain"><div class="rname">${escapeHtml(modelName(m) + lab)}</div><div class="rmeta">${m.sku ? escapeHtml(m.sku) + ' · ' : ''}${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}</div><div class="rmeta">${escapeHtml(r.status)}</div></div>
      <span class="ops-qty num ${r.damaged ? 'neg' : 'pos'}">+${r.qty} шт</span>
      ${r.expected ? `<button type="button" class="icon-btn ret-del" onclick="supRetCancel([${jsArg(r.id)}])" aria-label="Отменить возврат"><svg class="icon"><use href="#i-trash"/></svg></button>` : ''}</div>`;
  };
  const selN = retState.sel.size;
  box.innerHTML = `<div class="period-seg ret-tabs"><button type="button" data-ret-tab="ret" class="${retState.tab === 'ret' ? 'active' : ''}" onclick="retSetTab('ret')">Возвраты${nRet ? ' · ' + nRet : ''}</button><button type="button" data-ret-tab="dmg" class="${retState.tab === 'dmg' ? 'active' : ''}" onclick="retSetTab('dmg')">Повреждённые${nDam ? ' · ' + nDam : ''}</button></div>
    ${selN ? `<div class="ret-bar"><span>Выбрано: ${selN}</span><button type="button" class="btn ghost sm" onclick="supRetCancel([...retState.sel])"><svg class="icon"><use href="#i-trash"/></svg>Отменить</button></div>` : ''}
    <div class="card ret-card">${rows.map(item).join('') || emptyState('i-inbox', retState.tab === 'ret' ? 'Возвратов нет' : 'Повреждённых нет', retState.tab === 'ret' ? 'Нажмите «+» вверху, чтобы оформить возврат.' : 'Здесь появится то, что склад при проверке возврата отметил браком.')}</div>`;
}
function retSetTab(t){ retState.tab = t; retState.sel.clear(); renderSupReturns(); }
function retToggle(id, on){ on ? retState.sel.add(id) : retState.sel.delete(id); renderSupReturns(); }
function retNew(){ showSection('shipments'); if(typeof sellStart === 'function') sellStart('return'); }
/* корзина — только возврат, который ещё едет (склад не забрал); со склада — нельзя */
async function supRetCancel(ids){
  const rows = (await supReturns()).filter(r=> ids.includes(r.id));
  const can = rows.filter(r=> r.expected), undo = [];
  for(const r of can){ const res = await removeIncomingLine(r.id); if(res.ok) undo.push(async ()=>{ const l = await get('receiptLines', r.id); if(l){ delete l.deletedAt; await put('receiptLines', l); } }); }
  // весь возврат пуст — убираем и его
  for(const rid of new Set(can.map(r=> r.receipt.id))){ if(!(await receiptLines(rid)).length){ const rc = await get('receipts', rid); if(rc && rc.kind === 'ожидается'){ rc.deletedAt = Date.now(); await put('receipts', rc); undo.push(async ()=>{ const x = await get('receipts', rid); if(x){ delete x.deletedAt; await put('receipts', x); } }); } } }
  retState.sel.clear(); retSync();
  await renderSupReturns();
  if(rows.length && !can.length){ toast('Склад уже забрал этот возврат — отменить нельзя'); return; }
  if(can.length) uiUndo('Отменено: ' + can.length + ' ' + ruPlural(can.length, 'возврат', 'возврата', 'возвратов') + (rows.length > can.length ? ' (остальные склад уже забрал)' : ''), async ()=>{ for(const f of undo.reverse()) await f(); retSync(); await renderSupReturns(); });
}
function retSync(){ if(window.Sync && Sync.syncNow && typeof ffSoft === 'function') ffSoft(()=> Sync.syncNow('возвраты')); }

