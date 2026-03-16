/* Образовательная платформа КДБ №1 — основное приложение */
(function() {
'use strict';

window.__t0 = performance.now();
const API = (window.CONFIG && window.CONFIG.GAS_API) || '';
function getAIBase() { return (window.CONFIG && window.CONFIG.AI_API) || ''; }

function mdToHtml(md) {
  if (!md) return '';
  md = String(md).replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]));
  md = md.replace(/^###\s+(.*)$/gm,'<h3>$1</h3>').replace(/^##\s+(.*)$/gm,'<h2>$1</h2>').replace(/^#\s+(.*)$/gm,'<h1>$1</h1>');
  md = md.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  md = md.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>');
  return md.split(/\n{2,}/).map(p => /^<h\d/i.test(p.trim()) ? p : '<p>'+p.trim().replace(/\n/g,'<br>')+'</p>').join('');
}
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs||{}).forEach(([k,v]) => {
    if (k==='class') node.className=v;
    else if (k==='html') node.innerHTML=v;
    else if (v!=null) node.setAttribute(k,v);
  });
  [].concat(children||[]).filter(Boolean).forEach(c => node.append(c));
  return node;
}
const FETCH_TIMEOUT = 12000; // 12 сек
async function apiFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}
function esc(s) { return String(s).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))+Date.now(); }
function fmtDt(v) {
  try { return new Date(v).toLocaleString(undefined,{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return ''; }
}
function hideSplash(delay=800) {
  const sp = document.getElementById('splash');
  if (!sp) return;
  const wait = Math.max(0, delay - (performance.now() - window.__t0));
  setTimeout(() => { sp.classList.add('hidden'); setTimeout(()=>{sp.style.display='none'},450); }, wait);
}
// Гарантированно скрыть splash через 6 сек, даже если загрузка зависла
setTimeout(() => hideSplash(0), 6000);

let TOPICS = [];
let CURRENT = null;
let ACTIVE_TAB = 'video';
let USER_PREFS = null;
let EQ_CACHE = {};
let CARDS=[], ORDER=[], ci=0, flipped=false;
const opened=new Set();
let cardsFor=null;
let ST = { questions:[], answers:[], step:0 };
let EF = { questions:[], answers:[], step:0 };
let TOPIC_SELECT_UI = null;
let TOPIC_SELECT_BOUND = false;
let TOPIC_SELECT_DOC_BOUND = false;

const CE = {
  box: document.getElementById('cardBox'),
  qTitle: document.getElementById('qTitle'),
  qText: document.getElementById('qText'),
  aText: document.getElementById('aText'),
  counter: document.getElementById('cardsCounter'),
  bar: document.getElementById('cardsBar'),
  status: document.getElementById('cardsStatus'),
  congrats: document.getElementById('cardsCongrats'),
  overlay: document.getElementById('genOverlay'),
};

function loadPrefs() { try { const v=localStorage.getItem('userPrefs'); return v?JSON.parse(v):null; } catch { return null; } }
function savePrefs(p) { try { localStorage.setItem('userPrefs', JSON.stringify(p)); } catch {} }

function renderHeaderMeta() {
  const wrap = document.getElementById('headerMeta');
  wrap.innerHTML = '';
  if (!USER_PREFS) return;
  wrap.append(
    el('span', {class:'meta-badge'}, [USER_PREFS.course+' курс']),
    el('span', {class:'meta-badge'}, [USER_PREFS.faculty]),
    el('button', {class:'meta-change'}, ['Изменить'])
  );
  wrap.querySelector('.meta-change').addEventListener('click', () => {
    document.getElementById('onboarding').classList.remove('hidden');
  });
}

(function initOnboarding() {
  const state = { course:'', faculty:'' };
  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.g;
      document.querySelectorAll(`[data-g="${g}"]`).forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
      state[g] = btn.dataset.v;
      document.getElementById('obStart').disabled = !(state.course && state.faculty);
    });
  });
  document.getElementById('obStart').addEventListener('click', async () => {
    if (!state.course || !state.faculty) return;
    document.getElementById('obStatus').textContent = 'Загружаем материалы…';
    USER_PREFS = { ...state };
    savePrefs(USER_PREFS);
    document.getElementById('onboarding').classList.add('hidden');
    renderHeaderMeta();
    await loadTopics();
    hideSplash();
  });
})();

function buildSelect(topics) {
  const sel = document.getElementById('topicSelect');
  if (!sel) return;
  sel.innerHTML = '';
  topics.forEach(t => sel.append(el('option', {value:t.id}, [t.title])));
  if (!TOPIC_SELECT_BOUND) {
    sel.addEventListener('change', () => {
      renderTopicSelectUI();
      selectTopic(sel.value);
    });
    TOPIC_SELECT_BOUND = true;
  }
  TOPIC_SELECT_UI = initTopicSelectUI(sel);
  renderTopicSelectUI();
}

