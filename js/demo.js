/* «ФФ»: демо-поставщик «Пример» (ОПИСАНИЕ §11) — показывается, пока не удалят кнопкой
   в Настройках. Удаление мягкое: поставщик, модели, размеры, ячейки и операции уходят у всех. */
const DEMO_SUPPLIER_ID = '00000000-0000-4000-8000-00000000de01';

async function renderDemoCard(){
  const card = document.getElementById('demoCard');
  if(!card) return;
  const s = await get('suppliers', DEMO_SUPPLIER_ID);
  card.hidden = !(isOwnerRole() && s && !s.deletedAt);
}

async function removeDemoFF(){
  const s = await get('suppliers', DEMO_SUPPLIER_ID);
  if(!s || s.deletedAt) return {ok:false, error:'Примера нет'};
  const now = Date.now();
  const kill = async (store, rows)=>{ for(const r of rows){ if(!r.deletedAt){ r.deletedAt = now; await put(store, r); } } };
  const mine = r=> r.supplierId === DEMO_SUPPLIER_ID;
  /* Сначала операции — и на сервер: ячейку с товаром сервер удалить не даст. */
  await kill('ops', (await getAll('ops')).filter(mine));
  if(window.Sync && Sync.ready()) await Sync.syncNow('пример: операции');
  await kill('cells', (await getAll('cells')).filter(mine));
  await kill('sizes', (await getAll('sizes')).filter(mine));
  await kill('models', (await getAll('models')).filter(mine));
  s.deletedAt = now; await put('suppliers', s);
  return {ok:true};
}
async function removeDemoUI(){
  if(!confirm('Удалить демо-поставщика «Пример» со всеми его моделями, ячейками 901–903 и операциями?')) return;
  const r = await removeDemoFF();
  toast(r.ok ? 'Пример удалён' : r.error);
  await renderDemoCard();
}
