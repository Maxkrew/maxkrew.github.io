/* «Склад»: База на устройстве, остатки (серверные и локальные), хранилище, запуск. */
let db;
const DB_NAME = 'ff_fulfillment';
const DB_VERSION = 8;
/* Хранилища «ФФ» (модель склада с поставщиками и ячейками). Ключи — как на сервере,
   чтобы одна запись не могла задвоиться. Индекс dirty — «ещё не уехало на сервер». */
const FF_STORES = {
  suppliers:     {key:'id'},
  models:        {key:'id',       idx:{bySupplier:'supplierId'}},
  privates:      {key:'modelId'},
  sizes:         {key:'id',       idx:{byModel:'modelId'}},
  cells:         {key:'number'},
  ops:           {key:'uid',      idx:{bySize:'sizeId', byCell:'cellNumber', byModel:'modelId', byTs:'ts'}},
  receipts:      {key:'id'},
  receiptLines:  {key:'id',       idx:{byReceipt:'receiptId'}},
  shipments:     {key:'id'},
  shipmentLines: {key:'id',       idx:{byShipment:'shipmentId'}},
  linePrices:    {key:'lineId'},                                       // этап 2б: цены поставщика (только у него)
  photos:        {key:'id',       idx:{byShipment:'shipmentId', byModel:'modelId'}}
};

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains('products')) d.createObjectStore('products',{keyPath:'sku'});
      if(!d.objectStoreNames.contains('history')) d.createObjectStore('history',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('inventory')) d.createObjectStore('inventory',{keyPath:'sku'});
      if(!d.objectStoreNames.contains('settings')) d.createObjectStore('settings',{keyPath:'key'});
      if(!d.objectStoreNames.contains('reports')) d.createObjectStore('reports',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('adspend')) d.createObjectStore('adspend',{keyPath:'dateKey'});
      /* Заказы и выплаты для расчёта комиссии сотрудников. Ключ — uid
         с устройства, как у операций, чтобы одна запись не задвоилась
         при синхронизации. */
      if(!d.objectStoreNames.contains('orders')){
        d.createObjectStore('orders',{keyPath:'uid'}).createIndex('dirty','dirty');
      }
      if(!d.objectStoreNames.contains('payouts')){
        d.createObjectStore('payouts',{keyPath:'uid'}).createIndex('dirty','dirty');
      }

      /* Версия 3 готовит базу к синхронизации между устройствами.
         Записям нужен ключ, одинаковый на всех устройствах: автоинкремент
         для этого не годится — на телефоне и на компьютере он выдаст
         разные номера одним и тем же операциям (или один номер разным).
         Индекс по sku нужен, чтобы считать остаток по операциям товара,
         не перебирая всю историю. */
      if(e.oldVersion < 3){
        const histStore = e.target.transaction.objectStore('history');
        if(!histStore.indexNames.contains('bySku')) histStore.createIndex('bySku','sku');
        if(!histStore.indexNames.contains('byUid')) histStore.createIndex('byUid','uid',{unique:false});
      }

      /* Версия 4 — для синхронизации. Индекс dirty отбирает записи,
         которые ещё не уехали на сервер: перебирать всю базу на каждом
         сеансе связи слишком дорого. */
      if(e.oldVersion < 4){
        const t = e.target.transaction;
        const hs = t.objectStore('history');
        if(!hs.indexNames.contains('dirty')) hs.createIndex('dirty','dirty');
        const ps = t.objectStore('products');
        if(!ps.indexNames.contains('dirty')) ps.createIndex('dirty','dirty');
        const as = t.objectStore('adspend');
        if(!as.indexNames.contains('dirty')) as.createIndex('dirty','dirty');
      }

      /* Версия 8 — файлы фото на телефоне (не синхронизируются: уходят в хранилище ff-photos). */
      if(!d.objectStoreNames.contains('photoBlobs')) d.createObjectStore('photoBlobs', {keyPath:'id'});

      /* Версия 6 — хранилища «ФФ». */
      for(const [name, spec] of Object.entries(FF_STORES)){
        const st = d.objectStoreNames.contains(name)
          ? e.target.transaction.objectStore(name)
          : d.createObjectStore(name, {keyPath: spec.key});
        if(!st.indexNames.contains('dirty')) st.createIndex('dirty','dirty');
        for(const [iname, field] of Object.entries(spec.idx || {})){
          if(!st.indexNames.contains(iname)) st.createIndex(iname, field);
        }
      }
    };
    req.onsuccess = (e)=>{ db = e.target.result; resolve(db); };
    req.onerror = (e)=> reject(e);
  });
}

