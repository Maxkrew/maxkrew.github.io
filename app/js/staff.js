/* Fulbro: сотрудники поставщика (Настройки → «Сотрудники»). Поставщик приглашает кодом,
   сотрудник входит со своей почтой и вводит код. Сотрудник — как поставщик, но без денег
   и цен, без правки товаров и остатков; права держит сервер (my_supplier_boss). */

async function renderStaff(){
  const box = document.getElementById('staffList');
  if(!box || !(Sync.role() === 'supplier') || Sync.isStaff()) return;
  let list;
  try{ list = await Sync.staffList(); }
  catch(e){ box.innerHTML = '<div class="hint">Список сотрудников виден, когда есть связь.</div>'; return; }
  box.innerHTML = list.length ? list.map(t=> `<div class="row-item" data-staff="${escapeAttr(t.id)}"><div class="rmain"><b>${escapeHtml(t.name)}</b><br>
      <span class="rmeta">${t.member_id ? 'вошёл' : 'ещё не вошёл · код ' + escapeHtml(t.invite_code || '')}</span></div>
      <div class="rside"><button type="button" class="icon-btn" data-staff-del="${escapeAttr(t.id)}" onclick="staffRemove(${jsArg(t.id)}, ${jsArg(t.name)})" aria-label="Убрать сотрудника"><svg class="icon"><use href="#i-trash"/></svg></button></div></div>`).join('')
    : '<div class="hint">Сотрудников пока нет.</div>';
}
async function staffInvite(){
  const el = document.getElementById('staffName');
  const name = String(el.value || '').trim();
  if(!name){ toast('Напишите имя сотрудника'); el.focus(); return; }
  let r;
  try{ r = await Sync.inviteStaff(name); }catch(e){ toast(e.message); return; }
  el.value = '';
  document.getElementById('staffCode').innerHTML = `<div class="alert" style="margin-top:8px;">Код для «${escapeHtml(name)}»: <b data-staff-code>${escapeHtml(r.invite_code)}</b><br>
    Пусть сотрудник откроет приложение, зарегистрируется со своей почтой и введёт этот код. Код одноразовый.</div>`;
  await renderStaff();
}
async function staffRemove(id, name){
  if(!confirm('Убрать сотрудника «' + name + '»? Он сразу потеряет доступ.')) return;
  try{ await Sync.removeStaff(id); }catch(e){ toast(e.message); return; }
  toast('Сотрудник убран'); await renderStaff();
}
