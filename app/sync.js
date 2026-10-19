/* ============================================================
   «ФФ»: СИНХРОНИЗАЦИЯ С СЕРВЕРОМ
   ============================================================
   Главное хранилище — сервер; на телефоне копия, чтобы работать без сети.
   Правила (как в «Складе», проверены там):
   1. Правка пишется на телефон сразу и уезжает на сервер через 1,5 с.
   2. Остаток не передаётся — это сумма операций; операции с разных телефонов
      складываются, а не затирают друг друга. Ключ операции — uid.
   3. Удаления мягкие (deletedAt). Сервер новее — не перезаписываем его.
   Новое в «ФФ»:
   - Склад (хозяин) — пространство owner_id; поставщик подключён к складу по коду.
   - Поставщик качает только своё и никогда не получает ячейки (сервер их ему не отдаёт).
   - Сервер отказал по правам (поставщика архивировали) — строки не гоняются по кругу:
     «Доступ закрыт хозяином».
   ============================================================ */
(function(){
  'use strict';

  const CFG = window.SYNC_CONFIG || {};
  let client = null, channel = null, currentRun = null, queuedRun = false;
  const listeners = [];
  function onStatus(fn){ listeners.push(fn); }
  function emit(state, detail){ listeners.forEach(fn=>{ try{ fn(state, detail); }catch(e){} }); }
  const num = v => Number(v) || 0;

  function ready(){ return Boolean(client && CFG.url && CFG.key); }
  function init(){
    if(client) return client;
    if(!CFG.url || !CFG.key || !window.supabase) return null;
    client = window.supabase.createClient(CFG.url, CFG.key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ff-auth', detectSessionInUrl: true }
    });
    /* Ссылка из письма «Забыли пароль?» — открываем окно «Новый пароль». */
    client.auth.onAuthStateChange((event)=>{
      if(event === 'PASSWORD_RECOVERY' && typeof window.openNewPasswordModal === 'function') window.openNewPasswordModal('recovery');
    });
    return client;
  }
  /* Кто вошёл — из сохранённой сессии, без запроса к серверу. Каждый getUser() берёт
     общую блокировку входа; несколько подряд (запуск, роль, смена пароля, обмен) иногда
     задерживали регистрацию на 10 с. Проверку на сервере делает сам обмен данными. */
  async function currentUser(){
    if(!init()) return null;
    try{ const {data} = await client.auth.getSession(); return data && data.session ? data.session.user : null; }catch(e){ return null; }
  }

  // ------------------------------------------------------------------
  // ВХОД
  // ------------------------------------------------------------------
  const LAST_LOGIN_KEY = 'ff-last-login';
  function rememberLogin(v){ try{ localStorage.setItem(LAST_LOGIN_KEY, String(v || '').trim()); }catch(e){} }
  function lastLogin(){ try{ return localStorage.getItem(LAST_LOGIN_KEY) || ''; }catch(e){ return ''; } }
  const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
  function ruAuthError(msg){
    const m = String(msg || '');
    if(/invalid login credentials/i.test(m)) return 'Неверная почта или пароль';
    if(/already registered|already exists/i.test(m)) return 'Эта почта уже зарегистрирована — войдите';
    if(/password should be at least|weak/i.test(m)) return 'Пароль слишком короткий — не меньше 6 символов';
    if(/rate limit|too many/i.test(m)) return 'Слишком много попыток — подождите минуту';
    if(/failed to fetch|network/i.test(m)) return 'Нет связи с сервером';
    return m || 'Не получилось';
  }

  async function signIn(email, password){
    if(!init()) return {ok:false, error:'Сервер не настроен'};
    email = String(email || '').trim().toLowerCase();
    if(!validEmail(email)) return {ok:false, error:'Укажите почту'};
    if(String(password || '').length < 6) return {ok:false, error:'Пароль — не короче 6 символов'};
    const {error} = await client.auth.signInWithPassword({email, password});
    if(error) return {ok:false, error: ruAuthError(error.message)};
    rememberLogin(email);
    return {ok:true};
  }
  /* Регистрация: с кодом приглашения — это поставщик; без кода — только склад,
     заведённый владельцем сервиса (иначе «попросите код у склада»). */
  async function signUp(email, password, inviteCode){
    if(!init()) return {ok:false, error:'Сервер не настроен'};
    email = String(email || '').trim().toLowerCase();
    if(!validEmail(email)) return {ok:false, error:'Укажите почту'};
    if(String(password || '').length < 6) return {ok:false, error:'Пароль — не короче 6 символов'};
    const {data, error} = await client.auth.signUp({email, password});
    if(error) return {ok:false, error: ruAuthError(error.message)};
    if(!data || !data.session) return {ok:false, error:'На сервере включено подтверждение почты — выключите его (Authentication → Sign In / Providers → Confirm email)'};
    rememberLogin(email);
    if(inviteCode){
      const j = await joinByCode(inviteCode);
      if(!j.ok) return j;
    }
    return {ok:true};
  }
  /* Регистрация склада: учётка + склад с пробным периодом (сервер: register_warehouse). */
  async function registerWarehouse(email, password, title, phone){
    if(!String(title || '').trim()) return {ok:false, error:'Укажите название склада'};
    if(!init()) return {ok:false, error:'Сервер не настроен'};
    /* уже вошёл (учётка есть, склада нет) — почта и пароль не нужны; учётка осталась
       от прошлой сорвавшейся попытки — входим ею и доводим регистрацию склада до конца */
    const {data: s} = await client.auth.getSession();
    if(!(s && s.session)){
      const r = await signUp(email, password, null);
      if(!r.ok){ const li = await signIn(email, password); if(!li.ok) return r; }
    }
    const {error} = await client.rpc('register_warehouse', {p_title: String(title).trim(), p_phone: String(phone || '').trim()});
    if(error) return {ok:false, error: error.message};
    await resolveMembership();
    return {ok:true};
  }
  async function joinByCode(code){
    if(!init()) return {ok:false, error:'Сервер не настроен'};
    const {data, error} = await client.rpc('join_supplier', {p_code: String(code || '').trim()});
    if(error) return {ok:false, error: error.message};
    if(!data) return {ok:false, error:'Код уже использован или не подходит'};
    await resolveMembership();
    return {ok:true};
  }
  async function requestPasswordReset(email){
    if(!init()) return {ok:false, error:'Сервер не настроен'};
    email = String(email || '').trim().toLowerCase();
    if(!validEmail(email)) return {ok:false, error:'Укажите почту'};
    const redirectTo = location.origin + location.pathname;
    const {error} = await client.auth.resetPasswordForEmail(email, {redirectTo});
    return error ? {ok:false, error: ruAuthError(error.message)} : {ok:true};
  }
  async function setNewPassword(pw){
    if(!ready()) return {ok:false, error:'Нет связи'};
    if(String(pw || '').length < 6) return {ok:false, error:'Пароль — не короче 6 символов'};
    const {error} = await client.auth.updateUser({password: pw, data: {must_change_password: false}});
    return error ? {ok:false, error: ruAuthError(error.message)} : {ok:true};
  }
  async function mustChangePassword(){
    const u = await currentUser();
    return !!(u && u.user_metadata && u.user_metadata.must_change_password);
  }
  async function signOut(){
    stopRealtime();
    await wipeLocalData();          // данные склада не остаются на устройстве для следующего, кто войдёт
    membership = null; writeCachedMembership(null);
    if(client){ try{ await client.auth.signOut(); }catch(e){} }
    emit('signed-out');
  }

  // ------------------------------------------------------------------
  // КТО Я: склад (хозяин) или поставщик какого склада
  // ------------------------------------------------------------------
  const MEMBERSHIP_KEY = 'ff-membership', WAREHOUSE_KEY = 'ff-warehouse';
  function readCachedMembership(){
    try{
      const m = JSON.parse(localStorage.getItem(MEMBERSHIP_KEY) || 'null');
      if(!m || !m.role) return null;
      if(m.role === 'employee') m.role = 'supplier';      // кэш старого вида
      if(!m.ownerId && m.owner_id) m.ownerId = m.owner_id;
      return m;
    }catch(e){ return null; }
  }
  function writeCachedMembership(m){
    try{ if(m) localStorage.setItem(MEMBERSHIP_KEY, JSON.stringify(m)); else localStorage.removeItem(MEMBERSHIP_KEY); }catch(e){}
  }
  let membership = readCachedMembership();

  async function resolveMembership(){
    if(!ready()) return membership;
    const user = await currentUser();
    if(!user) return membership;
    try{
      const w = await client.from('warehouses').select('owner_id,title,paid_until,blocked,trial').eq('owner_id', user.id).limit(1);
      if(w.error) throw w.error;
      if(w.data && w.data.length){
        membership = Object.assign({role:'owner', ownerId:user.id, email:user.email || ''}, whStatus(w.data[0]));
      } else {
        const s = await client.from('suppliers').select('owner_id,id,name').eq('member_id', user.id);
        if(s.error) throw s.error;
        const list = (s.data || []).slice().sort((a, b)=> String(a.owner_id).localeCompare(String(b.owner_id)));   // порядок постоянный
        if(list.length){
          let pick = null;
          try{ const saved = localStorage.getItem(WAREHOUSE_KEY); pick = list.find(x=> x.owner_id === saved) || null; }catch(e){}
          pick = pick || list[0];
          const ww = await client.from('warehouses').select('owner_id,title,paid_until,blocked,trial').eq('owner_id', pick.owner_id).limit(1);
          membership = Object.assign({role:'supplier', ownerId:pick.owner_id, supplierId:pick.id, name:pick.name, email:user.email || '',
                        warehouses: list.map(x=> ({ownerId:x.owner_id, supplierId:x.id, name:x.name}))}, whStatus((ww.data || [])[0] || {}));
        } else {
          membership = {role:'none', email:user.email || ''};
        }
      }
      try{ const a = await client.rpc('is_service_admin'); membership.isAdmin = !a.error && a.data === true; }catch(e){}
      writeCachedMembership(membership);
    }catch(e){ /* нет связи — держимся кэша */ }
    return membership;
  }
  /* Подписка склада: работает ли (не заблокирован и срок не истёк; пусто — без срока). */
  function whStatus(w){
    const until = w.paid_until ? new Date(w.paid_until).getTime() : null;
    return {title: w.title || '', paidUntil: until, blocked: !!w.blocked, trial: !!w.trial,
            active: !w.blocked && (until === null || until > Date.now())};
  }
  function subscription(){
    if(!membership || (membership.role !== 'owner' && membership.role !== 'supplier')) return null;
    const m = membership;
    return {role: m.role, title: m.title, paidUntil: m.paidUntil === undefined ? null : m.paidUntil, blocked: !!m.blocked, trial: !!m.trial,
            active: m.active !== false && !(m.paidUntil && m.paidUntil <= Date.now())};
  }
  function role(){ return membership ? membership.role : 'none'; }
  function ownerId(){ return membership ? (membership.ownerId || null) : null; }
  function mySupplierId(){ return membership && membership.role === 'supplier' ? membership.supplierId : null; }
  function memberName(){ return membership && membership.role === 'supplier' ? (membership.name || 'Поставщик') : ''; }
  function authorName(){ return membership ? (membership.role === 'supplier' ? (membership.name || '') : (membership.email || '')) : ''; }

  // ------------------------------------------------------------------
  // ТАБЛИЦЫ: на телефоне camelCase, на сервере snake_case
  // push/pull — какие роли отправляют и принимают
  // ------------------------------------------------------------------
  const base = r => ({updatedAt: num(r.updated_at), deletedAt: r.deleted_at || undefined});
  const tail = (x, ws) => ({owner_id: ws, updated_at: num(x.updatedAt), deleted_at: x.deletedAt || null});
  const MAP = {
    suppliers: {
      table:'suppliers', key:'id', push:['owner'], pull:['owner','supplier'],
      toRow: (x, ws)=> Object.assign({id:x.id, name:x.name || '', archived:!!x.archived}, tail(x, ws)),
      toLocal: r=> Object.assign({id:r.id, name:r.name || '', memberId:r.member_id || null, inviteCode:r.invite_code || '', archived:!!r.archived}, base(r))
    },
    models: {
      table:'models', key:'id', push:['owner','supplier'], pull:['owner','supplier'],
      toRow: (x, ws, rl)=>{
        const r = Object.assign({id:x.id, supplier_id:x.supplierId, brand:x.brand || '', title:x.title || '', color:x.color || '',
          category:x.category || 'Одежда', capacity: num(x.capacity) || 7,
          len_cm: x.lenCm == null ? null : num(x.lenCm), wid_cm: x.widCm == null ? null : num(x.widCm), hei_cm: x.heiCm == null ? null : num(x.heiCm),
          sku:x.sku || '', price:num(x.price), stopped:!!x.stopped}, tail(x, ws));
        if(rl === 'owner') r.calc_price = x.calcPrice == null ? null : num(x.calcPrice);   // цену для расчёта шлёт только склад
        return r;
      },
      toLocal: r=> Object.assign({id:r.id, supplierId:r.supplier_id, brand:r.brand || '', title:r.title || '', color:r.color || '',
        category:r.category || 'Одежда', capacity:num(r.capacity) || 7, lenCm:r.len_cm, widCm:r.wid_cm, heiCm:r.hei_cm,
        sku:r.sku || '', price:num(r.price), calcPrice:r.calc_price == null ? null : num(r.calc_price), stopped:!!r.stopped}, base(r))
    },
    privates: {
      table:'model_private', key:'model_id', localKey:'modelId', push:['supplier'], pull:['supplier'],
      toRow: (x, ws)=> Object.assign({model_id:x.modelId, supplier_id:x.supplierId, buy_from:x.buyFrom || '', cost:num(x.cost),
        commission_percent:num(x.commissionPercent), tax_percent:num(x.taxPercent), packaging:num(x.packaging), delivery_discount:num(x.deliveryDiscount)}, tail(x, ws)),
      toLocal: r=> Object.assign({modelId:r.model_id, supplierId:r.supplier_id, buyFrom:r.buy_from || '', cost:num(r.cost),
        commissionPercent:num(r.commission_percent), taxPercent:num(r.tax_percent), packaging:num(r.packaging), deliveryDiscount:num(r.delivery_discount)}, base(r))
    },
    sizes: {
      table:'sizes', key:'id', push:['owner','supplier'], pull:['owner','supplier'],
      toRow: (x, ws)=> Object.assign({id:x.id, model_id:x.modelId, supplier_id:x.supplierId, size_label:x.sizeLabel || '', sort_key:num(x.sortKey), barcode:x.barcode || null}, tail(x, ws)),
      toLocal: r=> Object.assign({id:r.id, modelId:r.model_id, supplierId:r.supplier_id, sizeLabel:r.size_label, sortKey:num(r.sort_key), barcode:r.barcode || ''}, base(r))
    },
    cells: {
      table:'cells', key:'number', push:['owner'], pull:['owner'],
      toRow: (x, ws)=> Object.assign({number:String(x.number), supplier_id:x.supplierId || null, model_id:x.modelId || null,
        allowed_sizes:(x.allowedSizes && x.allowedSizes.length) ? x.allowedSizes : null, capacity:x.capacity ? num(x.capacity) : null, reserved:!!x.reserved}, tail(x, ws)),
      toLocal: r=> Object.assign({number:r.number, supplierId:r.supplier_id || null, modelId:r.model_id || null,
        allowedSizes:r.allowed_sizes || null, capacity:r.capacity || null, reserved:!!r.reserved}, base(r))
    },
    ops: {
      table:'operations', pullTable:{supplier:'supplier_operations'}, key:'uid', push:['owner'], pull:['owner','supplier'],
      toRow: (x, ws)=> Object.assign({uid:x.uid, supplier_id:x.supplierId, model_id:x.modelId, size_id:x.sizeId, cell_number:x.cellNumber || null,
        type:x.type, qty:num(x.qty), delta:num(x.delta), ts:num(x.ts), task_ref:x.taskRef || null, snap:x.snap || null,
        author_kind:x.authorKind || 'owner', author_name:x.authorName || ''}, tail(x, ws)),
      toLocal: r=> Object.assign({uid:r.uid, supplierId:r.supplier_id, modelId:r.model_id, sizeId:r.size_id, cellNumber:r.cell_number || null,
        type:r.type, qty:num(r.qty), delta:num(r.delta), ts:num(r.ts), taskRef:r.task_ref || null, snap:r.snap || null,
        authorKind:r.author_kind || 'owner', authorName:r.author_name || ''}, base(r))
    },
    receipts: {
      table:'receipts', key:'id', push:['owner'], pull:['owner'],
      toRow: (x, ws)=> Object.assign({id:x.id, supplier_id:x.supplierId, kind:x.kind || 'приёмка', weight_kg:x.weightKg == null ? null : num(x.weightKg), status:x.status || 'черновик', created_ts:num(x.createdTs)}, tail(x, ws)),
      toLocal: r=> Object.assign({id:r.id, supplierId:r.supplier_id, kind:r.kind, weightKg:r.weight_kg, status:r.status, createdTs:num(r.created_ts)}, base(r))
    },
    receiptLines: {
      table:'receipt_lines', key:'id', push:['owner'], pull:['owner'],
      toRow: (x, ws)=> Object.assign({id:x.id, receipt_id:x.receiptId, model_id:x.modelId, size_id:x.sizeId, qty:num(x.qty), plan:x.plan || null, done_qty:num(x.doneQty)}, tail(x, ws)),
      toLocal: r=> Object.assign({id:r.id, receiptId:r.receipt_id, modelId:r.model_id, sizeId:r.size_id, qty:num(r.qty), plan:r.plan || null, doneQty:num(r.done_qty)}, base(r))
    },
    shipments: {
      table:'shipments', key:'id', push:['owner'], pull:['owner'],
      toRow: (x, ws)=> Object.assign({id:x.id, supplier_id:x.supplierId, carrier:x.carrier || '', comment:x.comment || '', status:x.status || 'новая', created_by:x.createdBy || 'owner', created_ts:num(x.createdTs)}, tail(x, ws)),
      toLocal: r=> Object.assign({id:r.id, supplierId:r.supplier_id, carrier:r.carrier || '', comment:r.comment || '', status:r.status, createdBy:r.created_by, createdTs:num(r.created_ts)}, base(r))
    },
    shipmentLines: {
      table:'shipment_lines', key:'id', push:['owner'], pull:['owner'],
      toRow: (x, ws)=> Object.assign({id:x.id, shipment_id:x.shipmentId, model_id:x.modelId, size_id:x.sizeId, qty:num(x.qty), cell_number:x.cellNumber || null, collected:!!x.collected}, tail(x, ws)),
      toLocal: r=> Object.assign({id:r.id, shipmentId:r.shipment_id, modelId:r.model_id, sizeId:r.size_id, qty:num(r.qty), cellNumber:r.cell_number || null, collected:!!r.collected}, base(r))
    }
  };
  /* Порядок важен: сначала модель, потом её размеры и личные цифры, потом ячейки и операции —
     иначе сервер не пустит строку, ссылающуюся на ещё не известную ему модель. */
  const ORDER = ['suppliers','models','privates','sizes','cells','receipts','receiptLines','shipments','shipmentLines','ops'];
  const localKeyOf = (store, x)=> x[MAP[store].localKey || MAP[store].key];

  class AccessClosed extends Error {}
  /* Ошибки различаем по коду и статусу, а не по словам в тексте: раньше «В ячейке 401
     другая модель» принималась за «нет доступа» (в тексте есть «401»). */
  const errCode = e => String(e && e.code || '');
  const isCellRuleError = e => /другая модель|закреплена за другим поставщиком|Ячейки \S+ нет/i.test(String(e && e.message || ''));
  const isRlsError  = (e, st) => !isCellRuleError(e) && (errCode(e) === '42501' || st === 403);
  const isAuthError = (e, st) => !isCellRuleError(e) && (st === 401 || /^PGRST30\d$/.test(errCode(e)));
  const isDataError = (e, st) => !isCellRuleError(e) && !isRlsError(e, st) && !isAuthError(e, st) && st >= 400 && st < 500;

  /* Сервер отказал по правам. Складу это не грозит потерей: его строки не помечаются
     отвергнутыми (повтор при следующем обмене). Поставщику — проверяем, не закрыли ли доступ. */
  async function onRlsRefusal(store, list, rl, ws, msg){
    if(rl !== 'supplier') throw new Error(MAP[store].table + ': сервер не принял (' + msg + ')');
    /* срок склада закончился на сервере раньше, чем телефон узнал: правки не «отвергнуты»,
       они ждут, пока склад продлят */
    const act = await client.rpc('warehouse_active', {ws});
    if(!act.error && act.data === false){
      throw new Error('Подписка склада закончилась — правки сохранены на телефоне и уйдут после продления');
    }
    for(const p of list){ p.local.rejected = 1; p.local.rejectReason = 'нет прав'; p.local.dirty = 0; await window.put(store, p.local, {fromSync:true}); }
    const me = await client.from('suppliers').select('id').eq('owner_id', ws).eq('id', mySupplierId()).limit(1);
    if(!me.error && (!me.data || !me.data.length)) throw new AccessClosed('архив');
    if(typeof window.toast === 'function') window.toast('Сервер не принял правку — нет прав на эту запись');
  }
  async function onAuthTrouble(){
    try{ await client.auth.refreshSession(); }catch(e){}
    throw new Error('Вход устарел — обновили, обмен повторится');
  }

  // ------------------------------------------------------------------
  // отправка
  // ------------------------------------------------------------------
  async function pushStore(store, ws, rl){
    const spec = MAP[store];
    const dirty = (await window.getDirty(store)).filter(r=> !r.rejected);
    if(!dirty.length) return 0;
    const pairs = dirty.map(local=> ({local, row: spec.toRow(local, ws, rl)}));
    // одна строка на ключ — иначе сервер отвергает всю пачку
    const byKey = new Map();
    for(const p of pairs){ const k = String(p.row[spec.key]); const c = byKey.get(k); if(!c || num(p.local.updatedAt) >= num(c.local.updatedAt)) byKey.set(k, p); }
    const unique = [...byKey.values()];
    let sent = 0;
    for(let i = 0; i < unique.length; i += 200){
      const slice = unique.slice(i, i + 200);
      // сервер новее — уступаем (его версия приедет приёмом; сервер и сам не даст затереть новое)
      const remote = new Map();
      for(let j = 0; j < slice.length; j += 50){
        const keys = slice.slice(j, j + 50).map(p=> String(p.row[spec.key]));
        const chk = await client.from(spec.table).select(spec.key + ',updated_at').eq('owner_id', ws).in(spec.key, keys);
        if(chk.error){
          if(isAuthError(chk.error, chk.status)) await onAuthTrouble();
          throw new Error(spec.table + ': ' + chk.error.message);
        }
        (chk.data || []).forEach(r=> remote.set(String(r[spec.key]), num(r.updated_at)));
      }
      const send = slice.filter(p=>{ const t = remote.get(String(p.row[spec.key])); return !(t !== undefined && t > num(p.row.updated_at)); });
      if(send.length){
        const {error, status} = await client.from(spec.table).upsert(send.map(p=> p.row), {onConflict: 'owner_id,' + spec.key});
        if(error){
          if(isCellRuleError(error) || isDataError(error, status)){ sent += await pushOneByOne(store, send, rl, ws); continue; }
          if(isRlsError(error, status)){ await onRlsRefusal(store, send, rl, ws, error.message); continue; }
          if(isAuthError(error, status)) await onAuthTrouble();
          throw new Error(spec.table + ': ' + error.message);
        }
        sent += send.length;
      }
      for(const p of slice){ p.local.dirty = 0; await window.put(store, p.local, {fromSync:true}); }
    }
    // дубли того же ключа — уже отправлены в лице «победителя»
    for(const p of pairs){ if(!unique.includes(p)){ p.local.dirty = 0; await window.put(store, p.local, {fromSync:true}); } }
    return sent;
  }
  /* Пачку не приняли из-за одной-двух строк — шлём по одной: виноватые помечаются
     «не принято сервером», остальные уходят. Одна плохая строка больше не стопорит обмен. */
  async function pushOneByOne(store, list, rl, ws){
    const spec = MAP[store]; let sent = 0;
    for(const p of list){
      const {error, status} = await client.from(spec.table).upsert([p.row], {onConflict: 'owner_id,' + spec.key});
      if(error && (isCellRuleError(error) || isDataError(error, status))){
        p.local.rejected = 1; p.local.rejectReason = error.message; p.local.dirty = 0;
        await window.put(store, p.local, {fromSync:true});
        if(typeof window.ffOnRejected === 'function'){ try{ await window.ffOnRejected(store, p.local, error.message); }catch(e){} }
        continue;
      }
      if(error){
        if(isRlsError(error, status)){ await onRlsRefusal(store, [p], rl, ws, error.message); continue; }
        if(isAuthError(error, status)) await onAuthTrouble();
        throw new Error(spec.table + ': ' + error.message);
      }
      p.local.dirty = 0; await window.put(store, p.local, {fromSync:true}); sent++;
    }
    return sent;
  }

  // ------------------------------------------------------------------
  // приём — по порядковому номеру правки на сервере (seq), а не по часам телефона:
  // правка, сделанная давно без сети, всё равно доедет до всех
  // ------------------------------------------------------------------
  async function pullStore(store, ws, rl, sinceSeq){
    const spec = MAP[store];
    const table = (spec.pullTable && spec.pullTable[rl]) || spec.table;
    const PAGE = 1000, data = [];
    for(let from = 0; ; from += PAGE){
      const page = await client.from(table).select('*').eq('owner_id', ws).gt('seq', sinceSeq)
        .order('seq', {ascending:true}).range(from, from + PAGE - 1);
      if(page.error){
        if(isAuthError(page.error, page.status)) await onAuthTrouble();
        throw new Error(table + ': ' + page.error.message);
      }
      data.push(...(page.data || []));
      if(!page.data || page.data.length < PAGE) break;
    }
    let maxSeq = sinceSeq, applied = 0;
    for(const row of data){
      maxSeq = Math.max(maxSeq, num(row.seq));
      const incoming = spec.toLocal(row);
      const existing = await window.get(store, localKeyOf(store, incoming));
      if(existing && num(existing.updatedAt) > num(incoming.updatedAt)) continue;          // наша правка свежее (едет или уедет)
      if(existing && !existing.dirty && num(existing.updatedAt) === num(incoming.updatedAt) &&
         !existing.deletedAt === !incoming.deletedAt && !existing.rejected) continue;           // это наша же правка вернулась — ничего нового
      await window.put(store, incoming, {fromSync:true});
      applied++;
    }
    return {applied, maxSeq};
  }

  async function serverSizeStock(ws){
    const map = {}, PAGE = 1000;
    for(let from = 0; ; from += PAGE){
      const {data, error} = await client.from('size_stock').select('size_id,stock').eq('owner_id', ws).order('size_id', {ascending:true}).range(from, from + PAGE - 1);
      if(error) return null;
      (data || []).forEach(r=> map[r.size_id] = num(r.stock));
      if(!data || data.length < PAGE) break;
    }
    return map;
  }

  /* Самопроверка: сумма своих операций должна совпасть с сервером. Разовая разница бывает
     (чужая правка пришла между приёмом и сверкой), поэтому лечим, только если та же разница
     держится два обмена подряд: перекачать операции и убрать «отправленные», которых нет. */
  let lastDiffSig = '';
  async function selfCheck(ws, rl){
    if((await window.getDirty('ops')).some(r=> !r.rejected)) return;      // ещё не всё отправлено — сравнивать рано
    const server = await serverSizeStock(ws);
    if(!server || typeof window.ffCompareWithServer !== 'function') return;
    const diffs = await window.ffCompareWithServer(server);
    const sig = diffs.map(d=> d.sizeId + ':' + d.local + ':' + d.server).sort().join('|');
    if(!diffs.length){ lastDiffSig = ''; return; }
    if(sig !== lastDiffSig){ lastDiffSig = sig; return; }
    lastDiffSig = '';
    await pullStore('ops', ws, rl, 0);
    const live = new Set();
    const table = (MAP.ops.pullTable && MAP.ops.pullTable[rl]) || MAP.ops.table;
    for(let from = 0; ; from += 1000){
      const {data, error} = await client.from(table).select('uid').eq('owner_id', ws).order('uid', {ascending:true}).range(from, from + 999);
      if(error) return;
      (data || []).forEach(r=> live.add(r.uid));
      if(!data || data.length < 1000) break;
    }
    for(const op of await window.getAll('ops')){ if(!op.dirty && !op.rejected && !live.has(op.uid)) await window.del('ops', op.uid); }
    const after = await window.ffCompareWithServer(server);
    if(typeof window.toast === 'function') window.toast('Остатки сверены с сервером' + (after.length ? '' : ' и исправлены'));
  }

  // ------------------------------------------------------------------
  // доступ закрыт (поставщика архивировали / удалили)
  // ------------------------------------------------------------------
  function showAccessClosed(){
    let el = document.getElementById('ffAccessClosed');
    if(!el){
      el = document.createElement('div');
      el.id = 'ffAccessClosed';
      el.className = 'alert danger';
      el.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(12px + env(safe-area-inset-top));z-index:200;';
      el.innerHTML = '<span><b>Доступ закрыт хозяином.</b> Склад закрыл вам доступ — правки не отправлены. Обратитесь к складу.</span>';
      document.body.appendChild(el);
    }
  }
  async function onAccessClosed(){
    stopRealtime();
    membership = {role:'none', email: membership && membership.email || ''};
    writeCachedMembership(membership);
    showAccessClosed();
    emit('access-closed');
    if(typeof window.applyRoleUI === 'function'){ try{ await window.applyRoleUI(); }catch(e){} }
  }

  // ------------------------------------------------------------------
  // данные на устройстве принадлежат одной учётке и одному складу
  // ------------------------------------------------------------------
  async function wipeLocalData(){
    for(const s of ORDER) await window.clearStore(s);
    for(const r of await window.getAll('settings')){
      if(/^(ffSeq:|ffCursor:|ffEpoch:|ffScope$)/.test(r.key)) await window.del('settings', r.key);
    }
  }
  async function pendingCount(){
    return (await Promise.all(ORDER.map(s=> window.getDirty(s)))).reduce((n, a)=> n + a.filter(r=> !r.rejected).length, 0);
  }
  /* Сменилась учётка или склад — чужие данные стираются, а не показываются и не уезжают
     не в тот склад. */
  async function ensureScope(userId, ws){
    const scope = userId + '|' + ws;
    const row = await window.get('settings', 'ffScope');
    if(row && row.value === scope) return false;
    if(row && row.value !== scope) await wipeLocalData();
    await window.putRaw('settings', {key:'ffScope', value: scope});
    return !!row;
  }

  // ------------------------------------------------------------------
  // обмен целиком
  // ------------------------------------------------------------------
  async function syncNow(reason){
    if(!ready()) return {ok:false, error:'Сервер не настроен'};
    if(currentRun){
      queuedRun = true;
      try{ await currentRun; }catch(e){}
      if(queuedRun){ queuedRun = false; return runSync(reason); }
      return {ok:true, sent:0, received:0, coalesced:true};
    }
    return runSync(reason);
  }

  /* Отметка «идёт обмен» ставится сразу, до первого ожидания: два обмена (или обмен и
     откат копии) не могут пойти одновременно. */
  async function runSync(reason){
    let resolveRun; currentRun = new Promise(r=>{ resolveRun = r; });
    try{ return await runSyncInner(reason); }
    finally{ currentRun = null; resolveRun(); }
  }
  async function runSyncInner(reason){
    if(!navigator.onLine){ emit('offline'); return {ok:false, error:'нет сети'}; }
    const user = await currentUser();
    if(!user){ emit('signed-out'); return {ok:false, error:'не выполнен вход'}; }
    if(role() === 'none') await resolveMembership();
    const rl = role();
    if(rl !== 'owner' && rl !== 'supplier') return {ok:false, error:'нет доступа к складу'};
    const ws = ownerId();
    emit('syncing', {reason});
    try{
      await ensureScope(user.id, ws);
      const st = await client.from('warehouses').select('owner_id,title,paid_until,blocked,trial').eq('owner_id', ws).limit(1);
      if(!st.error && st.data && st.data.length){
        Object.assign(membership, whStatus(st.data[0])); writeCachedMembership(membership);
        if(typeof window.renderSubBanner === 'function'){ try{ window.renderSubBanner(); }catch(e){} }
      }
      const active = (subscription() || {}).active !== false;
      /* Архивному поставщику сервер просто ничего не отдаёт — без ошибки. Проверяем явно. */
      if(rl === 'supplier'){
        const me = await client.from('suppliers').select('id').eq('owner_id', ws).eq('id', mySupplierId()).limit(1);
        if(!me.error && (!me.data || !me.data.length)) throw new AccessClosed('архив');
      }
      await adoptEpochIfNeeded(ws, rl);
      /* Отправка не удалась — приём всё равно идёт: телефон не «глохнет» из-за одной беды. */
      let sent = 0, pushErr = null;
      /* «Только просмотр» (срок истёк, склад заблокирован): правки не отправляются, но и не
         теряются — уйдут после продления. */
      if(active) try{
        for(const s of ORDER) if(MAP[s].push.includes(rl)) sent += await pushStore(s, ws, rl);
        if(rl === 'owner') sent += await pushSettings(ws);
      }catch(e){ if(e instanceof AccessClosed) throw e; pushErr = e; }

      const cursorKey = 'ffSeq:' + ws;
      const cur = await window.get('settings', cursorKey);
      const since = cur ? num(cur.value) : 0;
      let received = 0, newCursor = since;
      for(const s of ORDER){
        if(!MAP[s].pull.includes(rl)) continue;
        const r = await pullStore(s, ws, rl, since);
        received += r.applied; newCursor = Math.max(newCursor, r.maxSeq);
      }
      received += await pullSettings(ws);
      await window.put('settings', {key: cursorKey, value: newCursor});

      if(!pushErr) await selfCheck(ws, rl);
      const pending = await pendingCount();
      if(received && typeof window.refreshAfterSync === 'function'){ try{ await window.refreshAfterSync(); }catch(e){} }
      if(pushErr){ emit('error', {message: pushErr.message}); return {ok:false, error: pushErr.message, received}; }
      emit('idle', {sent, received, pending, at: Date.now()});
      return {ok:true, sent, received};
    }catch(e){
      if(e instanceof AccessClosed){ await onAccessClosed(); return {ok:false, error:'Доступ закрыт хозяином', accessClosed:true}; }
      emit('error', {message: e.message});
      return {ok:false, error: e.message};
    }
  }
  // ------------------------------------------------------------------
  // настройки склада (одна запись app_settings.key='app'): пишет склад, читают все
  // ------------------------------------------------------------------
  async function pushSettings(ws){
    const local = await window.get('settings', 'app');
    if(!local || !local.dirty) return 0;
    const chk = await client.from('app_settings').select('updated_at').eq('owner_id', ws).eq('key', 'app').limit(1);
    if(chk.error) throw new Error('settings: ' + chk.error.message);
    const remote = chk.data && chk.data.length ? num(chk.data[0].updated_at) : 0;
    if(remote <= num(local.updatedAt)){
      const value = Object.assign({}, local); delete value.key; delete value.dirty;
      const {error} = await client.from('app_settings').upsert([{owner_id: ws, key:'app', value, updated_at: num(local.updatedAt)}], {onConflict:'owner_id,key'});
      if(error) throw new Error('settings: ' + error.message);
    }
    local.dirty = 0; await window.putRaw('settings', local);
    return 1;
  }
  async function pullSettings(ws){
    const local = await window.get('settings', 'app');
    const {data, error} = await client.from('app_settings').select('*').eq('owner_id', ws).eq('key', 'app').limit(1);
    if(error || !data || !data.length) return 0;
    if(num(data[0].updated_at) <= num(local && local.updatedAt)) return 0;
    const merged = Object.assign({}, data[0].value, {key:'app', updatedAt: num(data[0].updated_at), dirty:0});
    await window.putRaw('settings', merged);
    if(typeof window.applyRemoteSettings === 'function') window.applyRemoteSettings(merged);
    return 1;
  }

  // ------------------------------------------------------------------
  // откат копии: другие телефоны, увидев новую «эпоху», качают всё заново
  // ------------------------------------------------------------------
  const EPOCH_KEY = 'masterEpoch';
  async function adoptEpochIfNeeded(ws, rl){
    const {data, error} = await client.from('app_settings').select('updated_at').eq('owner_id', ws).eq('key', EPOCH_KEY).limit(1);
    if(error) return false;
    const remote = data && data.length ? num(data[0].updated_at) : 0;
    const row = await window.get('settings', 'ffEpoch:' + ws);
    if(remote <= num(row && row.value)) return false;
    for(const s of ORDER) await window.clearStore(s);
    await window.put('settings', {key:'ffSeq:' + ws, value: 0});
    await window.put('settings', {key:'ffEpoch:' + ws, value: remote});
    if(typeof window.toast === 'function' && row) window.toast('Данные обновлены с сервера');
    return true;
  }

  async function takeSnapshot(kind){
    if(!ready() || role() !== 'owner') return {ok:false, error:'только склад'};
    const {data, error} = await client.rpc('take_snapshot', {p_kind: kind || 'manual'});
    return error ? {ok:false, error:error.message} : {ok:true, id:data};
  }
  async function listSnapshots(){
    if(!ready() || role() !== 'owner') return [];
    const {data, error} = await client.from('snapshots').select('id,kind,taken_at,counts').eq('owner_id', ownerId()).order('taken_at', {ascending:false}).limit(60);
    if(error) throw new Error(error.message);
    return data || [];
  }
  const SNAP_STORES = {suppliers:'suppliers', models:'models', sizes:'sizes', cells:'cells', operations:'ops',
                       receipts:'receipts', receipt_lines:'receiptLines', shipments:'shipments', shipment_lines:'shipmentLines'};
  /* Откат: копия «до отката» → объявить эпоху → заменить данные телефона снимком →
     пометить удалёнными серверные строки, которых в снимке нет → отправить снимок. */
  async function restoreSnapshot(id, onProgress){
    const say = t=>{ try{ if(onProgress) onProgress(t); }catch(e){} };
    if(!ready() || role() !== 'owner') return {ok:false, error:'только склад'};
    if(!navigator.onLine) return {ok:false, error:'нет сети'};
    const ws = ownerId();
    say('Скачиваю копию…');
    const {data, error} = await client.from('snapshots').select('data').eq('id', id).limit(1);
    if(error) return {ok:false, error:error.message};
    if(!data || !data.length) return {ok:false, error:'копия не найдена'};
    const snap = data[0].data || {};
    say('Сохраняю нынешнее состояние…');
    const before = await takeSnapshot('before-restore');
    if(!before.ok) return {ok:false, error:'не удалось сохранить копию «до отката»: ' + before.error};
    if(currentRun){ try{ await currentRun; }catch(e){} }
    let resolveRun; currentRun = new Promise(r=>{ resolveRun = r; });
    try{
      const now = Date.now();
      const ep = await client.from('app_settings').upsert([{owner_id: ws, key: EPOCH_KEY, value:{by:'restore'}, updated_at: now}], {onConflict:'owner_id,key'});
      if(ep.error) throw new Error(ep.error.message);
      await window.put('settings', {key:'ffEpoch:' + ws, value: now});
      window.bulkBegin();
      try{
        /* Шаг 1 — снять на сервере лишнее, от операций к ячейкам и моделям: ячейку с
           товаром сервер не даст убрать, пока не сняты операции, которые её наполняют. */
        const entries = Object.entries(SNAP_STORES);
        const restored = {};
        for(const [table, store] of entries.slice().reverse()){
          const spec = MAP[store];
          await window.clearStore(store);
          const rows = (snap[table] || []).map(r=> spec.toLocal(Object.assign({}, r, {deleted_at: null})));
          restored[store] = rows;
          const keep = new Set(rows.map(r=> String(localKeyOf(store, r))));
          say('Сверяю: ' + spec.table + '…');
          const extra = [];
          for(let from = 0; ; from += 1000){
            const page = await client.from(spec.table).select(spec.key).eq('owner_id', ws).is('deleted_at', null).order(spec.key, {ascending:true}).range(from, from + 999);
            if(page.error) throw new Error(page.error.message);
            (page.data || []).forEach(r=>{ if(!keep.has(String(r[spec.key]))) extra.push(String(r[spec.key])); });
            if(!page.data || page.data.length < 1000) break;
          }
          for(let i = 0; i < extra.length; i += 50){
            const t = Date.now();
            const up = await client.from(spec.table).update({deleted_at: t, updated_at: t}).eq('owner_id', ws).in(spec.key, extra.slice(i, i + 50));
            if(up.error) throw new Error(up.error.message);
          }
        }
        /* Шаг 2 — положить снимок и отправить, от моделей к операциям. */
        for(const [, store] of entries){
          for(const r of restored[store]) await window.put(store, r);       // всё «новое» — уедет целиком
          if(MAP[store].push.includes('owner')) await pushStore(store, ws, 'owner');
        }
      }finally{ window.bulkEnd(); }
      return {ok:true, beforeId: before.id};
    }catch(e){
      return {ok:false, error:e.message};
    }finally{
      currentRun = null; if(resolveRun) resolveRun();
    }
  }

  // ------------------------------------------------------------------
  // поставщики (для склада)
  // ------------------------------------------------------------------
  async function createSupplier(name){
    if(!ready() || role() !== 'owner') return {ok:false, error:'Только для склада'};
    const {data, error} = await client.rpc('create_supplier', {p_name: String(name || '').trim()});
    if(error) return {ok:false, error:error.message};
    const row = Array.isArray(data) ? data[0] : data;
    await syncNow('новый поставщик');
    return {ok:true, id: row.id, code: row.invite_code};
  }
  async function resetSupplierPassword(supplierId){
    if(!ready() || role() !== 'owner') return {ok:false, error:'Только для склада'};
    const {data, error} = await client.rpc('owner_reset_password', {p_supplier: supplierId});
    return error ? {ok:false, error:error.message} : {ok:true, password: data};
  }

  // ------------------------------------------------------------------
  // мгновенные обновления с других устройств
  // ------------------------------------------------------------------
  function startRealtime(){
    if(!ready() || channel) return;
    channel = client.channel('ff-sync');
    ['suppliers','models','model_private','sizes','cells','operations','receipts','receipt_lines','shipments','shipment_lines','app_settings']
      .forEach(t=> channel.on('postgres_changes', {event:'*', schema:'public', table:t}, ()=> syncNow('чужая правка: ' + t)));
    channel.subscribe();
  }
  function stopRealtime(){ if(channel && client){ try{ client.removeChannel(channel); }catch(e){} } channel = null; }

  async function start(){
    if(!init()) return false;
    const user = await currentUser();
    if(!user){ emit('signed-out'); return false; }
    await resolveMembership();
    if(typeof window.applyRoleUI === 'function'){ try{ await window.applyRoleUI(); }catch(e){} }
    if(await mustChangePassword() && typeof window.openNewPasswordModal === 'function') window.openNewPasswordModal('forced');
    if(role() === 'owner' || role() === 'supplier'){
      startRealtime();
      await syncNow('запуск');
      if(role() === 'owner') takeSnapshot('daily').catch(()=>{});
    }
    return true;
  }

  window.addEventListener('online', ()=> syncNow('появилась сеть'));
  window.addEventListener('offline', ()=> emit('offline'));
  setInterval(()=>{ if(ready() && navigator.onLine && (role() === 'owner' || role() === 'supplier')) syncNow('по расписанию'); }, 120000);

  window.Sync = {
    init, start, signIn, signUp, joinByCode, requestPasswordReset, setNewPassword, mustChangePassword, signOut,
    changePassword: setNewPassword, syncNow, currentUser, ready, lastLogin, onStatus,
    isConfigured: ()=> Boolean(CFG.url && CFG.key),
    resolveMembership, role, ownerId, mySupplierId, memberName, authorName,
    warehouses: ()=> (membership && membership.warehouses) || [],
    chooseWarehouse: async ownerIdToUse=>{ try{ localStorage.setItem(WAREHOUSE_KEY, ownerIdToUse); }catch(e){} await resolveMembership(); return syncNow('другой склад'); },
    createSupplier, resetSupplierPassword, pendingCount, wipeLocalData, registerWarehouse, subscription,
    isAdmin: ()=> !!(membership && membership.isAdmin),
    loadTariffs: async ()=>{ if(!init()) return []; const {data, error} = await client.from('service_settings').select('value').eq('key', 'tariffs').limit(1); if(error) throw new Error(error.message); return (data && data[0] && data[0].value) || []; },
    adminList: async ()=>{ const {data, error} = await client.rpc('admin_list_warehouses'); if(error) throw new Error(error.message); return data || []; },
    adminExtend: async (id, days)=>{ const {error} = await client.rpc('admin_extend', {p_owner: id, p_days: days}); if(error) throw new Error(error.message); },
    adminUnlimited: async id=>{ const {error} = await client.rpc('admin_set_unlimited', {p_owner: id}); if(error) throw new Error(error.message); },
    adminBlock: async (id, on)=>{ const {error} = await client.rpc('admin_block', {p_owner: id, p_blocked: !!on}); if(error) throw new Error(error.message); },
    adminSetTariffs: async list=>{ const {error} = await client.rpc('admin_set_tariffs', {p_value: list}); if(error) throw new Error(error.message); },
    takeSnapshot, listSnapshots, restoreSnapshot, startRealtime, stopRealtime,
    // совместимость со старыми экранами «Склада» (уходят в задачах 5–7)
    joinWorkspace: code=> joinByCode(code), listMembers: async()=> [], removeMember: async()=> ({ok:false, error:'нет'}),
    ensureInviteCode: async()=> null, rotateInviteCode: async()=> ({ok:false, error:'нет'}), inviteCode: ()=> null,
    myMemberId: async()=>{ const u = await currentUser(); return u ? u.id : null; }, workspaceOwnerId: async()=> ownerId(),
    partnerMarkDamaged: async()=> ({ok:false, error:'нет в «ФФ»'}), partnerRestoreDamaged: async()=> ({ok:false, error:'нет в «ФФ»'}),
    publishAsMaster: async()=> ({ok:false, error:'нет в «ФФ»'}), serverLiveUids: async()=> null
  };
})();