function initTopicSelectUI(sel) {
  const wrap = sel.closest('.hero-pick-select-wrap');
  if (!wrap) return null;
  sel.classList.add('native-hidden');

  let root = wrap.querySelector('.topic-dropdown');
  let trigger = root ? root.querySelector('.topic-trigger') : null;
  let label = trigger ? trigger.querySelector('.topic-trigger-label') : null;
  let menu = root ? root.querySelector('.topic-menu') : null;

  if (!root || !trigger || !label || !menu) {
    root = el('div', {class:'topic-dropdown'});
    trigger = el('button', {
      type: 'button',
      class: 'topic-trigger',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false'
    });
    label = el('span', {class:'topic-trigger-label'}, ['Выберите тему']);
    const icon = el('span', {class:'topic-trigger-icon', 'aria-hidden': 'true'});
    trigger.append(label, icon);
    menu = el('div', {class:'topic-menu', role:'listbox'});
    root.append(trigger, menu);
    wrap.append(root);
  }

  if (!trigger.dataset.bound) {
    trigger.addEventListener('click', () => {
      if (!TOPIC_SELECT_UI) return;
      if (TOPIC_SELECT_UI.root.classList.contains('open')) closeTopicMenu();
      else openTopicMenu();
    });

    trigger.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openTopicMenu();
        const active = menu.querySelector('.topic-option.selected') || menu.querySelector('.topic-option');
        if (active) active.focus();
      }
    });
    trigger.dataset.bound = '1';
  }

  if (!TOPIC_SELECT_DOC_BOUND) {
    document.addEventListener('click', e => {
      if (!TOPIC_SELECT_UI || !TOPIC_SELECT_UI.root.contains(e.target)) closeTopicMenu();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeTopicMenu();
        if (TOPIC_SELECT_UI && TOPIC_SELECT_UI.trigger) TOPIC_SELECT_UI.trigger.focus();
      }
    });
    TOPIC_SELECT_DOC_BOUND = true;
  }

  return { sel, root, trigger, label, menu };
}

function openTopicMenu() {
  if (!TOPIC_SELECT_UI) return;
  TOPIC_SELECT_UI.root.classList.add('open');
  TOPIC_SELECT_UI.trigger.setAttribute('aria-expanded', 'true');
  const hero = TOPIC_SELECT_UI.root.closest('.hero-pick');
  if (hero) hero.classList.add('topic-open');
}

function closeTopicMenu() {
  if (!TOPIC_SELECT_UI) return;
  TOPIC_SELECT_UI.root.classList.remove('open');
  TOPIC_SELECT_UI.trigger.setAttribute('aria-expanded', 'false');
  const hero = TOPIC_SELECT_UI.root.closest('.hero-pick');
  if (hero) hero.classList.remove('topic-open');
}

function selectTopicFromMenu(value) {
  if (!TOPIC_SELECT_UI || !TOPIC_SELECT_UI.sel) return;
  const sel = TOPIC_SELECT_UI.sel;
  const changed = sel.value !== value;
  sel.value = value;
  renderTopicSelectUI();
  closeTopicMenu();
  TOPIC_SELECT_UI.trigger.focus();
  if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function renderTopicSelectUI() {
  if (!TOPIC_SELECT_UI || !TOPIC_SELECT_UI.sel) return;
  const { sel, root, trigger, label, menu } = TOPIC_SELECT_UI;
  const options = [...sel.options];

  menu.innerHTML = '';
  menu.removeAttribute('aria-activedescendant');
  options.forEach((opt, i) => {
    const active = opt.selected;
    const btn = el('button', {
      id: 'topic-opt-' + i,
      type: 'button',
      class: 'topic-option' + (active ? ' selected' : ''),
      role: 'option',
      'aria-selected': active ? 'true' : 'false',
      'data-value': opt.value
    }, [opt.textContent || '']);

    btn.addEventListener('click', () => selectTopicFromMenu(opt.value));
    btn.addEventListener('keydown', e => {
      const items = [...menu.querySelectorAll('.topic-option')];
      const idx = items.indexOf(btn);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = items[Math.min(idx + 1, items.length - 1)];
        if (next) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (idx <= 0) trigger.focus();
        else items[idx - 1].focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeTopicMenu();
        trigger.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectTopicFromMenu(opt.value);
      }
    });
    menu.append(btn);
    if (active) menu.setAttribute('aria-activedescendant', 'topic-opt-' + i);
  });

  const selected = options.find(o => o.selected) || options[0];
  label.textContent = selected ? selected.textContent : 'Выберите тему';
  const disabled = !options.length;
  root.classList.toggle('disabled', disabled);
  trigger.disabled = disabled;
}

