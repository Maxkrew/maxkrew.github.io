/* «ФФ»: Поставщики (только склад) — добавить, код приглашения, ячейки, сброс пароля, архив.
   Код показывается, пока поставщик не вошёл: после входа сервер его меняет (одноразовый). */

/* «1-12», «15», «1-3, 7», «4.1» → ['1',…]. Диапазоны — только целые номера. */
function parseCellRange(spec){
  const out = [];
  String(spec || '').split(/[,;\s]+/).map(s=> s.trim()).filter(Boolean).forEach(part=>{
    const m = part.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if(m){
      let a = Number(m[1]), b = Number(m[2]);
      if(a > b) [a, b] = [b, a];
      for(let i = a; i <= b && out.length < 2000; i++) out.push(String(i));
    } else if(/^\d+(\.\d+)?$/.test(part)) out.push(part);
  });
  return [...new Set(out)];
}

/* Закрепить ячейки за поставщиком. Чужую (живую) ячейку не перехватываем. */
async function assignCells(supplierId, spec){
  const nums = parseCellRange(spec);
  if(!nums.length) return {ok:false, error:'Укажите номера, например «1-12» или «15»'};
  const sups = Object.fromEntries((await getAll('suppliers')).map(s=> [s.id, s]));
  const cells = Object.fromEntries((await getAll('cells')).filter(c=> !c.deletedAt).map(c=> [c.number, c]));
  for(const n of nums){
    const c = cells[n];
    if(c && c.supplierId && c.supplierId !== supplierId){
      return {ok:false, error:'Ячейка ' + n + ' у ' + ((sups[c.supplierId] || {}).name || 'другого поставщика')};
    }
  }
  let created = 0;
  for(const n of nums){
    const c = cells[n];
    if(c && c.supplierId === supplierId) continue;
    if(c){ c.supplierId = supplierId; await put('cells', c); }
    else await put('cells', {number: n, supplierId, modelId: null, allowedSizes: null, capacity: null, reserved: false});
    created++;
  }
  return {ok:true, created};
}

const supTempPw = {};
async function renderSuppliers(){
  const box = document.getElementById('supList');
  if(!box) return;
  const sups = (await getAll('suppliers')).filter(s=> !s.deletedAt).sort((a, b)=> (a.archived - b.archived) || String(a.name).localeCompare(String(b.name), 'ru'));
  if(!sups.length){ box.innerHTML = emptyState('i-users', 'Поставщиков пока нет', 'Добавьте первого — он получит код приглашения для входа.'); return; }
  const cells = (await getAll('cells')).filter(c=> !c.deletedAt);
  box.innerHTML = sups.map(s=>{
    const mine = cells.filter(c=> c.supplierId === s.id).map(c=> c.number).sort(cmpCellNumber);
    const status = s.archived ? '<span class="pill g">в архиве</span>' : (s.memberId ? '<span class="pill">вошёл</span>' : '<span class="pill w">ждёт входа</span>');
    const codeLine = !s.archived && !s.memberId ? `<div class="rmeta sup-line">Код для входа: <b class="sup-code" data-sup-code>${escapeHtml(s.inviteCode || '…')}</b></div>` : '';
    const temp = supTempPw[s.id] ? `<div class="alert">Временный пароль: <b data-sup-temp>${escapeHtml(supTempPw[s.id])}</b> — передайте поставщику, при входе он поставит свой.</div>` : '';
    return `<div class="card sup-card">
      <div class="sup-head"><div class="rname">${escapeHtml(s.name || 'Поставщик')}</div>${status}</div>
      ${codeLine}
      <div class="rmeta sup-line">Ячейки: ${mine.length ? escapeHtml(cellRangeLabel(mine)) : 'не назначены'}</div>
      ${temp}
      <div class="btn-row sup-actions">
        <button class="btn ghost sm" onclick="assignCellsPrompt(${jsArg(s.id)})">Ячейки</button>
        ${s.memberId && !s.archived ? `<button class="btn alt sm" data-sup-reset="${escapeAttr(s.id)}" onclick="resetSupplierPasswordUI(${jsArg(s.id)})">Сброс пароля</button>` : ''}
        <button class="btn amber sm" data-sup-archive="${escapeAttr(s.id)}" onclick="toggleSupplierArchive(${jsArg(s.id)})">${s.archived ? 'Вернуть из архива' : 'В архив'}</button>
      </div>
    </div>`;
  }).join('');
}
/* 1,2,3,4,7 → «1–4, 7» */
function cellRangeLabel(nums){
  const out = []; let i = 0;
  while(i < nums.length){
    let j = i;
    while(j + 1 < nums.length && /^\d+$/.test(nums[j]) && /^\d+$/.test(nums[j + 1]) && Number(nums[j + 1]) === Number(nums[j]) + 1) j++;
    out.push(j > i + 1 ? nums[i] + '–' + nums[j] : (j === i + 1 ? nums[i] + ', ' + nums[j] : nums[i]));
    i = j + 1;
  }
  return out.join(', ');
}

function openSupAdd(){
  document.getElementById('supNewName').value = '';
  document.getElementById('supAddForm').hidden = false; document.getElementById('supAddDone').hidden = true;
  document.getElementById('supAddModalBg').classList.add('show');
  setTimeout(()=>{ try{ document.getElementById('supNewName').focus(); }catch(e){} }, 60);
}
function closeSupAdd(){ document.getElementById('supAddModalBg').classList.remove('show'); }
async function addSupplier(){
  const input = document.getElementById('supNewName');
  const name = (input.value || '').trim();
  if(!name){ toast('Введите имя поставщика'); input.focus(); return; }
  const btn = document.getElementById('supAddBtn'); btn.disabled = true;
  try{
    const r = await Sync.createSupplier(name);
    if(!r.ok){ toast('Не вышло: ' + r.error); return; }
    input.value = '';
    // код — тут же, крупно, с кнопкой «Скопировать»
    document.getElementById('supAddDoneText').textContent = 'Поставщик «' + name + '» добавлен.';
    document.getElementById('supAddCode').textContent = r.code || '';
    document.getElementById('supAddForm').hidden = true; document.getElementById('supAddDone').hidden = false;
    await renderSuppliers();
  }finally{ btn.disabled = false; }
}
async function copySupCode(){
  const code = document.getElementById('supAddCode').textContent.trim();
  try{ await navigator.clipboard.writeText(code); toast('Код скопирован'); }
  catch(e){ toast('Код: ' + code); }
}
async function assignCellsPrompt(id){
  const spec = prompt('Какие ячейки закрепить за поставщиком? Например: 1-12 или 15, 16');
  if(!spec) return;
  const r = await assignCells(id, spec);
  toast(r.ok ? ('Готово, новых ячеек: ' + r.created) : r.error);
  await renderSuppliers();
}
async function resetSupplierPasswordUI(id){
  if(!confirm('Сбросить пароль поставщику? Он сможет войти только с временным паролем и сразу поставит свой.')) return;
  const r = await Sync.resetSupplierPassword(id);
  if(!r.ok){ toast('Не вышло: ' + r.error); return; }
  supTempPw[id] = r.password;          // только в памяти этого экрана — не в базу и не на сервер
  await renderSuppliers();
}
async function toggleSupplierArchive(id){
  const s = await get('suppliers', id);
  if(!s) return;
  if(!s.archived && !confirm('Отправить «' + s.name + '» в архив? Он потеряет доступ, данные и история сохранятся.')) return;
  s.archived = !s.archived;
  await put('suppliers', s);
  await renderSuppliers();
  toast(s.archived ? 'Поставщик в архиве' : 'Поставщик возвращён');
}
