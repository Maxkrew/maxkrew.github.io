/* «Склад»: Меню «три точки», шторки, своя клавиатура, ввод количества, быстрые приход/расход. */
/* ============================================================
   МЕНЮ ДЕЙСТВИЙ ВКЛАДКИ (три точки)
   Раньше действия висели полосой кнопок под шапкой: они занимали место
   на каждом экране и подписи не помещались («Наклад.», «Сброс»).
   ============================================================ */
const CHROME_MENUS = {
  stock: ()=>[
    {icon:'i-plus',     title:'Добавить товар',        action:'openProductModal()'},
    {sep:true},
    {icon:'i-printer',  title:'Распечатать штрихкоды', action:'printBarcodesSelected()'},
    {icon:'i-download', title:'Накладная поставщику',  action:'exportSupplierInvoice()', needsSelection:true},
    stockTab === 'stop'
      ? {icon:'i-play',  title:'Вернуть в продажу',    action:'moveSelectedToStop(false)', needsSelection:true}
      : {icon:'i-pause', title:'Добавить в стоп',      action:'moveSelectedToStop(true)',  needsSelection:true},
    {icon:'i-x',        title:'Снять выделение',       action:'clearInvoiceSelection()', needsSelection:true},
    {icon:'i-trash',    title:'Удалить выбранные',     action:'deleteSelectedProducts()', needsSelection:true, danger:true},
    {note: invoiceSelection.size
        ? ('Отмечено: ' + invoiceSelection.size + ' ' + pluralTovar(invoiceSelection.size) + ' — печать по отмеченным')
        : 'Без галочек печатаются все товары из текущего списка'}
  ],
  history: ()=>[
    {icon:'i-check',    title:'Исправить остаток',     action:'deleteSelectedHistoryWithCorrection()', needsSelection:true},
    {icon:'i-x',        title:'Снять выделение',       action:'clearHistorySelection()', needsSelection:true},
    {sep:true},
    {icon:'i-download', title:'Выгрузить в CSV',       action:'exportHistoryCSV()'},
    {note: historySelection.size
        ? ('Отмечено: ' + historySelection.size + ' ' + pluralZapis(historySelection.size))
        : 'Отметьте записи галочками в списке'}
  ]
};
let chromeMenuSection = null;

function renderChromeMenu(){
  const menu = document.getElementById('chromeMenu');
  const build = CHROME_MENUS[chromeMenuSection];
  if(!menu || !build) return;
  const hasSelection = (chromeMenuSection === 'stock')
      ? invoiceSelection.size > 0
      : historySelection.size > 0;

  menu.innerHTML = build().map(item=>{
    if(item.sep) return '<div class="menu-sep"></div>';
    if(item.note) return `<div class="menu-note">${escapeHtml(item.note)}</div>`;
    const off = item.needsSelection && !hasSelection;
    return `<button type="button" role="menuitem" class="${item.danger?'danger':''}" ${off?'disabled':''}
      onclick="runChromeMenu(function(){ ${item.action} })">
      <svg class="icon"><use href="#${item.icon}"/></svg>${escapeHtml(item.title)}</button>`;
  }).join('');
}
const MENU_ANCHORS = {stock:'stockActions', history:'historyActions'};

function toggleChromeMenu(e, section){
  if(e) e.stopPropagation();
  const menu = document.getElementById('chromeMenu');
  if(!menu) return;

  const alreadyOpen = menu.classList.contains('show') && chromeMenuSection === section;
  closeChromeMenu();
  if(alreadyOpen) return;

  /* Меню одно на всё приложение и переезжает под ту кнопку, которую
     нажали: так оно всегда прижато к своему заголовку. */
  chromeMenuSection = section;
  const anchor = document.getElementById(MENU_ANCHORS[section]);
  if(!anchor) return;
  anchor.appendChild(menu);

  renderChromeMenu();
  menu.classList.add('show');
  const btn = anchor.querySelector('button');
  if(btn) btn.setAttribute('aria-expanded','true');
}
function closeChromeMenu(){
  const menu = document.getElementById('chromeMenu');
  if(menu) menu.classList.remove('show');
  document.querySelectorAll('.head-actions button').forEach(b=> b.setAttribute('aria-expanded','false'));
}
function runChromeMenu(fn){
  closeChromeMenu();
  try{ fn(); }catch(e){ toast('Не получилось: ' + e.message); }
}
/* меню закрывается кликом мимо и клавишей Escape */
document.addEventListener('click', (e)=>{
  const menu = document.getElementById('chromeMenu');
  if(menu && menu.classList.contains('show') && !menu.contains(e.target)) closeChromeMenu();
});
document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeChromeMenu(); });

