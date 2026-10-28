/* Fulbro: статистика отправок и биллинг за период (склад, «Отправки»; пожелание FoG 24.10.2026):
   «Отправлено всего: 17 шт. в 15 отправках · Акне 5: L 3 · M 2 …» и начислено за период —
   отправки × тариф, приёмка кг × тариф, по поставщикам. Считаются собранные отправки (ушли
   со склада) по времени отметки «Собрано»; фильтр поставщика — тот же, что в «Сборке». */
let stPeriod = 'today';
const ST_PERIODS = [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['7', '7 дней'], ['30', '30 дней']];

function stRange(p){
  const t0 = dayStart(Date.now()), D = 86400000;   // dayStart — js/analytics.js
  if(p === 'yesterday') return [t0 - D, t0];
  if(p === '7') return [t0 - 6 * D, Infinity];
  if(p === '30') return [t0 - 29 * D, Infinity];
  return [t0, Infinity];
}
/* {pieces, shipN, models:[{name, qty, sizes:[[label, qty]]}], fees:{shipSum, rcSum, kg, bySup:{id:{shipN, shipSum, rcSum, kg}}}} */
async function shipStats(supplierId, period){
  const [from, to] = stRange(period || stPeriod);
  const inRange = t=> t >= from && t < to;
  const models = await modelsMap(), sizes = Object.fromEntries((await getAll('sizes')).map(s=> [s.id, s]));
  const byModel = {}, bySup = {};
  const sup = id=> bySup[id] || (bySup[id] = {shipN: 0, shipSum: 0, rcSum: 0, kg: 0});
  let pieces = 0, shipN = 0;
  for(const s of (await getAll('shipments')).filter(s=> !s.deletedAt && s.status === 'собрана' && (!supplierId || s.supplierId === supplierId))){
    if(!inRange(await shCollectedAt(s))) continue;
    shipN++; sup(s.supplierId).shipN++; sup(s.supplierId).shipSum += Number(s.fee) || 0;
    for(const l of await shipmentLines(s.id)){
      if(!l.collected) continue;
      const q = Number(l.qty) || 0; pieces += q;
      const m = byModel[l.modelId] || (byModel[l.modelId] = {name: modelName(models[l.modelId] || {}), qty: 0, sizes: {}});
      const label = (sizes[l.sizeId] || {}).sizeLabel || '?';
      m.qty += q; m.sizes[label] = (m.sizes[label] || 0) + q;
    }
  }
  for(const r of (await getAll('receipts')).filter(r=> !r.deletedAt && Number(r.fee) > 0 && (!supplierId || r.supplierId === supplierId) && inRange(r.createdTs || 0))){
    sup(r.supplierId).rcSum += Number(r.fee); sup(r.supplierId).kg += Number(r.weightKg) || 0;
  }
  const list = Object.values(byModel).sort((a, b)=> b.qty - a.qty || a.name.localeCompare(b.name, 'ru'))
    .map(m=> ({name: m.name, qty: m.qty, sizes: Object.entries(m.sizes).sort((a, b)=> sizeOrder(a[0]) - sizeOrder(b[0]))}));
  const sum = k=> Math.round(Object.values(bySup).reduce((n, x)=> n + x[k], 0) * 100) / 100;
  return {pieces, shipN, models: list, fees: {shipSum: sum('shipSum'), rcSum: sum('rcSum'), kg: sum('kg'), bySup}};
}
async function statsCard(supplierId){
  const st = await shipStats(supplierId);
  const sups = await ffSuppliersMap();
  const tabs = ST_PERIODS.map(([id, label])=> `<button type="button" class="as-chip${stPeriod === id ? ' on' : ''}" data-st-period="${id}" onclick="stSetPeriod('${id}')">${label}</button>`).join('');
  const rows = st.models.map(m=> `<div class="st-row"><b>${escapeHtml(m.name)} ${m.qty}</b>: ${m.sizes.map(([l, q])=> escapeHtml(sizeText(l)) + ' ' + q).join(' · ')}</div>`).join('');
  const f = st.fees;
  const bySup = !supplierId && Object.keys(f.bySup).length > 1 ? Object.entries(f.bySup)
    .sort((a, b)=> (b[1].shipSum + b[1].rcSum) - (a[1].shipSum + a[1].rcSum))
    .map(([id, x])=> `<div class="st-row">${escapeHtml((sups[id] || {}).name || 'Поставщик')}: ${fmtMoney(x.shipSum + x.rcSum)} <span class="rmeta">(отправок ${x.shipN}${x.kg ? ', приёмка ' + Math.round(x.kg * 100) / 100 + ' кг' : ''})</span></div>`).join('') : '';
  const rates = typeof billingRates === 'function' ? billingRates(supplierId ? sups[supplierId] : null) : {ship: 0, kg: 0};
  return `<details class="card st-card" id="stCard"${window.stOpen ? ' open' : ''} ontoggle="window.stOpen = this.open"><summary class="rname">Статистика и начисления</summary>
    <div class="as-chips" style="margin-top:10px;">${tabs}</div>
    <div class="st-total">Отправлено всего: <b>${st.pieces} шт.</b> <span class="rmeta">в ${st.shipN} ${st.shipN === 1 ? 'отправке' : 'отправках'}</span></div>
    ${rows || '<div class="hint">За этот период ничего не отправлено</div>'}
    <div class="grp-title">Начислено за период</div>
    <div class="st-row">Отправки: ${st.shipN} — ${fmtMoney(f.shipSum)} <span class="rmeta">(${rates.mode === 'percent' ? 'процент от заказа' : 'тариф ' + fmtMoney(rates.ship)})</span></div>
    <div class="st-row">Приёмка: ${Math.round(f.kg * 100) / 100} кг — ${fmtMoney(f.rcSum)} <span class="rmeta">(тариф ${fmtMoney(rates.kg)}/кг)</span></div>
    <div class="st-total">Итого: <b>${fmtMoney(f.shipSum + f.rcSum)}</b></div>${bySup}</details>`;
}
async function stSetPeriod(p){ stPeriod = p; window.stOpen = true; await renderShipments(); }
