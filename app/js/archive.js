/* Fulbro: история отправок и возвратов (пожелание FoG, 28.10.2026) — ничего не пропадает:
   собранные, забронированные, отменённые и удалённые отправки, все возвраты. Фильтры:
   поставщик, товар, служба, статус, период; поиск по трек-номеру, товару, комментарию.
   Отправки — такими же карточками, как в работе: служба, трек, скриншот, товары (FoG, 05.11.2026). */
let shView = 'work';              // «Отправки»: 'work' — в работе, 'history' — история
let arKind = 'ship';              // в истории: 'ship' — отправки, 'ret' — возвраты
let arLimit = 100;

const arStatusText = s=> s.deletedAt ? 'удалена' : (s.status === 'новая' ? 'забронировано' : s.status);
const arVal = id=> ((document.getElementById(id) || {}).value || '');

async function renderArchive(){
  const owner = isOwnerRole();
  const sups = await ffSuppliersMap(), models = await modelsMap();
  const labels = Object.fromEntries((await getAll('sizes')).map(s=> [s.id, s.sizeLabel]));
  const keep = {q: arVal('arSearch'), sup: arVal('arSupplier'), model: arVal('arModel'), status: arVal('arStatus'), period: arVal('arPeriod') || '30', carrier: arVal('arCarrier')};
  const supList = Object.values(sups).filter(s=> !s.deletedAt).sort((a, b)=> String(a.name).localeCompare(String(b.name), 'ru'));
  const modelList = Object.values(models).filter(m=> !m.deletedAt && (!keep.sup || m.supplierId === keep.sup)).sort((a, b)=> modelName(a).localeCompare(modelName(b), 'ru'));
  const from = keep.period === 'all' ? 0 : (keep.period === 'today' ? dayStart(Date.now()) : dayStart(Date.now()) - (Number(keep.period) - 1) * 86400000);
  const q = keep.q.trim().toLowerCase();
  const tab = (id, label)=> `<button type="button" class="as-chip${arKind === id ? ' on' : ''}" data-ar-kind="${id}" onclick="arSetKind('${id}')">${label}</button>`;
  const opt = (v, label, cur)=> `<option value="${escapeAttr(v)}"${cur === v ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const filters = `<div class="card ar-filters">
    <input type="search" id="arSearch" placeholder="${arKind === 'ship' ? 'Поиск: трек-номер, товар, комментарий' : 'Поиск: товар'}" value="${escapeAttr(keep.q)}" oninput="arRefresh()">
    <div class="field-row" style="margin-top:8px;">
      ${owner ? `<select id="arSupplier" onchange="arRefresh()">${opt('', 'Все поставщики', keep.sup)}${supList.map(s=> opt(s.id, s.name, keep.sup)).join('')}</select>` : ''}
      <select id="arModel" onchange="arRefresh()">${opt('', 'Все товары', keep.model)}${modelList.map(m=> opt(m.id, modelName(m), keep.model)).join('')}</select></div>
    ${arKind === 'ship' ? `<div class="field-row" style="margin-top:8px;">
      <select id="arCarrier" onchange="arRefresh()">${opt('', 'Все службы', keep.carrier)}${carrierList().map(c=> opt(c, c, keep.carrier)).join('')}</select>
      <select id="arStatus" onchange="arRefresh()">${opt('', 'Все статусы', keep.status)}${opt('забронировано', 'Забронировано', keep.status)}${opt('собрана', 'Собрана', keep.status)}${opt('отменена', 'Отменена', keep.status)}${opt('удалена', 'Удалена', keep.status)}</select></div>` : ''}
    <div class="field-row" style="margin-top:8px;">
      <select id="arPeriod" onchange="arRefresh()">${opt('today', 'Сегодня', keep.period)}${opt('7', '7 дней', keep.period)}${opt('30', '30 дней', keep.period)}${opt('90', '90 дней', keep.period)}${opt('all', 'Всё время', keep.period)}</select></div></div>`;

  const rows = [];
  let total = 0, lastDay = '';
  if(arKind === 'ship'){
    const linesBy = {};
    for(const l of await getAll('shipmentLines')) if(!l.deletedAt) (linesBy[l.shipmentId] || (linesBy[l.shipmentId] = [])).push(l);
    const list = (await getAll('shipments')).filter(s=> (s.createdTs || 0) >= from && (!keep.sup || s.supplierId === keep.sup) && (!keep.carrier || s.carrier === keep.carrier) && (owner || s.supplierId === Sync.mySupplierId()))
      .sort((a, b)=> (b.createdTs || 0) - (a.createdTs || 0));
    for(const s of list){
      const ls = linesBy[s.id] || [];
      if(keep.model && !ls.some(l=> l.modelId === keep.model)) continue;
      const st = arStatusText(s);
      if(keep.status && st !== keep.status) continue;
      const items = ls.map(l=> modelName(models[l.modelId] || {}) + ' ' + sizeText(labels[l.sizeId] || '') + ' ×' + l.qty).join(', ');
      const tq = trackKey(q);
      if(q && !((tq && trackKey(s.track).includes(tq)) || items.toLowerCase().includes(q) || String(s.comment || '').toLowerCase().includes(q))) continue;
      total++;
      if(rows.length >= arLimit) continue;
      const day = new Date(s.createdTs || 0).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'});
      rows.push((day !== lastDay ? `<div class="ar-date">${day}</div>` : '') + await shipmentCard(s, false));
      lastDay = day;
    }
  } else {
    const linesBy = {};
    for(const l of await getAll('receiptLines')) if(!l.deletedAt) (linesBy[l.receiptId] || (linesBy[l.receiptId] = [])).push(l);
    const list = (await getAll('receipts')).filter(r=> r.kind === 'возврат' && (r.createdTs || 0) >= from && (!keep.sup || r.supplierId === keep.sup) && (owner || r.supplierId === Sync.mySupplierId()))
      .sort((a, b)=> (b.createdTs || 0) - (a.createdTs || 0));
    for(const r of list){
      const ls = linesBy[r.id] || [];
      if(keep.model && !ls.some(l=> l.modelId === keep.model)) continue;
      const items = ls.map(l=> modelName(models[l.modelId] || {}) + ' ' + sizeText(labels[l.sizeId] || '') + ' ×' + l.qty + (l.defect ? ' (брак)' : '')).join(', ');
      if(q && !items.toLowerCase().includes(q)) continue;
      total++;
      if(rows.length >= arLimit) continue;
      const d = new Date(r.createdTs || 0);
      const st = r.deletedAt ? 'удалён' : (r.status === 'разложено' ? 'разложен' : r.status);
      rows.push(`<div class="row-item ar-row" data-ar="${escapeAttr(r.id)}"><div class="rmain">
          <div class="rname">${escapeHtml(items || 'без товаров')}</div>
          <div class="rmeta">${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}${owner ? ' · ' + escapeHtml((sups[r.supplierId] || {}).name || '') : ''}</div></div>
        <div class="rside"><span class="ar-status">${escapeHtml(st)}</span></div></div>`);
    }
  }
  const more = total > rows.length ? `<button class="btn ghost" id="arMore" onclick="arLimit += 100; renderShipments()">Показать ещё (${total - rows.length})</button>` : '';
  const found = `<div class="rmeta" style="margin-bottom:6px;">Найдено: <b>${total}</b></div>`, none = '<div class="hint">Ничего не найдено — поменяйте фильтры</div>';
  return `<div class="as-chips">${tab('ship', 'Отправки')}${tab('ret', 'Возвраты')}</div>${filters}` + (arKind === 'ship'
    ? `<div class="ar-cards">${found}${rows.join('') || none}${more}</div>`
    : `<div class="card">${found}${rows.join('') || none}${more}</div>`);
}
async function shSetView(v){ shView = v; arLimit = 100; await renderShipments(); }
async function arSetKind(k){ arKind = k; arLimit = 100; await renderShipments(); }
/* фильтры перерисовываем, не теряя курсор в поле поиска */
let arTimer = null;
function arRefresh(){
  clearTimeout(arTimer);
  arTimer = setTimeout(async ()=>{
    const a = document.activeElement, id = a && a.id, pos = a && a.selectionStart;
    await renderShipments();
    const el = id && document.getElementById(id);
    if(el){ el.focus(); try{ if(pos != null) el.setSelectionRange(pos, pos); }catch(e){} }
  }, 200);
}
