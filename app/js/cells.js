/* «ФФ»: Ячейки — номера, размеры, свободные места, «куда положить» и «откуда взять».
   Только расчёт, без базы и экрана: ячейки видит лишь хозяин склада.
   Ячейка: {number, supplierId, modelId|null, allowedSizes:[label]|null, capacity|null, reserved}.
   Остаток ячейки: {sizeLabel: qty}. Правила — ОПИСАНИЕ §5. */

/* Номер «4.10» — это не «4.1»: сравниваем по частям как числа (1 < 1.1 < 1.2 < 1.10 < 2).
   Пол «П1» — первым (отправки берут с него), ячейки брака «Б1», «Б2»… (этап 2) — после всех числовых. */
const isDefectCell = c => !!c && (c.kind === 'брак' || /^Б/.test(String(c.number || '')));
/* Пол поставщика: сюда принимают всю поставку разом; любые модели, мест не считаем. */
const isFloorCell = c => !!c && (c.kind === 'пол' || /^П/.test(String(c.number || '')));
const cellRank = n => /^П/.test(String(n)) ? 0 : (/^Б/.test(String(n)) ? 2 : 1);
function cmpCellNumber(a, b){
  const ra = cellRank(a), rb = cellRank(b);
  if(ra !== rb) return ra < rb ? -1 : 1;
  if(ra !== 1){ a = String(a).slice(1); b = String(b).slice(1); }
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for(let i = 0; i < Math.max(pa.length, pb.length); i++){
    const x = pa[i] === undefined ? -1 : pa[i], y = pb[i] === undefined ? -1 : pb[i];
    if(x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
/* Цвета одного товара (тот же поставщик, бренд и название) могут лежать в одной ячейке. */
const itemKey = m => [m.supplierId, String(m.brand || '').trim().toLowerCase(), String(m.title || '').trim().toLowerCase()].join('|');
function sameItem(a, b){
  if(!a || !b) return false;
  if(a.id === b.id) return true;
  return !!(String(a.brand || '').trim() || String(a.title || '').trim()) && itemKey(a) === itemKey(b);
}

/* Под-ячейка рядом: у «4» и у «4.1» соседняя — следующая свободная «4.N». */
function nextSubCell(number, existing){
  const base = String(number).split('.')[0];
  let max = 0;
  (existing || []).forEach(n=>{
    const p = String(n).split('.');
    if(p[0] === base && p.length === 2) max = Math.max(max, Number(p[1]) || 0);
  });
  return base + '.' + (max + 1);
}

const SIZE_RANK = { XXS:5, XS:10, S:20, M:30, L:40, XL:50, XXL:60, '2XL':60, XXXL:70, '3XL':70, XXXXL:80, '4XL':80, '5XL':90, '6XL':100 };
/* Буквенные размеры по порядку, числовые (обувь) — по значению, всё прочее — в конец. */
function sizeOrder(label){
  const s = String(label || '').trim().toUpperCase();
  if(SIZE_RANK[s] !== undefined) return SIZE_RANK[s];
  const n = parseFloat(s.replace(',', '.'));
  if(!isNaN(n)) return 1000 + n;
  return 100000;
}

function cellCapacity(cell, models){
  if(cell.capacity) return Number(cell.capacity);
  const m = cell.modelId && models && models[cell.modelId];
  return m && m.capacity ? Number(m.capacity) : 7;
}
function cellTotal(stockBySize){
  let t = 0;
  for(const k in (stockBySize || {})) t += Number(stockBySize[k]) || 0;
  return t;
}
/* Свободные места не уходят в минус: при уменьшенной вместимости — «переполнена на N». */
function cellFree(cell, stockBySize, models){
  const cap = cellCapacity(cell, models), lying = cellTotal(stockBySize);
  return { free: Math.max(0, cap - lying), overBy: Math.max(0, lying - cap) };
}
/* Один и тот же размер — одно название (XXL = 2XL). Ранг sizeOrder — только для сортировки:
   «S/M» и «L/XL» по рангу совпадали и путались. */
const SIZE_ALIAS = {XXL:'2XL', XXXL:'3XL', XXXXL:'4XL'};
function sizeKey(l){ const s = String(l || '').trim().toUpperCase().replace(/\s+/g, ''); return SIZE_ALIAS[s] || s; }
function sizeAllowed(cell, sizeLabel){
  if(!cell.allowedSizes || !cell.allowedSizes.length) return true;
  const k = sizeKey(sizeLabel);
  return cell.allowedSizes.some(s=> sizeKey(s) === k);
}

/* Куда положить строку «модель + размер + N шт.»:
   1) ячейки этой модели (в т.ч. её бронь), где размер разрешён и есть место — по номеру;
      потом ячейки других цветов этого товара, где есть место;
   2) у модели уже есть ячейки — излишек в новую под-ячейку рядом с ними (4 → 4.1):
      так владелец и раскладывает («не помещается — создавай 4.1»);
   3) модель новая — пустые ячейки поставщика без брони по номеру, с привязкой к модели,
      а не хватило — под-ячейка рядом с последней из них (7 → 7.1, пример «Хром»). */
function planPlacement(line, cells, cellStock, models){
  const stock = cellStock || {};
  // ячейка брака — не для годного товара (ни своя, ни пустая, ни как соседняя для под-ячейки)
  const own = cells.filter(c=> c.supplierId === line.supplierId && !isDefectCell(c) && !isFloorCell(c)).sort((a,b)=> cmpCellNumber(a.number, b.number));
  const ofModel = own.filter(c=> c.modelId === line.modelId);
  const ofColors = own.filter(c=> c.modelId && c.modelId !== line.modelId && sameItem(models[line.modelId], models[c.modelId]));
  const empty = own.filter(c=> !c.modelId && !c.reserved && cellTotal(stock[c.number]) === 0);
  const steps = [];
  let left = Number(line.qty) || 0;

  for(const c of ofModel.concat(ofColors)){
    if(left <= 0) break;
    if(!sizeAllowed(c, line.sizeLabel)) continue;
    const n = Math.min(left, cellFree(c, stock[c.number], models).free);
    if(n > 0){ steps.push({cell: c.number, qty: n}); left -= n; }
  }
  const modelCap = (models[line.modelId] && models[line.modelId].capacity) || 7;
  for(const c of (ofModel.length ? [] : empty)){
    if(left <= 0) break;
    const n = Math.min(left, c.capacity ? Number(c.capacity) : modelCap);
    steps.push({cell: c.number, qty: n, bind: true}); left -= n;
  }
  const all = cells.map(c=> c.number);
  const created = [];
  while(left > 0){
    if(steps.length > 500) throw new Error('Слишком много штук для раскладки за один раз');
    const anchor = steps.length ? steps[steps.length - 1].cell
                 : (ofModel.length ? ofModel[ofModel.length - 1].number : (own.length ? own[own.length - 1].number : '1'));
    const num = nextSubCell(anchor, all.concat(created));
    created.push(num);
    const n = Math.min(left, modelCap);
    steps.push({cell: num, qty: n, isNew: true}); left -= n;
  }
  /* Подтверждение «Закрепить модель за ячейками…» — только для модели без своих ячеек. */
  const needsConfirm = ofModel.length === 0 && steps.some(s=> s.bind || s.isNew);
  return {steps, needsConfirm};
}

/* Откуда взять: сначала с пола, потом из менее заполненной ячейки (быстрее освободится),
   при равенстве — меньший номер. Остаток — по размеру {ячейка: {sizeId: штук}}: в одной
   ячейке бывают разные цвета, на полу — разные товары. Не хватило — {cell:null, qty:недостача}. */
function planPick(line, cells, cellStock){
  const stock = cellStock || {};
  const key = line.sizeId != null ? line.sizeId : line.sizeLabel;
  const qtyOf = num=> Number((stock[num] || {})[key]) || 0;
  const src = cells.filter(c=> !isDefectCell(c) && qtyOf(c.number) > 0)
    .sort((a,b)=> (isFloorCell(b) - isFloorCell(a)) || (cellTotal(stock[a.number]) - cellTotal(stock[b.number])) || cmpCellNumber(a.number, b.number));
  const out = [];
  let left = Number(line.qty) || 0;
  for(const c of src){
    if(left <= 0) break;
    const n = Math.min(left, qtyOf(c.number));
    out.push({cell: c.number, qty: n}); left -= n;
  }
  if(left > 0) out.push({cell: null, qty: left});
  return out;
}

/* Что лежит «не по размерам» после того, как хозяин поменял размеры ячейки. */
function sizesConflict(cell, stockBySize){
  const out = [];
  for(const k in (stockBySize || {})){
    const q = Number(stockBySize[k]) || 0;
    if(q > 0 && !sizeAllowed(cell, k)) out.push({sizeLabel: k, qty: q});
  }
  return out;
}
