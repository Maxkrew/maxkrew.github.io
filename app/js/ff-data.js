/* «ФФ»: данные склада на телефоне — операции, остатки по размерам и ячейкам,
   сводка по модели для экранов. Остаток нигде не хранится: это сумма delta живых
   операций. Ключ операции — её uid, поэтому одна операция не может лечь дважды
   (две галочки на двух телефонах с одним uid = одна запись). */

function ffRole(){ return (window.Sync && Sync.role) ? Sync.role() : 'none'; }

/* Знак по типу: приход и возврат кладут, отправка забирает, корректировка — как задано. */
function ffDelta(type, qty, delta){
  const q = Math.abs(Number(qty) || 0);
  if(type === 'Приход' || type === 'Возврат') return q;
  if(type === 'Отправка') return -q;
  return Number(delta) || 0;
}

async function ffLogOp(o){
  const uid = o.uid || newUid();
  const existing = await get('ops', uid);
  if(existing && !existing.deletedAt && !existing.rejected) return existing;   // повторная галочка — та же запись
  const supplier = ffRole() === 'supplier';
  const row = {
    uid, supplierId: o.supplierId, modelId: o.modelId, sizeId: o.sizeId,
    cellNumber: supplier ? null : (o.cellNumber || null),
    type: o.type, qty: Math.abs(Number(o.qty) || 0), delta: ffDelta(o.type, o.qty, o.delta),
    ts: o.ts || Date.now(), taskRef: o.taskRef || null, snap: o.snap || null,
    authorKind: supplier ? 'supplier' : 'owner',
    authorName: (window.Sync && Sync.authorName) ? Sync.authorName() : '',
    /* этап 2: правка поставщика — всегда на проверку складу; брак ставит только склад */
    defect: supplier ? false : !!o.defect,
    review: supplier ? 'на проверке' : (o.review || null)
  };
  await put('ops', row);
  return row;
}

function opsBy(index, value){
  return new Promise((res, rej)=>{
    const r = tx('ops').index(index).getAll(value);
    r.onsuccess = ()=> res(r.result || []); r.onerror = rej;
  });
}
/* Отвергнутая сервером операция (например, ячейку уже отдали другой модели) в остаток не
   входит — на сервере её нет; в истории она видна с пометкой. */
const ffLive = op => !op.deletedAt && !op.rejected;

async function ffSizeStock(sizeId){
  let s = 0;
  for(const op of await opsBy('bySize', sizeId)) if(ffLive(op)) s += Number(op.delta) || 0;
  return s;
}

/* Один проход по всем операциям: остатки по размерам и по ячейкам. Запоминается до
   следующей записи в базу (dataVersion) — экран склада на 60 000 операций не пересчитывает
   их по каждой модели заново. */
function ffStockIndex(){
  return cachedByVersion('ffStockIndex', async ()=>{
    /* bySize — всё (сверка с сервером); sellableBySize — «можно продать» (без брака);
       defectBySize — брак; pendingBySize — сколько правок поставщика ждут проверки (этап 2) */
    const bySize = {}, byCell = {}, sellableBySize = {}, defectBySize = {}, pendingBySize = {};
    for(const op of await getAll('ops')){
      if(!ffLive(op)) continue;
      const d = Number(op.delta) || 0;
      bySize[op.sizeId] = (bySize[op.sizeId] || 0) + d;
      const part = op.defect ? defectBySize : sellableBySize;
      part[op.sizeId] = (part[op.sizeId] || 0) + d;
      if(op.review === 'на проверке') pendingBySize[op.sizeId] = (pendingBySize[op.sizeId] || 0) + 1;
      if(op.cellNumber){
        const c = byCell[op.cellNumber] || (byCell[op.cellNumber] = {});
        c[op.sizeId] = (c[op.sizeId] || 0) + d;
      }
    }
    return {bySize, byCell, sellableBySize, defectBySize, pendingBySize};
  });
}

/* {номер ячейки: {sizeId: штук}} — только у склада (у поставщика ячеек нет). Копия. */
async function ffCellStockMap(){
  return JSON.parse(JSON.stringify((await ffStockIndex()).byCell));
}

/* Сводка по модели: размеры по порядку с остатками; у склада ещё и ячейки. */
async function modelView(modelId){
  const model = await get('models', modelId);
  if(!model || model.deletedAt) return null;
  const sizes = (await new Promise((res, rej)=>{ const r = tx('sizes').index('byModel').getAll(modelId); r.onsuccess = ()=> res(r.result || []); r.onerror = rej; }))
    .filter(s=> !s.deletedAt)
    .sort((a, b)=> sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel));
  const idx = await ffStockIndex();
  const view = {model, sizes: sizes.map(s=> ({id: s.id, label: s.sizeLabel, barcode: s.barcode || '',
    stock: idx.sellableBySize[s.id] || 0, defect: idx.defectBySize[s.id] || 0, pending: idx.pendingBySize[s.id] || 0}))};
  if(ffRole() === 'owner'){
    const cs = idx.byCell;
    const labelOf = Object.fromEntries(sizes.map(s=> [s.id, s.sizeLabel]));
    view.cells = (await getAll('cells'))
      // свои ячейки модели, а ещё брак, пол и ячейки другого цвета — где лежат её размеры
      .filter(c=> !c.deletedAt && (c.modelId === modelId || (c.supplierId === model.supplierId && Object.keys(cs[c.number] || {}).some(sid=> labelOf[sid] && cs[c.number][sid]))))
      .sort((a, b)=> cmpCellNumber(a.number, b.number))
      .map(c=>{
        const bySize = {};
        let total = 0;
        // только размеры этой модели: в ячейке может лежать и другой цвет
        for(const [sid, q] of Object.entries(cs[c.number] || {})){ if(q && labelOf[sid]){ bySize[labelOf[sid]] = (bySize[labelOf[sid]] || 0) + q; total += q; } }
        return {number: c.number, allowedSizes: c.allowedSizes || null, capacity: c.capacity || model.capacity || 7, reserved: !!c.reserved, stock: total, bySize, defect: isDefectCell(c), floor: isFloorCell(c)};
      });
  }
  return view;
}

/* Самопроверка после обмена: сумма своих операций должна совпасть с сервером.
   Возвращает список расхождений {sizeId, local, server}. */
async function ffCompareWithServer(serverBySize){
  const diffs = [];
  const seen = new Set(Object.keys(serverBySize || {}));
  for(const s of await getAll('sizes')) seen.add(s.id);
  for(const sizeId of seen){
    const local = await ffSizeStock(sizeId);
    const server = Number((serverBySize || {})[sizeId]) || 0;
    if(local !== server) diffs.push({sizeId, local, server});
  }
  return diffs;
}
