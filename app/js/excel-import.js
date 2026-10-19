/* «Fulbro», этап 2б: приход поставщика из Excel (ОПИСАНИЕ §11в «Excel»).
   Таблицы у всех разные: угадываем колонки по заголовкам, поставщик поправляет, выбор
   запоминается (на этом устройстве). Разбор — здесь, в приложении (SheetJS, без интернета). */

const XLS_ROLES = [['name', 'Название'], ['size', 'Размер'], ['qty', 'Количество'], ['price', 'Цена закупки'], ['sku', 'Артикул'], ['barcode', 'Штрихкод'], ['color', 'Цвет'], ['skip', 'Не нужно']];
const XLS_WORDS = {
  name: ['наименование', 'название', 'товар', 'модель', 'номенклатура'],
  size: ['размер', 'р-р'],
  qty: ['кол-во', 'количество', 'шт', 'остаток', 'кол'],
  price: ['цена', 'закуп', 'стоимость', 'себестоимость'],
  sku: ['артикул', 'арт'],
  barcode: ['штрихкод', 'баркод', 'ean'],
  color: ['цвет']
};
const XLS_MAX_QTY = 10000;

/* --- библиотека: один раз, из кэша приложения --- */
let xlsLoading = null;
function loadXlsx(){
  if(window.XLSX) return Promise.resolve();
  if(!xlsLoading) xlsLoading = new Promise((res, rej)=>{
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = ()=> res();
    s.onerror = ()=>{ xlsLoading = null; s.remove(); rej(new Error('Не удалось открыть модуль Excel')); };
    document.head.appendChild(s);
  });
  return xlsLoading;
}

/* .csv бывает в UTF-8 и в windows-1251 (старый Excel) — пробуем UTF-8 строго, иначе 1251 */
function xlsDecodeText(buf){
  try{ return new TextDecoder('utf-8', {fatal:true}).decode(buf).replace(/^﻿/, ''); }
  catch(e){ return new TextDecoder('windows-1251').decode(buf); }
}
async function readWorkbook(file){
  await loadXlsx();
  const buf = new Uint8Array(await file.arrayBuffer());
  const wb = /\.(csv|txt)$/i.test(file.name || '') ? XLSX.read(xlsDecodeText(buf), {type:'string', raw:true}) : XLSX.read(buf, {type:'array'});
  return {
    sheets: wb.SheetNames.slice(),
    /* числа — как есть: отформатированный текст SheetJS пишет «1,200» и «4.60123E+12» */
    rows: name=> XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, raw:true, defval:'', blankrows:true})
      .map(r=> r.map(v=> typeof v === 'number' ? (Number.isInteger(v) ? v.toFixed(0) : String(v)) : String(v == null ? '' : v).trim()))
  };
}