/* ============================================================
   ЗАКРЫТИЕ ОКОН: СВАЙП ВНИЗ И КАСАНИЕ ЗАТЕМНЕНИЯ
   Окна открываются снизу как шторки, и закрываться должны так же —
   иначе на телефоне до кнопки «Отмена» приходится долистывать всю форму.
   ============================================================ */
function closeSheet(bg){
  const fn = bg && bg.dataset ? window[bg.dataset.close] : null;
  if(typeof fn === 'function') fn();
  else if(bg) bg.classList.remove('show');
}

function setupSheetGestures(){
  document.querySelectorAll('.modal-bg').forEach(bg=>{
    const sheet = bg.querySelector('.modal');
    if(!sheet) return;

    // касание по затемнению — мимо самой шторки
    bg.addEventListener('click', (e)=>{ if(e.target === bg) closeSheet(bg); });

    let startY = 0, shift = 0, dragging = false;

    sheet.addEventListener('touchstart', (e)=>{
      /* тянуть можно только от верха: иначе жест перехватит прокрутку
         длинной формы, и до нижних полей будет не добраться */
      if(sheet.scrollTop > 0) return;
      dragging = true;
      startY = e.touches[0].clientY;
      shift = 0;
      sheet.style.transition = 'none';
    }, {passive:true});

    /* Слушатель не passive: пока тянем шторку, нужно запретить браузеру
       трактовать тот же жест как «потянуть страницу для обновления». */
    sheet.addEventListener('touchmove', (e)=>{
      if(!dragging) return;
      shift = Math.max(0, e.touches[0].clientY - startY);
      if(shift > 0 && e.cancelable) e.preventDefault();
      sheet.style.transform = 'translateY(' + shift + 'px)';
      bg.style.background = 'rgba(40,44,64,' + Math.max(0.12, 0.4 - shift/700) + ')';
    }, {passive:false});

    const finish = ()=>{
      if(!dragging) return;
      dragging = false;
      sheet.style.transition = '';
      sheet.style.transform = '';
      bg.style.background = '';
      // порог: случайное движение пальцем окно не захлопнет
      if(shift > 110) closeSheet(bg);
    };
    sheet.addEventListener('touchend', finish);
    sheet.addEventListener('touchcancel', finish);
  });
}

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(()=>t.classList.remove('show'), 2200);
}

function setMode(m){
  currentMode = m;
  // незакрытое подтверждение из прошлого режима только мешало бы
  cancelPrihodConfirm();
  updateModeUI();
  focusForScanner(document.getElementById('scanInput'));
}
function updateModeUI(){
  document.getElementById('btnModePrihod').classList.toggle('on', currentMode==='Приход');
  document.getElementById('btnModeRashod').classList.toggle('on', currentMode==='Расход');
}

/* ---- приход: количество спрашиваем после скана ---- */
var pendingPrihod = null;   // {product, barcode}

/* Ручной сканер прикидывается клавиатурой: символы летят подряд, между
   ними единицы миллисекунд, в конце — Enter. Человек так не печатает,
   по этому и отличаем. */
var scanTyped = '', scanTypedAt = 0, qtyBeforeTyping = '1', typeFlushTimer = null;
const SCAN_GAP_MS = 40;

/* Набранное человеком дописываем в поле сами — так же, как это сделал бы
   браузер: начатое заново число заменяем, продолженное дописываем.
   У числовых полей выделение недоступно (selectionStart всегда null),
   поэтому «начало ввода» отмечаем сами: открыли панель, поставили курсор
   или отсканировали ещё штуку. */
var qtyReplaceNext = true;

/* ---- количество на телефоне набирается своими кнопками ----
   Экранная клавиатура для этого не годится: пока к iPhone подключён сканер,
   iOS её вообще не показывает (сканер для системы — обычная клавиатура), а
   программный focus() закрывает уже открытую. Человек как раз собирался
   вписать штуки — и клавиатура пропадала. Поэтому на сенсорных устройствах
   поле только показывает число, а вводят его кнопки под ним. */
