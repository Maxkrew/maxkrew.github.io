/* «ФФ»: Вход по почте, состояние синхронизации, навигация по разделам.
   Работы без входа нет: главное хранилище — сервер, на телефоне копия (ОПИСАНИЕ §10). */
function setSyncLine(text){
  const el = document.getElementById('syncLine');
  if(el) el.textContent = text;
}

function describeSync(state, detail){
  detail = detail || {};
  if(state === 'syncing') return 'Синхронизация…';
  if(state === 'offline') return (detail.pending ? 'Нет сети · ждут: '+detail.pending : 'Нет сети');
  if(state === 'signed-out') return 'Вход не выполнен';
  if(state === 'access-closed') return 'Доступ закрыт';
  if(state === 'error') return 'Обмен не удался';
  if(state === 'idle'){
    if(detail.pending) return 'Не отправлено на сервер: ' + detail.pending;
    const t = detail.at ? new Date(detail.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '';
    return t ? ('Синхронизировано в ' + t) : 'Синхронизировано';
  }
  return '';
}

/* Синхронизация привезла чужие правки — перерисовать открытый раздел. */
async function refreshAfterSync(){
  const active = document.querySelector('main section.active');
  /* Человек сейчас что-то вводит в этом разделе — не перерисовываем у него под руками. */
  const f = document.activeElement;
  if(active && f && active.contains(f) && /^(INPUT|SELECT|TEXTAREA)$/.test(f.tagName)){ await updateProductCountPill(); return; }
  if(active) await renderSection(active.id.replace('sec-', ''));
  await updateProductCountPill();
}

/* ============================================================
   ОКНО ВХОДА: choose · login · register · regwarehouse · forgot · newpass · noaccess
   В каждом шаге (кроме первого и обязательной смены пароля) — стрелка «назад».
   ============================================================ */
const AUTH_TEXT = {
  choose:   {title:'Добро пожаловать в Fulbro', hint:'Кто вы?', submit:''},
  login:    {title:'Вход', hint:'Один вход на телефон и компьютер — данные хранятся на сервере.', submit:'Войти'},
  regwarehouse: {title:'Регистрация склада', hint:'14 дней бесплатно. Потом — подписка. Поставщики подключатся к складу по коду.', submit:'Зарегистрировать склад'},
  register: {title:'Регистрация поставщика', hint:'Введите код приглашения от склада, свою почту и придумайте пароль.', submit:'Зарегистрироваться'},
  forgot:   {title:'Забыли пароль?', hint:'Пришлём на почту ссылку — по ней поставите новый пароль.', submit:'Прислать ссылку'},
  newpass:  {title:'Новый пароль', hint:'Придумайте новый пароль, не короче 6 символов.', submit:'Сохранить пароль'},
  noaccess: {title:'Нет доступа к складу', hint:'Ваша учётка пока не подключена ни к одному складу. Попросите у склада код приглашения и введите его здесь.', submit:'Подключиться'}
};
let authNewPassForced = false;
let authSignedNoAccess = false;   // вошёл, но ни склада, ни поставщика (экран «нет доступа»)

function authMode(mode){
  const bg = document.getElementById('authModalBg');
  if(!bg) return;
  if(mode === 'choose') authWho = null;
  if(!ffSelfSignup() && mode === 'regwarehouse') mode = 'login';   // склад заводит владелец сервиса — складу только вход
  const whNote = document.getElementById('authWhNote');
  if(whNote) whNote.textContent = 'Я фулфилмент: храню и отправляю товар поставщиков.' + (ffSelfSignup() ? ' 14 дней бесплатно.' : '');
  bg.dataset.mode = mode;
  const tx = AUTH_TEXT[mode] || AUTH_TEXT.login;
  document.getElementById('authTitle').textContent = tx.title;
  document.getElementById('authHint').textContent = tx.hint;
  document.getElementById('authSubmitText').textContent = tx.submit;
  const show = (id, on)=>{ const el = document.getElementById(id); if(el) el.hidden = !on; };
  /* вошёл, но склада нет: регистрация склада — без почты и пароля, на этой же учётке */
  const regSigned = mode === 'regwarehouse' && authSignedNoAccess;
  show('authEmailField', mode === 'login' || mode === 'register' || mode === 'forgot' || (mode === 'regwarehouse' && !regSigned));
  show('authPassField', mode === 'login' || mode === 'register' || mode === 'newpass' || (mode === 'regwarehouse' && !regSigned));
  show('authWhTitleField', mode === 'regwarehouse');
  show('authWhPhoneField', mode === 'regwarehouse');
  show('authChoose', mode === 'choose');
  show('authSubmit', mode !== 'choose');
  show('authToRegWarehouse', mode === 'noaccess' && ffSelfSignup());
  show('authCodeField', mode === 'register' || mode === 'noaccess');
  show('authToForgot', mode === 'login');
  show('authToLogin', mode === 'register' || mode === 'choose' || (mode === 'regwarehouse' && !regSigned));
  show('authSignOut', mode === 'noaccess' || regSigned || (mode === 'newpass' && authNewPassForced));
  show('authBack', !!authBackTarget(mode));
  document.getElementById('authPassLabel').textContent = mode === 'newpass' ? 'Новый пароль' : 'Пароль';
  document.getElementById('authPass').setAttribute('autocomplete', (mode === 'login') ? 'current-password' : 'new-password');
  authError('');
  const info = document.getElementById('authInfo'); if(info){ info.hidden = true; info.textContent = ''; }
  if(mode === 'newpass' || mode === 'noaccess') document.getElementById('authPass').value = '';
  const em = document.getElementById('authEmail');
  if(em && !em.value && window.Sync && Sync.lastLogin) em.value = Sync.lastLogin();
}
/* Куда ведёт стрелка «назад» из шага; null — стрелки нет. */
function authBackTarget(mode){
  if(mode === 'choose') return null;
  if(mode === 'newpass') return authNewPassForced ? null : 'close';
  if(mode === 'forgot') return 'login';
  if(mode === 'noaccess') return 'signout';
  if(mode === 'regwarehouse' && authSignedNoAccess) return 'noaccess';
  return 'choose';
}
async function authBack(){
  const t = authBackTarget(document.getElementById('authModalBg').dataset.mode);
  if(t === 'close'){ document.getElementById('authModalBg').classList.remove('show'); return; }
  if(t === 'signout'){ await authSignOut('choose'); return; }
  if(t) authMode(t);
}
/* Регистрация складов и тарифы включаются в sync-config.js (SELF_SIGNUP); тестам — window.FF_SELF_SIGNUP. */
function ffSelfSignup(){ return window.FF_SELF_SIGNUP === true || !!(window.SYNC_CONFIG && window.SYNC_CONFIG.SELF_SIGNUP); }
/* Первый экран без входа: уже входил на этом устройстве — сразу вход, иначе «Кто вы?» (без регистрации — сразу вход). */
function authStartMode(){ return (window.Sync && Sync.lastLogin && Sync.lastLogin()) ? 'login' : 'choose'; }
/* #register с лендинга — регистрация склада, если она включена; иначе обычный вход */
function authRegisterMode(){ return ffSelfSignup() ? 'regwarehouse' : authStartMode(); }
/* какую карточку выбрал человек на «Кто вы?» — чтобы не пустить молча не в тот кабинет */
let authWho = null;
function authPickWarehouse(){ authWho = 'warehouse'; authMode(ffSelfSignup() ? 'regwarehouse' : 'login'); }
function authPickSupplier(){ authWho = 'supplier'; authMode('register'); }
function openAuth(mode){
  const bg = document.getElementById('authModalBg');
  if(!bg) return;
  authMode(mode || 'login');
  bg.classList.add('show');
  const openedMode = bg.dataset.mode;
  setTimeout(()=>{
    /* Курсор ставим сами, только если человек ещё никуда не нажал: иначе он уже
       печатает в другом поле, и перенос курсора увёл бы ввод (код — в пароль). */
    const a = document.activeElement;
    if(openedMode === 'choose' || bg.dataset.mode !== openedMode || (a && a !== document.body && bg.contains(a))) return;
    const id = (openedMode === 'newpass') ? 'authPass' : (openedMode === 'noaccess' ? 'authCode' : (openedMode === 'regwarehouse' && authSignedNoAccess) ? 'authWhTitle' : (document.getElementById('authEmail').value ? 'authPass' : 'authEmail'));
    const el = document.getElementById(id); if(el) el.focus();
  }, 60);
}
function closeAuth(){
  const bg = document.getElementById('authModalBg');
  if(!bg) return;
  /* Обязательная смена пароля и «нет доступа» без действия не закрываются. */
  if(bg.dataset.mode === 'noaccess' || (bg.dataset.mode === 'regwarehouse' && authSignedNoAccess) || (bg.dataset.mode === 'newpass' && authNewPassForced)) return;
  bg.classList.remove('show');
}
/* recovery — пришли по ссылке из письма; forced — склад сбросил пароль; change — сам из настроек */
function openNewPasswordModal(kind){
  authNewPassForced = (kind === 'forced' || kind === 'recovery');
  openAuth('newpass');
}
window.openNewPasswordModal = openNewPasswordModal;
function openPinModal(mode){ if(mode === 'change') openNewPasswordModal('change'); else openAuth('login'); }

function authError(msg){
  const err = document.getElementById('authError');
  if(!err) return;
  err.textContent = msg || '';
  err.classList.toggle('show', !!msg);
}
function authInfo(msg){
  const el = document.getElementById('authInfo');
  if(el){ el.textContent = msg; el.hidden = !msg; }
}
function authTogglePass(){
  const input = document.getElementById('authPass'), btn = document.getElementById('authEye');
  const shown = input.type === 'text';
  input.type = shown ? 'password' : 'text';
  btn.classList.toggle('on', !shown);
  btn.innerHTML = '<svg class="icon"><use href="#i-' + (shown ? 'eye' : 'eye-off') + '"/></svg>';
  input.focus();
}

async function authSubmit(){
  const bg = document.getElementById('authModalBg');
  const mode = bg.dataset.mode;
  const email = (document.getElementById('authEmail').value || '').trim();
  const pass = document.getElementById('authPass').value || '';
  const code = (document.getElementById('authCode').value || '').trim();
  const btn = document.getElementById('authSubmit');
  btn.disabled = true;
  try{
    if(mode === 'forgot'){
      const r = await Sync.requestPasswordReset(email);
      if(!r.ok){ authError(r.error); return; }
      authError(''); authInfo('Письмо отправлено на ' + email + '. Откройте ссылку из письма на этом устройстве.');
      return;
    }
    if(mode === 'newpass'){
      const r = await Sync.setNewPassword(pass);
      if(!r.ok){ authError(r.error); return; }
      authNewPassForced = false;
      bg.classList.remove('show');
      toast('Пароль изменён');
      return;
    }
    if(mode === 'noaccess'){
      if(!code){ authError('Введите код приглашения'); return; }
      const r = await Sync.joinByCode(code);
      if(!r.ok){ authError(r.error); return; }
      await afterLogin();
      return;
    }
    setSyncLine('Проверяем…');
    const r = mode === 'regwarehouse'
      ? await Sync.registerWarehouse(email, pass, (document.getElementById('authWhTitle').value || '').trim(), (document.getElementById('authWhPhone').value || '').trim())
      : (mode === 'register' ? await Sync.signUp(email, pass, code) : await Sync.signIn(email, pass));
    if(!r.ok){ authError(r.error); setSyncLine(describeSync('signed-out')); return; }
    if(mode === 'login' && authWho){
      await Sync.resolveMembership();
      const rl = Sync.role();
      const wrong = authWho === 'warehouse' && rl === 'supplier' ? 'Это учётка поставщика. Вернитесь назад и нажмите «Я поставщик».'
                  : authWho === 'supplier' && rl === 'owner' ? 'Это учётка склада. Вернитесь назад и нажмите «У меня склад».' : '';
      if(wrong){ await Sync.signOut(); authError(wrong); setSyncLine(describeSync('signed-out')); return; }
    }
    await afterLogin();
  }finally{
    btn.disabled = false;
  }
}
/* После входа: кто я? Нет склада и не поставщик — просим код. */
async function afterLogin(){
  const accessBanner = document.getElementById('ffAccessClosed');
  if(accessBanner) accessBanner.remove();
  /* Склад сбросил пароль — сначала новый пароль, потом всё остальное. */
  if(await Sync.mustChangePassword()){ openNewPasswordModal('forced'); Sync.start(); return; }
  await Sync.resolveMembership();
  if(Sync.role() === 'none'){ authSignedNoAccess = true; openAuth('noaccess'); return; }
  authSignedNoAccess = false;
  document.getElementById('authModalBg').classList.remove('show');
  toast('Вход выполнен');
  await Sync.start();
}
async function authSignOut(nextMode){
  const pending = await Sync.pendingCount();
  if(pending && !confirm('На этом устройстве ' + pending + ' правок ещё не отправлено на сервер — при выходе они пропадут. Выйти?')) return;
  authNewPassForced = false; authSignedNoAccess = false;
  await Sync.signOut();
  await applyRoleUI();
  openAuth(typeof nextMode === 'string' ? nextMode : 'login');
}

async function renderSyncStatusBox(){
  const el = document.getElementById('syncStatusBox');
  if(!el) return;
  if(!window.Sync || !Sync.isConfigured()){
    el.className = 'alert';
    el.innerHTML = '<svg class="icon"><use href="#i-alert"/></svg><span>Сервер не настроен.</span>';
    return;
  }
  const user = await Sync.currentUser();
  if(!user){
    el.className = 'alert danger';
    el.innerHTML = '<svg class="icon"><use href="#i-alert"/></svg><span>Вход не выполнен.</span>'
                 + '<button class="btn primary sm" style="margin-left:auto;width:auto;" onclick="openAuth(\'login\')">Войти</button>';
    return;
  }
  let pending = 0;
  for(const s of Object.keys(FF_STORES)) pending += (await getDirty(s)).filter(r=> !r.rejected).length;
  const role = Sync.role() === 'supplier' ? ('поставщик: ' + (Sync.memberName() || '')) : (Sync.role() === 'owner' ? 'склад' : 'нет доступа');
  el.className = pending ? 'alert' : 'alert success';
  el.innerHTML = '<svg class="icon"><use href="#i-' + (pending ? 'clock' : 'check-circle') + '"/></svg><span>'
               + 'Вход: <b>' + escapeHtml(user.email || '') + '</b> (' + escapeHtml(role) + ')<br>'
               + (pending ? ('Не отправлено на сервер: ' + pending + '. Уйдут при первой связи.') : 'Всё синхронизировано с сервером.')
               + '</span>';
}
async function syncNowFromSettings(){
  if(!window.Sync || !Sync.isConfigured()){ toast('Сервер не настроен'); return; }
  const r = await Sync.syncNow('вручную');
  toast(r.ok ? ('Готово. Отправлено: '+(r.sent||0)+', получено: '+(r.received||0)) : ('Не вышло: '+r.error));
  await renderSyncStatusBox();
}
/* Полная пересинхронизация: скачать всё заново (курсор в ноль). */
async function fullResyncFromSettings(){
  if(!window.Sync || !Sync.isConfigured()){ toast('Сервер не настроен'); return; }
  if(!confirm('Скачать все данные с сервера заново?\n\nНужно, если на этом устройстве что-то не совпадает с другими.')) return;
  toast('Пересинхронизация…');
  const ws = Sync.ownerId();
  if(ws) for(const r of await getAll('settings')) if(r.key === 'ffSeq:' + ws || String(r.key).startsWith('ffSeq:' + ws + ':')) await put('settings', {key: r.key, value: 0});   // курсоры всех таблиц
  const r = await Sync.syncNow('полная пересинхронизация');
  toast(r.ok ? 'Готово' : ('Не вышло: ' + r.error));
  await renderSyncStatusBox();
  await refreshAfterSync();
}
async function syncSignOut(){
  if(!confirm('Выйти из аккаунта на этом устройстве?')) return;
  await authSignOut();
  toast('Вы вышли из аккаунта');
}

async function initSync(){
  if(!window.Sync || !Sync.isConfigured()){ setSyncLine(describeSync('signed-out')); return; }
  Sync.onStatus((state, detail)=>{ setSyncLine(describeSync(state, detail)); if(state === 'idle' && typeof ffAfterSync === 'function') ffAfterSync(); });
  window.refreshAfterSync = refreshAfterSync;
  const started = await Sync.start();
  await applyRoleUI();
  /* С лендинга «Попробовать бесплатно» ведёт на app/#register — сразу регистрация склада. */
  if(!started){ openAuth(location.hash === '#register' ? authRegisterMode() : authStartMode()); return; }
  if(Sync.role() === 'none' && !document.getElementById('ffAccessClosed')){
    authSignedNoAccess = true;
    openAuth(location.hash === '#register' ? authRegisterMode() : 'noaccess');
  }
}

function hideSplash(){
  const el = document.getElementById('splashScreen');
  if(el) el.classList.add('hide');
}
function syncInvActionUI(){
  const idle = document.getElementById('invActionsIdle'), act = document.getElementById('invActionsActive'), card = document.getElementById('invScanCard');
  if(idle) idle.style.display = inventoryActive ? 'none' : 'flex';
  if(act) act.style.display = inventoryActive ? 'flex' : 'none';
  if(card) card.style.display = inventoryActive ? 'block' : 'none';
}

async function updateProductCountPill(){
  const n = (await getAll('models')).filter(m=> !m.deletedAt).length;
  const word = n%10===1 && n%100!==11 ? 'модель' : (n%10>=2 && n%10<=4 && !(n%100>=12&&n%100<=14) ? 'модели' : 'моделей');
  const el = document.getElementById('productCountPill');
  if(el) el.textContent = n + ' ' + word;
}

/* Отрисовка раздела: новые разделы «ФФ» и оставшиеся от «Склада». */
async function renderSection(name){
  const call = fn=> (typeof window[fn] === 'function') ? window[fn]() : null;
  if(name === 'stock') await (typeof renderStockFF === 'function' ? renderStockFF() : call('renderStock'));
  if(name === 'receipts') await call('renderReceipts');
  if(name === 'incoming') await call('renderIncoming');
  if(name === 'analysis') await call('renderSupplierAnalysis');
  if(name === 'shipments') await call('renderShipments');
  if(name === 'cells') await call('renderCells');
  if(name === 'suppliers') await call('renderSuppliers');
  if(name === 'tariffs') await call('renderTariffs');
  if(name === 'admin') await call('renderAdmin');
  if(name === 'history') await (typeof renderHistoryFF === 'function' ? renderHistoryFF() : call('renderHistory'));
  if(name === 'settings'){ renderStorageStatus(); renderSyncStatusBox(); renderSoundRows(); renderSnapshots(); if(typeof renderDemoCard === 'function') renderDemoCard(); }
}

function showSection(name, btn){
  if(!sectionAllowed(name)){ name = 'stock'; btn = null; }
  document.querySelectorAll('main section').forEach(s=>s.classList.remove('active'));
  const sec = document.getElementById('sec-'+name);
  if(sec) sec.classList.add('active');
  document.querySelectorAll('nav.bottom button').forEach(b=> b.classList.toggle('active', b.dataset.section === name));
  closeChromeMenu();
  try{ window.scrollTo(0,0); }catch(e){}
  renderSection(name);
}
function openSettings(){
  closeChromeMenu();
  showSection('settings', null);
}
