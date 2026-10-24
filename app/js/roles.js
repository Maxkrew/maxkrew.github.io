/* «ФФ»: кто что видит. Один список пунктов меню — из него строятся и нижнее меню
   (телефон), и боковое (компьютер, js/layout.js). Склад видит всё; поставщик — свой
   склад товаров и историю, без ячеек, приёмки и поставщиков (ОПИСАНИЕ §3, §9). */
const NAV_ITEMS = [
  /* labels — подпись для роли: у поставщика учёт своего товара (этап 2б, ОПИСАНИЕ §11в) */
  {id:'today',     label:'Сегодня',    icon:'i-home', group:'Склад',  roles:['owner']},   // плитки «что ждёт работы»
  {id:'stock',     label:'Склад',      icon:'i-box',   group:'Склад',  roles:['owner','supplier'], labels:{supplier:'Товары'}},
  {id:'receipts',  label:'Приёмка',    icon:'i-in',    group:'Склад',  roles:['owner']},
  {id:'incoming',  label:'Приход',     icon:'i-in',    group:'Склад',  roles:['supplier']},
  {id:'shipments', label:'Отправки',   icon:'i-out',   group:'Склад',  roles:['owner','supplier'], labels:{supplier:'Продажи'}},
  {id:'analysis',  label:'Анализ',     icon:'i-chart', group:'Склад',  roles:['supplier'], noStaff:true},   // деньги — не сотруднику
  {id:'cells',     label:'Ячейки',     icon:'i-grid',  group:'Склад',  roles:['owner']},
  {id:'suppliers', label:'Поставщики', icon:'i-users', group:'Деньги', roles:['owner']},
  /* у склада на телефоне — из Настроек (в нижнем меню 7 вкладок не помещаются), у поставщика — внизу */
  {id:'history',   label:'История',    icon:'i-clock', group:'Склад',  roles:['owner','supplier'], sideOnlyFor:['owner']},
  /* только в боковом меню (на телефоне — из Настроек), чтобы нижнее меню не переполнялось */
  {id:'tariffs',   label:'Тарифы',     icon:'i-coins', group:'Аккаунт', roles:['owner'], sideOnly:true},
  {id:'admin',     label:'Сервис',     icon:'i-gear',  group:'Аккаунт', roles:['admin'], sideOnly:true}
];
function itemLabel(i){ return (i.labels && i.labels[currentRole()]) || i.label; }
const isStaffRole = ()=> !!(window.Sync && Sync.isStaff && Sync.isStaff());
function itemAllowed(i){ if(i.noStaff && isStaffRole()) return false; return i.roles.includes(currentRole()) || (i.roles.includes('admin') && window.Sync && Sync.isAdmin && Sync.isAdmin()); }

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
    ` class="${i.sideOnly || (i.sideOnlyFor || []).includes(rl) ? 'side-only' : ''}${i.id === active ? ' active' : ''}"><svg class="icon"><use href="#${i.icon}"/></svg>${itemLabel(i)}</button>`).join('');
}

async function applyRoleUI(){
  const rl = currentRole();
  document.body.classList.toggle('is-employee', rl === 'supplier');
  document.body.classList.toggle('is-supplier', rl === 'supplier');
  document.body.classList.toggle('is-owner', rl === 'owner');
  document.body.classList.toggle('is-staff', isStaffRole());
  buildBottomNav();
  // Настройки: поставщику — только карточка входа и синхронизации
  // старые карточки «Склада» (data-legacy) скрыты всегда; «Пример» показывает свой код (data-self)
  document.querySelectorAll('#sec-settings .card:not([data-self])').forEach(c=>{ c.hidden = c.hasAttribute('data-legacy') || (rl !== 'owner' && !c.hasAttribute('data-emp')) || (rl !== 'supplier' && c.hasAttribute('data-sup-only')); });
  if(rl === 'supplier' && !isStaffRole() && typeof renderStaff === 'function') renderStaff();
  // с закрытого раздела — на «Склад»
  const active = document.querySelector('main section.active');
  const name = active ? active.id.replace('sec-', '') : '';
  if(!active || !sectionAllowed(name)) showSection('stock', document.querySelector('nav.bottom button[data-section="stock"]'));
  else if(typeof renderSection === 'function') renderSection(name);
  try{ refreshSoftKeyboardMode(); }catch(e){}
  if(typeof renderSubBanner === 'function') renderSubBanner();
  const sb = document.getElementById('setAdminBtn'); if(sb) sb.hidden = !(Sync.isAdmin && Sync.isAdmin());
  const billing = typeof ffSelfSignup === 'function' ? ffSelfSignup() : true;
  document.body.classList.toggle('no-billing', !billing);   // тарифы — когда включат регистрацию складов
  const sh = document.getElementById('setHistoryBtn'); if(sh) sh.hidden = rl !== 'owner';
  const st = document.getElementById('setTariffsBtn'); if(st) st.hidden = rl !== 'owner' || !billing;
  // демо-учётки: пример не удаляем (иначе демо-поставщик теряет вход)
  const demoBtn = document.getElementById('demoRemoveBtn'); if(demoBtn) demoBtn.hidden = /@fulbro.test$/i.test((Sync.lastLogin && Sync.lastLogin()) || '');
  const links = document.getElementById('setLinksCard'); if(links) links.hidden = ![...links.querySelectorAll('button')].some(b=> !b.hidden);
}
window.applyRoleUI = applyRoleUI;