async function loadTopics() {
  if (!USER_PREFS) return;
  const url = API + '?action=topics&course=' + encodeURIComponent(USER_PREFS.course) + '&faculty=' + encodeURIComponent(USER_PREFS.faculty);
  try {
    const data = await apiFetch(url);
    TOPICS = data.topics || [];
    if (!TOPICS.length) {
      TOPIC_SELECT_UI = null;
      document.getElementById('block-select').innerHTML = '<div class="empty" style="font-size:15px">По вашему курсу и факультету пока нет тем.</div>';
      return;
    }
    buildSelect(TOPICS);
    const m = location.hash.match(/topic=([^&]+)/);
    const initId = m ? decodeURIComponent(m[1]) : TOPICS[0].id;
    document.getElementById('topicSelect').value = initId;
    renderTopicSelectUI();
    await selectTopic(initId);
  } catch(err) { console.error(err); }
}

function renderPlayer(embed) {
  const wrap = document.getElementById('player');
  wrap.innerHTML = '';
  if (!embed || !embed.type) return;
  if (['youtube','vimeo','drive'].includes(embed.type)) {
    wrap.append(el('iframe', {src:embed.src, allow:'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture', allowfullscreen:''}));
  } else if (embed.type==='video') {
    const v = document.createElement('video'); v.src=embed.src; v.controls=true; v.playsInline=true; wrap.append(v);
  } else if (embed.src) {
    wrap.append(el('a',{href:embed.src,target:'_blank',class:'status'},['Открыть видео ↗']));
  }
}

async function loadComments(id) {
  const box = document.getElementById('comments');
  box.innerHTML = '<div class="empty">Загрузка…</div>';
  try {
    const d = await apiFetch(API+'?action=comments&topicId='+encodeURIComponent(id));
    box.innerHTML = '';
    if (!(d.comments||[]).length) { box.innerHTML='<div class="empty">Комментариев пока нет.</div>'; return; }
    (d.comments||[]).forEach(c => box.append(el('div',{class:'comment'},[el('div',{},[c.text]),el('small',{},[`${c.name||'Студент'} · ${fmtDt(c.ts)}`])])));
  } catch { box.innerHTML='<div class="empty" style="color:#b91c1c">Ошибка загрузки.</div>'; }
}

async function refreshLikes(id) {
  try { const d=await apiFetch(API+'?action=reactions&topicId='+encodeURIComponent(id)); document.getElementById('likeCount').textContent=(d.reactions&&d.reactions.likes)||0; } catch {}
}
function setLikeDone(done) {
  const b = document.getElementById('likeBtn'); b.disabled=done; b.classList.toggle('off',done);
}

document.getElementById('likeBtn').addEventListener('click', async () => {
  if (!CURRENT) return;
  if (localStorage.getItem('liked_'+CURRENT.id)) { setLikeDone(true); return; }
  const fd=new FormData(); fd.append('action','like'); fd.append('topicId',CURRENT.id); fd.append('token',uid());
  try { const r=await fetch(API,{method:'POST',body:fd}); const j=await r.json(); if(j.ok||j.already){document.getElementById('likeCount').textContent=j.likes||0;localStorage.setItem('liked_'+CURRENT.id,'1');setLikeDone(true);} } catch {}
});

document.getElementById('shareBtn').addEventListener('click', async () => {
  if (!CURRENT) return;
  const url = location.href.split('#')[0]+'#topic='+encodeURIComponent(CURRENT.id);
  if (navigator.share) { try { await navigator.share({title:CURRENT.title,url}); } catch {} }
  else { try { await navigator.clipboard.writeText(url); } catch {} }
});

document.getElementById('commentForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!CURRENT) return;
  const msg = document.getElementById('commentMsg'); msg.textContent='Отправляем…';
  const fd=new FormData(); fd.append('action','addComment'); fd.append('topicId',CURRENT.id);
  fd.append('name',e.target.name.value.trim()); fd.append('text',e.target.text.value.trim());
  try { const r=await fetch(API,{method:'POST',body:fd}); const j=await r.json(); msg.textContent=j.ok?'Комментарий добавлен ✔':'Ошибка: '+(j.error||''); if(j.ok){e.target.reset();await loadComments(CURRENT.id);} } catch { msg.textContent='Ошибка сети'; }
});

function aiSetBusy(busy, msg) {
  const btn=document.getElementById('askBtn'); btn.disabled=!!busy; btn.classList.toggle('off',!!busy);
  document.getElementById('aiStatus').textContent=msg||(busy?'Готовим ответ…':'');
}

