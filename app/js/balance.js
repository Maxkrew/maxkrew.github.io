/* «Склад»: Баланс партнёров и ставки комиссии. */
/* ============================================================
   БАЛАНС / КОМИССИЯ СОТРУДНИКОВ
   Заказы вбивает владелец: сумму и имя сотрудника. Ставка берётся по
   сумме всего заказа и пишется в заказ снимком — меняя пороги позже,
   прошлые начисления не трогаем. «Баланс» = начислено − выплачено.
   ============================================================ */
const DEFAULT_COMM_TIERS = [
  {max: 2500, percent: 10},
  {max: 5000, percent: 8},
  {max: null, percent: 6}
];
function commissionTiers(){
  const t = (settings && Array.isArray(settings.commissionTiers)) ? settings.commissionTiers : null;
  return (t && t.length) ? t : DEFAULT_COMM_TIERS;
}
/* Порог включается в нижнюю ставку: заказ ровно на 2500 → 10%. */
function rateForAmount(amount){
  const a = Number(amount) || 0;
  const tiers = commissionTiers();
  for(const t of tiers){
    if(t.max === null || t.max === undefined || a <= Number(t.max)) return Number(t.percent) || 0;
  }
  return Number(tiers[tiers.length - 1].percent) || 0;
}
const rub = n => Math.round(Number(n) || 0).toLocaleString('ru-RU');

function commTiersText(){
  const t = commissionTiers();
  let prev = 0;
  return t.map(tier=>{
    if(tier.max === null || tier.max === undefined){
      return 'свыше ' + rub(prev) + ' ₽ → ' + tier.percent + '%';
    }
    const lo = prev > 0 ? (rub(prev) + '–') : 'до ';
    const s = lo + rub(tier.max) + ' ₽ → ' + tier.percent + '%';
    prev = tier.max;
    return s;
  }).join('  ·  ');
}
function updateCommTiersSummary(){
  const el = document.getElementById('commTiersSummary');
  if(el) el.textContent = commTiersText();
}
function loadCommTiersForm(){
  const t = commissionTiers();
  const g = (i, def)=> t[i] || def;
  const set = (id, v)=>{ const el = document.getElementById(id); if(el) el.value = v; };
  const t1 = g(0, DEFAULT_COMM_TIERS[0]), t2 = g(1, DEFAULT_COMM_TIERS[1]), t3 = g(2, DEFAULT_COMM_TIERS[2]);
  set('tierMax1', t1.max == null ? 2500 : t1.max);
  set('tierPct1', t1.percent == null ? 10 : t1.percent);
  set('tierMax2', t2.max == null ? 5000 : t2.max);
  set('tierPct2', t2.percent == null ? 8 : t2.percent);
  set('tierPct3', t3.percent == null ? 6 : t3.percent);
}
async function saveCommTiers(){
  const val = id => Number(document.getElementById(id).value);
  const max1 = val('tierMax1'), pct1 = val('tierPct1');
  const max2 = val('tierMax2'), pct2 = val('tierPct2'), pct3 = val('tierPct3');
  if(!(max1 > 0) || !(max2 > max1)){ toast('Верхний порог должен быть больше нижнего'); return; }
  if([pct1, pct2, pct3].some(p=> !(p >= 0 && p <= 100))){ toast('Проценты — от 0 до 100'); return; }
  settings.commissionTiers = [
    {max: max1, percent: pct1},
    {max: max2, percent: pct2},
    {max: null, percent: pct3}
  ];
  await saveAppSettings();
  updateCommTiersSummary();
  toast('Ставки сохранены. Прошлые заказы не пересчитываются');
}

/* Начисления создаёт «Расход» на Панели. Выплата отмечается галочкой прямо
   на начислении — отдельного ввода выплат больше нет. */

function partnerFromStr(){ return (settings && settings.partnerFrom) || '2026-08-29'; }
function partnerFromTs(){
  const t = Date.parse(partnerFromStr() + 'T00:00:00');
  return isNaN(t) ? 0 : t;
}
async function savePartnerFrom(){
  const v = document.getElementById('partnerFromInput').value;
  settings.partnerFrom = v || '2026-08-29';
  await saveAppSettings();
  toast('Партнёр видит операции с ' + new Date(partnerFromTs()).toLocaleDateString('ru-RU'));
  await renderBalance(currentBalancePeriod, null);
}
/* партнёру — только общий пул и только с даты отсечки */
function visibleToPartner(row){
  if(!isEmployee()) return true;
  return matchesEmployeeScope(row) && (row.timestamp || 0) >= partnerFromTs();
}