/* ============================================================
   ОСТАТОК СЧИТАЕТСЯ ИЗ ОПЕРАЦИЙ
   Раньше остаток лежал полем в карточке товара, и сканирование его
   перезаписывало. Для одного устройства это работало, но при синхронизации
   ломается молча: если телефон офлайн продал 2 штуки, а компьютер — 3, то
   один говорит «осталось 8», другой «осталось 7», и побеждает тот, кто
   записал последним, — хотя на деле осталось 5.
   Поэтому источник правды — операции: остаток это сумма их приращений.
   Поле totalStock остаётся, но уже как кэш для быстрой отрисовки.
   ============================================================ */
function newUid(){
  if(crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10);
}

/* Приращение остатка по записи истории. Старые записи (до версии 3) поля
   delta не имеют, поэтому выводим его из типа операции. */
function historyDelta(h){
  if(typeof h.delta === 'number') return h.delta;
  const qty = Math.abs(Number(h.qty)||0);
  if(h.type === 'Расход') return -qty;
  if(h.type === 'Приход') return qty;
  return Number(h.qty)||0;   // корректировка уже со знаком
}

/* Приводит запись истории к нынешнему виду. Нужна там, где записи
   приходят со стороны: из бэкапа старого формата у них нет ни uid, ни
   delta, ни отметки legacy — и сервер отвергает такие строки. */
function normalizeHistoryRow(h){
  let changed = false;
  if(!h.uid){ h.uid = newUid(); changed = true; }
  if(typeof h.delta !== 'number'){ h.delta = historyDelta(h); changed = true; }
  if(typeof h.legacy !== 'boolean'){ h.legacy = true; changed = true; }
  return changed;
}

/* Чинит записи, попавшие в базу мимо миграции. Без этого синхронизация
   встаёт намертво: сервер отказывает всей пачке из-за пустого uid. */
async function repairHistoryRows(){
  const all = await getAll('history');
  let fixed = 0;
  for(const h of all){
    if(normalizeHistoryRow(h)){ await put('history', h); fixed++; }
  }
  return fixed;
}

function historyBySku(sku){
  return new Promise((res,rej)=>{
    const r = tx('history').index('bySku').getAll(sku);
    r.onsuccess = ()=> res(r.result);
    r.onerror = rej;
  });
}
function historyByUid(uid){
  return new Promise((res,rej)=>{
    const r = tx('history').index('byUid').get(uid);
    r.onsuccess = ()=> res(r.result);
    r.onerror = rej;
  });
}

/* Пересчитывает остаток товара по его операциям и обновляет кэш.
   Записи, помеченные legacy, в расчёт не идут: они относятся ко времени
   до перехода на новую модель, а их итог уже учтён операцией
   «Начальный остаток». */
/* ---- Остаток по серверу ----
   Эталон — сумма операций, посчитанная сервером (представление
   product_stock). Телефон показывает: серверное число + то, что он
   отправил после последнего замера (ledger) + свои ещё не отправленные
   операции. Локальная история нужна только для «Истории» и работы без
   связи — её сбои (недокачка, дубли) на число больше не влияют. */
