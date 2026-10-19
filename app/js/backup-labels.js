/* «Склад»: Этикетки, резервные копии (экспорт/импорт), служебные функции. */
/* ============================================================
   ПЕЧАТЬ ЭТИКЕТОК — название сверху, QR-код снизу, 20 штук на лист A4
   Без галочек печатаются все товары из текущего списка «Склада»
   (с учётом поиска и фильтра поставщика). С галочками — только они.
   В QR кодируется штрихкод товара, а если его нет — SKU.
   ============================================================ */
async function printBarcodesSelected(){
  const all = await getAllLive('products');
  let list;
  if(invoiceSelection.size > 0){
    list = all.filter(p=> invoiceSelection.has(p.sku));
  } else {
    const q = (document.getElementById('stockSearch').value || '').toLowerCase();
    const sup = (document.getElementById('supplierFilter').value || '');
    list = all.filter(p=>
      (!q || p.name.toLowerCase().includes(q) || String(p.sku).toLowerCase().includes(q) || String(p.barcode).toLowerCase().includes(q))
      && (!sup || (p.supplier || '').trim() === sup));
  }
  if(!list.length){ toast('Нет товаров для печати'); return; }
  list.sort((a,b)=> a.name.localeCompare(b.name, 'ru'));
  openBarcodeSheet(list);
}

