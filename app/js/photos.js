/* «Fulbro», этап 2б: закрытые цены поставщика по строкам и фото (товар, скриншот штрихкода Авито,
   фото к заказу). Фото сжимается на телефоне, без сети копится в photoBlobs и уходит на сервер
   при обмене: сначала файл в хранилище ff-photos, потом строка photos (ОПИСАНИЕ §11в). */

/* --- цены строк: видит только поставщик (у склада их нет вовсе) --- */
async function setLinePrice(lineId, doc, price){
  if(Sync.isStaff && Sync.isStaff()) return;   // цены — только у поставщика
  const n = Number(String(price).replace(',', '.'));
  if(!isFinite(n) || n < 0) return;
  await put('linePrices', {lineId, supplierId: Sync.mySupplierId(), doc, price: Math.round(n * 100) / 100});
}
function fmtMoney(n){ return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('ru-RU') + ' ₽'; }
async function linePrice(lineId){
  const r = await get('linePrices', lineId);
  return r && !r.deletedAt ? r.price : null;
}

/* --- сжатие: длинная сторона ≤ 1280 px, JPEG ≤ 300 КБ --- */
const PHOTO_MAX_SIDE = 1280, PHOTO_MAX_BYTES = 300 * 1024;
async function compressImage(file){
  const bm = await createImageBitmap(file);
  const k = Math.min(1, PHOTO_MAX_SIDE / Math.max(bm.width, bm.height));
  let w = Math.max(1, Math.round(bm.width * k)), h = Math.max(1, Math.round(bm.height * k));
  const c = document.createElement('canvas');
  let out = null;
  for(let step = 0; step < 8; step++){
    c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bm, 0, 0, w, h);
    for(const q of [0.82, 0.7, 0.58, 0.46]){
      out = await new Promise(r=> c.toBlob(r, 'image/jpeg', q));
      if(out && out.size <= PHOTO_MAX_BYTES) return out;
    }
    w = Math.max(1, Math.round(w * 0.8)); h = Math.max(1, Math.round(h * 0.8));   // всё ещё велико — уменьшаем
  }
  return out;
}

/* --- фото --- */
async function addPhoto(o, file, alreadyCompressed){
  const blob = alreadyCompressed ? file : await compressImage(file);
  const id = newUid();
  const path = Sync.ownerId() + '/' + o.supplierId + '/' + id + '.jpg';
  await put('photoBlobs', {id, blob, path, pending: true});
  await put('photos', {id, supplierId: o.supplierId, kind: o.kind, modelId: o.modelId || null, shipmentId: o.shipmentId || null, path, createdTs: Date.now()});
  return id;
}
/* Строка фото уходит на сервер, только когда её файл уже загружен. */
async function photoReady(row){
  const b = await get('photoBlobs', row.id);
  return !(b && b.pending);
}
const photoUrlCache = new Map();
async function photoUrl(id){
  const b = await get('photoBlobs', id);
  if(b && b.blob){
    if(!photoUrlCache.has('b:' + id)) photoUrlCache.set('b:' + id, URL.createObjectURL(b.blob));
    return photoUrlCache.get('b:' + id);
  }
  const p = await get('photos', id);
  if(!p || p.deletedAt) return null;
  const c = photoUrlCache.get(id);
  if(c && c.until > Date.now()) return c.url;
  const url = await Sync.photoSignedUrl(p.path);
  if(url) photoUrlCache.set(id, {url, until: Date.now() + 50 * 60 * 1000});
  return url;
}
async function modelPhoto(modelId){
  const list = (await getAll('photos')).filter(p=> !p.deletedAt && p.kind === 'товар' && p.modelId === modelId);
  list.sort((a, b)=> (b.createdTs || 0) - (a.createdTs || 0));
  return list[0] || null;
}