let serverStockState = null;   // {key:'serverStock', value:{sku:n}|null, ledger:{sku:n}, at}
async function loadServerStock(){
  if(serverStockState) return serverStockState;
  const r = await get('settings', 'serverStock');
  serverStockState = r || {key:'serverStock', value:null, ledger:{}, at:0};
  if(!serverStockState.ledger) serverStockState.ledger = {};
  return serverStockState;
}
function saveServerStockState(){ return putRaw('settings', serverStockState); }
function opEffect(h){ return (!h.legacy && !h.deletedAt) ? historyDelta(h) : 0; }

/* Отправка прошла: сервер теперь знает эту запись, но свежего замера ещё
   нет — учитываем разницу в ledger до следующего замера. */
async function serverStockNotePushed(row, prevEff, prevSku){
  const st = await loadServerStock();
  if(!st.value) return;
  const eff = opEffect(row);
  if(prevSku !== undefined && prevEff) st.ledger[prevSku] = (st.ledger[prevSku]||0) - prevEff;
  if(eff) st.ledger[row.sku] = (st.ledger[row.sku]||0) + eff;
  await saveServerStockState();
}
async function serverStockReset(){
  serverStockState = {key:'serverStock', value:null, ledger:{}, at:0};
  await saveServerStockState();
}

/* Ещё не отправленные операции: вклад каждой — её нынешний эффект минус
   то, что по ней уже знает сервер (srvEff/srvSku ставит синхронизация). */
async function pendingStockDelta(sku){
  const dirty = await getDirty('history');
  const byUid = new Map();
  dirty.forEach(h=>{ const k = h.uid || ('#'+h.id); const prev = byUid.get(k); if(!prev || (Number(h.updatedAt)||0) > (Number(prev.updatedAt)||0)) byUid.set(k, h); });
  let d = 0;
  byUid.forEach(h=>{
    if(String(h.sku) === String(sku)) d += opEffect(h);
    const srvSku = h.srvSku !== undefined ? h.srvSku : h.sku;
    if(String(srvSku) === String(sku)) d -= (Number(h.srvEff)||0);
  });
  return d;
}

/* Сумма по локальной истории — как считалось раньше. Нужна для работы
   до первого замера с сервера и для самопроверки. */
async function localStockSum(sku){
  const ops = await historyBySku(sku);
  const byUid = new Map();
  ops.forEach(h=>{
    const key = h.uid || ('#'+h.id);
    const prev = byUid.get(key);
    if(!prev || (Number(h.updatedAt)||0) > (Number(prev.updatedAt)||0)) byUid.set(key, h);
  });
  let stock = 0;
  byUid.forEach(h=>{ stock += opEffect(h); });
  return stock;
}

async function expectedStock(sku){
  const st = await loadServerStock();
  if(!st.value) return localStockSum(sku);
  return (Number(st.value[sku])||0) + (Number(st.ledger[sku])||0) + await pendingStockDelta(sku);
}

/* Новый замер с сервера. Пересчитываем все товары; где локальная история
   даёт другое число — это сбой на телефоне: число берём серверное,
   сообщаем «исправлено» и в фоне перекачиваем историю. */
let lastHealAt = 0;
const notifiedMismatch = new Set();
async function applyServerStock(map){
  const st = await loadServerStock();
  st.value = map; st.ledger = {}; st.at = Date.now();
  await saveServerStockState();
  const fixes = [];
  window.lastStockChangeCount = 0;
  for(const p of await getAllLive('products')){
    const shown = Number(p.totalStock)||0;
    const local = await localStockSum(p.sku);
    const now = await recalcStock(p.sku);
    if(now !== shown) window.lastStockChangeCount++;
    if(local !== now){
      const sig = p.sku + ':' + local + ':' + now;
      if(!notifiedMismatch.has(sig)){ notifiedMismatch.add(sig); fixes.push({name:p.name, from: shown !== now ? shown : local, to: now}); }
    }
  }
  if(fixes.length){
    const text = fixes.slice(0,3).map(f=> f.name + ' ' + f.from + ' → ' + f.to).join(', ') + (fixes.length > 3 ? (' и ещё ' + (fixes.length-3)) : '');
    toast('Исправлено по серверу: ' + text);
    if(Date.now() - lastHealAt > 6*60*60*1000){
      lastHealAt = Date.now();
      setTimeout(healLocalHistory, 500);
    }
  }
  return fixes;
}
/* Тихое лечение: перекачать историю целиком и убрать дубли, чтобы и
   список «Истории» совпал с сервером. */