document.getElementById('aiForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!CURRENT) return;
  const qEl=document.getElementById('aiQ'); const q=qEl.value.trim(); if(!q) return;
  aiSetBusy(true,'Формулируем ответ…');
  const aiBase = getAIBase();
  try {
    const r = await fetch(aiBase + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topicId: CURRENT.id,
        question: q,
        topicTitle: CURRENT.title,
        topicDesc: (CURRENT.description||'').replace(/<[^>]+>/g,'').slice(0,8000)
      })
    });
    const j = await r.json();
    if (j.answer) {
      const box=document.getElementById('aiAnswer'); const body=document.getElementById('aiAnswerBody');
      body.innerHTML=mdToHtml(String(j.answer).trim()); box.hidden=false;
      box.scrollIntoView({behavior:'smooth',block:'start'});
      aiSetBusy(false,'Готово'); qEl.value='';
      const fd=new FormData(); fd.append('action','addQA'); fd.append('topicId',CURRENT.id);
      fd.append('question',q); fd.append('answer',j.answer);
      try { await fetch(API,{method:'POST',body:fd}); } catch {}
      await loadQA(CURRENT.id);
    } else aiSetBusy(false,'Ошибка: '+(j.error||'сервер ИИ недоступен. Запустите node server.js'));
  } catch { aiSetBusy(false,'Ошибка сети. Убедитесь, что сервер запущен (node server.js).'); }
});

async function loadQA(id) {
  const box=document.getElementById('qaBox');
  box.innerHTML='<div class="empty">Загрузка…</div>';
  try {
    const d=await apiFetch(API+'?action=qa&topicId='+encodeURIComponent(id));
    const items=d.qa||[];
    box.innerHTML=items.length?'':'<div class="empty">Вопросов пока нет — задайте первый!</div>';
    items.forEach(r=>box.append(el('div',{class:'qa-item'},[el('div',{class:'qa-q'},['Q: ',r.q]),el('div',{class:'qa-a',html:mdToHtml(r.a)})])));
  } catch { box.innerHTML='<div class="empty" style="color:#b91c1c">Ошибка.</div>'; }
}

function showTab(tab) {
  ACTIVE_TAB = tab;
  ['video','cards','exam','selftest','examfull'].forEach(t => {
    const el = document.getElementById('tab-'+t);
    if (el) el.classList.toggle('active', t===tab);
  });
  ['block-video','block-desc','block-ai','block-social'].forEach(id => document.getElementById(id).hidden=(tab!=='video'));
  document.getElementById('block-cards').hidden = (tab!=='cards');
  document.getElementById('block-exam').hidden  = (tab!=='exam');
  document.getElementById('block-selftest').hidden = (tab!=='selftest');
  document.getElementById('block-examfull').hidden = (tab!=='examfull');
  document.getElementById('block-select-wrap').hidden = (tab==='examfull');
  if (tab==='cards' && CURRENT) ensureCards(CURRENT.id);
  if (tab==='exam'  && CURRENT) loadExamQ(CURRENT.id);
  if (tab==='selftest' && CURRENT) resetST();
  if (tab==='examfull') resetEF();
}
document.getElementById('tab-video').addEventListener('click', ()=>showTab('video'));
document.getElementById('tab-cards').addEventListener('click', ()=>showTab('cards'));
document.getElementById('tab-exam').addEventListener('click', ()=>showTab('exam'));
document.getElementById('tab-selftest').addEventListener('click', ()=>showTab('selftest'));
document.getElementById('tab-examfull').addEventListener('click', ()=>showTab('examfull'));
document.getElementById('videoTabGeneral').addEventListener('click', ()=>switchVideoTab('general'));
document.getElementById('videoTabPathogen').addEventListener('click', ()=>switchVideoTab('pathogen'));

(function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebarToggle');
  const overlay = document.getElementById('sidebarOverlay');
  const STORAGE_KEY = 'sidebarHidden';
  function isMobile() { return window.matchMedia('(max-width: 768px)').matches; }
  function getHidden() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v !== null) return v === '1';
      return isMobile();
    } catch { return isMobile(); }
  }
  function setHidden(v) { try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch {} }
  function apply() {
    const hidden = getHidden();
    const mobile = isMobile();
    sidebar.classList.toggle('sidebar-hidden', hidden && !mobile);
    sidebar.classList.toggle('sidebar-visible', !hidden && mobile);
    if (overlay) {
      overlay.classList.toggle('visible', mobile && !hidden);
      overlay.setAttribute('aria-hidden', (mobile && !hidden) ? 'false' : 'true');
    }
  }
  function toggleSidebar() {
    const mobile = isMobile();
    const hidden = getHidden();
    setHidden(mobile ? !hidden : !hidden);
    apply();
  }
  if (toggle) toggle.addEventListener('click', toggleSidebar);
  if (overlay) overlay.addEventListener('click', () => { if (isMobile()) { setHidden(true); apply(); } });
  sidebar.querySelectorAll('.sidebar-link, .sidebar-admin').forEach(el => {
    el.addEventListener('click', () => { if (isMobile()) { setHidden(true); apply(); } });
  });
  window.addEventListener('resize', apply);
  apply();
})();

