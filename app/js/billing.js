/* Fulbro: биллинг склада — сколько поставщик должен складу. Тарифы склада (Настройки
   склада → settings.billing): за каждую собранную отправку и за килограмм приёмки.
   Сумма ставится в документ (fee), когда отправка стала «собрана» и когда приёмка ушла
   в раскладку с весом: потом смена тарифа прошлых долгов не меняет. Оплаты — «Оплачено».
   Долг = начислено − оплачено. Видит только склад. */
const BILLING_DEFAULT = {ship: 150, kg: 40};
const money2 = n=> Math.round((Number(n) || 0) * 100) / 100;

function billingRates(){
  const b = (window.settings && settings.billing) || {};
  const val = (x, d)=> (x === undefined || x === null || x === '' || !isFinite(Number(x))) ? d : Math.max(0, Number(x));
  return {ship: val(b.ship, BILLING_DEFAULT.ship), kg: val(b.kg, BILLING_DEFAULT.kg)};
}
/* Статус отправки и её сумма: «собрана» — начисляем по тарифу (один раз), иначе — снимаем. */
function shipmentSetStatus(sh, status){
  sh.status = status;
  if(status === 'собрана'){ if(sh.fee === null || sh.fee === undefined) sh.fee = billingRates().ship; }
  else sh.fee = null;
}
/* Сумма приёмки: только настоящая приёмка с весом (не возврат и не раскладка с пола). */
function receiptFee(r){
  return (r.kind || 'приёмка') === 'приёмка' && Number(r.weightKg) > 0 ? money2(Number(r.weightKg) * billingRates().kg) : null;
}

async function supplierBilling(supplierId){
  const sh = (await getAll('shipments')).filter(s=> !s.deletedAt && s.supplierId === supplierId && s.status === 'собрана' && Number(s.fee) > 0);
  const rc = (await getAll('receipts')).filter(r=> !r.deletedAt && r.supplierId === supplierId && Number(r.fee) > 0);
  const pays = (await getAll('payments')).filter(p=> !p.deletedAt && p.supplierId === supplierId).sort((a, b)=> (b.ts || 0) - (a.ts || 0));
  const shipSum = money2(sh.reduce((n, s)=> n + Number(s.fee), 0));
  const rcSum = money2(rc.reduce((n, r)=> n + Number(r.fee), 0));
  const kg = money2(rc.reduce((n, r)=> n + (Number(r.weightKg) || 0), 0));
  const paid = money2(pays.reduce((n, p)=> n + Number(p.amount), 0));
  return {shipN: sh.length, shipSum, kg, rcSum, paid, debt: money2(shipSum + rcSum - paid), payments: pays};
}
async function addPayment(supplierId, amount){
  const n = money2(String(amount).replace(/\s/g, '').replace(',', '.'));
  if(!(n > 0)) return {ok:false, error:'Укажите сумму больше нуля'};
  if(n > 10000000) return {ok:false, error:'Слишком большая сумма'};
  const id = newUid();
  await put('payments', {id, supplierId, amount: n, ts: Date.now(), note: ''});
  return {ok:true, id};
}
async function removePayment(id){
  const p = await get('payments', id);
  if(p && !p.deletedAt){ p.deletedAt = Date.now(); await put('payments', p); }
  return {ok:true};
}

/* ---------------- экран «Поставщики»: тарифы и долг ---------------- */
function billingTariffCard(){
  const r = billingRates();
  return `<div class="card bill-card" id="billTariffs"><div class="rname">Тарифы склада для поставщиков</div>
    <div class="field-row" style="margin-top:8px;align-items:flex-end;">
      <div class="field" style="margin:0;"><label for="billShip">Отправка, ₽</label><input type="number" id="billShip" min="0" inputmode="decimal" value="${r.ship}"></div>
      <div class="field" style="margin:0;"><label for="billKg">Приёмка, ₽ за кг</label><input type="number" id="billKg" min="0" inputmode="decimal" value="${r.kg}"></div>
      <button class="btn primary" style="width:auto;" id="billSave" onclick="billSaveRates()">Сохранить</button></div>
    <p class="hint" style="margin:6px 0 0;">Считается за каждую собранную отправку и за вес приёмки. Новый тариф — только для новых отправок и приёмок.</p></div>`;
}
async function billingSupplierBlock(s){
  const b = await supplierBilling(s.id);
  const pays = b.payments.slice(0, 5).map(p=> `<div class="row-item bill-pay"><div class="rmain">Оплата ${fmtMoney(p.amount)} · ${new Date(p.ts).toLocaleDateString('ru-RU')}</div>
      <div class="rside"><button type="button" class="icon-btn" data-pay-del="${escapeAttr(p.id)}" onclick="billRemovePay(${jsArg(p.id)})" aria-label="Убрать оплату"><svg class="icon"><use href="#i-trash"/></svg></button></div></div>`).join('');
  return `<div class="bill-box" data-bill="${escapeAttr(s.id)}">
    <div class="sup-head"><div>Долг: <b class="bill-debt${b.debt > 0 ? ' neg' : ''}">${fmtMoney(b.debt)}</b></div>
      <button class="btn primary sm" style="width:auto;" data-pay="${escapeAttr(s.id)}" onclick="billPay(${jsArg(s.id)})">Оплачено</button></div>
    <div class="rmeta">Отправок ${b.shipN} — ${fmtMoney(b.shipSum)} · приёмка ${b.kg} кг — ${fmtMoney(b.rcSum)} · оплачено ${fmtMoney(b.paid)}</div>
    ${pays}</div>`;
}
async function billSaveRates(){
  const ship = Number(document.getElementById('billShip').value), kg = Number(document.getElementById('billKg').value);
  if(!(ship >= 0) || !(kg >= 0)){ toast('Тариф — число, 0 или больше'); return; }
  settings.billing = {ship: money2(ship), kg: money2(kg)};
  await saveAppSettings();
  toast('Тарифы сохранены');
}
async function billPay(supplierId){
  const b = await supplierBilling(supplierId);
  const v = prompt('Сколько поставщик заплатил, ₽?', b.debt > 0 ? String(b.debt) : '');
  if(v === null) return;
  const r = await addPayment(supplierId, v);
  if(!r.ok){ toast(r.error); return; }
  toast('Оплата записана'); await renderSuppliers();
}
async function billRemovePay(id){
  if(!confirm('Убрать эту оплату? Сумма вернётся в долг.')) return;
  await removePayment(id); toast('Оплата убрана'); await renderSuppliers();
}
