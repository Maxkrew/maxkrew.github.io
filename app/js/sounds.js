/* «Склад»: Звуки сканирования. */
/* ============================================================
   ЗВУКИ СКАНИРОВАНИЯ
   По умолчанию — встроенные сигналы: приход выше, расход ниже, ошибка
   двойным низким. Любой из трёх можно заменить своим файлом; он хранится
   вместе с настройками, поэтому работает и без сети.
   ============================================================ */
const SOUND_KINDS = [
  {key:'prihod', title:'Приход',  note:'короткий высокий сигнал'},
  {key:'rashod', title:'Расход',  note:'короткий низкий сигнал'},
  {key:'error',  title:'Ошибка',  note:'двойной низкий сигнал'}
];
const soundPlayers = {};
/* data:-URL звука на iOS проигрывается ненадёжно (особенно крупный) —
   один раз переводим его в blob-URL и дальше играем уже его. */
const soundObjectUrls = {};

function customSound(key){
  return (settings.sounds && settings.sounds[key]) ? settings.sounds[key].data : null;
}

/* Blob-URL для звука key. Пересобирается, только если сам файл сменился. */
function soundSrcFor(key){
  const rec = settings.sounds && settings.sounds[key];
  if(!rec || !rec.data){
    if(soundObjectUrls[key]){ try{ URL.revokeObjectURL(soundObjectUrls[key].url); }catch(e){} delete soundObjectUrls[key]; }
    return null;
  }
  if(soundObjectUrls[key] && soundObjectUrls[key].from === rec.data) return soundObjectUrls[key].url;
  if(soundObjectUrls[key]){ try{ URL.revokeObjectURL(soundObjectUrls[key].url); }catch(e){} }
  try{
    const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(rec.data);
    if(!m) return rec.data;
    const type = m[1] || 'audio/mpeg';
    let blob;
    if(m[2]){
      const bin = atob(m[3]);
      const arr = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
      blob = new Blob([arr], {type});
    } else {
      blob = new Blob([decodeURIComponent(m[3])], {type});
    }
    const url = URL.createObjectURL(blob);
    soundObjectUrls[key] = {from: rec.data, url};
    return url;
  }catch(e){ return rec.data; }
}

/* Пул из трёх <audio> на каждый звук: сканеру часто прилетает два товара
   подряд, а повторный запуск ещё звучащего элемента браузер молча
   отбрасывает — сигнал пропускался. */
function ensureSoundEntry(key){
  const src = soundSrcFor(key);
  if(!src){ delete soundPlayers[key]; return null; }
  let entry = soundPlayers[key];
  if(!entry || entry.src !== src){
    const mk = ()=>{ const a = new Audio(src); a.preload = 'auto'; try{ a.load(); }catch(e){} return a; };
    entry = {src, pool:[mk(), mk(), mk()], next:0};
    soundPlayers[key] = entry;
    customSoundsPrimed = false;   // новый пул — надо снова завести под iOS
  }
  return entry;
}

/* Заводим пулы заранее, ещё до первого скана — тогда primeCustomSounds()
   на первом же символе сканера успеет их «благословить». */
function warmCustomSounds(){
  SOUND_KINDS.forEach(k=> ensureSoundEntry(k.key));
}

/* Полный сброс — когда звук поменяли здесь или он приехал с другого
   устройства синхронизацией. */
function refreshCustomSounds(){
  Object.keys(soundObjectUrls).forEach(k=>{ try{ URL.revokeObjectURL(soundObjectUrls[k].url); }catch(e){} delete soundObjectUrls[k]; });
  Object.keys(soundPlayers).forEach(k=> delete soundPlayers[k]);
  customSoundsPrimed = false;
  warmCustomSounds();
}

/* Прогоняет каждый элемент пула коротким muted-воспроизведением ВНУТРИ
   жеста пользователя. После этого iOS разрешает запускать эти же элементы
   из кода — по скану. Один раз за «сеанс видимости». */
