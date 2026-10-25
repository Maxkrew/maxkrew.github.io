/* Своё окно выбора вместо системного списка (владелец, 20.10.2026: «вылезает как из-под айфона»).
   Нажали на любой выпадающий список — снизу выезжает окно приложения: заголовок, варианты,
   выбранный — с зелёной галочкой, стрелка назад. Значение уходит в тот же <select>
   с событием change, поэтому весь остальной код работает как раньше. */
(function(){
  let current = null, touch = null;
  const bg = ()=> document.getElementById('pickSheetBg');

  function titleOf(sel){
    const id = sel.id && document.querySelector('label[for="' + CSS.escape(sel.id) + '"]');
    if(id) return id.textContent.trim();
    const f = sel.closest('.field'); const l = f && f.querySelector(':scope > label');
    if(l) return l.textContent.trim();
    return sel.getAttribute('aria-label') || 'Выберите';
  }
  function open(sel){
    // товар в отправке и приёмке — своё окно: фото, название, размеры (js/product-pick.js)
    if(sel.dataset.products && typeof openProductPick === 'function'){ current = null; openProductPick(sel); return; }
    current = sel;
    const opts = [...sel.options];
    document.getElementById('pickTitle').textContent = titleOf(sel);
    document.getElementById('pickList').innerHTML = opts.map((o, i)=>
      `<button type="button" class="pick-item${o.selected ? ' on' : ''}" data-pick="${escapeAttr(o.value)}" data-i="${i}"${o.disabled ? ' disabled' : ''}>
        <span>${escapeHtml(o.textContent)}</span>${o.selected ? '<svg class="icon"><use href="#i-check"/></svg>' : ''}</button>`).join('') || '<div class="hint">Выбирать пока нечего</div>';
    bg().classList.add('show'); document.documentElement.classList.add('sheet-open');
    const on = document.querySelector('#pickList .pick-item.on'); if(on) try{ on.scrollIntoView({block: 'center'}); }catch(e){}
  }
  function close(){ const b = bg(); if(b) b.classList.remove('show'); document.documentElement.classList.remove('sheet-open'); current = null; }
  window.closePickSheet = close;
  function pick(i){
    const sel = current; if(!sel) return;
    const changed = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    close();
    if(changed){ sel.dispatchEvent(new Event('input', {bubbles: true})); sel.dispatchEvent(new Event('change', {bubbles: true})); }
  }
  const usable = sel=> sel && sel.tagName === 'SELECT' && !sel.disabled && !sel.multiple && !sel.hasAttribute('data-native') && !sel.closest('#pickSheetBg');

  // мышь и компьютер: не даём открыться системному списку
  document.addEventListener('mousedown', e=>{
    const sel = e.target.closest && e.target.closest('select');
    if(!usable(sel)) return;
    e.preventDefault(); sel.focus({preventScroll: true}); open(sel);
  }, true);
  // телефон: касание без прокрутки — наше окно
  document.addEventListener('touchstart', e=>{
    const sel = e.target.closest && e.target.closest('select');
    touch = usable(sel) ? {sel, x: e.touches[0].clientX, y: e.touches[0].clientY} : null;
  }, {capture: true, passive: true});
  document.addEventListener('touchend', e=>{
    if(!touch) return;
    const t = e.changedTouches[0], moved = Math.abs(t.clientX - touch.x) + Math.abs(t.clientY - touch.y) > 10;
    const sel = touch.sel; touch = null;
    if(moved) return;
    e.preventDefault(); open(sel);
  }, {capture: true, passive: false});
  // клавиатура: стрелки работают как обычно, Enter/пробел — наше окно
  document.addEventListener('keydown', e=>{
    const sel = e.target;
    if(usable(sel) && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); open(sel); }
  }, true);
  document.addEventListener('click', e=>{
    const b = e.target.closest && e.target.closest('#pickList .pick-item');
    if(b && !b.disabled) pick(Number(b.dataset.i));
  });
})();