async function toggleOrderPaid(uid, isPaid){
  const o = await get('orders', uid);
  if(!o) return;
  o.paid = !!isPaid;
  o.paidAt = isPaid ? Date.now() : undefined;
  await put('orders', o);
  if(window.Sync && Sync.syncNow) Sync.syncNow(isPaid ? 'отмечено выплачено' : 'снята отметка');
  await renderBalance(currentBalancePeriod, null);
}
async function deleteOrder(uid){
  const o = await get('orders', uid);
  if(!o) return;
  /* Начисление пришло с продажи в «Расходе». Убрать его = отменить ту
     продажу: связанная операция удаляется, товар возвращается на склад. */
  const linked = o.opUid ? await historyByUid(o.opUid) : null;
  const canRestore = linked && !linked.deletedAt && linked.type === 'Расход';

  const msg = canRestore
    ? 'Отменить эту продажу?\n\nТовар «' + linked.name + '» — ' + Math.abs(Number(linked.qty)||0) + ' шт вернётся на склад, начисление партнёру пропадёт.'
    : 'Убрать это начисление? (на остаток это не повлияет)';
  if(!confirm(msg)) return;

  await softDelete('orders', uid);
  if(canRestore){
    await softDelete('history', linked.id);
    await new Promise(r=> setTimeout(r, 0));   // даём транзакции удаления зафиксироваться до пересчёта
    await recalcStock(linked.sku);
  }
  if(window.Sync && Sync.syncNow) Sync.syncNow(canRestore ? 'отменена продажа' : 'убрано начисление');
  toast(canRestore ? 'Продажа отменена, товар вернулся на склад' : 'Начисление убрано');
  await renderBalance(currentBalancePeriod, null);
  if(canRestore){ await renderStock(); await renderHistory(); await renderStats(); }
}

async function computeBalance(range){
  const all = (await getAllLive('orders')).filter(visibleToPartner);

  /* Долг — накопительный: всё начисленное минус отмеченное выплаченным, за всё время. */
  const earnedAll = all.reduce((s,o)=> s + (Number(o.commission)||0), 0);
  const paidAllAmt = all.filter(o=> o.paid).reduce((s,o)=> s + (Number(o.commission)||0), 0);
  const debtAll = earnedAll - paidAllAmt;

  const inRange = ts => !range || (ts >= range.start && ts <= range.end);
  const O = all.filter(o=> inRange(o.timestamp));

  let ordersSum = 0, commission = 0, paid = 0, unpaid = 0;
  const byTier = {}, byDay = {};
  O.forEach(o=>{
    const amt = Number(o.amount)||0, com = Number(o.commission)||0, rp = Number(o.ratePercent)||0;
    ordersSum += amt; commission += com;
    if(o.paid) paid += com; else unpaid += com;
    const t = byTier[rp] || (byTier[rp] = {count:0, sum:0, commission:0});
    t.count++; t.sum += amt; t.commission += com;
    const key = o.dateKey || dateKeyOf(new Date(o.timestamp));
    const dd = byDay[key] || (byDay[key] = {count:0, sales:0, commission:0, paid:0, ts:o.timestamp});
    dd.count++; dd.sales += amt; dd.commission += com; if(o.paid) dd.paid += com;
  });

  return {ordersCount:O.length, ordersSum, commission, paid, unpaid, earnedAll, paidAllAmt, debtAll, byTier, byDay};
}

