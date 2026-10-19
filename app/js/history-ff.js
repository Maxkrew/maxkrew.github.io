/* «ФФ»: История — все операции, новые сверху, с автором. Поставщик видит свои и без ячеек. */
async function renderHistoryFF(){
  const box = document.getElementById('ffHistoryList');
  if(!box) return;
  const owner = isOwnerRole();
  const sups = await ffSuppliersMap(), models = await modelsMap();
  const labels = Object.fromEntries((await getAll('sizes')).map(s=> [s.id, s.sizeLabel]));
  const sel = document.getElementById('ffHistSupplier');
  if(sel){
    sel.hidden = !owner;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Все поставщики</option>' + Object.values(sups).filter(s=> !s.deletedAt).map(s=> `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    sel.value = cur;
  }
  const sup = owner ? (sel ? sel.value : '') : Sync.mySupplierId();
  const type = (document.getElementById('ffHistType') || {}).value || '';
  const q = ((document.getElementById('ffHistSearch') || {}).value || '').trim().toLowerCase();
  const nameOf = id=> (modelName(models[id] || {}) || '').toLowerCase();
  /* Новые сверху по индексу времени — останавливаемся на 500 подходящих,
     а не сортируем все десятки тысяч операций. */
  const ops = await new Promise((res, rej)=>{
    const out = [];
    const r = tx('ops').index('byTs').openCursor(null, 'prev');
    r.onsuccess = ()=>{
      const cur = r.result;
      if(!cur || out.length >= 500){ res(out); return; }
      const o = cur.value;
      if((!o.deletedAt || o.review === 'отменено') && (!sup || o.supplierId === sup) && (!type || o.type === type) &&
         (!q || nameOf(o.modelId).includes(q) || String(labels[o.sizeId] || '').toLowerCase() === q)) out.push(o);
      cur.continue();
    };
    r.onerror = rej;
  });
  if(!ops.length){ box.innerHTML = emptyState('i-clock', 'Операций пока нет', 'Здесь появятся приход, отправки и правки количества.'); return; }
  box.innerHTML = ops.map(o=>{
    const who = o.authorKind === 'supplier' ? 'поставщик' + (o.authorName ? ' (' + o.authorName + ')' : '') : 'склад' + (o.authorName ? ' (' + o.authorName + ')' : '');
    const cell = owner && o.cellNumber ? ' — ячейка ' + o.cellNumber : '';
    const sign = o.delta > 0 ? 'in' : (o.delta < 0 ? 'out' : '');
    const d = new Date(o.ts);
    const rv = o.review === 'отменено' ? ' · <b>отменено складом</b>' : (o.review === 'на проверке' ? ' · <span class="warn">на проверке</span>' : '');
    return `<div class="row-item hist-row ${sign}${o.deletedAt ? ' cancelled' : ''}"><div class="rmain">
      <div class="rname">${escapeHtml(o.type)} ${Math.abs(o.qty)} шт. — ${escapeHtml(modelName(models[o.modelId] || {}))} ${escapeHtml(labels[o.sizeId] || '')}${escapeHtml(cell)} — ${escapeHtml(who)}</div>
      <div class="rmeta">${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})}${owner ? ' · ' + escapeHtml((sups[o.supplierId] || {}).name || '') : ''}${o.rejected ? ' · <b>не принято сервером</b>' : ''}${rv}</div>
    </div><div class="rside"><span class="rval ${sign}">${o.delta > 0 ? '+' : ''}${o.delta}</span>${owner && !o.deletedAt ? `<button class="icon-btn" data-del-op="${escapeAttr(o.uid)}" onclick="deleteOpUI(${jsArg(o.uid)})" aria-label="Удалить операцию"><svg class="icon"><use href="#i-trash"/></svg></button>` : ''}</div></div>`;
  }).join('');
}
/* Удалить ошибочную операцию (только склад). Остаток вернётся сам — это сумма живых операций.
   Если операция — галочка задания, задание снова становится невыполненным. */
async function deleteOpFF(uid){
  const op = await get('ops', uid);
  if(!op || op.deletedAt) return {ok:false, error:'Операция не найдена'};
  op.deletedAt = Date.now();
  await put('ops', op);
  if(op.taskRef){
    const sl = await get('shipmentLines', op.taskRef);
    if(sl && sl.collected){
      sl.collected = false; await put('shipmentLines', sl);
      const sh = await get('shipments', sl.shipmentId); if(sh && sh.status !== 'новая'){ sh.status = 'новая'; await put('shipments', sh); }
    }
    const rl = await get('receiptLines', op.taskRef);
    if(rl && rl.plan){
      const st = rl.plan.find(s=> s.uid === uid);
      if(st && st.done){
        st.done = false; rl.doneQty = rl.plan.filter(s=> s.done).reduce((n, s)=> n + s.qty, 0); await put('receiptLines', rl);
        const r = await get('receipts', rl.receiptId); if(r && r.status === 'разложено'){ r.status = 'раскладка'; await put('receipts', r); }
      }
    }
  }
  return {ok:true};
}
async function deleteOpUI(uid){
  if(!confirm('Удалить эту операцию? Остаток пересчитается.')) return;
  const r = await deleteOpFF(uid);
  toast(r.ok ? 'Операция удалена' : r.error);
  await renderHistoryFF();
}
window.renderHistory = renderHistoryFF;