async function healLocalHistory(){
  if(!window.Sync || !Sync.ready()) return;
  await put('settings', {key:'syncCursor', value: 0});
  await Sync.syncNow('самопроверка');
  await dedupeLocalHistory();
  /* «Отправленные» записи, которых на сервере нет, — сбойные дубли только
     этого телефона: убираем их, чтобы «История» совпала с сервером. */
  const live = await Sync.serverLiveUids();
  if(live && live.size){
    for(const h of await getAllLive('history')){
      if(!h.dirty && h.uid && !live.has(h.uid)) await del('history', h.id);
    }
  }
  await renderHistory();
}
async function dropServerStock(){
  const st = await loadServerStock();
  window.lastStockChangeCount = 0;
  if(!st.value) return;
  await serverStockReset();
  for(const p of await getAllLive('products')){
    const before = Number(p.totalStock)||0;
    if((await recalcStock(p.sku)) !== before) window.lastStockChangeCount++;
  }
}

async function recalcStock(sku){
  const p = await get('products', sku);
  if(!p) return null;
  const stock = await expectedStock(sku);
  if(p.totalStock !== stock){
    /* Остаток — производный кэш, на сервер он не ездит. Раньше запись шла
       обычным put: карточка помечалась «изменённой», уезжала на сервер и
       там затирала чужие правки и удаления этого товара с другого телефона. */
    p.totalStock = stock;
    await putRaw('products', p);
  }
  return stock;
}

/* Разовый перевод уже накопленных данных на новую модель: старая история
   помечается как справочная, а текущий остаток каждого товара
   закрепляется операцией «Начальный остаток», чтобы сумма приращений
   сошлась с тем, что человек видит на экране прямо сейчас. */
