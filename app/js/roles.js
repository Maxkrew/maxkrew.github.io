/* «ФФ»: кто что видит. Один список пунктов меню — из него строятся и нижнее меню
   (телефон), и боковое (компьютер, js/layout.js). Склад видит всё; поставщик — свой
   склад товаров и историю, без ячеек, приёмки и поставщиков (ОПИСАНИЕ §3, §9). */
const NAV_ITEMS = [
  {id:'stock',     label:'Склад',      icon:'i-box',   group:'Склад',  roles:['owner','supplier']},
  {id:'receipts',  label:'Приёмка',    icon:'i-in',    group:'Склад',  roles:['owner']},
  {id:'shipments', label:'Отправки',   icon:'i-out',   group:'Склад',  roles:['owner']},
  {id:'cells',     label:'Ячейки',     icon:'i-grid',  group:'Склад',  roles:['owner']},
  {id:'suppliers', label:'Поставщики', icon:'i-users', group:'Деньги', roles:['owner']},
  {id:'history',   label:'История',    icon:'i-clock', group:'Склад',  roles:['owner','supplier']},
  /* только в боковом меню (на телефоне — из Настроек), чтобы нижнее меню не переполнялось */
  {id:'tariffs',   label:'Тарифы',     icon:'i-coins', group:'Аккаунт', roles:['owner'], sideOnly:true},
  {id:'admin',     label:'Сервис',     icon:'i-gear',  group:'Аккаунт', roles:['admin'], sideOnly:true}
];
function itemAllowed(i){ return i.roles.includes(currentRole()) || (i.roles.includes('admin') && window.Sync && Sync.isAdmin && Sync.isAdmin()); }

function currentRole(){ return (window.Sync && Sync.role) ? Sync.role() : 'none'; }
function isOwnerRole(){ return currentRole() === 'owner'; }
function isSupplierRole(){ return currentRole() === 'supplier'; }

/* Разрешён ли раздел этой роли. Настройки — всем вошедшим. */
function sectionAllowed(name){
  if(name === 'settings') return true;
  const it = NAV_ITEMS.find(i=> i.id === name);
  return !!it && itemAllowed(it);
}

function buildBottomNav(){
  const nav = document.querySelector('nav.bottom');
  if(!nav) return;
  const rl = currentRole();
  const active = (document.querySelector('main section.active') || {id:''}).id.replace('sec-', '');
  nav.innerHTML = NAV_ITEMS.map(i=>
    `<button type="button" data-section="${i.id}" onclick="showSection('${i.id}',this)"${itemAllowed(i) ? '' : ' hidden'}` +
    ` class="${i.sideOnly ? 'side-only' : ''}${i.id === active ? ' active' : ''}"><svg class="icon"><use href="#${i.icon}"/></svg>${i.label}</button>`).join('');
}

async function applyRoleUI(){
  const rl = currentRole();
  document.body.classList.toggle('is-employee', rl === 'supplier');
  document.body.classList.toggle('is-supplier', rl === 'supplier');
  document.body.classList.toggle('is-owner', rl === 'owner');
  buildBottomNav();
  // Настройки: поставщику — только карточка входа и синхронизации
  // старые карточки «Склада» (data-legacy) скрыты всегда; «Пример» показывает свой код (data-self)
  document.querySelectorAll('#sec-settings .card:not([data-self])').forEach(c=>{ c.hidden = c.hasAttribute('data-legacy') || (rl !== 'owner' && !c.hasAttribute('data-emp')); });
  // с закрытого раздела — на «Склад»
  const active = document.querySelector('main section.active');
  const name = active ? active.id.replace('sec-', '') : '';
  if(!active || !sectionAllowed(name)) showSection('stock', document.querySelector('nav.bottom button[data-section="stock"]'));
  else if(typeof renderSection === 'function') renderSection(name);
  try{ refreshSoftKeyboardMode(); }catch(e){}
  if(typeof renderSubBanner === 'function') renderSubBanner();
  const sb = document.getElementById('setAdminBtn'); if(sb) sb.hidden = !(Sync.isAdmin && Sync.isAdmin());
  const st = document.getElementById('setTariffsBtn'); if(st) st.hidden = rl !== 'owner';
}
window.applyRoleUI = applyRoleUI;
