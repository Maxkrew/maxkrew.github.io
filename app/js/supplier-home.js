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
  return `<span class="sz">${escapeHtml(label)}: на складе <b>${c.stock}</b>${flow.length ? ' <span class="flow">· ' + flow.join(' · ') + '</span>' : ''}</span>`;
}

/* Кнопки «Приход» и «Продал» с главного экрана. */
async function homeGo(kind){
  if(kind === 'incoming'){ showSection('incoming'); if(typeof incStart === 'function') await incStart(); }
  else { showSection('shipments'); if(typeof sellStart === 'function') await sellStart(); }
}
