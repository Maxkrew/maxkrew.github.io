/* Fulbro: экран «Сегодня» у склада (по образцу владельца, 24.10.2026) — плитки «что ждёт
   работы»; нажал плитку — открылся нужный раздел. */
async function renderToday(){
  const box = document.getElementById('todayBox');
  if(!box) return;
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const ships = (await getAll('shipments')).filter(s=> !s.deletedAt && s.status !== 'отменена');
  const open = ships.filter(s=> s.status !== 'собрана');
  const newToday = ships.filter(s=> s.createdBy === 'supplier' && (s.createdTs || 0) >= from.getTime()).length;
  const doneToday = typeof shCollectedToday === 'function' ? (await shCollectedToday(ships)).length : 0;
  const review = typeof reviewItems === 'function' ? (await reviewItems()).length : 0;
  const receipts = (await getAll('receipts')).filter(r=> !r.deletedAt);
  const expected = receipts.filter(r=> r.kind === 'ожидается').length;
  let notPlaced = 0;
  for(const r of receipts.filter(r=> r.kind !== 'ожидается')) if(!(await receiptIsDone(r.id))) notPlaced++;
  const sups = Object.values(await ffSuppliersMap()).filter(s=> !s.deletedAt && !s.archived);
  let floor = 0, debt = 0;
  for(const s of sups){
    if(typeof floorLeftovers === 'function') for(const x of await floorLeftovers(s.id)) floor += x.qty;
    if(typeof supplierBilling === 'function') debt += Math.max(0, (await supplierBilling(s.id)).debt);
  }
  const tile = (id, icon, n, label, sub, go, warn)=> `<button type="button" class="td-tile${warn && n ? ' warn' : ''}" data-today="${id}" onclick="showSection(${jsArg(go)})">
      <svg class="icon"><use href="#${icon}"/></svg><b>${n}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ''}</button>`;
  box.innerHTML = `<div class="td-grid">
    ${tile('new', 'i-out', newToday, 'новых заказов сегодня', 'от поставщиков', 'shipments')}
    ${tile('open', 'i-box', open.length, 'не собрано', 'собрано сегодня: ' + doneToday, 'shipments', true)}
    ${tile('review', 'i-check', review, 'проверить', review ? 'поставщик поправил остаток' : 'всё проверено', 'shipments', true)}
    ${tile('expected', 'i-in', expected, 'ожидается поставок', 'нажмите «Принять» на складе', 'stock')}
    ${tile('receipts', 'i-in', notPlaced, 'не разложено', 'открытые приёмки', 'receipts', true)}
    ${tile('floor', 'i-grid', floor, 'шт. лежит на полу', 'сверх заказов', 'receipts', true)}
    ${tile('debt', 'i-coins', fmtMoney(debt), 'долг поставщиков', 'за отправки и приёмку', 'suppliers')}
  </div>`;
}