function renderBalanceSummary(d){
  const emp = isEmployee();
  document.getElementById('balSummary').innerHTML = `
    <div class="receipt-row"><span class="rl">Продаж за период</span><span class="rv">${d.ordersCount}</span></div>
    <div class="receipt-row"><span class="rl">Сумма продаж</span><span class="rv">${rub(d.ordersSum)} ₽</span></div>
    <div class="receipt-row"><span class="rl">${emp ? 'Мне начислено' : 'Начислено'} за период</span><span class="rv">${rub(d.commission)} ₽</span></div>
    <div class="receipt-row"><span class="rl">— выплачено</span><span class="rv">${rub(d.paid)} ₽</span></div>
    <div class="receipt-row"><span class="rl">— не выплачено</span><span class="rv">${rub(d.unpaid)} ₽</span></div>
    <div class="receipt-row total"><span class="rl">К выплате</span><span class="rv">${rub(d.debtAll)} ₽</span></div>`;
}
function renderBalanceByDay(d){
  const box = document.getElementById('balByDay');
  if(!box) return;
  const rows = Object.entries(d.byDay).sort((a,b)=> b[1].ts - a[1].ts);
  if(!rows.length){ box.innerHTML = emptyLine('', 'За период движений нет'); return; }
  box.innerHTML = rows.map(([key,x])=>{
    const dstr = new Date(x.ts).toLocaleDateString('ru-RU');
    const left = x.commission - x.paid;
    return `<div class="row-item">
      <div class="rmain"><div class="rname">${dstr}</div><div class="rmeta">${x.count} прод. на ${rub(x.sales)} ₽${x.paid ? ' · выплачено ' + rub(x.paid) + ' ₽' : ''}</div></div>
      <div class="rside"><span class="rval ${left>0?'neg':'pos'}">${rub(left)} ₽</span></div>
    </div>`;
  }).join('') + '<div class="t-caption" style="margin-top:8px;color:var(--text-tertiary);">Справа — сколько за день ещё не выплачено.</div>';
}
/* понятная подпись вилки: ценовой диапазон продажи */
function tierRangeLabel(pct){
  const tiers = commissionTiers();
  let prev = 0;
  for(const t of tiers){
    if(Number(t.percent) === Number(pct)){
      if(t.max == null) return 'продажи от ' + rub(prev) + ' ₽';
      return 'продажи ' + (prev > 0 ? rub(prev) + '–' : 'до ') + rub(t.max) + ' ₽';
    }
    if(t.max != null) prev = t.max;
  }
  return 'ставка ' + pct + '%';
}
function renderBalanceByTier(d){
  const box = document.getElementById('balByTier');
  const tiers = Object.entries(d.byTier).sort((a,b)=> Number(b[0]) - Number(a[0]));
  if(!tiers.length){ box.innerHTML = emptyLine('', 'Продаж за период нет'); return; }
  box.innerHTML = tiers.map(([pct,t])=> `
    <div class="row-item">
      <div class="rmain"><div class="rname">${escapeHtml(tierRangeLabel(pct))} — ${pct}%</div><div class="rmeta">${t.count} прод. на ${rub(t.sum)} ₽</div></div>
      <div class="rside"><span class="rval">${rub(t.commission)} ₽</span></div>
    </div>`).join('') + '<div class="t-caption" style="margin-top:8px;color:var(--text-tertiary);">Сколько начислено с продаж в каждой ценовой вилке.</div>';
}
async function renderBalanceLists(range){
  const emp = isEmployee();
  const inRange = ts => !range || (ts >= range.start && ts <= range.end);
  let orders = (await getAllLive('orders')).filter(o=> inRange(o.timestamp)).filter(visibleToPartner);
  orders.sort((a,b)=> b.timestamp - a.timestamp);
  const unpaid = orders.filter(o=> !o.paid);
  const paid   = orders.filter(o=> o.paid);

  const row = (o, checked)=>{
    const meta = (o.dateDisplay || new Date(o.timestamp).toLocaleDateString('ru-RU'))
               + ' · ' + rub(o.amount) + ' ₽ · ставка ' + o.ratePercent + '%';
    const chk = emp ? ''
      : `<input type="checkbox" class="hist-chk" ${checked ? 'checked' : ''} aria-label="Отметить выплаченным" onchange="toggleOrderPaid(${jsArg(o.uid)}, this.checked)">`;
    const delBtn = (emp || checked) ? ''
      : `<button class="icon-btn" onclick="deleteOrder(${jsArg(o.uid)})" aria-label="Убрать начисление"><svg class="icon"><use href="#i-trash"/></svg></button>`;
    return `<div class="row-item">
      ${chk}
      <div class="rmain"><div class="rname">${escapeHtml(o.note || 'Продажа')}</div><div class="rmeta">${meta}</div></div>
      <div class="rside"><span class="rval ${checked ? '' : 'pos'}">${rub(o.commission)} ₽</span>${delBtn}</div>
    </div>`;
  };

  document.getElementById('balOrdersList').innerHTML = unpaid.length
    ? unpaid.slice(0, 400).map(o=> row(o, false)).join('')
    : emptyLine('', emp ? 'Всё выплачено' : 'Нет невыплаченных начислений');
  document.getElementById('balPaidList').innerHTML = paid.length
    ? paid.slice(0, 400).map(o=> row(o, true)).join('')
    : emptyLine('', 'Выплаченных пока нет');

  const uh = document.getElementById('balUnpaidHead');
  if(uh) uh.textContent = 'Не выплачено' + (unpaid.length ? ' (' + unpaid.length + ')' : '');
  const ph = document.getElementById('balPaidHead');
  if(ph) ph.textContent = 'Выплачено' + (paid.length ? ' (' + paid.length + ')' : '');
  const hint = document.getElementById('balUnpaidHint');
  if(hint) hint.hidden = emp;

  const markAllBtn = document.getElementById('balMarkAllBtn');
  if(markAllBtn){
    const show = !emp && unpaid.length > 1;   // на одну галочку кнопка ни к чему
    markAllBtn.hidden = !show;
    if(show){
      const sum = unpaid.reduce((s,o)=> s + (Number(o.commission)||0), 0);
      markAllBtn.innerHTML = `<svg class="icon"><use href="#i-check"/></svg>Отметить все выплаченными (${unpaid.length} · ${rub(sum)} ₽)`;
    }
  }
}
/* Отмечает выплаченными разом все начисления, которые сейчас видны в
   «Не выплачено» (то есть за выбранный период) — чтобы не тыкать галочки
   по одной, если заказов за период много. */
