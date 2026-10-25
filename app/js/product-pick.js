/* Fulbro: выбор товара в отправке и приёмке (владелец, 24.10.2026): в окне выбора — фото,
   название и сразу размеры с остатком. Нажали размер — выбраны и товар, и размер; нажали
   название — только товар. Работает поверх обычного <select data-products="ship|receipt">:
   значение уходит в него с событием change, дальше всё как раньше. */
let ppSelect = null;

async function openProductPick(sel){
  ppSelect = sel;
  const ship = sel.dataset.products === 'ship';
  const models = await modelsMap(), idx = await ffStockIndex();
  const sizes = (await getAll('sizes')).filter(s=> !s.deletedAt);
  const free = ship && typeof reservedMaps === 'function' ? (await reservedMaps()).bySize : {};
  const rows = [];
  for(const o of [...sel.options]){
    if(!o.value) continue;
    const m = models[o.value]; if(!m) continue;
    const ph = typeof modelPhoto === 'function' ? await modelPhoto(m.id) : null;
    const sz = sizes.filter(s=> s.modelId === m.id).sort((a, b)=> sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel));
    const chips = sz.map(s=>{
      const q = (idx.sellableBySize[s.id] || 0) - (free[s.id] || 0);
      return `<button type="button" class="pp-size${q > 0 || !ship ? '' : ' none'}" data-pp-size="${escapeAttr(s.id)}" onclick="ppChoose(${jsArg(m.id)}, ${jsArg(s.id)})">${escapeHtml(sizeText(s.sizeLabel))} <b class="${stockTone(q)}">${q}</b></button>`;
    }).join('');
    rows.push(`<div class="pp-item${o.selected ? ' on' : ''}" data-pp-model="${escapeAttr(m.id)}">
      <button type="button" class="pp-head" onclick="ppChoose(${jsArg(m.id)})">
        <span class="pp-photo">${ph ? `<img alt="" data-ph-src="${escapeAttr(ph.id)}">` : '<svg class="icon"><use href="#i-box"/></svg>'}</span>
        <span class="pp-name">${escapeHtml(modelName(m))}</span></button>
      <div class="pp-sizes">${chips || '<span class="hint">Размеров нет</span>'}</div></div>`);
  }
  document.getElementById('pickTitle').textContent = 'Товар';
  const list = document.getElementById('pickList');
  list.innerHTML = rows.join('') || '<div class="hint">Товаров пока нет</div>';
  document.getElementById('pickSheetBg').classList.add('show');
  document.documentElement.classList.add('sheet-open');   // страница позади не прокручивается
  list.scrollTop = 0;
  if(typeof fillPhotoThumbs === 'function') fillPhotoThumbs(list);
}
async function ppChoose(modelId, sizeId){
  const sel = ppSelect; ppSelect = null;
  if(typeof closePickSheet === 'function') closePickSheet();
  if(!sel) return;
  sel.value = modelId;
  // размеры строятся по change асинхронно — ждём кнопку нужного размера и выбираем её
  sel.dispatchEvent(new Event('change', {bubbles: true}));
  if(!sizeId) return;
  const box = document.getElementById(sel.dataset.sizes);
  for(let i = 0; i < 40; i++){
    const b = box && box.querySelector('button[data-size-id="' + CSS.escape(sizeId) + '"]');
    if(b){ box.querySelectorAll('button').forEach(x=> x.classList.remove('on')); b.classList.add('on'); return; }
    await new Promise(r=> setTimeout(r, 25));
  }
}