function openBarcodeSheet(list){
  const grid = document.getElementById('labelSheetGrid');
  const overlay = document.getElementById('labelSheetOverlay');
  if(!grid || !overlay) return;
  grid.innerHTML = list.map(p=>{
    const val = String(p.barcode || '').trim() || String(p.sku);
    return `<div class="lbl">
      <div class="nm">${escapeHtml(p.name)}</div>
      <div class="qr" data-val="${escapeAttr(val)}"></div>
      <div class="cd">${escapeHtml(val)}${p.price ? ' · ' + Math.round(p.price) + ' ₽' : ''}</div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.qr').forEach(el=>{
    try{
      new QRCode(el, {text: el.getAttribute('data-val'), width:120, height:120, correctLevel: QRCode.CorrectLevel.M});
    }catch(e){ el.textContent = el.getAttribute('data-val'); }
  });
  grid.className = 'label-sheet' + (list.length === 1 ? ' single' : '');
  const info = document.getElementById('labelSheetInfo');
  if(info) info.textContent = (list.length === 1) ? 'Этикетка товара' : (list.length + ' шт · по 20 на листе A4');
  overlay.hidden = false;
  document.body.classList.add('labels-open');
  try{ overlay.scrollTo(0,0); }catch(e){}
}
function closeLabelSheet(){
  document.body.classList.remove('labels-open');
  const overlay = document.getElementById('labelSheetOverlay');
  if(overlay){ overlay.hidden = true; const g = document.getElementById('labelSheetGrid'); if(g) g.innerHTML = ''; }
}
document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && document.body.classList.contains('labels-open')) closeLabelSheet(); });

async function exportBackup(){
  const data = {
    products: await getAllLive('products'),
    history: await getAllLive('history'),
    reports: await getAll('reports'),
    adspend: await getAllLive('adspend'),
    settings: settings,
    exportedAt: new Date().toISOString()
  };
  downloadFile('ff_backup_'+new Date().toISOString().slice(0,10)+'.json', JSON.stringify(data,null,2), 'application/json');
}
function importBackup(e){
  const file = e.target.files[0];
  if(!file) return;
  if(!isMasterDevice()){ e.target.value=''; requestImport(); return; }
  const reader = new FileReader();
  reader.onload = async (ev)=>{
    try{
      const data = JSON.parse(ev.target.result);
      if(!data || typeof data !== 'object' || (!data.products && !data.history)){
        toast('Это не похоже на бэкап «Склада»');
        return;
      }

      const hasData = (await getAllLive('history')).length > 0 || (await getAllLive('products')).length > 0;
      if(hasData && !confirm(
        'Загрузить файл как ГЛАВНЫЕ данные?\n\n' +
        'Всё, чего нет в файле, будет удалено — и на этом телефоне, и на всех остальных (после синхронизации). ' +
        'Остатки везде станут такими, как в файле.'
      )) return;

      /* Импорт — это «главный телефон»: сервер и остальные устройства должны
         стать копией файла. Раньше «замена» чистила только этот телефон, а
         серверные записи оставались — и каждая загрузка добавляла к ним ещё
         одну поправку остатка, так что цифры на разных телефонах расходились.
         Поэтому лишнее не стираем физически, а помечаем удалённым (это
         доедет до всех), а записи из файла оживляем под теми же uid. */
      bulkWrite++;
      try{
      const now = Date.now();
      const stripLocalFlags = (row)=>{ delete row.deletedAt; delete row.dirty; return row; };

      const fileProducts = (data.products || []).map(p=> stripLocalFlags(Object.assign({}, p)));
      const fileSkus = new Set(fileProducts.map(p=> String(p.sku)));
      for(const p of await getAll('products')){
        if(!p.deletedAt && !fileSkus.has(String(p.sku))){ p.deletedAt = now; await put('products', p); }
      }
      for(const p of fileProducts) await put('products', p);

      /* Записи из файла приводим к нынешнему виду: в бэкапах, снятых до
         перехода на новую модель, нет ни uid, ни delta, ни отметки legacy.
         Без этого сервер отвергает всю пачку («null value in column uid»),
         а остаток считается по неполным данным. */
      const fileHistory = (data.history || []).map(h=>{
        const copy = stripLocalFlags(Object.assign({}, h));
        delete copy.id;                  // локальный id не переносим — ищем строку по uid
        delete copy.srvEff; delete copy.srvSku;   // что знает сервер — решает этот телефон, не файл
        normalizeHistoryRow(copy);
        return copy;
      });
      const fileUids = new Set(fileHistory.map(h=> h.uid));
      const localByUid = new Map();
      for(const h of await getAll('history')){
        if(h.uid && !localByUid.has(h.uid)){ localByUid.set(h.uid, h); continue; }
        if(h.uid) await del('history', h.id);          // локальный дубль uid — просто выбрасываем
        else if(!h.deletedAt){ h.deletedAt = now; await put('history', h); }
      }
      for(const h of localByUid.values()){
        if(!fileUids.has(h.uid) && !h.deletedAt){ h.deletedAt = now; await put('history', h); }
      }
      for(const copy of fileHistory){
        const existing = localByUid.get(copy.uid);
        if(existing){
          copy.id = existing.id;
          if(existing.srvEff !== undefined){ copy.srvEff = existing.srvEff; copy.srvSku = existing.srvSku; }
        }
        await put('history', copy);
      }

      /* отчёты по устройству, наружу не ездят — заменяем как есть */
      await clearStore('reports');
      if(data.reports) for(const r of data.reports) await put('reports', Object.assign({}, r));

      const fileDates = new Set((data.adspend || []).map(a=> a.dateKey));
      for(const a of await getAll('adspend')){
        if(!a.deletedAt && !fileDates.has(a.dateKey)){ a.deletedAt = now; await put('adspend', a); }
      }
      if(data.adspend) for(const a of data.adspend) await put('adspend', stripLocalFlags(Object.assign({}, a)));

      /* В бэкапе остаток лежит полем товара, а у нас он складывается из
         операций. Записи из файла помечены справочными, поэтому сумма по
         ним нулевая — закрепляем остаток из файла отдельной операцией,
         иначе после импорта склад окажется пустым. */
      if(data.products){
        for(const p of data.products){
          const wanted = Number(p.totalStock) || 0;
          if(!(await get('products', p.sku))) continue;
          const current = await localStockSum(p.sku);   // файл — эталон: считаем по его записям
          const diff = wanted - current;
          if(diff !== 0){
            const prod = await get('products', p.sku);
            await logHistory('Начальный остаток', prod.barcode, prod, Math.abs(diff), {delta: diff});
            await recalcStock(p.sku);
          }
        }
      }

      /* Звуки и логотип живут в настройках, но в бэкапах их может не быть
         (файл снят старой версией). Поэтому настройки из файла не
         затирают их целиком, а накладываются поверх. */
      if(data.settings){
        const keptSounds = settings.sounds;
        const keptLogo = settings.logoDataUrl;
        settings = Object.assign({}, data.settings, {key:'app'});
        if(!settings.sounds && keptSounds) settings.sounds = keptSounds;
        if(!settings.logoDataUrl && keptLogo) settings.logoDataUrl = keptLogo;
        await saveAppSettings();
        loadSettingsForm();
      }

      const inv = await getAll('inventory');
      inventoryActive = inv.length > 0;
      syncInvActionUI();
      await renderStock(); await renderHistory(); await renderStats(); await renderReports(); await renderInvList();
      await updateProductCountPill();
      }finally{ bulkWrite--; }
      toast('Данные заменены из файла');
      if(window.Sync && Sync.isConfigured() && !isEmployee()) await publishToAllPhones();
    }catch(err){ toast('Ошибка импорта: файл повреждён или имеет неверный формат'); }
  };
  reader.readAsText(file);
  e.target.value='';
}
/* ---- копии на сервере ---- */
const SNAP_KIND = {daily:'Ежедневная', manual:'Вручную', 'before-restore':'До отката'};
async function renderSnapshots(){
  const card = document.getElementById('snapshotsCard'), box = document.getElementById('snapshotsList');
  if(!card || !box) return;
  const can = window.Sync && Sync.isConfigured() && !isEmployee();
  card.hidden = !can;
  if(!can) return;
  if(!(await Sync.currentUser())){ box.innerHTML = emptyLine('i-alert', 'Войдите в аккаунт, чтобы видеть копии'); return; }
  let list;
  try{ list = await Sync.listSnapshots(); }
  catch(e){ box.innerHTML = emptyLine('i-alert', navigator.onLine ? 'Не удалось загрузить список копий' : 'Нет сети — список копий недоступен'); return; }
  if(!list.length){ box.innerHTML = emptyLine('i-alert', 'Копий пока нет — первая появится этой ночью'); return; }
  const master = true;   // «ФФ»: откат — у склада на любом его устройстве
  box.innerHTML = list.map(s=>{
    const d = new Date(s.taken_at), c = s.counts || {};
    const when = d.toLocaleDateString('ru-RU', {day:'numeric', month:'long'}) + ', ' + d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
    return `<div class="row-item">
      <div class="rmain"><div class="rname">${escapeHtml(when)}</div>
        <div class="rmeta">${SNAP_KIND[s.kind] || escapeHtml(s.kind)} · моделей: ${Number(c.models)||0} · ячеек: ${Number(c.cells)||0} · операций: ${Number(c.operations)||0}</div></div>
      <button class="btn ghost sm" style="width:auto;" ${master ? '' : 'disabled'} onclick="restoreSnapshotUI(${Number(s.id)}, ${jsArg(when)})">Откатить</button>
    </div>`;
  }).join('') + (master ? '' : `<div class="t-caption" style="margin-top:8px;color:var(--text-secondary);">Откатить можно только на главном устройстве (галочка выше).</div>`);
}
async function snapshotNow(){
  const r = await Sync.takeSnapshot('manual');
  toast(r.ok ? 'Копия сохранена на сервере' : ('Не вышло: ' + r.error));
  await renderSnapshots();
}
async function restoreSnapshotUI(id, when){
  if(!confirm('Откатить ВСЕ данные к копии от ' + when + '?\n\nМодели, ячейки, приёмки, отправки и история на всех телефонах станут такими, как тогда. Всё, что сделано после, пропадёт из приложения — но нынешнее состояние сначала сохранится копией «До отката», её можно вернуть так же.')) return;
  const r = await Sync.restoreSnapshot(id, t=> toast(t));
  toast(r.ok ? ('Готово: данные откатились к ' + when + '. Остальные телефоны обновятся сами.') : ('Не вышло: ' + r.error));
  await refreshAfterSync();
  await renderSnapshots();
}

async function wipeAll(){
  if(!confirm('Удалить ВСЕ данные (товары, историю, отчёты, рекламу)? Это необратимо.')) return;
  await clearStore('products'); await clearStore('history');
  await clearStore('inventory'); await clearStore('reports'); await clearStore('adspend');
  inventoryActive=false;
  stopInvCamera();
  syncInvActionUI();
  await renderStock(); await renderHistory(); await renderStats(); await renderReports(); await renderInvList();
  toast('Все данные удалены');
}

function downloadFile(filename, content, mime){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
/* Значение в атрибуте HTML (data-*, value, title) — полное экранирование, как для текста. */
function escapeAttr(s){ return escapeHtml(s); }
/* Значение как аргумент JS внутри onclick="…": строка JSON, затем экранирование для HTML.
   Раньше там было только \' — поставщик мог подбросить свой код в браузер склада. */
function jsArg(s){ return escapeHtml(JSON.stringify(String(s ?? ''))); }

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  });
}