var touchQty = false;
function initQtyPads(){
  /* Любое сенсорное устройство: iPad с клавиатурой-чехлом отдаёт
     «pointer: fine», поэтому смотрим ещё и на касания. */
  touchQty = !!(
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0)
    || ('ontouchstart' in window)
  );
  /* Количество вводится кнопками-цифрами под полем, само поле — только
     показывает число. Так не воюем с системной/встроенной клавиатурой:
     она для количества просто не нужна. */
  ['prihodQtyPad','camQtyPad','qrQtyPad','qpQtyPad'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.classList.toggle('on', touchQty);
  });
  ['prihodQtyInput','camQtyInput','qrQtyInput','qpQtyInput'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.readOnly = touchQty;
  });
}
function padKey(inputId, key){
  const inp = document.getElementById(inputId);
  if(!inp) return;
  if(key === 'clear'){
    inp.value = ''; qtyReplaceNext = true;
  } else if(key === 'back'){
    inp.value = String(inp.value).slice(0, -1); qtyReplaceNext = false;
  } else {
    const base = qtyReplaceNext ? '' : String(inp.value);
    inp.value = (base + key).replace(/^0+(?=\d)/, '').slice(0, 6);   // склад — не миллионы штук
    qtyReplaceNext = false;
  }
  if(inputId === 'prihodQtyInput'){
    qtyBeforeTyping = inp.value;
    clearTimeout(typeFlushTimer); scanTyped = '';
  }
}

/* Фокус нужен только физическому сканеру — он печатает туда, где курсор.
   Пока такого сканера не видели, на сенсорном экране фокус не трогаем. */
var hwScannerSeen = false;
function focusForScanner(el){
  if(!el) return;
  if(touchQty && !hwScannerSeen) return;
  try{ el.focus(); }catch(e){}
}

/* ================= своя экранная клавиатура =================
   Сканер для iOS — обычная клавиатура. Пока он подключён, системная
   клавиатура не показывается вообще: остаётся одна полоска со стрелками,
   и ни SKU, ни название вписать нечем. Веб-страница заставить iOS показать
   клавиатуру не может, поэтому рисуем клавиши сами.

   Показываем не всем подряд: сначала ждём, не появится ли системная. Если
   она пришла — окно заметно уменьшилось, и своя не нужна. */
/* Раскладки повторяют клавиатуру iPhone — те же ряды, та же длина рядов,
   те же знаки на слоях «123» и «#+=». Цифрового ряда над буквами на iPhone
   нет, цифры живут на отдельном слое. */
const SKB_LAYOUTS = {
  ru: [
    ['й','ц','у','к','е','н','г','ш','щ','з','х','ъ'],
    ['ф','ы','в','а','п','р','о','л','д','ж','э'],
    ['@shift','я','ч','с','м','и','т','ь','б','ю','@back']
  ],
  en: [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['@shift','z','x','c','v','b','n','m','@back']
  ],
  num: [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['-','/',':',';','(',')','₽','&','@','"'],
    ['@sym','.',',','?','!','\'','@back']
  ],
  sym: [
    ['[',']','{','}','#','%','^','*','+','='],
    ['_','\\','|','~','<','>','$','€','№','•'],
    ['@num','.',',','?','!','\'','@back']
  ]
};

var skbTarget = null, skbLayer = 'ru', skbLetters = 'ru', skbShift = 0, skbNumMode = false;
var skbShiftTapAt = 0;
var skbBaseH = 0, skbProbe = null, skbHideTimer = null;

function skbIsLetters(){ return skbLayer === 'ru' || skbLayer === 'en'; }
function skbLabel(key){
  switch(key){
    case '@shift': return skbShift === 2 ? '⇪' : '⇧';
    case '@back':  return '⌫';
    case '@space': return skbLayer === 'en' ? 'space' : 'пробел';
    case '@done':  return 'Готово';
    case '@lang':  return skbLetters === 'en' ? 'РУС' : 'ENG';
    case '@num':   return '123';
    case '@sym':   return '#+=';
    case '@abc':   return skbLetters === 'en' ? 'ABC' : 'АБВ';
  }
  return (skbShift && skbIsLetters()) ? key.toUpperCase() : key;
}

function skbViewportH(){ return window.visualViewport ? window.visualViewport.height : window.innerHeight; }

function skbTypable(el){
  if(!el || el.disabled) return false;
  /* Поле, которое мы сами закрыли от системной клавиатуры, остаётся своим:
     печатать в него можно, просто нашими кнопками. Чужое «только чтение» —
     это количество со своим пультиком, туда лезть не надо. */
  if(el.readOnly && el.dataset.skbRo !== '1' && el.dataset.skbTmpRo !== '1') return false;
  if(el.tagName === 'TEXTAREA') return true;
  if(el.tagName !== 'INPUT') return false;
  return ['text','search','tel','number','password','email','url'].indexOf((el.type||'text').toLowerCase()) >= 0;
}

