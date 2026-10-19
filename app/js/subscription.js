/* Fulbro: подписка склада на экране (ОПИСАНИЕ §11б). Плашка сверху: «Пробный период: осталось
   N дней» / «Подписка до ДД.ММ» / «Подписка закончилась — только просмотр». В «только просмотре»
   ничего не записывается (сервер тоже не примет), кнопки изменения спрятаны. */
function subDaysLeft(until){ return Math.max(0, Math.ceil((until - Date.now()) / 86400000)); }
function daysWord(n){ return n%10===1 && n%100!==11 ? 'день' : (n%10>=2 && n%10<=4 && !(n%100>=12&&n%100<=14) ? 'дня' : 'дней'); }

function renderSubBanner(){
  const s = (window.Sync && Sync.subscription) ? Sync.subscription() : null;
  let el = document.getElementById('subBanner');
  if(!el){
    const main = document.querySelector('main');
    if(!main) return;
    el = document.createElement('div');
    el.id = 'subBanner';
    main.parentNode.insertBefore(el, main);
  }
  const readonly = !!(s && !s.active);
  window.ffReadonly = readonly;
  document.body.classList.toggle('readonly', readonly);
  if(!s){ el.hidden = true; return; }
  let text = '', cls = 'sub-banner';
  if(!s.active){
    cls += ' danger';
    text = s.role === 'supplier'
      ? 'Склад приостановлен — только просмотр. Изменения станут доступны, когда склад продлит подписку.'
      : (s.blocked ? 'Склад заблокирован — только просмотр. Свяжитесь с нами.' : 'Подписка закончилась — только просмотр. Данные сохранены.');
  } else if(s.role === 'owner' && s.paidUntil){
    const n = subDaysLeft(s.paidUntil);
    text = s.trial ? 'Пробный период: осталось ' + n + ' ' + daysWord(n)
                   : 'Подписка до ' + new Date(s.paidUntil).toLocaleDateString('ru-RU') + ' · осталось ' + n + ' ' + daysWord(n);
    if(n <= 3) cls += ' warn';
  }
  el.className = cls;
  el.hidden = !text;
  el.innerHTML = text ? '<span>' + escapeHtml(text) + '</span>' + (s.role === 'owner' ? ' <button type="button" class="btn ghost sm" onclick="showSection(\'tariffs\')">Тарифы</button>' : '') : '';
}

/* Попытка записи в «только просмотре» — одно понятное сообщение, а не тихий отказ. */
let ffReadonlyToastAt = 0;
function ffReadonlyBlocked(){
  if(Date.now() - ffReadonlyToastAt > 3000){ ffReadonlyToastAt = Date.now(); try{ toast('Только просмотр — подписка склада закончилась'); }catch(e){} }
}