async function markAllUnpaidVisible(){
  const range = getPeriodRange(currentBalancePeriod);
  const inRange = ts => !range || (ts >= range.start && ts <= range.end);
  const unpaid = (await getAllLive('orders')).filter(o=> !o.paid && inRange(o.timestamp) && visibleToPartner(o));
  if(!unpaid.length){ toast('Отмечать нечего'); return; }
  const sum = unpaid.reduce((s,o)=> s + (Number(o.commission)||0), 0);
  if(!confirm('Отметить выплаченными все начисления за выбранный период?\n\n' + unpaid.length + ' шт. на сумму ' + rub(sum) + ' ₽.')) return;
  const now = Date.now();
  for(const o of unpaid){
    o.paid = true;
    o.paidAt = now;
    await put('orders', o);
  }
  if(window.Sync && Sync.syncNow) Sync.syncNow('массово отмечено выплачено');
  toast('Отмечено выплаченными: ' + unpaid.length);
  await renderBalance(currentBalancePeriod, null);
}
function exportBalanceCSV(){
  getAllLive('orders').then(all=>{
    all = all.filter(visibleToPartner);
    all.sort((a,b)=> b.timestamp - a.timestamp);
    let csv = 'Дата;Что;Сумма продажи;Ставка %;Комиссия;Выплачено\n';
    all.forEach(o=>{
      csv += [o.dateDisplay || new Date(o.timestamp).toLocaleDateString('ru-RU'),
              (o.note || 'продажа'), o.amount, o.ratePercent, o.commission, o.paid ? 'да' : 'нет'].join(';') + '\n';
    });
    downloadFile('vyplaty.csv', csv, 'text/csv;charset=utf-8');
  });
}

var currentBalancePeriod = 1;
async function renderBalance(period, btnEl){
  currentBalancePeriod = period;
  const isCustom = typeof period === 'object' && period !== null;
  const ids = {1:'balPeriodBtn1', 'yesterday':'balPeriodBtnYesterday', 7:'balPeriodBtn7', 30:'balPeriodBtn30'};
  document.querySelectorAll('#sec-balance .period-seg button').forEach(b=> b.classList.remove('active'));
  const activeBtn = btnEl || document.getElementById(isCustom ? 'balPeriodBtnRange' : ids[period]);
  if(activeBtn) activeBtn.classList.add('active');

  const label = document.getElementById('balCustomRangeLabel');
  if(isCustom){
    label.style.display = 'block';
    label.textContent = 'Период: ' + new Date(period.start).toLocaleDateString('ru-RU')
      + ' – ' + new Date(period.end).toLocaleDateString('ru-RU');
  } else {
    label.style.display = 'none';
  }

  updateCommTiersSummary();
  const pf = document.getElementById('partnerFromInput');
  if(pf && !pf.value) pf.value = partnerFromStr();

  const range = getPeriodRange(period);
  const data = await computeBalance(range);
  renderBalanceSummary(data);
  renderBalanceByDay(data);
  renderBalanceByTier(data);
  await renderBalanceLists(range);
}

