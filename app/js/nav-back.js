/* «Назад» как в обычном приложении (просьба владельца, 20.10.2026): кнопка «назад» браузера,
   свайп на iPhone и «назад» на Android закрывают открытое окно, а если окон нет — возвращают
   в прошлый раздел. И в каждом окне есть стрелка назад сверху (правило владельца). */
(function(){
  const curSection = ()=> ((document.querySelector('main section.active') || {}).id || 'sec-stock').replace(/^sec-/, '');
  let ignorePops = 0;

  /* разделы: каждый переход — шаг истории */
  const baseShow = window.showSection;
  if(typeof baseShow !== 'function') return;
  let fromPop = false;
  window.showSection = function(name, btn){
    const before = curSection();
    const r = baseShow.apply(this, arguments);
    const after = curSection();
    if(!fromPop && after !== before) try{ history.pushState({ff: 1, sec: after}, ''); }catch(e){}
    return r;
  };

  /* окна: открылось — шаг истории; закрыли стрелкой/крестиком — убираем этот шаг сами,
     чтобы следующее «назад» не было «пустым» */
  const tracked = ()=> [...document.querySelectorAll('.modal-bg, #photoViewer')].filter(el=> el.id !== 'authModalBg');
  const isOpen = el=> el.classList.contains('show');
  function closeEl(el){
    const fn = el.id === 'photoViewer' ? 'closePhoto' : el.getAttribute('data-close');
    if(fn && typeof window[fn] === 'function'){ try{ window[fn](); }catch(e){} }
    if(isOpen(el)) el.classList.remove('show');
  }
  const obs = new MutationObserver(list=>{
    for(const m of list){
      const el = m.target;
      if(isOpen(el) && !el.__ffStep){
        el.__ffStep = true;
        try{ history.pushState({ff: 1, sec: curSection(), modal: el.id}, ''); }catch(e){}
      } else if(!isOpen(el) && el.__ffStep){
        el.__ffStep = false;
        if(!el.__ffByPop){ ignorePops++; try{ history.back(); }catch(e){ ignorePops--; } }
        el.__ffByPop = false;
      }
    }
  });
  function watch(){ for(const el of tracked()) if(!el.__ffWatched){ el.__ffWatched = true; obs.observe(el, {attributes: true, attributeFilter: ['class']}); } }

  window.addEventListener('popstate', e=>{
    if(ignorePops > 0){ ignorePops--; return; }
    const open = tracked().filter(isOpen);
    if(open.length){
      const top = open[open.length - 1];
      top.__ffByPop = true; closeEl(top);
      return;
    }
    const st = e.state;
    if(st && st.ff && st.sec && st.sec !== curSection()){
      fromPop = true; try{ window.showSection(st.sec); } finally { fromPop = false; }
    }
  });

  /* стрелка назад в окнах, где её нет (карточка товара, ячейки и др.) — перед заголовком */
  function addArrows(){
    for(const bg of document.querySelectorAll('.modal-bg')){
      if(bg.id === 'authModalBg') continue;
      const modal = bg.querySelector('.modal'); if(!modal || modal.querySelector('[data-back]')) continue;
      const fn = bg.getAttribute('data-close');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'icon-btn'; b.setAttribute('data-back', ''); b.setAttribute('aria-label', 'Назад');
      b.innerHTML = '<svg class="icon"><use href="#i-arrow-left"/></svg>';
      b.addEventListener('click', ()=> closeEl(bg));
      const h = modal.querySelector(':scope > h3');
      const row = document.createElement('div'); row.className = 'head-row modal-head';
      if(h){ h.parentNode.insertBefore(row, h); row.appendChild(b); row.appendChild(h); h.style.flex = '1'; h.style.margin = '0 0 0 8px'; }
      else { const grip = modal.querySelector('.modal-grip'); row.appendChild(b); if(grip) grip.after(row); else modal.prepend(row); }
      if(!fn) b.addEventListener('click', ()=> bg.classList.remove('show'));
    }
  }

  function init(){
    addArrows(); watch();
    try{ history.replaceState({ff: 1, sec: curSection()}, ''); }catch(e){}
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
