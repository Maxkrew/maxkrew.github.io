/* Fulbro: режим «без ячеек» (владелец, 21.11.2026: «не все работают с системой ячеек — нужно,
   чтобы люди могли просто загружать товары на склад и отправлять без ячеек»).
   Учёт тот же: товар лежит на «полу» поставщика (как «Всё на пол»), номера ячеек просто не показываются.
   — вкладки «Ячейки» нет, на «Сегодня» нет «не разложено» и «лежит на полу»;
   — приёмка: одна кнопка «Принять» — товар сразу на складе;
   — сборка: без «возьми из ячейки N»;
   — переключить можно в любой момент: ничего не теряется, товар из ячеек тоже отправляется. */

function ffNoCells(){ return !!(window.settings && settings.noCells); }

/* класс на <body> — по нему CSS прячет ячейки; плюс то, что CSS не достать */
function applyNoCells(){
  const on = ffNoCells();
  document.body.classList.toggle('no-cells', on);
  const cb = document.getElementById('setNoCells'); if(cb) cb.checked = on;
  const p = document.querySelector('#sec-receipts .page-head p');
  if(p){ if(!p.dataset.cellsText) p.dataset.cellsText = p.textContent; p.textContent = on ? 'Что приехало от поставщиков — «Принять», и товар на складе' : p.dataset.cellsText; }
  if(typeof buildBottomNav === 'function') buildBottomNav();
  const active = document.querySelector('main section.active');
  if(on && active && active.id === 'sec-cells') showSection('today');
}

async function setNoCells(on){
  settings.noCells = !!on;
  await saveAppSettings();
  applyNoCells();
  toast(on ? 'Работаем без ячеек: приёмка сразу на склад, сборка без номеров ячеек' : 'Ячейки включены');
  if(window.Sync && Sync.syncNow) Sync.syncNow('настройки').catch(()=>{});
}

/* «Принять» в режиме без ячеек: всё на пол поставщика и сразу отмечено «положено» */
async function rcAccept(rid){
  const mid = (document.getElementById('rcModel-' + rid) || {}).value, sz = document.querySelector('#rcSizes-' + CSS.escape(rid) + ' button.on'), q = (document.getElementById('rcQty-' + rid) || {}).value;
  if(mid && sz && q){ const ok = await rcAddLine(rid, true); if(!ok) return; }
  if(!(await receiptLines(rid)).length){ toast('Выберите товар, размер и сколько штук'); return; }
  const w = (document.getElementById('rcWeight-' + rid) || {}).value;
  await finishReceipt(rid, w, true);
  let n = 0;
  for(const l of await receiptLines(rid)) for(let i = 0; i < (l.plan || []).length; i++){ const r = await tickReceiptStep(l.id, i); if(r && r.ok) n += Number(l.plan[i].qty) || 0; }
  toast('Принято: ' + n + ' шт. — товар на складе');
  await renderReceipts();
}