function setFlipped(v) {
  flipped=v; CE.box.classList.toggle('flipped',v);
  if (v && CARDS.length) { opened.add(ORDER[ci]); if(opened.size===CARDS.length)CE.congrats.classList.add('show'); persistOpened(); }
}
function renderCard() {
  if (!CARDS.length) { CE.qTitle.textContent='Вопрос'; CE.qText.textContent='Нажмите «Сгенерировать карточки»'; CE.aText.textContent='—'; CE.counter.textContent='0/0'; CE.bar.style.width='0%'; return; }
  const it=CARDS[ORDER[ci]];
  CE.qTitle.textContent='Вопрос '+(ci+1); CE.qText.textContent=it.q; CE.aText.textContent=it.a;
  CE.counter.textContent=(ci+1)+'/'+CARDS.length; CE.bar.style.width=(((ci+1)/CARDS.length)*100)+'%';
}
function shuffleOrder() { ORDER=[...CARDS.keys()]; for(let j=ORDER.length-1;j>0;j--){const k=Math.floor(Math.random()*(j+1));[ORDER[j],ORDER[k]]=[ORDER[k],ORDER[j]];} ci=0; }
function cKey()  { return 'cards_'+(CURRENT?CURRENT.id:''); }
function oKey()  { return 'cards_o_'+(CURRENT?CURRENT.id:''); }
function persistCards()  { try{localStorage.setItem(cKey(),JSON.stringify(CARDS));}catch{} }
function persistOpened() { try{localStorage.setItem(oKey(),JSON.stringify([...opened]));}catch{} }
function tryLoadLocal() {
  try {
    const raw=localStorage.getItem(cKey()); if(!raw) return false;
    const arr=JSON.parse(raw); if(!Array.isArray(arr)||!arr.length) return false;
    CARDS=arr.map(x=>({q:String(x.q||''),a:String(x.a||'')}));
    const op=JSON.parse(localStorage.getItem(oKey())||'[]');
    opened.clear(); op.forEach(i=>opened.add(Number(i)));
    shuffleOrder(); setFlipped(false); renderCard(); if(opened.size===CARDS.length)CE.congrats.classList.add('show');
    return true;
  } catch { return false; }
}
async function generateCards(t) {
  t=t||CURRENT; if(!t) return;
  CE.status.textContent='Генерируем…'; document.getElementById('genCards').disabled=true; CE.overlay.classList.add('show');
  const prompt = ['Сгенерируй РОВНО 12 карточек «вопрос–ответ» по теме ниже.',
    'Формат: чистый JSON-массив [{"q":"Вопрос?","a":"Ответ."}]. Без Markdown, без пояснений. Язык — русский.',
    'Тема: '+t.title,'Описание: '+(t.description||'').slice(0,3000)].join('\n');
  const aiBase = getAIBase();
  try {
    const r = await fetch(aiBase + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topicId: t.id,
        question: prompt,
        topicTitle: t.title,
        topicDesc: (t.description||'').replace(/<[^>]+>/g,'').slice(0,4000),
        channel: 'cards'
      })
    });
    const j = await r.json();
    const raw = String(j.answer||'').trim();
    let arr=[]; const m=raw.match(/\[[\s\S]*\]/); if(m){try{arr=JSON.parse(m[0]);}catch{}}
    if(!arr.length){const pp=[...raw.matchAll(/"q"\s*:\s*"([^"]+)"\s*,\s*"a"\s*:\s*"([^"]+)"/g)].map(x=>({q:x[1],a:x[2]}));if(pp.length)arr=pp;}
    CARDS=arr.filter(x=>x&&x.q&&x.a).map(x=>({q:String(x.q),a:String(x.a)}));
    if(!CARDS.length) throw new Error('empty');
    opened.clear(); CE.congrats.classList.remove('show'); shuffleOrder(); setFlipped(false); renderCard();
    CE.status.textContent='Сгенерировано '+CARDS.length+' карточек'; persistCards(); persistOpened();
  } catch { CE.status.textContent='Ошибка генерации. Запустите node server.js и попробуйте снова.'; }
  finally { document.getElementById('genCards').disabled=false; CE.overlay.classList.remove('show'); }
}
function ensureCards(id) { if(cardsFor===id)return; cardsFor=id; if(!tryLoadLocal()){CARDS=[];renderCard();} }
CE.box.addEventListener('click', ()=>setFlipped(!flipped));
document.getElementById('prevCard').addEventListener('click', ()=>{if(!CARDS.length)return;ci=(ci-1+CARDS.length)%CARDS.length;setFlipped(false);renderCard();});
document.getElementById('nextCard').addEventListener('click', ()=>{if(!CARDS.length)return;ci=(ci+1)%CARDS.length;setFlipped(false);renderCard();});
document.getElementById('genCards').addEventListener('click', ()=>generateCards(CURRENT));
document.addEventListener('keydown', e=>{
  if(document.getElementById('block-cards').hidden) return;
  if(e.key===' '){e.preventDefault();setFlipped(!flipped);}
  if(e.key==='ArrowRight'){if(!CARDS.length)return;ci=(ci+1)%CARDS.length;setFlipped(false);renderCard();}
  if(e.key==='ArrowLeft'){if(!CARDS.length)return;ci=(ci-1+CARDS.length)%CARDS.length;setFlipped(false);renderCard();}
});

