/* Fulbro: «Сборка» на экране «Отправки» у склада (по образцу, который показал владелец,
   24.10.2026): фильтр по поставщикам с числом заказов, «собрано X / Y, осталось N», большая
   кнопка «Собран» на заказе, «Выбрать» — собрать несколько разом, «Собранные сегодня». */
let shFilter = '';                 // поставщик в фильтре; '' — все
let shSelectMode = false;          // режим «Выбрать»
const shSelected = new Set();

/* Когда отправку собрали: последняя отметка «Собрано» её строк. */
async function shCollectedAt(s){
  let t = 0;
  for(const l of await shipmentLines(s.id)) if(l.collected) t = Math.max(t, Number(l.collectedTs) || 0);
  return t;
}
async function shCollectedToday(list){
  const from = dayStart(Date.now()), out = [];   // dayStart — js/analytics.js
  for(const s of list) if(s.status === 'собрана' && await shCollectedAt(s) >= from) out.push(s);
  return out;
}

/* Шапка сборки: фильтр, счётчик, «Выбрать». open — несобранные (все поставщики). */
async function assemblyHeader(open, all){
  const sups = await ffSuppliersMap();
  const count = {}; for(const s of open) count[s.supplierId] = (count[s.supplierId] || 0) + 1;
  // все действующие поставщики (и без открытых заказов — для статистики); сначала те, у кого есть заказы
  const ids = Object.values(sups).filter(s=> !s.deletedAt && !s.archived).map(s=> s.id)
    .sort((a, b)=> ((count[b] || 0) > 0) - ((count[a] || 0) > 0) || String((sups[a] || {}).name).localeCompare(String((sups[b] || {}).name), 'ru'));
  if(shFilter && !ids.includes(shFilter)) ids.push(shFilter);
  const chip = (id, label, n)=> `<button type="button" class="as-chip${shFilter === id ? ' on' : ''}" data-as-filter="${escapeAttr(id)}" onclick="shSetFilter(${jsArg(id)})">${escapeHtml(label)} <b>${n}</b></button>`;
  const chips = chip('', 'Все', open.length) + ids.map(id=> chip(id, (sups[id] || {}).name || 'Поставщик', count[id] || 0)).join('');
  const mine = list=> shFilter ? list.filter(s=> s.supplierId === shFilter) : list;
  const left = mine(open).length, done = (await shCollectedToday(mine(all))).length, total = left + done;
  const pct = total ? Math.round(done / total * 100) : 0;
  const selBar = shSelectMode ? `<div class="as-selbar"><span>Выбрано: <b>${shSelected.size}</b></span>
      <button class="btn primary" style="width:auto;" id="asCollectSel" onclick="shCollectSelected()"${shSelected.size ? '' : ' disabled'}>Собрать выбранные</button></div>` : '';
  return `<div class="as-chips">${chips}</div>
    <div class="as-tools"><button type="button" class="btn ghost sm${shSelectMode ? ' on' : ''}" style="width:auto;" id="asSelectBtn" onclick="shToggleSelect()">${shSelectMode ? 'Отменить выбор' : '☑ Выбрать'}</button></div>
    <div class="card as-progress"><b class="as-count">${done} / ${total}</b><span class="bar"><i style="width:${pct}%"></i></span><span class="rmeta">осталось ${left}</span></div>${selBar}`;
}
async function shSetFilter(id){ shFilter = id; await renderShipments(); }
async function shToggleSelect(){ shSelectMode = !shSelectMode; shSelected.clear(); await renderShipments(); }
async function shSelectOne(id, on){
  if(on) shSelected.add(id); else shSelected.delete(id);
  const b = document.getElementById('asCollectSel'); if(b) b.disabled = !shSelected.size;
  const n = document.querySelector('.as-selbar b'); if(n) n.textContent = shSelected.size;
}
/* «Собран»: отметить все строки отправки. Строке без ячейки (товара не хватает) — нельзя. */
async function shCollectAll(id){
  const lines = (await shipmentLines(id)).filter(l=> !l.collected);
  if(lines.some(l=> !l.cellNumber)) return {ok:false, error:'В отправке есть товар, которого нет на складе — отправьте его в минус или уберите'};
  for(const l of lines){ const r = await tickCollected(l.id, true); if(!r.ok) return r; }
  return {ok:true, n: lines.length};
}
async function shCollect(id){
  const r = await shCollectAll(id);
  if(!r.ok){ toast(r.error); return; }
  toast('Собрано'); await renderShipments();
}
async function shCollectSelected(){
  let ok = 0, bad = 0;
  for(const id of [...shSelected]){ const r = await shCollectAll(id); if(r.ok) ok++; else bad++; }
  shSelected.clear(); shSelectMode = false;
  toast('Собрано: ' + ok + (bad ? ' · не собрано ' + bad + ' — не хватает товара' : ''));
  await renderShipments();
}

/* Звук нового заказа (Настройки → «Звук новых заказов»): после обмена склад слышит сигнал
   и видит подсказку, если поставщик оформил новый заказ. Какие заказы уже видели — в памяти
   телефона: при первом запуске ничего не звенит. */
const ORDERS_SEEN_KEY = 'ff-orders-seen';
async function checkNewOrders(){
  if(!(window.Sync && Sync.role && Sync.role() === 'owner')) return [];
  const fresh = (await getAll('shipments')).filter(s=> !s.deletedAt && s.createdBy === 'supplier' && s.status === 'новая');
  let seen = null;
  try{ seen = JSON.parse(localStorage.getItem(ORDERS_SEEN_KEY) || 'null'); }catch(e){}
  const known = new Set(seen || []);
  const added = seen ? fresh.filter(s=> !known.has(s.id)) : [];
  try{ localStorage.setItem(ORDERS_SEEN_KEY, JSON.stringify([...new Set([...known, ...fresh.map(s=> s.id)])].slice(-2000))); }catch(e){}
  if(added.length && settings.orderSound){
    const sups = await ffSuppliersMap();
    toast(added.length === 1 ? 'Новый заказ от «' + ((sups[added[0].supplierId] || {}).name || 'поставщика') + '»' : 'Новых заказов: ' + added.length);
    const was = settings.sound; settings.sound = true;
    try{ beep(880, 0, 0.12, 0.12); beep(1175, 0.16, 0.12, 0.12); beep(1568, 0.32, 0.18, 0.12); }catch(e){}
    settings.sound = was;
    try{ if(navigator.vibrate) navigator.vibrate([200, 100, 200]); }catch(e){}
  }
  return added;
}
async function setOrderSound(on){
  settings.orderSound = !!on;
  await saveAppSettings();
  if(on){ const was = settings.sound; settings.sound = true; try{ beep(880, 0, 0.12, 0.12); }catch(e){} settings.sound = was; }   // разбудить звук касанием
  toast(on ? 'Звук новых заказов включён' : 'Звук новых заказов выключен');
}
