/* FFDrop: «Тарифы» у склада — карточки из настроек сервиса (их заполняет владелец сервиса).
   Пустая цена — «Скоро». Оплаты картой пока нет — кнопка «Оплата — скоро». */
const TARIFF_ICONS = ['i-box', 'i-in', 'i-grid', 'i-users'];
function tariffCardsHtml(list, opts){
  opts = opts || {};
  const cards = (Array.isArray(list) && list.length ? list : [{}, {}, {}, {}]).slice(0, 8);
  return '<div class="tariff-grid">' + cards.map((t, i)=>{
    t = (t && typeof t === 'object') ? t : {};   // пустая или битая карточка — не ломает экран
    const price = String(t.price || '').trim();
    return `<div class="tariff-card">
      <span class="tariff-ico"><svg class="icon"><use href="#${TARIFF_ICONS[i % TARIFF_ICONS.length]}"/></svg></span>
      <div class="tariff-name">${escapeHtml(t.name || 'Тариф ' + (i + 1))}</div>
      <div class="tariff-cond">${escapeHtml(t.condition || 'Условия скоро')}</div>
      <div class="tariff-price">${price ? escapeHtml(Number(price) ? Number(price).toLocaleString('ru-RU') : price) + ' <span>₽/мес</span>' : 'Скоро'}</div>
      <div class="tariff-feat">${escapeHtml(t.features || '')}</div>
      ${opts.buy ? '<button class="btn ghost" disabled>Оплата — скоро</button>' : ''}
    </div>`;
  }).join('') + '</div>';
}
async function renderTariffs(){
  const box = document.getElementById('tariffsBox');
  if(!box) return;
  let list = [];
  try{ list = await Sync.loadTariffs(); }catch(e){}
  const s = Sync.subscription ? Sync.subscription() : null;
  const head = s && s.paidUntil ? `<div class="card"><b>${s.trial ? 'Пробный период' : 'Подписка'}</b> до ${new Date(s.paidUntil).toLocaleDateString('ru-RU')}. Оплата картой появится скоро — пока продлить подписку можно, написав нам.</div>` : '';
  box.innerHTML = head + tariffCardsHtml(list, {buy:true});
}
