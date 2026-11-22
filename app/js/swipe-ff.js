/* Fulbro: свайп по товару у поставщика (владелец, 22.11.2026, как в «Складе»):
   вправо — «Приход» (зелёная плашка), влево — «Продал» (красная). Открывается нужный экран с уже выбранным товаром. */
const SW_TRIGGER = 90;
let swSuppressClick = 0;

/* куда ведёт свайп: товар уже выбран, размер — если он один */
async function swGoIncoming(modelId){
  showSection('incoming');
  if(typeof renderIncoming === 'function') await renderIncoming();
  const sel = document.getElementById('incModel'); if(!sel) return;
  sel.value = modelId; await incFillSizes();
  const q = document.getElementById('incQty'); if(q) try{ q.focus(); }catch(e){}
}
async function swGoSell(modelId){
  showSection('shipments');
  if(typeof sellStart === 'function') await sellStart();
  if(typeof sellPickModel === 'function') await sellPickModel(modelId);
  const sizes = document.querySelectorAll('#sellSizes [data-size-id]');
  if(sizes.length === 1) await sellPickSize(sizes[0].dataset.sizeId);
}

function swInit(list){
  if(!list || list._sw) return; list._sw = true;
  let row = null, card = null, x0 = 0, y0 = 0, dx = 0, mode = '';   // mode: '' — ещё не понятно, 'x' — свайп, 'y' — прокрутка
  const reset = ()=>{ if(card){ card.style.transition = ''; card.style.transform = ''; } if(row) row.classList.remove('sw-in', 'sw-out', 'sw-go'); row = card = null; mode = ''; dx = 0; };
  list.addEventListener('touchstart', e=>{
    const r = e.target.closest('.sw-row'); if(!r || e.touches.length > 1) return;
    reset(); row = r; card = r.querySelector('.model-card'); x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, {passive: true});
  list.addEventListener('touchmove', e=>{
    if(!row) return;
    const t = e.touches[0]; dx = t.clientX - x0; const dy = t.clientY - y0;
    if(!mode){ if(Math.abs(dx) < 8 && Math.abs(dy) < 8) return; mode = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; }
    if(mode !== 'x') return;
    if(e.cancelable) e.preventDefault();
    card.style.transition = 'none';
    card.style.transform = 'translateX(' + Math.max(-160, Math.min(160, dx)) + 'px)';
    row.classList.toggle('sw-in', dx > 0); row.classList.toggle('sw-out', dx < 0);
    row.classList.toggle('sw-go', Math.abs(dx) >= SW_TRIGGER);
  }, {passive: false});
  const end = ()=>{
    if(!row) return;
    const r = row, mid = r.dataset.swModel, go = mode === 'x' && Math.abs(dx) >= SW_TRIGGER, dir = dx;
    if(mode === 'x') swSuppressClick = Date.now();
    reset();
    if(go){ try{ navigator.vibrate && navigator.vibrate(15); }catch(e){} (dir > 0 ? swGoIncoming : swGoSell)(mid); }
  };
  list.addEventListener('touchend', end); list.addEventListener('touchcancel', ()=> reset());
  // после свайпа не открывать карточку товара
  list.addEventListener('click', e=>{ if(Date.now() - swSuppressClick < 400){ e.stopPropagation(); e.preventDefault(); } }, true);
}
/* обёртка карточки поставщика: под ней — «Приход» слева и «Продал» справа */
function swWrap(modelId, cardHtml){
  return `<div class="sw-row" data-sw-model="${escapeAttr(modelId)}"><div class="sw-under" aria-hidden="true"><span class="sw-l"><svg class="icon"><use href="#i-in"/></svg>Приход</span><span class="sw-r">Продал<svg class="icon"><use href="#i-out"/></svg></span></div>${cardHtml}</div>`;
}
