/* «Склад»: Роли (владелец/партнёр), главное устройство, настройки, логотип. */
/* ============================================================
   РОЛИ: владелец или сотрудник (кабинет с урезанным доступом)
   ============================================================ */
function isEmployee(){
  return !!(window.Sync && Sync.role && (Sync.role() === 'employee' || Sync.role() === 'supplier'));
}
const EMP_SECTIONS = ['stock','returns','history','balance','settings'];

/* Кэш состава сотрудников и «кто я» — заполняется в applyRoleUI. */
window.__wsMembers = [];
window.__empMemberId = null;
window.__empName = '';

function wsMemberIdByName(name){
  const m = (window.__wsMembers || []).find(x=> (x.name || '') === String(name || '').trim());
  return m ? m.member_id : undefined;
}
/* Для кабинета партнёра: строка баланса относится ко мне?
   Начисления с продаж — общие (без имени и memberId), их видят все партнёры.
   Именные строки (выплаты конкретному) — только тот партнёр. */
function matchesEmployeeScope(row){
  if(!isEmployee()) return true;
  if(!row.memberId && !row.employee) return true;                       // общий пул
  if(window.__empMemberId && row.memberId) return row.memberId === window.__empMemberId;
  return (row.employee || '') === (window.__empName || '');
}

/* applyRoleUI и меню по ролям — в js/roles.js («ФФ»: склад и поставщик). */

/* ---- карточка «Партнёры» в настройках (владелец) ---- */
async function renderMembersCard(){
  const codeEl = document.getElementById('inviteCodeView');
  if(codeEl && window.Sync && Sync.inviteCode){
    let code = Sync.inviteCode();
    if(!code && Sync.ensureInviteCode){ try{ code = await Sync.ensureInviteCode(); }catch(e){} }
    codeEl.textContent = code || '—';
  }
  const box = document.getElementById('membersList');
  if(!box) return;
  const members = window.__wsMembers || [];
  if(!members.length){
    box.innerHTML = emptyLine('', 'Партнёров пока нет. Передайте код выше.');
    return;
  }
  box.innerHTML = members.map(m=>`
    <div class="row-item">
      <div class="rmain"><div class="rname">${escapeHtml(m.name || 'Партнёр')}</div>
        <div class="rmeta">с ${new Date(m.created_at).toLocaleDateString('ru-RU')}</div></div>
      <div class="rside">
        <button class="icon-btn" onclick="removeMemberUI(${jsArg(m.member_id)})" aria-label="Убрать партнёра"><svg class="icon"><use href="#i-trash"/></svg></button>
      </div>
    </div>`).join('');
}
async function copyInviteCode(){
  let code = (window.Sync && Sync.inviteCode) ? Sync.inviteCode() : '';
  if(!code && window.Sync && Sync.ensureInviteCode){ try{ code = await Sync.ensureInviteCode(); }catch(e){} }
  if(!code){ toast('Код появится после входа и связи с сервером'); return; }
  const el = document.getElementById('inviteCodeView');
  if(el) el.textContent = code;
  try{
    await navigator.clipboard.writeText(code);
    toast('Код скопирован: ' + code);
  }catch(e){ toast('Код: ' + code); }
}
async function rotateInvite(){
  if(!confirm('Сменить код приглашения? Старый перестанет работать.')) return;
  const r = await Sync.rotateInviteCode();
  if(!r.ok){ toast('Не вышло: ' + r.error); return; }
  renderMembersCard();
  toast('Новый код: ' + r.code);
}
async function removeMemberUI(memberId){
  if(!confirm('Убрать этого партнёра из пространства? Он потеряет доступ к складу.')) return;
  const r = await Sync.removeMember(memberId);
  if(!r.ok){ toast('Не вышло: ' + r.error); return; }
  window.__wsMembers = (window.__wsMembers || []).filter(m=> m.member_id !== memberId);
  renderMembersCard();
  toast('Партнёр убран');
}

/* Отметка «главное устройство» — только у этого телефона (localStorage),
   на сервер не ездит: иначе после синхронизации главными стали бы все. */