/* «Всегда» значит «печатаем только своей». Если просто показать её поверх,
   iOS поднимет и свою — на экране окажутся две клавиатуры сразу. Поэтому в
   этом режиме поля переводятся в «только чтение»: курсор в них ставится,
   а системная клавиатура не открывается. */
function skbApplyAlways(){
  const on = touchQty && (skbMode() === 'always');
  document.querySelectorAll('input, textarea').forEach(el=>{
    if(el.dataset.skbRo === '1'){
      if(!on){ el.readOnly = false; delete el.dataset.skbRo; }
      return;
    }
    if(!on || !skbTypable(el)) return;
    el.readOnly = true;
    el.dataset.skbRo = '1';
  });
}
function skbIsNumeric(el){
  const t = (el.type||'').toLowerCase();
  if(t === 'number' || t === 'tel') return true;
  const im = (el.getAttribute('inputmode')||'').toLowerCase();
  return im === 'numeric' || im === 'decimal';
}

function skbLayout(){
  if(skbNumMode){
    return [{k:['1','2','3'],c:'pad'},{k:['4','5','6'],c:'pad'},
            {k:['7','8','9'],c:'pad'},{k:['@back','0','@done'],c:'pad'}];
  }
  const rows = SKB_LAYOUTS[skbLayer].map((r,i)=>({
    k: r.slice(),
    /* второй ряд латиницы на iPhone сдвинут внутрь — иначе выглядит чужим */
    c: (skbLayer === 'en' && i === 1) ? 'inset' : ''
  }));
  rows.push({k:[ skbIsLetters() ? '@num' : '@abc', '@lang', '@space', '@done'], c:''});
  return rows;
}

function skbKeyClass(key){
  switch(key){
    case '@shift': return 'mod shift' + (skbShift ? ' on' : '');
    case '@back':  return 'mod back';
    case '@space': return 'space';
    case '@done':  return 'go';
    case '@lang':  return 'mod lang';
    case '@num': case '@abc': case '@sym': return 'mod';
  }
  return 'ltr';
}

function skbRender(){
  const host = document.getElementById('skbRows');
  if(!host) return;
  host.innerHTML = '';
  skbLayout().forEach(row=>{
    const div = document.createElement('div');
    div.className = 'skb-row' + (row.c ? ' ' + row.c : '');
    row.k.forEach(key=>{
      const b = document.createElement('button');
      b.type = 'button';
      const label = skbLabel(key);
      b.textContent = label;
      b.className = skbKeyClass(key);
      if(b.className === 'ltr') b.dataset.k = label;   // для подсказки над клавишей
      b.addEventListener('click', ()=> skbKey(key));
      div.appendChild(b);
    });
    host.appendChild(div);
  });
}

/* Нажатие на клавишу не должно уводить курсор из поля — иначе после первой
   же буквы печатать станет некуда. */
function skbBindGuards(){
  const kb = document.getElementById('softKb');
  if(!kb) return;
  kb.addEventListener('mousedown', (e)=>{ e.preventDefault(); });
  const vv = window.visualViewport;
  if(vv){
    vv.addEventListener('scroll', skbPlace);
    vv.addEventListener('resize', ()=>{
      skbPlace();
      /* Системная клавиатура могла прийти позже нашей — тогда на экране
         оказались бы две сразу. Окно заметно поджалось — свою убираем. */
      if(kb.classList.contains('on') && (skbBaseH - vv.height) >= 120) skbHide();
    });
  }
}

/* Полоска со стрелками от iOS всё равно висит внизу — поднимаем клавиатуру
   ровно над ней, иначе нижний ряд оказывается под полоской. */
function skbPlace(){
  const kb = document.getElementById('softKb');
  if(!kb || !kb.classList.contains('on')) return;
  const vv = window.visualViewport;
  const gap = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  kb.style.bottom = gap + 'px';
}