async function loadExamQ(id) {
  const box=document.getElementById('examList');
  box.innerHTML='<div class="empty">Загрузка…</div>';
  try {
    const d=await apiFetch(API+'?action=examQuestions&topicId='+encodeURIComponent(id));
    const list=d.questions||[];
    EQ_CACHE[id]=list;
    if(!list.length){box.innerHTML='<div class="empty" style="padding:1.5rem;text-align:center">Вопросы не добавлены.</div>';return;}
    box.innerHTML='';
    list.forEach((item,i)=>box.append(el('div',{class:'exam-item'},[el('span',{class:'exam-num'},[String(i+1)]),el('p',{class:'exam-q'},[item.q])])));
  } catch { box.innerHTML='<div class="empty" style="color:#b91c1c">Ошибка загрузки.</div>'; }
}

function stShow(panel) {
  ['st-idle','st-answering','st-grading','st-results'].forEach(id=>{
    document.getElementById(id).style.display = id===panel?'':'none';
  });
}
function resetST() { stShow('st-idle'); document.getElementById('stIdleStatus').textContent=''; }
function shuffle(arr) { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

document.getElementById('startST').addEventListener('click', async () => {
  if (!CURRENT) return;
  let qs = EQ_CACHE[CURRENT.id];
  if (!qs) {
    document.getElementById('stIdleStatus').textContent = 'Загружаем вопросы…';
    try { const d=await apiFetch(API+'?action=examQuestions&topicId='+encodeURIComponent(CURRENT.id)); qs=d.questions||[]; EQ_CACHE[CURRENT.id]=qs; }
    catch { document.getElementById('stIdleStatus').textContent='Ошибка загрузки вопросов.'; return; }
  }
  if (!qs.length) { document.getElementById('stIdleStatus').textContent='По этой теме нет экзаменационных вопросов.'; return; }
  const picked = shuffle(qs).slice(0,4);
  ST = { questions:picked, answers:new Array(picked.length).fill(''), step:0 };
  showSTQuestion(0);
});

function showSTQuestion(step) {
  stShow('st-answering');
  const total=ST.questions.length;
  document.getElementById('stProgress').textContent = 'Вопрос '+(step+1)+' из '+total;
  document.getElementById('stQ').textContent = ST.questions[step].q;
  document.getElementById('stA').value = ST.answers[step]||'';
  document.getElementById('stA').focus();
  document.getElementById('stNext').textContent = step<total-1 ? 'Следующий вопрос →' : 'Отправить на проверку ✓';
}

document.getElementById('stNext').addEventListener('click', async () => {
  ST.answers[ST.step] = document.getElementById('stA').value.trim();
  if (ST.step < ST.questions.length-1) { ST.step++; showSTQuestion(ST.step); }
  else await submitST();
});
document.getElementById('stSkip').addEventListener('click', async () => {
  ST.answers[ST.step]='';
  if (ST.step < ST.questions.length-1) { ST.step++; showSTQuestion(ST.step); }
  else await submitST();
});

async function submitST() {
  stShow('st-grading');
  const answers = ST.questions.map((q,i)=>({question:q.q, answer:ST.answers[i]||''}));
  let sid = localStorage.getItem('sid');
  if (!sid) { sid=uid(); localStorage.setItem('sid',sid); }
  const aiBase = getAIBase();
  try {
    const r = await fetch(aiBase + '/api/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topicId: CURRENT.id,
        topicTitle: CURRENT.title,
        topicDesc: (CURRENT.description||'').replace(/<[^>]+>/g,'').slice(0,4000),
        studentId: sid,
        answers
      })
    });
    const j = await r.json();
    if (j.ok) showSTResults(j.grades, j.avgGrade, answers);
    else { stShow('st-idle'); document.getElementById('stIdleStatus').textContent='Ошибка: '+(j.error||'запустите node server.js'); }
  } catch { stShow('st-idle'); document.getElementById('stIdleStatus').textContent='Ошибка сети. Запустите node server.js.'; }
}

