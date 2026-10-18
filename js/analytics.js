/* «Склад»: Аналитика — графики продаж, что растёт/падает, прогноз остатков. */
/* ============================================================
   ПРОДАЖИ — это живые записи «Расход» (как и в «Расходах»), по одной на
   uid: локальные дубли истории не должны задваивать графики.
   ============================================================ */
const DAY_MS = 24*60*60*1000;

async function salesRows(){
  const hist = await getAllLive('history');
  const products = await getAll('products');
  const bySku = {}; products.forEach(p=> bySku[p.sku] = p);
  const seen = new Set(), rows = [];
  for(const h of hist){
    if(h.type !== 'Расход') continue;
    const k = h.uid || ('#'+h.id);
    if(seen.has(k)) continue; seen.add(k);
    const e = opEconomics(h, bySku[h.sku]);
    rows.push({ts: Number(h.timestamp)||0, sku: h.sku, name: (bySku[h.sku] && bySku[h.sku].name) || h.name || h.sku,
               qty: Math.abs(Number(h.qty)||0), revenue: e ? e.revenue : 0});
  }
  return rows;
}

function dayStart(ts){ const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
function weekStart(ts){ const d = new Date(dayStart(ts)); const wd = (d.getDay()+6)%7; d.setDate(d.getDate()-wd); return d.getTime(); }
function ddmm(ts){ const d = new Date(ts); return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0'); }
function fmtNum(n){ return Math.round(n).toLocaleString('ru-RU'); }
function fmtRate(n){ return n >= 10 ? fmtNum(n) : n.toLocaleString('ru-RU', {maximumFractionDigits:1}); }

/* корзины: 30 дней или 12 недель, последняя — текущая */
function bucketize(rows, mode, metric){
  const n = mode === 'week' ? 12 : 30;
  const step = mode === 'week' ? 7*DAY_MS : DAY_MS;
  const last = mode === 'week' ? weekStart(Date.now()) : dayStart(Date.now());
  const buckets = [];
  for(let i = n-1; i >= 0; i--){
    /* через границу перехода на летнее время шаг бывает 23/25 ч — выравниваем */
    const start = mode === 'week' ? weekStart(last - i*step + DAY_MS/2) : dayStart(last - i*step + DAY_MS/2);
    buckets.push({start, end: start + step, value: 0});
  }
  for(const r of rows){
    for(const b of buckets){
      if(r.ts >= b.start && r.ts < b.end){ b.value += metric === 'revenue' ? r.revenue : r.qty; break; }
    }
  }
  buckets.forEach((b, i)=>{
    b.label = mode === 'week' ? ('неделя с ' + ddmm(b.start)) : new Date(b.start).toLocaleDateString('ru-RU', {day:'numeric', month:'long', weekday:'short'});
    b.short = ddmm(b.start);
    b.tick = mode === 'week' ? (i % 3 === 2 || i === buckets.length-1) : (i % 7 === 1 || i === buckets.length-1);
  });
  return buckets;
}

function niceMax(v){
  if(v <= 0) return 4;
  /* середина шкалы тоже подписана — она должна быть целой */
  if(v <= 10) return Math.max(2, Math.ceil(v / 2) * 2);
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for(const m of [1, 2, 4, 5, 10]) if(m*p >= v) return m*p;
  return 10*p;
}

/* Столбики: тонкие, скругление 4px только сверху, 2px зазор, одна ось,
   сетка приглушённая. Подписан только максимум — остальное по касанию. */
function barChartSvg(buckets, unit){
  const W = 340, H = 180, L = 40, R = 6, T = 16, B = 22;
  const max = niceMax(Math.max(...buckets.map(b=> b.value)));
  const n = buckets.length, slot = (W-L-R)/n, bw = Math.max(1.5, slot - 2);
  const y = v => T + (H-T-B) * (1 - v/max);
  let g = '';
  [0, max/2, max].forEach(t=>{
    g += `<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)" stroke-width="1"/>`;
    g += `<text x="${L-6}" y="${y(t)+3.5}" text-anchor="end" class="ch-axis">${fmtNum(t)}</text>`;
  });
  const top = buckets.reduce((a, b)=> b.value > a.value ? b : a, buckets[0]);
  buckets.forEach((b, i)=>{
    const x = L + i*slot + (slot-bw)/2, y0 = y(0), h = y0 - y(b.value);
    if(b.value > 0){
      const r = Math.min(4, bw/2, h);
      g += `<path class="ch-bar" data-i="${i}" d="M${x},${y0} V${y0-h+r} Q${x},${y0-h} ${x+r},${y0-h} H${x+bw-r} Q${x+bw},${y0-h} ${x+bw},${y0-h+r} V${y0} Z"/>`;
    }
    if(b.tick){
      const lastOne = i === n-1;
      g += `<text x="${lastOne ? W-R : x+bw/2}" y="${H-6}" text-anchor="${lastOne ? 'end' : 'middle'}" class="ch-axis">${b.short}</text>`;
    }
    g += `<rect class="ch-hit" data-i="${i}" x="${L+i*slot}" y="${T}" width="${slot}" height="${H-T-B}" fill="transparent"/>`;
  });
  if(top.value > 0){
    const i = buckets.indexOf(top), x = L + i*slot + slot/2;
    g += `<text x="${Math.min(W-R-2, Math.max(L+10, x))}" y="${y(top.value)-5}" text-anchor="middle" class="ch-val">${fmtNum(top.value)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="ch-svg" role="img" aria-label="Продажи, ${unit}">${g}</svg>`;
}

/* стрелка вверх/вниз — своя: иконки «приход/расход» в приложении означают другое */
function trendIcon(up){
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${up ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M6 13l6 6 6-6'}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function sparkSvg(values){
  const W = 72, H = 22, max = Math.max(1, ...values);
  const pts = values.map((v, i)=> (i*(W-2)/(values.length-1)+1).toFixed(1) + ',' + (H-2 - (H-4)*v/max).toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="ch-spark" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/* ============================================================
   ГРАФИК ПРОДАЖ
   ============================================================ */
var salesMode = 'day', salesMetric = 'qty', salesBuckets = [];
function setSalesMode(m){ salesMode = m; renderSalesCharts(); }
function setSalesMetric(m){ salesMetric = m; renderSalesCharts(); }

async function renderSalesCharts(){
  const box = document.getElementById('salesChart');
  if(!box) return;
  document.querySelectorAll('#salesModeSeg button').forEach(b=> b.classList.toggle('active', b.dataset.v === salesMode));
  document.querySelectorAll('#salesMetricSeg button').forEach(b=> b.classList.toggle('active', b.dataset.v === salesMetric));
  const rows = await salesRows();
  salesBuckets = bucketize(rows, salesMode, salesMetric);
  const unit = salesMetric === 'revenue' ? '₽' : 'шт';
  const total = salesBuckets.reduce((s, b)=> s + b.value, 0);
  /* сравнение с таким же отрезком перед ним */
  const span = salesBuckets[salesBuckets.length-1].end - salesBuckets[0].start;
  const prevStart = salesBuckets[0].start - span;
  const prev = rows.filter(r=> r.ts >= prevStart && r.ts < salesBuckets[0].start)
                   .reduce((s, r)=> s + (salesMetric === 'revenue' ? r.revenue : r.qty), 0);
  const chg = prev > 0 ? Math.round((total - prev) / prev * 100) : null;
  /* «+3650%» не читается — большой рост пишем разами */
  const times = total / prev, tr = Math.round(times);
  const razа = (times !== tr || (tr % 10 >= 2 && tr % 10 <= 4 && (tr % 100 < 12 || tr % 100 > 14))) ? 'раза' : 'раз';
  const chgText = chg === null ? '' : chg >= 200 ? ('в ' + fmtRate(times) + ' ' + razа) : ((chg >= 0 ? '+' : '−') + Math.abs(chg) + '%');
  const prevName = salesMode === 'week' ? '12 недель' : '30 дней';
  document.getElementById('salesHeadline').innerHTML =
    `<div class="ch-hero num">${fmtNum(total)} ${unit}</div>
     <div class="t-caption" style="color:var(--text-secondary);">за ${prevName}${chg === null ? '' :
       ` · <span class="trend ${chg >= 0 ? 'up' : 'down'}">${trendIcon(chg >= 0)}${chgText}</span> ${chg >= 200 ? 'больше, чем за' : 'к'} предыдущие ${prevName}`}</div>`;
  if(total === 0){
    box.innerHTML = emptyLine('i-alert', 'Продаж за этот отрезок нет');
  } else {
    box.innerHTML = barChartSvg(salesBuckets, unit) + '<div class="ch-tip" id="salesTip" hidden></div>';
    wireChartHover(box, unit);
  }
  document.getElementById('salesTable').innerHTML = salesBuckets.slice().reverse()
    .map(b=> `<div class="row-item"><div class="rmain">${escapeHtml(b.label)}</div><span class="rval">${fmtNum(b.value)} ${unit}</span></div>`).join('');
  await renderTrends(rows);
}

function wireChartHover(box, unit){
  const svg = box.querySelector('svg'), tip = box.querySelector('.ch-tip');
  const show = (e)=>{
    const t = e.target.closest('.ch-hit'); if(!t){ hide(); return; }
    const i = Number(t.dataset.i), b = salesBuckets[i];
    svg.querySelectorAll('.ch-bar').forEach(p=> p.classList.toggle('dim', Number(p.dataset.i) !== i));
    tip.innerHTML = `<b class="num">${fmtNum(b.value)} ${unit}</b><span>${escapeHtml(b.label)}</span>`;
    tip.hidden = false;
    const br = box.getBoundingClientRect(), tr = t.getBoundingClientRect();
    const x = Math.min(br.width - tip.offsetWidth - 4, Math.max(4, tr.left - br.left + tr.width/2 - tip.offsetWidth/2));
    tip.style.left = x + 'px';
  };
  const hide = ()=>{ tip.hidden = true; svg.querySelectorAll('.ch-bar').forEach(p=> p.classList.remove('dim')); };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', (e)=>{ if(e.pointerType === 'mouse') hide(); });
}

/* ---- что растёт, что падает: 14 полных дней против 14 до них ----
   Сегодняшний день не берём: он неполный и всегда «проседал» бы. */
async function renderTrends(rows){
  const box = document.getElementById('salesTrends');
  if(!box) return;
  const today = dayStart(Date.now());
  const cur0 = today - 14*DAY_MS, prev0 = today - 28*DAY_MS;
  const by = {};
  for(const r of rows){
    if(r.ts < prev0 || r.ts >= today) continue;
    const o = by[r.sku] = by[r.sku] || {name: r.name, cur: 0, prev: 0, days: new Array(28).fill(0)};
    if(r.ts >= cur0) o.cur += r.qty; else o.prev += r.qty;
    o.days[Math.floor((r.ts - prev0) / DAY_MS)] += r.qty;
  }
  /* шум (±1 шт или меньше 10%) не показываем — только заметные сдвиги */
  const list = Object.values(by).map(o=> Object.assign(o, {d: o.cur - o.prev}))
    .filter(o=> Math.abs(o.d) >= 2 && (o.prev === 0 || Math.abs(o.d) / o.prev >= 0.1));
  const up = list.filter(o=> o.d > 0).sort((a, b)=> b.d - a.d);
  const down = list.filter(o=> o.d < 0).sort((a, b)=> a.d - b.d);
  const row = o=>{
    const pct = o.prev > 0 ? Math.round(o.d / o.prev * 100) : null;
    return `<div class="row-item">
      <div class="rmain"><div class="rname">${escapeHtml(o.name)}</div>
        <div class="rmeta num">${fmtNum(o.prev)} → ${fmtNum(o.cur)} шт</div></div>
      ${sparkSvg(o.days)}
      <span class="trend ${o.d > 0 ? 'up' : 'down'}">${trendIcon(o.d > 0)}${pct === null ? 'новый' : ((o.d > 0 ? '+' : '−') + Math.abs(pct) + '%')}</span>
    </div>`;
  };
  box.innerHTML = (!up.length && !down.length)
    ? emptyLine('i-alert', 'За 4 недели заметных изменений нет')
    : (up.length ? `<div class="t-eyebrow ch-group">Растут</div>` + up.map(row).join('') : '')
      + (down.length ? `<div class="t-eyebrow ch-group">Падают</div>` + down.map(row).join('') : '');
}

/* ============================================================
   ПРОГНОЗ: на сколько дней хватит
   Скорость — продажи за последние 30 ПОЛНЫХ дней (сегодняшний неполный не
   берём), делённые на число дней. Если товар начали продавать недавно —
   на дни с первой продажи, но не меньше 7, чтобы пара продаж подряд не
   давала «кончится завтра». Сегодняшние продажи всё равно учтены — они
   уже уменьшили остаток.
   ============================================================ */
function reorderLeadDays(){ return Math.max(1, Math.round(Number(settings.reorderLeadDays) || 14)); }
async function saveReorderLead(){
  const v = Math.round(Number(document.getElementById('reorderLeadInput').value));
  if(!(v >= 1 && v <= 180)){ toast('Укажите от 1 до 180 дней'); return; }
  settings.reorderLeadDays = v;
  await saveAppSettings();
  toast('Сохранено: заказ за ' + v + ' ' + pluralDney(v));
  await renderForecast();
  await renderReorderCard();
}

function computeForecast(){
  return cachedByVersion('forecast:' + reorderLeadDays() + ':' + dayStart(Date.now()), computeForecastNow);
}
async function computeForecastNow(){
  const rows = await salesRows();
  const today = dayStart(Date.now()), from = today - 30*DAY_MS;
  const by = {};
  for(const r of rows){
    const o = by[r.sku] = by[r.sku] || {sold: 0, first: Infinity};
    o.first = Math.min(o.first, dayStart(r.ts));
    if(r.ts >= from && r.ts < today) o.sold += r.qty;
  }
  const lead = reorderLeadDays();
  const out = {};
  const rb = await returnsBySku();
  for(const p of await getAllLive('products')){
    if(p.stopped) continue;   // в «Стопе» — не продаём, заказывать не нужно
    const s = by[p.sku] || {sold: 0, first: Infinity};
    const days = Math.max(7, Math.min(30, Math.round((today - s.first) / DAY_MS)));
    const rate = s.sold / days;
    const stock = normalStock(p, rb);   // возвраты и повреждённые продавать как новые не будем
    const daysLeft = rate > 0 ? Math.max(0, stock) / rate : Infinity;
    let status = 'ok';
    if(stock <= 0 && rate > 0) status = 'out';
    else if(rate > 0 && daysLeft <= lead) status = 'order';
    else if(rate === 0) status = 'idle';
    const orderQty = rate > 0 ? Math.max(0, Math.ceil(rate * (lead + 30) - Math.max(0, stock))) : 0;
    out[p.sku] = {sku: p.sku, name: p.name, stock, rate, daysLeft, status, orderQty};
  }
  return out;
}

function forecastBadge(f){
  if(f.status === 'out') return `<span class="fc-badge out"><svg class="icon"><use href="#i-alert"/></svg>Закончился</span>`;
  if(f.status === 'order') return `<span class="fc-badge order"><svg class="icon"><use href="#i-alert"/></svg>Пора заказать</span>`;
  return '';
}
function daysLeftText(f){
  if(f.rate === 0) return 'не продаётся 30 дней';
  if(f.status === 'out') return 'нет на складе';
  const d = Math.floor(f.daysLeft);
  return d > 365 ? 'хватит больше чем на год' : ('хватит на ~' + d + ' ' + pluralDney(d));
}

async function renderForecast(){
  const box = document.getElementById('forecastList');
  if(!box) return;
  const inp = document.getElementById('reorderLeadInput');
  if(inp && document.activeElement !== inp) inp.value = reorderLeadDays();
  const fc = Object.values(await computeForecast());
  const rank = f=> f.status === 'out' ? 0 : f.status === 'order' ? 1 : f.status === 'ok' ? 2 : 3;
  fc.sort((a, b)=> rank(a) - rank(b) || a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
  if(!fc.length){ box.innerHTML = emptyLine('i-box', 'Товаров пока нет'); return; }
  box.innerHTML = fc.map(f=> `<div class="row-item fc-row ${f.status}">
      <div class="rmain"><div class="rname">${escapeHtml(f.name)}</div>
        <div class="rmeta">${daysLeftText(f)}${f.rate > 0 ? (' · ' + fmtRate(f.rate) + ' шт/день') : ''}</div>
        ${f.orderQty > 0 && f.status !== 'ok' ? `<div class="rmeta fc-order num">Заказать ~${fmtNum(f.orderQty)} шт</div>` : ''}</div>
      <div class="rside"><span class="rval num">${f.stock} шт</span>${forecastBadge(f)}</div>
    </div>`).join('');
}

/* карточка на «Панели»: только когда есть что заказывать */
async function renderReorderCard(fcMap){
  const card = document.getElementById('reorderCard');
  if(!card) return;
  if(isEmployee()){ card.hidden = true; return; }
  const fc = Object.values(fcMap || await computeForecast()).filter(f=> f.status === 'out' || f.status === 'order')
    .sort((a, b)=> a.daysLeft - b.daysLeft);
  card.hidden = fc.length === 0;
  if(!fc.length) return;
  document.getElementById('reorderCount').textContent = fc.length;
  document.getElementById('reorderList').innerHTML = fc.slice(0, 3).map(f=>
    `<div class="row-item"><div class="rmain"><div class="rname">${escapeHtml(f.name)}</div><div class="rmeta">${daysLeftText(f)}</div></div>${forecastBadge(f)}</div>`).join('')
    + (fc.length > 3 ? `<div class="t-caption" style="margin-top:6px;color:var(--text-secondary);">и ещё ${fc.length - 3}</div>` : '');
}
function openForecast(){
  const navBtn = [...document.querySelectorAll('nav.bottom button')].find(b=> /showSection\('finance'/.test(b.getAttribute('onclick')||''));
  showSection('finance', navBtn || null);
  switchFinSubTab('fc');
  const el = document.getElementById('finSubFc');
  if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
}