function skbShow(el){
  /* Переезжаем на другое поле — прежнее сначала отпускаем. */
  const prev = skbTarget;
  if(prev && prev !== el && prev.dataset.skbTmpRo === '1'){
    prev.readOnly = false; delete prev.dataset.skbTmpRo;
  }
  skbTarget = el;
  skbNumMode = skbIsNumeric(el);
  skbShift = 0;
  /* Пока своя клавиатура на экране, поле закрыто от системной. Иначе:
     нажатие на нашу клавишу возвращает курсор в поле, а возврат курсора
     по касанию пальца — законный повод для iOS открыть свою. Так на
     экране и оказывались две сразу, независимо от настроек. */
  if(!el.readOnly){ el.readOnly = true; el.dataset.skbTmpRo = '1'; }
  const kb = document.getElementById('softKb');
  if(!kb) return;
  skbRender();
  kb.classList.add('on');
  kb.setAttribute('aria-hidden', 'false');
  skbPlace();
  setTimeout(()=>{ try{ el.scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){} }, 80);
}
/* Убрали крестиком — значит убрали: пока курсор в том же поле, сама
   больше не выскакивает. Перешли в другое поле — снова можно. */
var skbDismissed = null;
function skbHide(byHand){
  const kb = document.getElementById('softKb');
  if(!kb) return;
  if(byHand) skbDismissed = skbTarget;
  /* Поле закрывали только на время показа — возвращаем как было,
     иначе после нашей клавиатуры в него нельзя было бы печатать обычной. */
  const t = skbTarget;
  if(t && t.dataset.skbTmpRo === '1'){ t.readOnly = false; delete t.dataset.skbTmpRo; }
  kb.classList.remove('on');
  kb.setAttribute('aria-hidden', 'true');
  skbTarget = null;
}

function skbInsert(text){
  const el = skbTarget;
  if(!el) return;
  if(document.activeElement !== el){ try{ el.focus({preventScroll:true}); }catch(e){ try{ el.focus(); }catch(e2){} } }
  let done = false;
  try{
    if(typeof el.setRangeText === 'function' && el.selectionStart !== null){
      el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
      done = true;
    }
  }catch(e){}
  if(!done) el.value = String(el.value) + text;   // у number-полей курсора нет
  el.dispatchEvent(new Event('input', {bubbles:true}));
}
/* Курсор по буквам. На iPhone его двигают лупой или пробелом, но обе
   возможности принадлежат системной клавиатуре — а она в это время
   закрыта. Без стрелок опечатку в середине слова не поправить: приходится
   стирать строку до неё. */
function skbMove(delta){
  const el = skbTarget;
  if(!el) return;
  if(document.activeElement !== el){ try{ el.focus({preventScroll:true}); }catch(e){} }
  try{
    const len = String(el.value).length;
    const s = el.selectionStart, e = el.selectionEnd;
    if(s === null) return;                       // у числовых полей курсора нет
    /* Есть выделение — стрелка ставит курсор к его краю, как везде. */
    let pos = (s !== e) ? (delta < 0 ? s : e) : Math.min(len, Math.max(0, s + delta));
    el.setSelectionRange(pos, pos);
  }catch(err){}
}

function skbBackspace(){
  const el = skbTarget;
  if(!el) return;
  if(document.activeElement !== el){ try{ el.focus({preventScroll:true}); }catch(e){ try{ el.focus(); }catch(e2){} } }
  let done = false;
  try{
    const s = el.selectionStart, e2 = el.selectionEnd;
    if(s !== null){
      if(s !== e2) el.setRangeText('', s, e2, 'end');
      else if(s > 0) el.setRangeText('', s-1, s, 'end');
      done = true;
    }
  }catch(e){}
  if(!done) el.value = String(el.value).slice(0, -1);
  el.dispatchEvent(new Event('input', {bubbles:true}));
}

function skbKey(key){
  /* Залипание ловится только по двум ⇧ подряд: если между ними успели
     нажать букву, это уже не двойное нажатие. */
  if(key !== '@shift') skbShiftTapAt = 0;
  if(key === '@back'){ skbBackspace(); return; }
  if(key === '@space'){ skbInsert(' '); return; }
  if(key === '@shift'){
    /* два быстрых нажатия — залипание, как на телефоне */
    const now = Date.now();
    skbShift = (now - skbShiftTapAt < 400) ? 2 : (skbShift ? 0 : 1);
    skbShiftTapAt = now;
    skbRender(); return;
  }
  if(key === '@lang'){
    skbLetters = (skbLetters === 'en') ? 'ru' : 'en';
    skbLayer = skbLetters; skbShift = 0; skbRender(); return;
  }
  if(key === '@num'){ skbLayer = 'num'; skbShift = 0; skbRender(); return; }
  if(key === '@sym'){ skbLayer = 'sym'; skbShift = 0; skbRender(); return; }
  if(key === '@abc'){ skbLayer = skbLetters; skbShift = 0; skbRender(); return; }
  if(key === '@done'){
    const el = skbTarget;
    skbHide();
    if(el){
      /* «Готово» должно срабатывать как Enter: на сканирующих полях
         на нём висит вся обработка. */
      try{ el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true})); }catch(e){}
      try{ el.blur(); }catch(e){}
    }
    return;
  }
  skbInsert((skbShift && skbIsLetters()) ? key.toUpperCase() : key);
  /* как на телефоне: одиночный ⇧ даёт одну заглавную, залипание держится */
  if(skbShift === 1){ skbShift = 0; skbRender(); }
}