function showSTResults(grades, avgGrade, answers) {
  stShow('st-results');
  const avg=Number(avgGrade)||0;
  const emoji = avg>=4.5?'🌟':avg>=3.5?'👍':avg>=2.5?'📚':'😢';
  const label  = avg>=4.5?'Отлично!':avg>=3.5?'Хорошо':avg>=2.5?'Удовлетворительно':'Требует доработки';
  document.getElementById('stAvg').innerHTML =
    `<div class="avg-box"><div class="big">${emoji} ${avg}</div><div class="lbl">Средняя оценка · ${label}</div></div>`;
  const box=document.getElementById('stResultList'); box.innerHTML='';
  (grades||[]).forEach((g,i)=>{
    const grade=Math.min(5,Math.max(1,Math.round(Number(g.grade)||0)));
    const div=document.createElement('div'); div.className='result-item g'+grade;
    div.innerHTML=`<div class="grade-badge">${grade}</div>
      <p class="result-q">${esc(answers[i].question)}</p>
      <p class="result-ans">Ваш ответ: «${esc(answers[i].answer||'(пусто)')}»</p>
      <p class="result-comment">${esc(g.comment||'')}`;
    box.append(div);
  });
}
document.getElementById('stRetry').addEventListener('click', ()=>resetST());

function efShow(panel) {
  ['ef-idle','ef-answering','ef-grading','ef-results'].forEach(id=>{
    document.getElementById(id).style.display = id===panel?'':'none';
  });
}
function resetEF() { efShow('ef-idle'); document.getElementById('efIdleStatus').textContent=''; }

document.getElementById('startEF').addEventListener('click', async () => {
  if (!USER_PREFS) return;
  document.getElementById('efIdleStatus').textContent = 'Загружаем вопросы…';
  try {
    const url = API + '?action=examQuestionsAll&course=' + encodeURIComponent(USER_PREFS.course) + '&faculty=' + encodeURIComponent(USER_PREFS.faculty);
    const d = await apiFetch(url);
    let qs = d.questions || [];
    if (!qs.length) { document.getElementById('efIdleStatus').textContent='Нет экзаменационных вопросов по вашему курсу.'; return; }
    const shuffled = shuffle(qs);
    const picked = [];
    const usedTopics = new Set();
    for (const q of shuffled) {
      if (picked.length >= 4) break;
      if (!usedTopics.has(q.topicId)) { picked.push(q); usedTopics.add(q.topicId); }
    }
    if (picked.length < 4) {
      for (const q of shuffled) {
        if (picked.length >= 4) break;
        if (!picked.includes(q)) picked.push(q);
      }
    }
    EF = { questions: picked.slice(0,4), answers: new Array(Math.min(4,picked.length)).fill(''), step:0 };
    document.getElementById('efIdleStatus').textContent = '';
    showEFQuestion(0);
  } catch { document.getElementById('efIdleStatus').textContent='Ошибка загрузки вопросов.'; return; }
});

function showEFQuestion(step) {
  efShow('ef-answering');
  const total = EF.questions.length;
  document.getElementById('efProgress').textContent = 'Вопрос '+(step+1)+' из '+total;
  document.getElementById('efQ').textContent = EF.questions[step].q;
  document.getElementById('efTopic').textContent = 'Тема: ' + (EF.questions[step].topicTitle||'—');
  document.getElementById('efA').value = EF.answers[step]||'';
  document.getElementById('efA').focus();
  document.getElementById('efNext').textContent = step<total-1 ? 'Следующий →' : 'Отправить на проверку ✓';
}

document.getElementById('efNext').addEventListener('click', async () => {
  EF.answers[EF.step] = document.getElementById('efA').value.trim();
  if (EF.step < EF.questions.length-1) { EF.step++; showEFQuestion(EF.step); }
  else await submitEF();
});
document.getElementById('efSkip').addEventListener('click', async () => {
  EF.answers[EF.step]='';
  if (EF.step < EF.questions.length-1) { EF.step++; showEFQuestion(EF.step); }
  else await submitEF();
});

async function submitEF() {
  efShow('ef-grading');
  const answers = EF.questions.map((q,i)=>({
    question: q.q,
    answer: EF.answers[i]||'',
    topicTitle: q.topicTitle,
    topicDesc: q.topicDesc
  }));
  let sid = localStorage.getItem('sid');
  if (!sid) { sid=uid(); localStorage.setItem('sid',sid); }
  const aiBase = getAIBase();
  try {
    const r = await fetch(aiBase + '/api/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: sid, answers })
    });
    const j = await r.json();
    if (j.ok) showEFResults(j.grades, j.avgGrade, answers);
    else { efShow('ef-idle'); document.getElementById('efIdleStatus').textContent='Ошибка: '+(j.error||'запустите node server.js'); }
  } catch { efShow('ef-idle'); document.getElementById('efIdleStatus').textContent='Ошибка сети. Запустите node server.js.'; }
}

