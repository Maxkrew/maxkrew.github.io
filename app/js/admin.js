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
      <div class="adm-head"><div class="adm-title">${escapeHtml(w.title)}</div>${admStatus(w)}</div>
      <div class="adm-mail">${escapeHtml(w.email || '')}</div>
      <div class="adm-meta">с ${new Date(w.created_at).toLocaleDateString('ru-RU')}${w.phone ? ' · ' + escapeHtml(w.phone) : ''}</div>
      <div class="adm-stats"><span><b>${Number(w.suppliers)||0}</b> поставщ.</span><span><b>${Number(w.models)||0}</b> товаров</span><span><b>${Number(w.shipments_30d)||0}</b> отправок / 30 дн.</span></div>
      <div class="adm-btns">
        <button class="btn ghost sm" data-adm-extend="${escapeAttr(w.owner_id)}" onclick="admExtend(${jsArg(w.owner_id)}, 30)">+ месяц</button>
        <button class="btn ghost sm" onclick="admExtendAsk(${jsArg(w.owner_id)})">+ N дней</button>
        <button class="btn alt sm" data-adm-unlimited="${escapeAttr(w.owner_id)}" onclick="admUnlimited(${jsArg(w.owner_id)})">Без срока</button>
        <button class="btn amber sm" data-adm-block="${escapeAttr(w.owner_id)}" onclick="admBlock(${jsArg(w.owner_id)}, ${w.blocked ? 'false' : 'true'})">${w.blocked ? 'Разблокировать' : 'Заблокировать'}</button>
      </div>
      ${w.owner_id === Sync.ownerId() ? '<div class="adm-own">Это ваш склад — удалить нельзя</div>' : `<button class="btn danger adm-del" data-adm-del="${escapeAttr(w.owner_id)}" data-email="${escapeAttr(w.email || '')}" data-title="${escapeAttr(w.title || '')}" onclick="admDelete(${jsArg(w.owner_id)}, this.dataset.email, this.dataset.title)"><svg class="icon"><use href="#i-trash"/></svg>Удалить склад</button>`}
    </div>`).join('');
  const tf = (Array.isArray(tariffs) && tariffs.length ? tariffs : []).concat([{}, {}, {}, {}]).slice(0, Math.max(4, tariffs.length || 0));
  const fld = (i, k, label, ph, v, attrs)=> `<div class="field"><label>${label}</label><input type="text" data-tf="${i}" data-k="${k}" placeholder="${ph}" value="${escapeAttr(v || '')}"${attrs || ''}></div>`;
  const editor = `<div class="adm-sec-title">Тарифы</div><p class="adm-sec-note">Карточки на лендинге и в разделе «Тарифы» у складов. Пустая цена показывается как «Скоро».</p>
    ${tf.map((t, i)=> `<div class="card tf-row"><div class="tf-num">Тариф ${i + 1}</div>
      ${fld(i, 'name', 'Название', 'Старт', t.name)}
      ${fld(i, 'condition', 'Условие', 'до 300 отправок за 30 дней', t.condition)}
      ${fld(i, 'price', 'Цена в месяц, ₽', '2990', t.price, ' inputmode="numeric"')}
      ${fld(i, 'features', 'Что входит', 'ячейки, приёмка, поставщики', t.features)}
    </div>`).join('')}
    <button class="btn primary" id="tfSave" onclick="admSaveTariffs()"><svg class="icon"><use href="#i-check"/></svg>Сохранить тарифы</button>`;
  box.innerHTML = `<div class="adm-sec-title">Склады · ${list.length}</div>` + rows + editor;
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

/* удалить склад целиком — простое «Да / Нет» с названием склада (необратимо) */
async function admDelete(id, email, title){
  if(!confirm('Удалить склад «' + (title || email) + '» (' + email + ')? Удалятся все его товары, ячейки, поставщики и история. Отменить нельзя.')) return;
  try{ await Sync.adminDelete(id); toast('Склад удалён'); }catch(err){ toast('Не удалось: ' + err.message); }
  if(typeof renderAdmin === 'function') await renderAdmin();
}