var skbInited = false;
function initSoftKeyboard(){
  if(skbInited) return;
  /* «Всегда» должно работать и там, где мы приняли устройство за компьютер:
     если человек включил клавиатуру руками, значит она ему нужна. */
  if(!touchQty && skbMode() !== 'always') return;
  skbInited = true;
  skbBindGuards();
  skbBaseH = skbViewportH();
  const canProbe = !!window.visualViewport;

  document.addEventListener('focusin', (e)=>{
    const el = e.target;
    clearTimeout(skbHideTimer);
    clearTimeout(skbProbe);
    if(el && el.closest && el.closest('#softKb')) return;   // жмут по самой клавиатуре
    if(!skbTypable(el)){ skbHide(); return; }
    if(el !== skbDismissed) skbDismissed = null;   // другое поле — запрет снят
    if(el === skbDismissed) return;
    const mode = skbMode();
    if(mode === 'off') return;
    if(mode === 'always'){ skbShow(el); return; }
    /* Уже на экране — просто переводим на новое поле, без паузы и мигания:
       раз системной клавиатуры не было секунду назад, нет её и сейчас. */
    const kb = document.getElementById('softKb');
    if(kb && kb.classList.contains('on')){ skbShow(el); return; }
    /* Ждём системную клавиатуру: пришла — окно заметно уменьшится, и своя
       не нужна. Не пришла — печатать нечем, показываем свою. */
    skbProbe = setTimeout(()=>{
      /* Решаем по факту, а не по догадке: системная клавиатура заметно
         поджимает окно. Поджала — своя не нужна, и неважно, подключён
         сканер или нет. Android при сканере клавиатуру обычно показывает,
         и лезть к нему со своей незачем. */
      const shrink = skbBaseH - skbViewportH();
      const needOwn = canProbe ? (shrink < 120) : hwScannerSeen;
      if(needOwn && skbTypable(document.activeElement)) skbShow(document.activeElement);
      else skbHide();
    }, 450);
  });

  document.addEventListener('focusout', ()=>{
    clearTimeout(skbProbe);
    clearTimeout(skbHideTimer);
    skbHideTimer = setTimeout(()=>{
      const a = document.activeElement;
      if(a && a.closest && a.closest('#softKb')) return;
      if(skbTypable(a)) return;      // курсор просто перешёл в соседнее поле
      skbBaseH = skbViewportH();     // полей в работе нет — запоминаем полную высоту
      skbHide();
    }, 250);
  });

  window.addEventListener('orientationchange', ()=>{
    setTimeout(()=>{ if(!skbTarget) skbBaseH = skbViewportH(); skbPlace(); }, 400);
  });
}

/* Пультик и клавиатура поднимаются сразу, не дожидаясь базы: если в данных
   что-то сломается и загрузка не дойдёт до конца, печатать всё равно нужно. */
function bootInput(){
  try{ initQtyPads(); }catch(e){}
  try{ initSoftKeyboard(); }catch(e){}
  try{ skbApplyAlways(); }catch(e){}
  try{ syncAuthKbButton(); }catch(e){}
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootInput);
else bootInput();

/* Настройку прочитали позже базы — если там «Всегда», клавиатуру надо
   поднять и на устройстве, которое мы приняли за компьютер. */
function refreshSoftKeyboardMode(){
  try{ initSoftKeyboard(); }catch(e){}
  try{ skbApplyAlways(); }catch(e){}
  if(skbMode() === 'off') skbHide();
}

function typeIntoQty(text){
  const inp = document.getElementById('prihodQtyInput');
  const digits = String(text||'').replace(/\D/g, '');
  if(!digits) return;
  let selected = false;
  try{ selected = inp.selectionStart !== null && inp.selectionStart !== inp.selectionEnd; }catch(e){}
  const replacing = qtyReplaceNext || selected || !inp.value;
  const next = (replacing ? digits : String(inp.value) + digits).replace(/^0+(?=\d)/, '');
  inp.value = next.slice(0, 6);   // склад — не миллионы штук
  qtyBeforeTyping = inp.value;
  qtyReplaceNext = false;
}

