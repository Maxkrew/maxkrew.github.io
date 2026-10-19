/* «ФФ»: Сайт и телефон. На компьютере меню слева (группы Склад / Деньги / Аккаунт),
   на телефоне — нижнее. Источник правды — нижнее меню: роли, «активный» и скрытые пункты
   решаются там (как в «Складе»), боковое повторяет его. */
const SIDE_GROUPS = [
  {title:'Склад',  sections:['stock','receipts','incoming','shipments','analysis','cells','history']},
  {title:'Деньги', sections:['suppliers']},
  {title:'Аккаунт', sections:['tariffs','admin']}
];

function bottomButtons(){
  return [...document.querySelectorAll('nav.bottom button')].map(b=>{
    const m = /showSection\('(\w+)'/.exec(b.getAttribute('onclick') || '');
    return {btn:b, section: m ? m[1] : null};
  }).filter(x=> x.section);
}

function renderSideNav(){
  const side = document.querySelector('aside.side');
  if(!side) return;
  const items = bottomButtons();
  const title = (document.getElementById('companyTitle') || {}).textContent || 'Fulbro';
  const html = ['<div class="side-brand"><span class="side-mark"></span><span class="side-name"></span></div>'];
  const placed = new Set();
  const groups = SIDE_GROUPS.map(g=> ({title:g.title, items: items.filter(i=> g.sections.includes(i.section))}));
  const rest = items.filter(i=> !SIDE_GROUPS.some(g=> g.sections.includes(i.section)));
  if(rest.length) groups[0].items.push(...rest);
  groups.forEach(g=>{
    if(!g.items.length) return;
    const anyVisible = g.items.some(i=> !i.btn.hidden);
    html.push('<div class="side-grp"' + (anyVisible ? '' : ' hidden') + '>' + g.title + '</div>');
    g.items.forEach(i=>{
      placed.add(i.section);
      const icon = i.btn.querySelector('use');
      const href = icon ? icon.getAttribute('href') : '#i-box';
      html.push('<button type="button" data-section="' + i.section + '"' + (i.btn.hidden ? ' hidden' : '') +
        ' class="side-it' + (i.btn.classList.contains('active') ? ' a' : '') + '"><svg class="icon"><use href="' + href + '"/></svg><span></span></button>');
    });
  });
  if(!groups.some(g=> g.title === 'Аккаунт' && g.items.some(i=> !i.btn.hidden))) html.push('<div class="side-grp">Аккаунт</div>');
  html.push('<button type="button" data-action="settings" class="side-it' + (isSectionActive('settings') ? ' a' : '') + '"><svg class="icon"><use href="#i-gear"/></svg><span>Настройки</span></button>');
  side.innerHTML = html.join('');
  const sn = side.querySelector('.side-name'); sn.textContent = title; sn.classList.toggle('brand-word', typeof ffAppWord === 'function' && title === ffAppWord());
  /* подписи — текстом, а не разметкой: они берутся из кнопок нижнего меню */
  items.forEach(i=>{
    const b = side.querySelector('button[data-section="' + i.section + '"] span');
    if(b) b.textContent = i.btn.textContent.trim();
  });
}
function isSectionActive(name){
  const s = document.getElementById('sec-' + name);
  return !!(s && s.classList.contains('active'));
}

function initSideNav(){
  const side = document.querySelector('aside.side');
  const nav = document.querySelector('nav.bottom');
  if(!side || !nav) return;
  side.addEventListener('click', e=>{
    const b = e.target.closest('button');
    if(!b) return;
    if(b.dataset.action === 'settings'){ openSettings(); renderSideNav(); return; }
    const it = bottomButtons().find(i=> i.section === b.dataset.section);
    if(it) it.btn.click();
  });
  /* роли и переключение разделов меняют нижнее меню — боковое следует за ним */
  new MutationObserver(renderSideNav).observe(nav, {subtree:true, attributes:true, attributeFilter:['class','hidden'], childList:true});
  /* «Настройки» открываются без кнопки нижнего меню — отмечаем их по самому переходу */
  const orig = window.showSection;
  if(typeof orig === 'function'){
    window.showSection = function(){ const r = orig.apply(this, arguments); renderSideNav(); return r; };
  }
  renderSideNav();
}
window.addEventListener('DOMContentLoaded', initSideNav);