function isMasterDevice(){
  try{ return localStorage.getItem('ff-master-device') === '1'; }catch(e){ return false; }
}
function setMasterDevice(on){
  try{ localStorage.setItem('ff-master-device', on ? '1' : '0'); }catch(e){}
  applyMasterUI();
  renderSnapshots();
  toast(on ? 'Это главное устройство: импорт разрешён' : 'Главное устройство снято');
}
function applyMasterUI(){
  const chk = document.getElementById('masterDeviceChk');
  if(chk) chk.checked = isMasterDevice();
  const btn = document.getElementById('importBtn');
  if(btn) btn.style.opacity = isMasterDevice() ? '' : '0.5';
  const show = isMasterDevice() && !isEmployee() ? '' : 'none';
  const pb = document.getElementById('masterPublishBtn'); if(pb) pb.style.display = show;
  const pc = document.getElementById('masterPublishCap'); if(pc) pc.style.display = show;
}
async function publishToAllPhones(){
  if(!window.Sync || !Sync.isConfigured()){ toast('Синхронизация не настроена'); return; }
  toast('Раздаю данные на все телефоны…');
  const r = await Sync.publishAsMaster();
  await renderSyncStatusBox();
  toast(r.ok
    ? ('Готово: сервер = этот телефон' + (r.removed ? ('; удалено лишнего на сервере: ' + r.removed) : '') + '. Остальные телефоны обновятся сами.')
    : ('Не вышло: ' + r.error));
  return r;
}
async function masterPublishFromSettings(){
  if(!confirm('Раздать данные ЭТОГО телефона на все?\n\nВсё, чего нет на этом телефоне, будет удалено с сервера, а остальные телефоны заменят свои данные на эти. Неотправленные правки на других телефонах пропадут.')) return;
  await publishToAllPhones();
}
function requestImport(){
  if(!isMasterDevice()){
    toast('Импорт только на главном устройстве. Отметьте галочку «Главное устройство» ниже');
    return;
  }
  document.getElementById('importFile').click();
}

function loadSettingsForm(){
  applyMasterUI();
  document.getElementById('setCompany').value = settings.company;
  document.getElementById('setLowStock').value = settings.lowStock;
  document.getElementById('setSound').value = settings.sound?'1':'0';
  document.getElementById('setBlockNeg').value = settings.blockNeg?'1':'0';
  document.getElementById('setKbMode').value = skbMode();
  applyHeaderLogo();
  renderSoundRows();
  loadCommTiersForm();
  if(!isEmployee()) renderMembersCard();
  showAppVersion();
}

/* Версию берём из имени кеша — его поднимает выкладка, так что это ровно
   то, что сейчас лежит на устройстве. Иначе не понять, дошли правки или нет. */
async function showAppVersion(){
  const el = document.getElementById('appVersion');
  if(!el) return;
  let v = 'без кеша';
  try{
    const keys = await caches.keys();
    const k = keys.filter(x=>x.indexOf('ff-')===0).sort().pop();
    if(k) v = k.replace('ff-','');
  }catch(e){}
  el.textContent = v;
}
async function saveSettings(){
  settings.company = document.getElementById('setCompany').value.trim() || 'FFDrop';
  settings.lowStock = Number(document.getElementById('setLowStock').value)||5;
  settings.sound = document.getElementById('setSound').value==='1';
  settings.blockNeg = document.getElementById('setBlockNeg').value==='1';
  setSkbMode(document.getElementById('setKbMode').value);
  await saveAppSettings();
  refreshSoftKeyboardMode();
  document.getElementById('companyTitle').textContent = settings.company.toUpperCase();
  toast('Настройки сохранены');
  await renderStock();
}

function applyHeaderLogo(){
  const src = settings.logoDataUrl || 'icon-192.png';
  const headerImg = document.getElementById('headerLogoImg');
  if(headerImg) headerImg.src = src;
  const previewImg = document.getElementById('logoPreviewImg');
  if(previewImg) previewImg.src = src;
}
function handleLogoUpload(e){
  const file = e.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){ toast('Выберите файл изображения'); e.target.value=''; return; }
  if(file.size > 900*1024){ toast('Файл слишком большой — выберите картинку до 900 КБ'); e.target.value=''; return; }
  const reader = new FileReader();
  reader.onload = async (ev)=>{
    settings.logoDataUrl = ev.target.result;
    await saveAppSettings();
    applyHeaderLogo();
    toast('Логотип обновлён');
  };
  reader.readAsDataURL(file);
  e.target.value='';
}
async function resetLogo(){
  delete settings.logoDataUrl;
  await saveAppSettings();
  applyHeaderLogo();
  toast('Возвращён стандартный логотип');
}

function generateEAN13(){
  let digits = '2' + String(Math.floor(Math.random()*10));
  for(let i=0;i<10;i++) digits += Math.floor(Math.random()*10);
  let sum = 0;
  for(let i=0;i<12;i++){ sum += Number(digits[i]) * (i%2===0 ? 1 : 3); }
  const check = (10 - (sum % 10)) % 10;
  return digits + check;
}
async function generateBarcodeForModal(){
  let code;
  const existing = await getAllLive('products');
  do { code = generateEAN13(); } while(existing.some(p=>p.barcode===code));
  document.getElementById('pmBarcode').value = code;
}

function printQRForModal(){
  const name = document.getElementById('pmName').value.trim() || 'Товар';
  const barcode = document.getElementById('pmBarcode').value.trim();
  const sku = document.getElementById('pmSku').value.trim();
  if(!barcode && !sku){ toast('Сначала укажите SKU или штрихкод'); return; }
  const price = Number(document.getElementById('pmPrice').value) || 0;
  openBarcodeSheet([{name, barcode, sku, price}]);
}