async function migrateToOperationModel(){
  const flag = await get('settings', 'stockModel');
  if(flag && flag.value === 'operations') return false;

  const hist = await getAllLive('history');
  for(const h of hist){
    let changed = false;
    if(!h.uid){ h.uid = newUid(); changed = true; }
    if(typeof h.delta !== 'number'){ h.delta = historyDelta(h); changed = true; }
    if(h.legacy !== true){ h.legacy = true; changed = true; }
    if(changed) await put('history', h);
  }

  const products = await getAllLive('products');
  const now = Date.now();
  for(const p of products){
    const qty = Number(p.totalStock) || 0;
    /* нулевой остаток и так получится из пустой суммы операций —
       заводить для него запись «Начальный остаток» незачем */
    if(qty === 0){
      p.updatedAt = now;
      await put('products', p);
      continue;
    }
    await put('history', {
      uid: newUid(),
      date: new Date(now).toLocaleDateString('ru-RU'),
      time: new Date(now).toLocaleTimeString('ru-RU'),
      timestamp: now,
      type: 'Начальный остаток',
      barcode: p.barcode || '',
      sku: p.sku,
      name: p.name,
      qty: qty,
      delta: qty,
      stockAfter: qty,
      legacy: false,
      snap: priceSnapshot(p)
    });
    p.updatedAt = now;
    await put('products', p);
  }

  await put('settings', {key:'stockModel', value:'operations', migratedAt: now});
  return true;
}
function tx(store, mode='readonly'){ return db.transaction(store, mode).objectStore(store); }
function getAll(store){ return new Promise((res,rej)=>{ const r = tx(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=rej; }); }
function get(store,key){ return new Promise((res,rej)=>{ const r = tx(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=rej; }); }
/* Синхронизируемые хранилища помечаются при каждой локальной правке:
   dirty=1 значит «ещё не уехало на сервер». Записи, пришедшие с сервера,
   кладутся с fromSync:true — иначе они тут же уехали бы обратно. */
const SYNCED_STORES = ['products','history','adspend','orders','payouts'].concat(Object.keys(FF_STORES));
/* Правка сразу отправляется на сервер (с небольшой задержкой, чтобы серия
   правок ушла одним обменом), а не ждёт двухминутного таймера. На время
   массовых операций (импорт) отправка выключена. */
let bulkWrite = 0, autoSyncTimer = null;
function bulkBegin(){ bulkWrite++; }
function bulkEnd(){ bulkWrite = Math.max(0, bulkWrite - 1); }
function scheduleAutoSync(){
  if(bulkWrite > 0 || !window.Sync || !Sync.isConfigured()) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(()=>{ if(bulkWrite === 0 && Sync.ready()) Sync.syncNow('изменение'); }, 1500);
}
/* Номер версии данных: растёт при любой записи в товары или историю.
   По нему кэшируются тяжёлые пересчёты (возвраты, прогноз), чтобы поиск
   на «Складе» не пересчитывал всю историю на каждую букву. */
var dataVersion = 0;
function touchData(store){ if(store === 'history' || store === 'products' || store === 'ops' || store === 'models' || store === 'sizes' || store === 'cells') dataVersion++; }
function cachedByVersion(slot, compute){
  const c = cachedByVersion.store[slot];
  if(c && c.v === dataVersion) return c.p;
  const v = dataVersion, p = compute();
  cachedByVersion.store[slot] = {v, p};
  p.catch(()=>{ if(cachedByVersion.store[slot] && cachedByVersion.store[slot].p === p) delete cachedByVersion.store[slot]; });
  return p;
}
cachedByVersion.store = {};

function put(store,val,opts){
  opts = opts || {};
  /* «Только просмотр» (подписка закончилась): свои правки в данные склада не пишем. */
  if(window.ffReadonly && !opts.fromSync && FF_STORES[store]){ if(typeof ffReadonlyBlocked === 'function') ffReadonlyBlocked(); return Promise.resolve(); }
  touchData(store);
  if(SYNCED_STORES.indexOf(store) !== -1){
    if(opts.fromSync){
      val.dirty = 0;
    } else {
      val.updatedAt = Date.now();
      val.dirty = 1;
      scheduleAutoSync();
    }
  }
  return new Promise((res,rej)=>{ const r = tx(store,'readwrite').put(val); r.onsuccess=()=>res(r.result); r.onerror=rej; });
}
/* «Живые» записи — всё, кроме помеченных удалёнными. Интерфейс и расчёты
   работают только с ними, а синхронизация видит и удалённые тоже. */
/* Настройки — единственная запись, которая ездит между устройствами
   целиком: в ней и название компании, и логотип, и свои звуки. Помечаем
   её отдельно, потому что в хранилище settings лежат ещё и служебные
   записи (курсор обмена, отметка миграции), которым на сервере делать
   нечего. */
/* opts.initial — это не правка человека, а настройки по умолчанию у только
   что установленного приложения. Отправлять их нельзя: войдя в общую
   учётную запись, новое устройство затирало бы на сервере уже настроенные
   звуки, логотип и название — именно так они и «слетали». */
async function saveAppSettings(opts){
  opts = opts || {};
  settings.key = 'app';
  settings.updatedAt = opts.initial ? 0 : Date.now();
  settings.dirty = opts.initial ? 0 : 1;
  return new Promise((res,rej)=>{
    const r = tx('settings','readwrite').put(settings);
    r.onsuccess = ()=> res(r.result);
    r.onerror = rej;
  });
}

/* Запись без пометок синхронизации — нужна ей самой, когда она кладёт
   в базу то, что только что оттуда получила. */
function putRaw(store, val){
  touchData(store);
  return new Promise((res,rej)=>{ const r = tx(store,'readwrite').put(val); r.onsuccess=()=>res(r.result); r.onerror=rej; });
}

/* Настройки пришли с другого устройства — применяем их на месте, чтобы не
   требовать перезапуска. */
function applyRemoteSettings(incoming){
  settings = incoming;
  const title = document.getElementById('companyTitle');
  /* «FFDrop» — прежнее рабочее название, могло сохраниться в настройках склада как имя по умолчанию */
  if(title) setCompanyTitle();
  applyHeaderLogo();
  loadSettingsForm();
  // звуки могли смениться — пересобираем пулы под новый файл
  refreshCustomSounds();
}

async function getAllLive(store){
  const all = await getAll(store);
  return all.filter(r=> !r.deletedAt);
}
function getDirty(store){
  return new Promise((res,rej)=>{
    const r = tx(store).index('dirty').getAll(1);
    r.onsuccess=()=>res(r.result); r.onerror=rej;
  });
}
/* Удаление помечает запись, а не стирает её: физически стёртая строка на
   другом устройстве просто прилетела бы обратно при следующей связи. */
async function softDelete(store, key){
  const row = await get(store, key);
  if(!row) return false;
  row.deletedAt = Date.now();
  await put(store, row);
  return true;
}
function del(store,key){ touchData(store); return new Promise((res,rej)=>{ const r = tx(store,'readwrite').delete(key); r.onsuccess=()=>res(); r.onerror=rej; }); }
function clearStore(store){ touchData(store); return new Promise((res,rej)=>{ const r = tx(store,'readwrite').clear(); r.onsuccess=()=>res(); r.onerror=rej; }); }

/* ============================================================
   ПОСТОЯННОЕ ХРАНИЛИЩЕ
   Вся база живёт только на этом устройстве, а браузер вправе вычистить
   IndexedDB при нехватке места (а Safari на iOS — просто через несколько
   недель без открытия приложения). persist() помечает хранилище как
   постоянное, и тогда данные удаляются только руками пользователя.
   ============================================================ */
/* Оба вызова Storage API умеют не отвечать вовсе: пока браузер решает
   вопрос с разрешением, промис просто висит. Без таймаута интерфейс
   застывал бы на «проверяем» навсегда. */
function withTimeout(promise, ms){
  return Promise.race([promise, new Promise(r=>setTimeout(()=>r(undefined), ms))]);
}
async function ensurePersistentStorage(){
  if(!navigator.storage || !navigator.storage.persist) return null;
  try{
    const already = await withTimeout(navigator.storage.persisted(), 3000);
    if(already === true) return true;
    const granted = await withTimeout(navigator.storage.persist(), 4000);
    return (granted === undefined) ? null : granted;
  }catch(e){ return null; }
}
async function storageUsageLabel(){
  if(!navigator.storage || !navigator.storage.estimate) return '';
  try{
    const est = await withTimeout(navigator.storage.estimate(), 2000);
    if(est && est.usage){
      const mb = est.usage/1024/1024;
      return ' · занято ' + (mb < 0.1 ? Math.round(est.usage/1024) + ' КБ' : mb.toFixed(1) + ' МБ');
    }
  }catch(e){}
  return '';
}
function setStorageStatus(cls, icon, text){
  const el = document.getElementById('storageStatus');
  if(!el) return;
  el.className = 'alert '+cls;
  el.innerHTML = '<svg class="icon"><use href="#'+icon+'"/></svg><span>'+text+'</span>';
}
async function renderStorageStatus(){
  if(!document.getElementById('storageStatus')) return;
  setStorageStatus('', 'i-clock', 'Проверяем хранилище…');
  const granted = await ensurePersistentStorage();
  const used = await storageUsageLabel();
  if(granted === true){
    setStorageStatus('success','i-check-circle','Хранилище защищено от автоочистки'+used);
  } else if(granted === false){
    setStorageStatus('danger','i-alert','Браузер может очистить данные сам'+used+'. Установите приложение на главный экран и почаще делайте экспорт.');
  } else {
    setStorageStatus('danger','i-alert','Статус хранилища неизвестен'+used+'. Делайте экспорт регулярно.');
  }
}

let currentMode = 'Приход';
/* var, а не let: так настройки видны как window.settings — это нужно
   вспомогательным скриптам и удобно при разборе проблем на устройстве */
/* Имя в шапке: своё название склада или «fulbro» (как в логотипе). «FFDrop»/«Fulzo» — прежние
   рабочие названия, могли сохраниться как имя по умолчанию. */
/* название в шапке — только Fulbro (владелец, 20.10.2026: «название компании менять нельзя») */
function ffCompanyName(){ return ffAppWord(); }
/* Название приложения — как в логотипе владельца: «FULBRO» фирменным шрифтом (класс brand-word). */
function ffAppWord(){ return String((window.SYNC_CONFIG && SYNC_CONFIG.APP_NAME) || 'Fulbro').toUpperCase(); }
function setCompanyTitle(){
  const t = document.getElementById('companyTitle'); if(!t) return;
  const n = ffCompanyName(); t.textContent = n; t.classList.toggle('brand-word', n === ffAppWord());
}
var settings = { key:'app', company:(window.SYNC_CONFIG && SYNC_CONFIG.APP_NAME) || 'Fulbro', lowStock:5, sound:true, blockNeg:true };

/* Клавиатура настраивается для каждого устройства отдельно и в общие
   настройки не попадает: на iPhone со сканером своя нужна, а на Android
   с той же учётной записью — нет, там системная показывается сама. */
function skbMode(){
  /* Партнёр не сканирует — своя экранная клавиатура ему только мешает.
     Всегда системная клавиатура телефона. Настройку устройства не трогаем. */
  if(typeof isEmployee === 'function' && isEmployee()) return 'off';
  /* По умолчанию — клавиатура телефона. Встроенную включают вручную те,
     у кого к телефону подключён Bluetooth/USB-сканер. */
  try{ return localStorage.getItem('ff-kb-mode') || 'off'; }catch(e){ return 'off'; }
}
function setSkbMode(v){ try{ localStorage.setItem('ff-kb-mode', v || 'auto'); }catch(e){} }

/* На экране входа в настройки не попасть, а клавиатура нужна уже там:
   пока не подобран режим, человек не может ввести даже логин. */
const SKB_MODE_NAMES = {off:'телефона', auto:'авто', always:'встроенная'};
function syncAuthKbButton(){
  const b = document.getElementById('authKbBtn');
  if(b) b.textContent = 'Клавиатура: ' + (SKB_MODE_NAMES[skbMode()] || 'сама');
}
function cycleSkbMode(){
  const order = ['auto','always','off'];
  const next = order[(order.indexOf(skbMode()) + 1) % order.length];
  setSkbMode(next);
  syncAuthKbButton();
  skbHide();
  refreshSoftKeyboardMode();
  toast('Клавиатура: ' + SKB_MODE_NAMES[next]);
}
let inventoryActive = false;

window.addEventListener('DOMContentLoaded', async ()=>{
  const splashStart = Date.now();
  await openDB();
  const s = await get('settings','app');
  if(s) settings = s; else await saveAppSettings({initial:true});
  refreshSoftKeyboardMode();
  setCompanyTitle();
  applyHeaderLogo();

  const migrated = await migrateToOperationModel();
  /* Записи могли попасть в базу мимо миграции — например, импортом
     старого бэкапа. Без uid сервер отвергает всю пачку целиком. */
  await repairHistoryRows();

  const inv = await getAll('inventory');
  inventoryActive = inv.length > 0;
  syncInvActionUI();
  updateModeUI();

  initQtyPads();
  initSoftKeyboard();

  /* Физический сканер печатает очередью — символы идут через единицы
     миллисекунд. Заметили такую очередь — значит сканер есть, и фокусом
     можно распоряжаться как раньше. */
  let lastKeyAt = 0, fastRun = 0;
  document.addEventListener('keydown', (e)=>{
    if(!e.key || e.key.length !== 1) return;
    const now = Date.now();
    fastRun = (now - lastKeyAt) <= SCAN_GAP_MS ? fastRun + 1 : 1;
    lastKeyAt = now;
    if(fastRun >= 4) hwScannerSeen = true;
  }, true);

  const scanInput = document.getElementById('scanInput');
  wireScanInput(scanInput, handleScan);
  focusForScanner(scanInput);

  /* Набрал количество — Enter, и товар принят. Без этого пришлось бы
     каждый раз тянуться к кнопке, а руки заняты сканером. */
  const prihodQtyInput = document.getElementById('prihodQtyInput');
  prihodQtyInput.addEventListener('keydown', async (e)=>{
    if(e.key === 'Enter'){
      e.preventDefault();
      /* Сканер печатает штрихкод и сам жмёт Enter. Раз символы шли в поле
         количества — это не количество, а скан: код уходит туда, где ему
         место. Иначе приход улетал на миллионы штук: в поле оказывался
         сам штрихкод. */
      const raw = scanTyped;
      clearTimeout(typeFlushTimer);
      scanTyped = '';
      if(raw.length >= 6){
        const split = await splitQtyAndCode(raw);
        if(split.code){
          if(split.qty) prihodQtyInput.value = split.qty;
          handleScan(split.code);
          return;
        }
      }
      if(raw) typeIntoQty(raw);   // всё-таки набирали руками — дописываем
      confirmPrihodScan();
      return;
    }
    if(e.key === 'Escape'){
      e.preventDefault(); clearTimeout(typeFlushTimer); scanTyped = '';
      cancelPrihodConfirm(); return;
    }

    if(e.key.length === 1){
      /* Буфер нужен только чтобы поймать очередь символов от аппаратного
         сканера, случайно попавшую в поле количества. Человеку на обычной
         клавиатуре не мешаем — иначе на iPhone поле «залипало» и клавиатура
         закрывалась (preventDefault на каждой цифре). */
      if(!hwScannerSeen){ clearTimeout(typeFlushTimer); scanTyped = ''; return; }
      /* Ни один символ не попадает в поле сразу: сначала копим и только
         через мгновение решаем, человек это набирает или сканер стреляет
         очередью. Пауза незаметна на глаз, зато поле не портится. */
      e.preventDefault();
      scanTyped += e.key;
      scanTypedAt = Date.now();
      clearTimeout(typeFlushTimer);
      typeFlushTimer = setTimeout(()=>{
        const text = scanTyped; scanTyped = '';
        if(text.length < 6) typeIntoQty(text);
      }, SCAN_GAP_MS + 20);
      return;
    }
    /* Backspace, стрелки и прочее — обычное поведение поля. */
    clearTimeout(typeFlushTimer);
    scanTyped = '';
    qtyReplaceNext = false;
  });
  /* Встал в поле — значит набирает количество заново. */
  prihodQtyInput.addEventListener('focus', ()=>{ qtyReplaceNext = true; });

  wireScanInput(document.getElementById('invScanInput'), handleInventoryScan);

  wireScanInput(document.getElementById('scanCaptureInput'), (val)=>{
    if(!scannerCaptureCallback) return;
    scannerCaptureCallback(val);
    toast('Штрихкод считан: '+val);
    closeScannerCapture();
  });

  ['pmSku','pmName'].forEach(id=>{
    document.getElementById(id).addEventListener('input', validateProductForm);
  });

  setupSheetGestures();

  /* Enter на клавиатуре телефона — привычный способ войти */
  ['loginInput','pinInput'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); submitPin(); } });
  });

  /* Роль из кэша — применяем ДО первых отрисовок и до снятия заставки,
     иначе партнёр секунду видит интерфейс владельца со всеми вкладками. */
  try{ await applyRoleUI(); }catch(e){}

  await renderSection('stock');
  await updateProductCountPill();
  loadSettingsForm();
  warmCustomSounds();   // пулы <audio> готовы ещё до первого скана
  { const el = document.getElementById('payDate'); if(el && !el.value) el.value = todayDateKey(); }
  renderStorageStatus();

  const elapsed = Date.now() - splashStart;
  setTimeout(hideSplash, Math.max(0, 900 - elapsed));

  initSync();
});
