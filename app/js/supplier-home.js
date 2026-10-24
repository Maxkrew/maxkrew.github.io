/* «Fulbro», этап 2б: учёт поставщика — у каждого размера три цифры (ОПИСАНИЕ §11в):
   на складе (можно продать) · едет (поставки, которые склад ещё не принял) · ждёт отправки
   (заказы, которые склад ещё не собрал). Остаток меняет только склад. */

async function supplierCounts(){
  const idx = await ffStockIndex();
  const out = new Map();
  const at = id=> out.get(id) || (out.set(id, {stock: idx.sellableBySize[id] || 0, defect: idx.defectBySize[id] || 0, incoming: 0, waiting: 0}), out.get(id));
  for(const id of Object.keys(idx.sellableBySize)) at(id);
  for(const id of Object.keys(idx.defectBySize)) at(id);
  const expected = new Set((await getAll('receipts')).filter(r=> !r.deletedAt && r.kind === 'ожидается').map(r=> r.id));
  for(const l of await getAll('receiptLines')) if(!l.deletedAt && expected.has(l.receiptId)) at(l.sizeId).incoming += Number(l.qty) || 0;
  const open = new Set((await getAll('shipments')).filter(s=> !s.deletedAt && s.status === 'новая').map(s=> s.id));
  for(const l of await getAll('shipmentLines')) if(!l.deletedAt && !l.collected && open.has(l.shipmentId)) at(l.sizeId).waiting += Number(l.qty) || 0;
  return out;
}

/* Строка размера у поставщика: «L на складе 5 · едет 50 · ждёт отправки 3» (нули не пишем). */
function supplierSizeLine(label, c){
  c = c || {stock: 0, defect: 0, incoming: 0, waiting: 0};
  const flow = [];
  if(c.incoming) flow.push('едет ' + c.incoming);
  if(c.waiting) flow.push('ждёт отправки ' + c.waiting);
  if(c.defect) flow.push('<span class="warn">брак ' + c.defect + '</span>');
  return `<span class="sz">${escapeHtml(label)}: на складе <b class="${stockTone(c.stock)}">${c.stock}</b>${flow.length ? ' <span class="flow">· ' + flow.join(' · ') + '</span>' : ''}</span>`;
}

/* Кнопки «Приход» и «Продал» с главного экрана. */
async function homeGo(kind){
  if(kind === 'incoming'){ showSection('incoming'); if(typeof incStart === 'function') await incStart(); }
  else { showSection('shipments'); if(typeof sellStart === 'function') await sellStart(); }
}

/* «Кончаются размеры» (поставщик, по образцу владельца 24.10.2026): размеры, которых на складе
   0–1 шт. и которые продавались за 2 недели; сверху — что продаётся лучше. */
let runOutAll = false;
async function runningOutList(){
  const since = Date.now() - 14 * 86400000;
  const ships = new Map((await getAll('shipments')).filter(s=> !s.deletedAt && s.status !== 'отменена' && (s.createdTs || 0) >= since).map(s=> [s.id, s]));
  const sold = {};
  for(const l of await getAll('shipmentLines')) if(!l.deletedAt && ships.has(l.shipmentId)) sold[l.sizeId] = (sold[l.sizeId] || 0) + (Number(l.qty) || 0);
  const counts = await supplierCounts(), models = await modelsMap(), out = [];
  for(const s of (await getAll('sizes')).filter(s=> !s.deletedAt && sold[s.id])){
    const m = models[s.modelId]; if(!m || m.deletedAt) continue;
    const c = counts.get(s.id) || {stock: 0, waiting: 0, incoming: 0};
    const left = c.stock - c.waiting;   // свободно: на складе минус ждёт отправки
    if(left <= 1) out.push({model: m, size: s, left, sold: sold[s.id], incoming: c.incoming});
  }
  return out.sort((a, b)=> (b.sold - a.sold) || (a.left - b.left));
}
async function renderRunningOut(){
  const box = document.getElementById('runningOut');
  if(!box) return;
  if(isOwnerRole()){ box.innerHTML = ''; return; }
  const list = await runningOutList();
  if(!list.length){ box.innerHTML = ''; return; }
  const shown = runOutAll ? list : list.slice(0, 5);
  const rows = [];
  for(const x of shown){
    const ph = typeof modelPhoto === 'function' ? await modelPhoto(x.model.id) : null;
    rows.push(`<div class="row-item ro-row" data-runout="${escapeAttr(x.size.id)}"><div class="rmain" style="display:flex;align-items:center;gap:10px;">
        <span class="pp-photo">${ph ? `<img alt="" data-ph-src="${escapeAttr(ph.id)}">` : '<svg class="icon"><use href="#i-box"/></svg>'}</span>
        <span><b>${escapeHtml(modelName(x.model))}</b><br><span class="rmeta">размер ${escapeHtml(sizeText(x.size.sizeLabel))} · продано за 2 недели: ${x.sold}${x.incoming ? ' · едет ' + x.incoming : ''}</span></span></div>
      <div class="rside"><span class="ro-tag${x.left > 0 ? ' one' : ''}">${x.left > 0 ? 'остался ' + x.left : 'закончился'}</span></div></div>`);
  }
  box.innerHTML = `<div class="card ro-card"><div class="grp-title" style="margin-top:0;">Кончаются размеры · ${list.length}</div>${rows.join('')}
    ${list.length > 5 ? `<button class="btn ghost sm" id="runOutMore" onclick="runOutAll = !runOutAll; renderRunningOut()">${runOutAll ? 'Свернуть' : 'Показать все (' + list.length + ')'}</button>` : ''}</div>`;
  if(typeof fillPhotoThumbs === 'function') fillPhotoThumbs(box);
}