function showEFResults(grades, avgGrade, answers) {
  efShow('ef-results');
  const avg=Number(avgGrade)||0;
  const emoji = avg>=4.5?'🌟':avg>=3.5?'👍':avg>=2.5?'📚':'😢';
  const label  = avg>=4.5?'Отлично!':avg>=3.5?'Хорошо':avg>=2.5?'Удовлетворительно':'Требует доработки';
  document.getElementById('efAvg').innerHTML =
    `<div class="avg-box"><div class="big">${emoji} ${avg}</div><div class="lbl">Средняя оценка · ${label}</div></div>`;
  const box=document.getElementById('efResultList'); box.innerHTML='';
  (grades||[]).forEach((g,i)=>{
    const grade=Math.min(5,Math.max(1,Math.round(Number(g.grade)||0)));
    const div=document.createElement('div'); div.className='result-item g'+grade;
    const topicLabel = answers[i].topicTitle ? ` <span class="form-hint">(${esc(answers[i].topicTitle)})</span>` : '';
    div.innerHTML=`<div class="grade-badge">${grade}</div>
      <p class="result-q">${esc(answers[i].question)}${topicLabel}</p>
      <p class="result-ans">Ваш ответ: «${esc(answers[i].answer||'(пусто)')}»</p>
      <p class="result-comment">${esc(g.comment||'')}`;
    box.append(div);
  });
}
document.getElementById('efRetry').addEventListener('click', ()=>resetEF());

let ACTIVE_VIDEO_TAB = 'general';

function switchVideoTab(tab) {
  ACTIVE_VIDEO_TAB = tab;
  document.querySelectorAll('.video-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.video === tab);
  });
  if (!CURRENT) return;
  const embed = tab === 'pathogen' ? (CURRENT.embedPathogen || null) : (CURRENT.embed || null);
  renderPlayer(embed);
}

async function selectTopic(id) {
  const t=TOPICS.find(x=>String(x.id)===String(id)); if(!t) return;
  closeTopicMenu();
  const sel = document.getElementById('topicSelect');
  if (sel && String(sel.value) !== String(id)) {
    sel.value = String(id);
    renderTopicSelectUI();
  }
  CURRENT=t;
  document.getElementById('topicTitle').textContent=t.title;
  const hasGeneral = !!(t.embed && t.embed.src);
  const hasPathogen = !!(t.embedPathogen && t.embedPathogen.src);
  const tabGeneral = document.getElementById('videoTabGeneral');
  const tabPathogen = document.getElementById('videoTabPathogen');
  const tabsWrap = document.querySelector('.video-tabs');
  const showTabs = hasGeneral && hasPathogen;
  tabsWrap.hidden = !showTabs;
  if (showTabs) {
    ACTIVE_VIDEO_TAB = 'general';
    tabGeneral.classList.add('active');
    tabPathogen.classList.remove('active');
    renderPlayer(t.embed);
  } else if (hasPathogen) {
    renderPlayer(t.embedPathogen);
  } else {
    renderPlayer(t.embed);
  }
  document.getElementById('block-video').hidden=false;
  document.getElementById('desc').innerHTML=mdToHtml(t.description||'');
  document.getElementById('block-desc').hidden=false;
  document.getElementById('aiAnswer').hidden=true;
  document.getElementById('aiStatus').textContent='';
  document.getElementById('block-ai').hidden=false;
  document.getElementById('block-social').hidden=false;
  await loadComments(id);
  await refreshLikes(id);
  setLikeDone(!!localStorage.getItem('liked_'+id));
  await loadQA(id);
  history.replaceState(null,'','#topic='+encodeURIComponent(id));
  cardsFor=null; CARDS=[]; ci=0; setFlipped(false); opened.clear(); CE.congrats.classList.remove('show'); renderCard();
  if(ACTIVE_TAB==='cards')  ensureCards(id);
  if(ACTIVE_TAB==='exam')   loadExamQ(id);
  if(ACTIVE_TAB==='selftest') resetST();
}

async function boot() {
  USER_PREFS=loadPrefs();
  if (!USER_PREFS) {
    hideSplash(200);
    const ob = document.getElementById('onboarding');
    if (ob) ob.classList.remove('hidden');
    return;
  }
  renderHeaderMeta();
  try {
    await loadTopics();
  } catch(e) {
    console.error('loadTopics:', e);
    const sel = document.getElementById('block-select');
    if (sel) sel.innerHTML = '<div class="empty" style="color:#DC2626;font-weight:600">Не удалось загрузить темы. Проверьте интернет и обновите страницу.</div>';
  }
  hideSplash();
}

showTab('video');
boot();
})();