/* Набранное руками количество может слипнуться со следующим сканом —
   человек не всегда делает паузу. Поэтому ищем в конце ввода штрихкод,
   который приложение знает: что осталось спереди, то и было количеством. */
async function splitQtyAndCode(raw){
  raw = String(raw||'').trim();
  if(raw.length < 6) return {qty:'', code:''};
  const all = await getAllLive('products');
  const codes = {};
  all.forEach(p=>{ codes[String(p.barcode).trim()] = true; });
  for(let start = 0; start <= raw.length - 6; start++){
    const tail = raw.slice(start);
    if(codes[tail]){
      const head = raw.slice(0, start);
      return {qty: /^\d+$/.test(head) ? head : '', code: tail};
    }
  }
  /* Знакомого кода нет. Длинную череду цифр всё равно считаем сканом —
     это надёжнее, чем принять чужой штрихкод за количество и оприходовать
     миллионы штук. */
  return raw.length >= 8 ? {qty:'', code: raw} : {qty:'', code:''};
}

function showPrihodConfirm(p, barcode){
  pendingPrihod = {product:p, barcode: String(barcode).trim()};
  document.getElementById('prihodConfirmName').textContent = p.name;
  document.getElementById('prihodConfirmStock').textContent = 'На складе сейчас: ' + (p.totalStock||0) + ' шт';
  const input = document.getElementById('prihodQtyInput');
  input.value = 1;
  qtyBeforeTyping = '1';
  qtyReplaceNext = true;
  const panel = document.getElementById('prihodConfirm');
  panel.style.display = 'block';
  /* с пультиком карточка стала выше — на маленьком экране «Добавить»
     оказывалось за краем, поэтому подводим её к глазам сами */
  if(touchQty) try{ panel.scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){}
  /* фокус сразу в количество и с выделением: сканер уже отработал,
     дальше человек просто набирает число и жмёт Enter. На телефоне без
     сканера фокус не трогаем — он бы только закрыл клавиатуру. */
  setTimeout(()=>{ focusForScanner(input); if(document.activeElement === input){ try{ input.select(); }catch(e){} } }, 40);
}

/* Отсканировали тот же товар ещё раз — значит принимаем ещё штуку.
   Сколько раз провели сканером, столько штук и будет. */
function bumpPrihodQty(){
  const input = document.getElementById('prihodQtyInput');
  const next = Math.max(1, Math.round(Number(input.value)||1) + 1);
  input.value = next;
  qtyBeforeTyping = String(next);
  qtyReplaceNext = true;
  document.getElementById('prihodConfirmStock').textContent =
    'На складе сейчас: ' + (pendingPrihod && pendingPrihod.product.totalStock || 0) + ' шт · отсканировано ' + next;
  playSound('Приход');
  focusForScanner(input);
  if(document.activeElement === input){ try{ input.select(); }catch(e){} }
}
function adjustPrihodQty(delta){
  const input = document.getElementById('prihodQtyInput');
  input.value = Math.max(1, Math.round(Number(input.value)||1) + delta);
  qtyReplaceNext = true;
  focusForScanner(input);
}
function cancelPrihodConfirm(){
  pendingPrihod = null;
  scanTyped = '';
  document.getElementById('prihodConfirm').style.display = 'none';
  focusForScanner(document.getElementById('scanInput'));
}
async function confirmPrihodScan(){
  if(!pendingPrihod) return;
  scanTyped = '';
  const qty = Math.max(1, Math.round(Number(document.getElementById('prihodQtyInput').value)||1));
  const item = pendingPrihod;
  pendingPrihod = null;
  document.getElementById('prihodConfirm').style.display = 'none';
  await applyStockOperation(item.product, item.barcode, qty);
  focusForScanner(document.getElementById('scanInput'));
}

/* ---- быстрый расход прямо со «Склада» (кнопка рядом с карандашиком) ----
   Без сканера: нажал на товар — ввёл штук — сразу списалось в «Расход»,
   без похода в «Панель». */
