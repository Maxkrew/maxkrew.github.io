/* Fulbro: стеклянные детали нового дизайна (владелец, 21.11.2026, проект v3:
   https://claude.ai/artifact/Wgi6Wd3CqB3ptAcdp5or2Z).
   — шапка-капсула: значок, склад, синхронизация, кружок аккаунта; нажал или потянул вниз — шторка сверху;
   — шторка сверху (topSheet): аккаунт, цифры, Поставщики / История / Настройки / Выйти;
   — шторка снизу (uiSheet) и меню «⋯» (uiMenu) — для следующих шагов. */

function uiInitials(s){
  const w = String(s || '').replace(/[«»"@].*$/, '').trim().split(/\s+/).filter(Boolean);
  if(!w.length) return 'F';
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}
function uiWord(n, a, b, c){ return n % 10 === 1 && n % 100 !== 11 ? a : (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? b : c); }

/* шапка: название склада и кружок аккаунта — по роли */
function renderHeaderCap(){
  const rl = window.Sync && Sync.role ? Sync.role() : 'none';
  const sub = window.Sync && Sync.subscription ? Sync.subscription() : null;
  const wh = String((sub && sub.title) || '').trim();
  const t = document.getElementById('hcapTitle'), av = document.getElementById('hcapAv');
  if(t) t.textContent = rl === 'supplier' ? (wh ? 'Склад «' + wh + '»' : 'Склад') : (wh || 'FULBRO');
  const who = rl === 'supplier' ? (Sync.memberName && Sync.memberName()) : (wh || (Sync.lastLogin && Sync.lastLogin()) || '');
  if(av) av.textContent = uiInitials(who);
  const sheet = document.getElementById('topSheet');
  if(sheet && sheet.classList.contains('show')) renderTopSheet();
}

/* ---------- шторка сверху ---------- */
async function renderTopSheet(){
  const box = document.getElementById('topSheetBody'); if(!box) return;
  const rl = Sync.role ? Sync.role() : 'none';
  const sub = Sync.subscription ? Sync.subscription() : null;
  const wh = String((sub && sub.title) || '').trim();
  const email = (Sync.lastLogin && Sync.lastLogin()) || '';
  const supName = rl === 'supplier' ? (Sync.memberName && Sync.memberName()) || 'Поставщик' : '';
  const name = rl === 'supplier' ? supName : (wh ? 'Склад «' + wh + '»' : 'Склад');
  const roleText = rl === 'supplier' ? (Sync.isStaff && Sync.isStaff() ? 'сотрудник поставщика' : 'поставщик') : rl === 'owner' ? 'владелец склада' : '';
  const n = (await getAll('models')).filter(m=> !m.deletedAt).length;
  const syncTxt = (document.getElementById('syncLine') || {}).textContent || '';
  const tile = (id, label, value, extra)=> `<button type="button" class="ts-tile${extra || ''}" data-ts="${id}"><span>${label}</span><b>${value}</b></button>`;
  const tiles = [tile('sync', 'Синхронизация', escapeHtml(syncTxt.replace(/^Синхронизировано в /, '✓ ').replace(/^Синхронизировано$/, '✓')) || '—', ' on')];
  tiles.push(tile('stock', 'Товаров', n + '', ''));
  if(rl === 'owner'){
    const sups = typeof ffSuppliersMap === 'function' ? Object.values(await ffSuppliersMap()).filter(s=> !s.deletedAt && !s.archived).length : 0;
    tiles.push(tile('suppliers', 'Поставщиков', sups + '', ''));
    const until = sub && sub.paidUntil ? new Date(sub.paidUntil).toLocaleDateString('ru-RU', {day: '2-digit', month: '2-digit'}) : '';
    tiles.push(tile('sub', sub && sub.trial ? 'Пробный период' : 'Подписка', until ? 'до ' + until : 'без срока', ''));
  } else if(rl === 'supplier'){
    tiles.push(tile('wh', 'Подключено к складу', escapeHtml(wh || '—'), ''));
  }
  const row = (id, icon, label, cls)=> `<button type="button" class="ts-row${cls || ''}" data-ts="${id}"><svg class="icon"><use href="#${icon}"/></svg><span>${label}</span><svg class="icon ts-chev"><use href="#i-chev"/></svg></button>`;
  const rows = [];
  if(rl === 'owner') rows.push(row('suppliers', 'i-users', 'Поставщики'));
  if(rl === 'owner' || rl === 'supplier') rows.push(row('history', 'i-clock', 'История операций'));
  if(Sync.isAdmin && Sync.isAdmin()) rows.push(row('admin', 'i-chart', 'Панель сервиса: все склады'));   // только владелец сервиса
  rows.push(row('settings', 'i-gear', 'Настройки'));
  rows.push(row('logout', 'i-x', 'Выйти из аккаунта', ' danger'));
  box.innerHTML = `<div class="ts-head"><span class="hav big">${escapeHtml(uiInitials(rl === 'supplier' ? supName : (wh || email)))}</span>
      <span class="ts-who"><b>${escapeHtml(name)}</b><span>${escapeHtml(email)}${roleText ? ' · ' + roleText : ''}</span></span></div>
    <div class="ts-tiles">${tiles.join('')}</div>
    <div class="ts-list">${rows.join('')}</div>`;
}
function openTopSheet(){
  const s = document.getElementById('topSheet'); if(!s) return;
  s.hidden = false;
  requestAnimationFrame(()=> s.classList.add('show'));
  const cap = document.getElementById('hcap'); if(cap) cap.setAttribute('aria-expanded', 'true');
  renderTopSheet();
}
function closeTopSheet(){
  const s = document.getElementById('topSheet'); if(!s || s.hidden) return;
  s.classList.remove('show');
  const cap = document.getElementById('hcap'); if(cap) cap.setAttribute('aria-expanded', 'false');
  setTimeout(()=>{ if(!s.classList.contains('show')) s.hidden = true; }, 220);
}
function toggleTopSheet(){ const s = document.getElementById('topSheet'); if(s && s.classList.contains('show')) closeTopSheet(); else openTopSheet(); }
async function topSheetAction(id){
  closeTopSheet();
  if(id === 'sync'){ if(window.Sync && Sync.syncNow){ toast('Обновляю…'); const r = await Sync.syncNow('вручную'); toast(r && r.ok ? 'Готово' : 'Не вышло: ' + ((r && r.error) || 'нет сети')); } return; }
  if(id === 'stock') return showSection('stock');
  if(id === 'suppliers' || id === 'history' || id === 'admin') return showSection(id);
  if(id === 'settings' || id === 'sub' || id === 'wh') return openSettings();
  if(id === 'logout') return syncSignOut();
}

/* ---------- меню «⋯» ----------
   uiMenu(кнопка, [{label, icon, danger, run}]) — список рядом с кнопкой, закрывается мимо и Esc */
function uiMenu(anchor, items){
  uiMenuClose();
  const m = document.createElement('div');
  m.className = 'ui-menu'; m.id = 'uiMenu'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i)=> `<button type="button" role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${escapeHtml(it.label)}${it.icon ? `<svg class="icon"><use href="#${it.icon}"/></svg>` : ''}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  m.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  m.addEventListener('click', e=>{ const b = e.target.closest('button[data-i]'); if(!b) return; const it = items[+b.dataset.i]; uiMenuClose(); try{ it.run && it.run(); }catch(err){ toast('Не получилось: ' + err.message); } });
  anchor.setAttribute('aria-expanded', 'true'); m._anchor = anchor;
  setTimeout(()=> m.classList.add('show'), 0);
}
function uiMenuClose(){ const m = document.getElementById('uiMenu'); if(m){ if(m._anchor) m._anchor.setAttribute('aria-expanded', 'false'); m.remove(); } }

/* ---------- шторка снизу ----------
   uiSheet({title, html, onReady}) — выезжает снизу; закрыть: «Готово», мимо, Esc, смахнуть вниз */
function uiSheet(o){
  uiSheetClose(true);
  const w = document.createElement('div');
  w.className = 'ui-sheet-bg'; w.id = 'uiSheet';
  w.innerHTML = `<div class="ui-sheet glass" role="dialog" aria-modal="true" aria-label="${escapeAttr(o.title || '')}"><div class="ui-grab"></div>
    <div class="ui-sheet-head"><b>${escapeHtml(o.title || '')}</b><button type="button" class="ui-sheet-done" onclick="uiSheetClose()">${escapeHtml(o.done || 'Готово')}</button></div>
    <div class="ui-sheet-body">${o.html || ''}</div></div>`;
  document.body.appendChild(w);
  w.addEventListener('click', e=>{ if(e.target === w) uiSheetClose(); });
  uiDragClose(w.querySelector('.ui-sheet'), 1, uiSheetClose);
  requestAnimationFrame(()=> w.classList.add('show'));
  if(o.onReady) o.onReady(w.querySelector('.ui-sheet-body'));
  return w;
}
function uiSheetClose(now){ const w = document.getElementById('uiSheet'); if(!w) return; w.id = ''; w.classList.remove('show'); if(now) w.remove(); else setTimeout(()=> w.remove(), 220); }

/* смахнуть шторку: dir = 1 — вниз (нижняя шторка), -1 — вверх (верхняя) */
function uiDragClose(el, dir, close){
  let y0 = null, dy = 0;
  el.addEventListener('touchstart', e=>{ if(el.scrollTop > 0 && dir > 0) return; y0 = e.touches[0].clientY; dy = 0; }, {passive: true});
  el.addEventListener('touchmove', e=>{ if(y0 === null) return; dy = (e.touches[0].clientY - y0) * dir; if(dy > 0) el.style.transform = `translateY(${dy * dir}px)`; }, {passive: true});
  el.addEventListener('touchend', ()=>{ if(y0 === null) return; el.style.transform = ''; if(dy > 70) close(); y0 = null; });
}

/* потянуть капсулу вниз — открыть шторку */
function uiInitHeaderCap(){
  const cap = document.getElementById('hcap'); if(!cap || cap._inited) return; cap._inited = true;
  let y0 = null;
  cap.addEventListener('touchstart', e=>{ y0 = e.touches[0].clientY; }, {passive: true});
  cap.addEventListener('touchmove', e=>{ if(y0 !== null && e.touches[0].clientY - y0 > 30){ y0 = null; openTopSheet(); } }, {passive: true});
  const s = document.getElementById('topSheet');
  if(s){
    s.addEventListener('click', e=>{ const b = e.target.closest('[data-ts]'); if(b) return topSheetAction(b.dataset.ts); if(e.target === s) closeTopSheet(); });
    uiDragClose(s.querySelector('.ts-panel'), -1, closeTopSheet);
  }
  if(window.Sync && Sync.onStatus) Sync.onStatus(()=> setTimeout(renderHeaderCap, 0));
  renderHeaderCap();
}
document.addEventListener('keydown', e=>{ if(e.key === 'Escape'){ uiMenuClose(); closeTopSheet(); uiSheetClose(); } });
document.addEventListener('click', e=>{ const m = document.getElementById('uiMenu'); if(m && !m.contains(e.target) && !(m._anchor && m._anchor.contains(e.target))) uiMenuClose(); }, true);
window.addEventListener('DOMContentLoaded', uiInitHeaderCap);