/* --- угадывание --- */
const xlsNorm = s=> String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
function xlsRoleOf(text){
  const t = xlsNorm(text); if(!t) return null;
  const words = t.split(/[\s.,:;()/]+/).filter(Boolean);
  // самое точное совпадение, а не первое: «Штрихкод» — не «шт», «Цена товара» — не «товар»
  let best = null, score = 0;
  for(const [role, list] of Object.entries(XLS_WORDS)) for(const w of list){
    const sc = t === w ? 3 : t.startsWith(w) ? 2 + w.length / 100 : words.some(x=> x.startsWith(w)) ? 1 + w.length / 100 : 0;
    if(sc > score){ score = sc; best = role; }
  }
  return best;
}
function xlsSizeLabel(text){
  // «М», «ХL», «С» часто набраны русскими буквами
  const look = {'М': 'M', 'Х': 'X', 'С': 'S', 'Л': 'L'};
  const t = String(text || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[МХСЛ]/g, c=> look[c]);
  if(!t) return null;
  const alias = {XXL: '2XL', XXXL: '3XL', XXXXL: '4XL'};
  const u = alias[t] || t;
  if(SIZE_SET.includes(u)) return u;
  if(/^\d{2}$/.test(u) && Number(u) >= 20 && Number(u) <= 60) return u;
  return null;
}
function guessColumns(header){
  const used = new Set();
  return (header || []).map(h=>{
    const r = xlsRoleOf(h);
    if(!r || used.has(r)) return 'skip';
    used.add(r); return r;
  });
}
function detectSizeColumns(header){
  const idx = [];
  (header || []).forEach((h, i)=>{ if(xlsSizeLabel(h)) idx.push(i); });
  return idx.length >= 2 ? idx : [];
}
function findHeaderRow(rows){
  for(let i = 0; i < Math.min(10, rows.length); i++){
    const known = new Set((rows[i] || []).map(xlsRoleOf).filter(Boolean));
    if(known.size >= 2) return i;
  }
  return 0;
}
/* «12 шт» → 12, «12,0» → 12, «1 200,50 ₽» → 1200.5; пусто и текст — null */
function parseNumber(text){
  const s = String(text == null ? '' : text).replace(/[\s  ]/g, '');
  const m = s.match(/-?\d[\d.,]*/);
  if(!m) return null;
  let t = m[0].replace(/[.,]+$/, '');
  // есть и точка, и запятая — десятичный знак тот, что последний («3,000.00», «1.200,50»)
  if(t.includes('.') && t.includes(',')){
    const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    t = t.split(dec === '.' ? ',' : '.').join('').replace(',', '.');
  } else t = t.replace(',', '.');
  if((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');   // «1.200.000»
  const n = Number(t);
  return isFinite(n) ? n : null;
}

/* --- разбор строк --- */
function parseImport(rows, opts){
  const headerRow = opts.headerRow || 0, roles = opts.roles || [], sizeCols = opts.sizeCols || [];
  const header = rows[headerRow] || [];
  const col = role=> roles.indexOf(role);
  const cell = (r, role)=>{ const i = col(role); return i < 0 ? '' : String(r[i] == null ? '' : r[i]).trim(); };
  const lines = [], errors = [];
  for(let i = headerRow + 1; i < rows.length; i++){
    const r = rows[i] || [], rowNo = i + 1;
    if(!r.some(v=> String(v || '').trim())) continue;                       // пустая строка
    const name = cell(r, 'name');
    if(/^(итого|всего)/i.test(name) || (!name && r.some(v=> /^(итого|всего)/i.test(String(v || '').trim())))) continue;
    if(!name){ errors.push({row: rowNo, msg: 'Строка ' + rowNo + ': нет названия'}); continue; }
    const base = {row: rowNo, name, color: cell(r, 'color'), sku: cell(r, 'sku'), barcode: cell(r, 'barcode'), price: parseNumber(cell(r, 'price'))};
    if(base.price !== null && base.price < 0) base.price = null;
    const add = (size, raw)=>{
      const q = parseNumber(raw);
      if(q === null || q <= 0){ errors.push({row: rowNo, msg: 'Строка ' + rowNo + ': нет количества'}); return; }
      if(q > XLS_MAX_QTY){ errors.push({row: rowNo, msg: 'Строка ' + rowNo + ': больше ' + XLS_MAX_QTY + ' шт. — проверьте'}); return; }
      lines.push(Object.assign({}, base, {size, qty: Math.round(q)}));
    };
    if(sizeCols.length){
      let any = false;
      for(const ci of sizeCols){ const q = parseNumber(r[ci]); if(q !== null && q > 0){ any = true; add(xlsSizeLabel(header[ci]), r[ci]); } }
      if(!any) errors.push({row: rowNo, msg: 'Строка ' + rowNo + ': нет количества'});
    } else {
      add(xlsSizeLabel(cell(r, 'size')) || cell(r, 'size') || 'Единый', cell(r, 'qty'));
    }
  }
  return {lines, errors};
}

/* --- поиск своих товаров: штрихкод → артикул + размер → название (+ цвет) + размер --- */
async function matchImportLines(lines, supplierId){
  const models = (await getAll('models')).filter(m=> !m.deletedAt && m.supplierId === supplierId);
  const sizes = (await getAll('sizes')).filter(s=> !s.deletedAt && s.supplierId === supplierId);
  const sizeKeyOf = l=> xlsSizeLabel(l) || xlsNorm(l);
  const sizeOf = (modelId, label)=> sizes.find(s=> s.modelId === modelId && sizeKeyOf(s.sizeLabel) === sizeKeyOf(label));
  return lines.map(l=>{
    let m = null, s = null;
    if(l.barcode){ s = sizes.find(x=> x.barcode && String(x.barcode).trim() === l.barcode) || null; if(s) m = models.find(x=> x.id === s.modelId) || null; }
    if(!m && l.sku) m = models.find(x=> x.sku && xlsNorm(x.sku) === xlsNorm(l.sku)) || null;
    if(!m){ const key = xlsNorm([l.name, l.color].filter(Boolean).join(' ')); m = models.find(x=> xlsNorm(modelName(x)) === key) || null; }
    if(m && !s) s = sizeOf(m.id, l.size) || null;
    return Object.assign({}, l, {modelId: m ? m.id : null, sizeId: s ? s.id : null, isNew: !m});
  });
}
/* новые модели и размеры, затем одна поставка «ожидается» с ценами */
async function importToIncoming(matched){
  const made = new Map();   // одна новая модель на название+цвет+артикул
  const out = [];
  for(const l of matched){
    let modelId = l.modelId;
    if(!modelId){
      const key = xlsNorm([l.name, l.color, l.sku].join('|'));
      modelId = made.get(key);
      if(!modelId){ modelId = await saveModel({title: l.name, color: l.color, sku: l.sku, category: 'Одежда', capacity: 7, sizes: []}); made.set(key, modelId); }
    }
    const sizeId = l.sizeId || await saveSize(modelId, l.size, l.barcode || undefined);
    out.push({modelId, sizeId, qty: l.qty, price: l.price});
  }
  const r = await submitIncoming(out);
  if(!r.ok) throw new Error(r.error);
  return r.id;
}

/* --- запомненное сопоставление (на этом устройстве) --- */
const xlsSig = header=> (header || []).map(h=> xlsNorm(h)).join('|');
async function xlsRemembered(header){
  const r = await get('settings', 'xlsMap:' + Sync.mySupplierId());
  const v = r && r.value;
  return v && v.signature === xlsSig(header) && Array.isArray(v.roles) && v.roles.length === header.length ? v : null;
}
async function xlsRemember(header, roles, headerRow){
  await putRaw('settings', {key: 'xlsMap:' + Sync.mySupplierId(), value: {signature: xlsSig(header), roles: roles.slice(), headerRow}});
}

/* --- окно --- */
const xls = {wb: null, sheet: '', rows: [], headerRow: 0, roles: [], sizeCols: [], matched: [], errors: []};
function openXlsImport(){
  Object.assign(xls, {wb: null, sheet: '', rows: [], headerRow: 0, roles: [], sizeCols: [], matched: [], errors: []});
  const f = document.getElementById('xlsFile'); if(f) f.value = '';
  document.getElementById('xlsSheetRow').hidden = true;
  document.getElementById('xlsPreview').innerHTML = '';
  document.getElementById('xlsSummary').innerHTML = '<span class="hint">Выберите файл .xlsx, .xls или .csv</span>';
  document.getElementById('xlsSend').disabled = true;
  document.getElementById('xlsModalBg').classList.add('show');
  loadXlsx().catch(e=> toast(e.message));   // заранее, пока человек ищет файл
}
function closeXlsImport(){ document.getElementById('xlsModalBg').classList.remove('show'); }
async function xlsPickFile(input){
  const file = input.files && input.files[0]; if(!file) return;
  try{ xls.wb = await readWorkbook(file); }
  catch(e){ toast('Не получилось прочитать файл: ' + e.message); return; }
  const sel = document.getElementById('xlsSheet');
  sel.innerHTML = xls.wb.sheets.map(n=> `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('');
  document.getElementById('xlsSheetRow').hidden = xls.wb.sheets.length < 2;
  await xlsUseSheet(xls.wb.sheets[0]);
}
async function xlsUseSheet(name){
  xls.sheet = name; xls.rows = xls.wb.rows(name);
  xls.headerRow = findHeaderRow(xls.rows);
  const header = xls.rows[xls.headerRow] || [];
  const mem = await xlsRemembered(header);
  xls.roles = mem ? mem.roles.slice() : guessColumns(header);
  xls.sizeCols = detectSizeColumns(header);
  await xlsRefresh();
}
async function xlsSetRole(i, role){ xls.roles[i] = role; await xlsRefresh(); }
async function xlsRefresh(){
  const header = xls.rows[xls.headerRow] || [];
  const width = Math.max(header.length, ...xls.rows.slice(xls.headerRow, xls.headerRow + 8).map(r=> r.length));
  const sizeCols = xls.sizeCols.filter(i=> xls.roles[i] === 'skip' || !xls.roles[i]);
  const res = parseImport(xls.rows, {headerRow: xls.headerRow, roles: xls.roles, sizeCols: sizeCols.length >= 2 ? sizeCols : []});
  xls.matched = await matchImportLines(res.lines, Sync.mySupplierId());
  xls.errors = res.errors;
  const th = [];
  for(let i = 0; i < width; i++){
    const isSize = sizeCols.includes(i) && sizeCols.length >= 2;
    th.push(`<th>${isSize ? '<span class="xls-size">размер ' + escapeHtml(xlsSizeLabel(header[i]) || '') + '</span>' : ''}<select data-col="${i}" onchange="xlsSetRole(${i}, this.value)">${XLS_ROLES.map(([v, t])=> `<option value="${v}"${(xls.roles[i] || 'skip') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></th>`);
  }
  const body = xls.rows.slice(xls.headerRow, xls.headerRow + 8).map((r, k)=> `<tr${k === 0 ? ' class="xls-head"' : ''}>${Array.from({length: width}, (_, i)=> `<td>${escapeHtml(r[i] || '')}</td>`).join('')}</tr>`).join('');
  document.getElementById('xlsPreview').innerHTML = `<div class="xls-wrap"><table class="xls-table"><thead><tr>${th.join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  const n = xls.matched.length, pcs = xls.matched.reduce((s, l)=> s + l.qty, 0);
  const fresh = new Set(xls.matched.filter(l=> l.isNew).map(l=> xlsNorm([l.name, l.color, l.sku].join('|')))).size;
  const errs = xls.errors.slice(0, 20).map(e=> `<div class="xls-err">${escapeHtml(e.msg)}</div>`).join('') + (xls.errors.length > 20 ? `<div class="xls-err">…и ещё ${xls.errors.length - 20}</div>` : '');
  document.getElementById('xlsSummary').innerHTML = `<b>Нашёл ${n} ${ruPlural(n, 'товар', 'товара', 'товаров')}, ${pcs} шт., новых ${fresh}</b>${errs}`;
  document.getElementById('xlsSend').disabled = !n;
}
async function xlsSend(){
  if(!xls.matched.length) return;
  const btn = document.getElementById('xlsSend'); btn.disabled = true;
  try{
    await xlsRemember(xls.rows[xls.headerRow] || [], xls.roles, xls.headerRow);
    await importToIncoming(xls.matched);
    closeXlsImport(); toast('Поставка создана — склад её увидит');
    if(typeof renderIncoming === 'function') await renderIncoming();
  }catch(e){ toast(e.message); btn.disabled = false; }
}
function ruPlural(n, one, few, many){
  const a = Math.abs(n) % 100, b = a % 10;
  if(a > 10 && a < 20) return many;
  if(b === 1) return one;
  if(b >= 2 && b <= 4) return few;
  return many;
}