let pendingQuickRashod = null; // товар
async function openQuickRashod(sku){
  const p = await get('products', sku);
  if(!p) return;
  pendingQuickRashod = p;
  document.getElementById('qrName').textContent = p.name;
  document.getElementById('qrStock').textContent = 'На складе сейчас: ' + (p.totalStock||0) + ' шт';
  const input = document.getElementById('qrQtyInput');
  input.value = 1;
  qtyReplaceNext = true;
  document.getElementById('qrSingleOrder').checked = false;
  document.getElementById('quickRashodModalBg').classList.add('show');
}
function adjustQuickRashodQty(delta){
  const input = document.getElementById('qrQtyInput');
  input.value = Math.max(1, Math.round(Number(input.value)||1) + delta);
  qtyReplaceNext = true;
}
function closeQuickRashod(){
  pendingQuickRashod = null;
  document.getElementById('quickRashodModalBg').classList.remove('show');
}
async function confirmQuickRashod(){
  if(!pendingQuickRashod) return;
  const p = pendingQuickRashod;
  const qty = Math.max(1, Math.round(Number(document.getElementById('qrQtyInput').value)||1));
  const singleOrder = document.getElementById('qrSingleOrder').checked;
  closeQuickRashod();
  const barcode = p.barcode || p.sku;
  /* applyStockOperation берёт направление из currentMode — подменяем его
     на время одного вызова, чтобы не трогать режим на вкладке «Панель». */
  const savedMode = currentMode;
  currentMode = 'Расход';
  const ok = await applyStockOperation(p, barcode, qty, {singleOrder});
  currentMode = savedMode;
  if(ok) toast(p.name + ' — расход −' + qty + ' шт');
}

/* ---- быстрый приход прямо со «Склада» (кнопка рядом с карандашиком) ----
   Та же логика, что и у быстрого расхода выше, только приёмка. */
let pendingQuickPrihod = null; // товар
async function openQuickPrihod(sku){
  const p = await get('products', sku);
  if(!p) return;
  pendingQuickPrihod = p;
  document.getElementById('qpName').textContent = p.name;
  document.getElementById('qpStock').textContent = 'На складе сейчас: ' + (p.totalStock||0) + ' шт';
  const input = document.getElementById('qpQtyInput');
  input.value = 1;
  qtyReplaceNext = true;
  document.getElementById('quickPrihodModalBg').classList.add('show');
}
function adjustQuickPrihodQty(delta){
  const input = document.getElementById('qpQtyInput');
  input.value = Math.max(1, Math.round(Number(input.value)||1) + delta);
  qtyReplaceNext = true;
}
function closeQuickPrihod(){
  pendingQuickPrihod = null;
  document.getElementById('quickPrihodModalBg').classList.remove('show');
}
async function confirmQuickPrihod(){
  if(!pendingQuickPrihod) return;
  const p = pendingQuickPrihod;
  const qty = Math.max(1, Math.round(Number(document.getElementById('qpQtyInput').value)||1));
  closeQuickPrihod();
  const barcode = p.barcode || p.sku;
  const savedMode = currentMode;
  currentMode = 'Приход';
  const ok = await applyStockOperation(p, barcode, qty);
  currentMode = savedMode;
  if(ok) toast(p.name + ' — приход +' + qty + ' шт');
}


/* ============================================================
   iOS: МЕНЮ ВНИЗУ «ЗАВИСАЕТ» ПОСЕРЕДИНЕ
   Клавиатура на iPhone не сжимает окно, а сдвигает видимую область. После
   её закрытия Safari иногда не возвращает область на место, и закреплённое
   внизу меню остаётся висеть посреди экрана до следующей прокрутки.
   Пока клавиатура открыта — меню прячем (над клавиатурой оно только
   мешает); когда закрылась — показываем заново (это заставляет браузер
   поставить его на место) и выравниваем страницу.
   ============================================================ */
(function(){
  const vv = window.visualViewport;
  if(!vv) return;
  let kbOpen = false;
  const realign = ()=>{ try{ window.scrollTo(window.scrollX, window.scrollY); }catch(e){} };
  function check(){
    const open = vv.height < window.innerHeight * 0.78;
    if(open === kbOpen) return;
    kbOpen = open;
    document.body.classList.toggle('kb-open', open);
    if(!open){ requestAnimationFrame(realign); setTimeout(realign, 120); }
  }
  vv.addEventListener('resize', check);
  vv.addEventListener('scroll', ()=>{ if(!kbOpen && vv.offsetTop > 0) realign(); });
  document.addEventListener('focusout', ()=> setTimeout(()=>{ check(); if(!kbOpen) realign(); }, 80));
})();
