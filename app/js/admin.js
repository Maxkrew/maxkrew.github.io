/* Fulbro: панель владельца сервиса (ОПИСАНИЕ §11б) — все склады, продление, блокировка,
   редактор тарифов. Права проверяет сервер (admin_*), здесь — только экран. */
function admStatus(w){
  if(w.blocked) return '<span class="pill" style="background:#FDECEC;color:#B91C1C">заблокирован</span>';
  if(!w.paid_until) return '<span class="pill">без срока</span>';
  const left = Math.ceil((new Date(w.paid_until) - Date.now()) / 86400000);
  if(left <= 0) return '<span class="pill g">срок истёк</span>';
  return `<span class="pill${left <= 3 ? ' w' : ''}">${w.trial ? 'пробный, ' : ''}осталось ${left} дн. · до ${new Date(w.paid_until).toLocaleDateString('ru-RU')}</span>`;
}
async function renderAdmin(){
  const box = document.getElementById('adminBox');
  if(!box) return;
  if(!Sync.isAdmin()){ box.innerHTML = emptyState('i-alert', 'Нет доступа', 'Эта панель — для владельца сервиса.'); return; }
  let list = [], tariffs = [];
  try{ list = await Sync.adminList(); }catch(e){ box.innerHTML = emptyState('i-alert', 'Не удалось загрузить склады', e.message); return; }
  try{ tariffs = await Sync.loadTariffs(); }catch(e){}
  const rows = list.map(w=> `<div class="card adm-card">
      <div class="head-row"><div><div class="rname">${escapeHtml(w.title)}</div>
        <div class="rmeta">${escapeHtml(w.email || '')}${w.phone ? ' · ' + escapeHtml(w.phone) : ''} · с ${new Date(w.created_at).toLocaleDateString('ru-RU')}</div></div>${admStatus(w)}</div>
      <div class="rmeta">Поставщиков: ${Number(w.suppliers)||0} · моделей: ${Number(w.models)||0} · отправок за 30 дней: ${Number(w.shipments_30d)||0}</div>
      <div class="btn-row sup-actions">
        <button class="btn ghost sm" data-adm-extend="${escapeAttr(w.owner_id)}" onclick="admExtend(${jsArg(w.owner_id)}, 30)">+ месяц</button>
        <button class="btn ghost sm" onclick="admExtendAsk(${jsArg(w.owner_id)})">+ N дней</button>
        <button class="btn ghost sm" data-adm-unlimited="${escapeAttr(w.owner_id)}" onclick="admUnlimited(${jsArg(w.owner_id)})">Без срока</button>
        <button class="btn amber sm" data-adm-block="${escapeAttr(w.owner_id)}" onclick="admBlock(${jsArg(w.owner_id)}, ${w.blocked ? 'false' : 'true'})">${w.blocked ? 'Разблокировать' : 'Заблокировать'}</button>
        ${w.owner_id === Sync.ownerId() ? '' : `<button class="btn danger sm" data-adm-del="${escapeAttr(w.owner_id)}" data-email="${escapeAttr(w.email || '')}" onclick="admDelete(${jsArg(w.owner_id)}, this.dataset.email)"><svg class="icon"><use href="#i-trash"/></svg>Удалить</button>`}
      </div></div>`).join('');
  const tf = (Array.isArray(tariffs) && tariffs.length ? tariffs : []).concat([{}, {}, {}, {}]).slice(0, Math.max(4, tariffs.length || 0));
  const editor = `<div class="card"><div class="rname">Тарифы</div><p class="rmeta">Карточки на лендинге и в разделе «Тарифы» у складов. Пустая цена показывается как «Скоро».</p>
    <div class="tf-edit">${tf.map((t, i)=> `<div class="tf-row">
      <input data-tf="${i}" data-k="name" placeholder="Название, например «Старт»" value="${escapeAttr(t.name || '')}">
      <input data-tf="${i}" data-k="condition" placeholder="Условие, например «до 300 отправок за 30 дней»" value="${escapeAttr(t.condition || '')}">
      <input data-tf="${i}" data-k="price" inputmode="numeric" placeholder="Цена в месяц, ₽" value="${escapeAttr(t.price || '')}">
      <input data-tf="${i}" data-k="features" placeholder="Что входит" value="${escapeAttr(t.features || '')}">
    </div>`).join('')}</div>
    <button class="btn primary" id="tfSave" onclick="admSaveTariffs()" style="margin-top:8px;">Сохранить тарифы</button></div>`;
  box.innerHTML = `<div class="card"><b>Складов: ${list.length}</b></div>` + rows + editor;
}
async function admRun(p, okText){
  try{ await p; toast(okText); }catch(e){ toast('Не вышло: ' + e.message); }
  await renderAdmin();
}
function admExtend(id, days){ return admRun(Sync.adminExtend(id, days), 'Продлено на ' + days + ' дн.'); }
function admExtendAsk(id){ const n = parseInt(prompt('На сколько дней продлить?', '14'), 10); if(n > 0) return admExtend(id, n); }
function admUnlimited(id){ return admRun(Sync.adminUnlimited(id), 'Срок снят'); }
function admBlock(id, on){ if(on && !confirm('Заблокировать склад? Он и его поставщики будут только смотреть.')) return; return admRun(Sync.adminBlock(id, on), on ? 'Заблокирован' : 'Разблокирован'); }
async function admSaveTariffs(){
  const cards = [];
  document.querySelectorAll('.tf-row').forEach(row=>{
    const c = {};
    row.querySelectorAll('input[data-k]').forEach(i=> c[i.dataset.k] = (i.value || '').trim().slice(0, 200));
    cards.push(c);
  });
  return admRun(Sync.adminSetTariffs(cards), 'Тарифы сохранены');
}

/* удалить склад целиком — только вписав его почту (необратимо) */
async function admDelete(id, email){
  const typed = prompt('Удалить склад НАВСЕГДА — со всеми товарами, ячейками, поставщиками и историей? Это нельзя отменить.\n\nЧтобы подтвердить, впишите почту склада: ' + email);
  if(typed === null) return;
  if(String(typed).trim().toLowerCase() !== String(email).trim().toLowerCase()){ toast('Почта не совпала — склад не удалён'); return; }
  try{ await Sync.adminDelete(id); toast('Склад удалён'); }catch(e){ toast('Не удалось: ' + e.message); }
  if(typeof renderAdmin === 'function') await renderAdmin();
}