function primeCustomSounds(){
  if(customSoundsPrimed) return;
  const entries = Object.values(soundPlayers);
  if(!entries.length) return;
  let ok = true;
  entries.forEach(entry=>{
    entry.pool.forEach(a=>{
      try{
        a.muted = true;
        const p = a.play();
        if(p && p.then){
          p.then(()=>{ try{ a.pause(); a.currentTime = 0; }catch(e){} a.muted = false; })
           .catch(()=>{ a.muted = false; ok = false; });
        } else {
          try{ a.pause(); a.currentTime = 0; }catch(e){}
          a.muted = false;
        }
      }catch(e){ a.muted = false; ok = false; }
    });
  });
  if(ok) customSoundsPrimed = true;
}

/* Возвращает false, если своего звука нет — тогда играет встроенный. */
function playCustomSound(key){
  const entry = ensureSoundEntry(key);
  if(!entry) return false;
  const player = entry.pool[entry.next];
  entry.next = (entry.next + 1) % entry.pool.length;
  try{ player.currentTime = 0; }catch(e){}
  try{
    const p = player.play();
    if(p && p.catch) p.catch(()=>{
      /* iOS не дал воспроизвести — значит элемент «протух». Заводим заново
         и пробуем ещё раз тем же элементом. */
      customSoundsPrimed = false;
      primeCustomSounds();
      try{ player.currentTime = 0; const p2 = player.play(); if(p2 && p2.catch) p2.catch(()=>{}); }catch(e){}
    });
  }catch(e){ return false; }
  return true;
}

function playSound(mode){
  if(!settings.sound) return;
  const key = (mode === 'Расход') ? 'rashod' : 'prihod';
  if(playCustomSound(key)) return;
  beep(mode === 'Расход' ? 550 : 880, 0, 0.09, 0.09);
}
function playErrorSound(){
  if(!settings.sound) return;
  if(playCustomSound('error')) return;
  beep(220, 0, 0.1, 0.09);
  beep(220, 0.14, 0.1, 0.09);
}

function renderSoundRows(){
  const box = document.getElementById('soundRows');
  if(!box) return;
  box.innerHTML = SOUND_KINDS.map(kind=>{
    const own = settings.sounds && settings.sounds[kind.key];
    const label = own ? escapeHtml(own.name || 'свой файл') : ('стандартный · ' + kind.note);
    return `<div class="row-item">
      <div class="rmain">
        <div class="rname">${kind.title}</div>
        <div class="rmeta">${label}</div>
      </div>
      <div class="rside">
        <button class="icon-btn" onclick="previewSound('${kind.key}')" aria-label="Прослушать ${kind.title}"><svg class="icon"><use href="#i-play"/></svg></button>
        <button class="icon-btn" onclick="pickSound('${kind.key}')" aria-label="Загрузить звук для ${kind.title}"><svg class="icon"><use href="#i-upload"/></svg></button>
        ${own ? `<button class="icon-btn" onclick="resetSound('${kind.key}')" aria-label="Вернуть стандартный"><svg class="icon"><use href="#i-x"/></svg></button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function previewSound(key){
  unlockAudio();
  if(playCustomSound(key)) return;
  if(key === 'error') { beep(220,0,0.1,0.09); beep(220,0.14,0.1,0.09); }
  else beep(key === 'rashod' ? 550 : 880, 0, 0.09, 0.09);
}

let pendingSoundKey = null;
function pickSound(key){
  pendingSoundKey = key;
  document.getElementById('soundFileInput').click();
}
function handleSoundUpload(e){
  const file = e.target.files[0];
  const key = pendingSoundKey;
  pendingSoundKey = null;
  e.target.value = '';
  if(!file || !key) return;
  if(!file.type.startsWith('audio/')){ toast('Нужен звуковой файл'); return; }
  if(file.size > 400*1024){ toast('Файл больше 400 КБ — возьмите звук покороче'); return; }

  const reader = new FileReader();
  reader.onload = async (ev)=>{
    settings.sounds = settings.sounds || {};
    settings.sounds[key] = {name: file.name, data: ev.target.result};
    await saveAppSettings();
    refreshCustomSounds();
    renderSoundRows();
    toast('Звук сохранён');
    previewSound(key);
  };
  reader.readAsDataURL(file);
}
async function resetSound(key){
  if(settings.sounds) delete settings.sounds[key];
  await saveAppSettings();
  refreshCustomSounds();
  renderSoundRows();
  toast('Вернули стандартный звук');
}

