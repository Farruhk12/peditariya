/* Образовательная платформа КДБ №1 — основное приложение */
(function() {
'use strict';

window.__t0 = performance.now();
const API = (window.CONFIG && window.CONFIG.GAS_API) || '';
const USE_API = typeof location !== 'undefined' && location.origin && location.origin.startsWith('http');

async function aiPost(action, body) {
  if (USE_API) {
    const path = action === 'aiChat' ? '/api/chat' : '/api/grade';
    const reqBody = action === 'aiChat' ? { topicId: body.topicId, question: body.question, topicTitle: body.topicTitle, topicDesc: body.topicDesc, channel: body.channel } : body;
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) });
    return r.json();
  }
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body })
  }).then(r => r.json());
}

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
const FETCH_TIMEOUT = 12000;
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
setTimeout(() => hideSplash(0), 6000);

let TOPICS = [];
let CURRENT = null;
let ACTIVE_TAB = 'desc';
let USER_PREFS = null;
let EQ_CACHE = {};
let CARDS=[], ORDER=[], ci=0, flipped=false;
const opened=new Set();
let cardsFor=null;
let ST = { questions:[], answers:[], step:0 };
let EF = { questions:[], answers:[], step:0 };

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

function updateTopicsUI() {
  if (!USER_PREFS) return;
  const facLabel = USER_PREFS.faculty === 'Педиатрический' ? 'Педиатрический факультет' : 'Лечебный факультет';
  const sub = document.getElementById('topicsSubtitle');
  if (sub) sub.textContent = USER_PREFS.course + ' курс · ' + facLabel;
  const fac = document.getElementById('sidebarFaculty');
  if (fac) fac.textContent = facLabel;
}

function renderHeaderMeta() {
  const wrap = document.getElementById('headerMeta');
  wrap.innerHTML = '';
  const changeBtn = document.getElementById('changePrefsBtn');
  if (!USER_PREFS) {
    if (changeBtn) changeBtn.style.display = 'none';
    return;
  }
  wrap.append(
    el('span', {class:'meta-badge'}, [USER_PREFS.course+' курс']),
    el('span', {class:'meta-badge'}, [USER_PREFS.faculty])
  );
  if (changeBtn) changeBtn.style.display = '';
  updateTopicsUI();
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

// ─── View management ───

function switchView(view) {
  ['topics', 'detail', 'exam'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.hidden = (v !== view);
  });
  document.getElementById('nav-home').classList.toggle('active', view === 'topics');
  document.getElementById('nav-exam').classList.toggle('active', view === 'exam');
}

document.getElementById('nav-home').addEventListener('click', () => switchView('topics'));
document.getElementById('nav-exam').addEventListener('click', () => { switchView('exam'); resetEF(); });
document.getElementById('backBtn').addEventListener('click', () => switchView('topics'));

document.getElementById('changePrefsBtn').addEventListener('click', () => {
  document.getElementById('onboarding').classList.remove('hidden');
});

// ─── Topic List ───

function buildTopicList(topics) {
  const list = document.getElementById('topicList');
  list.innerHTML = '';
  if (!topics.length) {
    list.innerHTML = '<div class="empty" style="padding:1rem 0">По вашему курсу и факультету пока нет тем.</div>';
    return;
  }
  topics.forEach((t, i) => {
    const hasVideo   = !!(t.embed && t.embed.src);
    const hasPathogen = !!(t.embedPathogen && t.embedPathogen.src);
    const tags = [];
    if (hasVideo)    tags.push('<span class="topic-tag topic-tag-video">Видео</span>');
    if (hasPathogen) tags.push('<span class="topic-tag topic-tag-pathogen">Патогенез</span>');

    const card = el('div', {class: 'topic-card', 'data-id': String(t.id)});
    card.innerHTML =
      '<span class="topic-num">' + (i + 1) + '</span>' +
      '<div class="topic-card-content">' +
        '<div class="topic-card-title">' + esc(t.title) + '</div>' +
        (tags.length ? '<div class="topic-card-tags">' + tags.join('') + '</div>' : '') +
      '</div>' +
      '<svg class="topic-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

    card.addEventListener('click', () => selectTopic(t.id));
    list.append(card);
  });
}

document.getElementById('topicSearch').addEventListener('input', function() {
  const q = this.value.toLowerCase().trim();
  document.querySelectorAll('.topic-card').forEach(card => {
    const id = card.dataset.id;
    const t = TOPICS.find(x => String(x.id) === id);
    card.hidden = !!(q && t && !t.title.toLowerCase().includes(q));
  });
});

async function loadTopics() {
  if (!USER_PREFS) return;
  const url = API + '?action=topics&course=' + encodeURIComponent(USER_PREFS.course) + '&faculty=' + encodeURIComponent(USER_PREFS.faculty);
  try {
    const data = await apiFetch(url);
    TOPICS = data.topics || [];
    if (!TOPICS.length) {
      document.getElementById('topicList').innerHTML = '<div class="empty" style="padding:1rem 0">По вашему курсу и факультету пока нет тем.</div>';
      return;
    }
    buildTopicList(TOPICS);
    const m = location.hash.match(/topic=([^&]+)/);
    if (m) {
      const initId = decodeURIComponent(m[1]);
      await selectTopic(initId);
    }
  } catch(err) {
    console.error(err);
    document.getElementById('topicList').innerHTML = '<div class="empty" style="color:#ef4444;font-weight:600;padding:1rem 0">Не удалось загрузить темы. Проверьте интернет.</div>';
  }
}

// ─── Content Tabs ───

function showTab(tab) {
  ACTIVE_TAB = tab;
  document.querySelectorAll('.ctab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ctab === tab);
  });
  const contentBlocks = ['desc', 'ai', 'cards', 'exam', 'selftest', 'social'];
  contentBlocks.forEach(t => {
    const el = document.getElementById('block-' + t);
    if (el) el.hidden = (t !== tab);
  });
  if (tab === 'cards'    && CURRENT) ensureCards(CURRENT.id);
  if (tab === 'exam'     && CURRENT) loadExamQ(CURRENT.id);
  if (tab === 'selftest' && CURRENT) resetST();
}

document.querySelectorAll('.ctab').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.ctab));
});

// ─── Sidebar toggle ───

(function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const toggle  = document.getElementById('sidebarToggle');
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
    setHidden(!getHidden());
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

// ─── Video player ───

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

document.getElementById('videoTabGeneral').addEventListener('click', ()=>switchVideoTab('general'));
document.getElementById('videoTabPathogen').addEventListener('click', ()=>switchVideoTab('pathogen'));

// ─── Comments & Likes ───

async function loadComments(id) {
  const box = document.getElementById('comments');
  box.innerHTML = '<div class="empty">Загрузка…</div>';
  try {
    const d = await apiFetch(API+'?action=comments&topicId='+encodeURIComponent(id));
    box.innerHTML = '';
    if (!(d.comments||[]).length) { box.innerHTML='<div class="empty">Комментариев пока нет.</div>'; return; }
    (d.comments||[]).forEach(c => box.append(el('div',{class:'comment'},[el('div',{},[c.text]),el('small',{},[`${c.name||'Студент'} · ${fmtDt(c.ts)}`])])));
  } catch { box.innerHTML='<div class="empty" style="color:#ef4444">Ошибка загрузки.</div>'; }
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

// ─── AI Chat ───

function aiSetBusy(busy, msg) {
  const btn=document.getElementById('askBtn'); btn.disabled=!!busy; btn.classList.toggle('off',!!busy);
  document.getElementById('aiStatus').textContent=msg||(busy?'Готовим ответ…':'');
}

document.getElementById('aiForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!CURRENT) return;
  const qEl=document.getElementById('aiQ'); const q=qEl.value.trim(); if(!q) return;
  aiSetBusy(true,'Формулируем ответ…');
  try {
    const j = await aiPost('aiChat', {
      topicId: CURRENT.id,
      question: q,
      topicTitle: CURRENT.title,
      topicDesc: (CURRENT.description||'').replace(/<[^>]+>/g,'').slice(0,8000)
    });
    if (j.answer) {
      const box=document.getElementById('aiAnswer'); const body=document.getElementById('aiAnswerBody');
      body.innerHTML=mdToHtml(String(j.answer).trim()); box.hidden=false;
      box.scrollIntoView({behavior:'smooth',block:'start'});
      aiSetBusy(false,'Готово'); qEl.value='';
      const fd=new FormData(); fd.append('action','addQA'); fd.append('topicId',CURRENT.id);
      fd.append('question',q); fd.append('answer',j.answer);
      try { await fetch(API,{method:'POST',body:fd}); } catch {}
      await loadQA(CURRENT.id);
    } else aiSetBusy(false,'Ошибка: '+(j.error||'ИИ недоступен'));
  } catch { aiSetBusy(false,'Ошибка сети. Проверьте GEMINI_API_KEY в Google Apps Script.'); }
});

async function loadQA(id) {
  const box=document.getElementById('qaBox');
  box.innerHTML='<div class="empty">Загрузка…</div>';
  try {
    const d=await apiFetch(API+'?action=qa&topicId='+encodeURIComponent(id));
    const items=d.qa||[];
    box.innerHTML=items.length?'':'<div class="empty">Вопросов пока нет — задайте первый!</div>';
    items.forEach(r=>box.append(el('div',{class:'qa-item'},[el('div',{class:'qa-q'},['Q: ',r.q]),el('div',{class:'qa-a',html:mdToHtml(r.a)})])));
  } catch { box.innerHTML='<div class="empty" style="color:#ef4444">Ошибка.</div>'; }
}

// ─── Flashcards ───

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
  try {
    const j = await aiPost('aiChat', {
      topicId: t.id,
      question: prompt,
      topicTitle: t.title,
      topicDesc: (t.description||'').replace(/<[^>]+>/g,'').slice(0,4000),
      channel: 'cards'
    });
    if (j.error) throw new Error(j.error);
    const raw = String(j.answer||'').trim();
    let arr = [];
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const str = (jsonMatch[1] || jsonMatch[0]).trim();
      try { arr = JSON.parse(str); } catch { arr = JSON.parse(jsonMatch[0] || '[]'); }
    }
    if (!arr.length) {
      const pp = [...raw.matchAll(/"q"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"a"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(x => ({ q: x[1].replace(/\\"/g, '"'), a: x[2].replace(/\\"/g, '"') }));
      if (pp.length) arr = pp;
    }
    CARDS = (Array.isArray(arr) ? arr : []).filter(x => x && (x.q || x.question) && (x.a || x.answer)).map(x => ({ q: String(x.q || x.question || ''), a: String(x.a || x.answer || '') }));
    if (!CARDS.length) throw new Error('ИИ не вернул карточки. Попробуйте ещё раз.');
    opened.clear(); CE.congrats.classList.remove('show'); shuffleOrder(); setFlipped(false); renderCard();
    CE.status.textContent='Сгенерировано '+CARDS.length+' карточек'; persistCards(); persistOpened();
  } catch (e) { CE.status.textContent='Ошибка: ' + (e && e.message ? e.message : 'нет ключа. Добавьте GEMINI_API_KEY в config.js'); }
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

// ─── Exam Questions ───

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
  } catch { box.innerHTML='<div class="empty" style="color:#ef4444">Ошибка загрузки.</div>'; }
}

// ─── Self-test ───

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
  try {
    const j = await aiPost('aiGrade', {
      topicId: CURRENT.id,
      topicTitle: CURRENT.title,
      topicDesc: (CURRENT.description||'').replace(/<[^>]+>/g,'').slice(0,4000),
      studentId: sid,
      answers
    });
    if (j.ok) showSTResults(j.grades, j.avgGrade, answers);
    else { stShow('st-idle'); document.getElementById('stIdleStatus').textContent='Ошибка: '+(j.error||''); }
  } catch { stShow('st-idle'); document.getElementById('stIdleStatus').textContent='Ошибка сети.'; }
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

// ─── Full Exam ───

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
  try {
    const j = await aiPost('aiGrade', { studentId: sid, answers });
    if (j.ok) showEFResults(j.grades, j.avgGrade, answers);
    else { efShow('ef-idle'); document.getElementById('efIdleStatus').textContent='Ошибка: '+(j.error||''); }
  } catch { efShow('ef-idle'); document.getElementById('efIdleStatus').textContent='Ошибка сети.'; }
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

// ─── Select Topic ───

async function selectTopic(id) {
  const t = TOPICS.find(x => String(x.id) === String(id));
  if (!t) return;
  CURRENT = t;

  // Switch to detail view
  switchView('detail');

  // Set title
  document.getElementById('topicTitle').textContent = t.title;

  // Video tabs
  const hasGeneral  = !!(t.embed && t.embed.src);
  const hasPathogen = !!(t.embedPathogen && t.embedPathogen.src);
  const tabGeneral  = document.getElementById('videoTabGeneral');
  const tabPathogen = document.getElementById('videoTabPathogen');
  const tabsWrap    = document.querySelector('.video-tabs');
  const showTabs    = hasGeneral && hasPathogen;
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

  // Reset content tabs to description
  showTab('desc');

  // Load content
  document.getElementById('desc').innerHTML = mdToHtml(t.description||'');
  document.getElementById('aiAnswer').hidden = true;
  document.getElementById('aiStatus').textContent = '';

  await loadComments(id);
  await refreshLikes(id);
  setLikeDone(!!localStorage.getItem('liked_'+id));
  await loadQA(id);

  history.replaceState(null, '', '#topic='+encodeURIComponent(id));
  cardsFor=null; CARDS=[]; ci=0; setFlipped(false); opened.clear();
  CE.congrats.classList.remove('show'); renderCard();
}

// ─── Boot ───

async function boot() {
  USER_PREFS = loadPrefs();
  if (!USER_PREFS) {
    hideSplash(200);
    const ob = document.getElementById('onboarding');
    if (ob) ob.classList.remove('hidden');
    return;
  }
  renderHeaderMeta();
  switchView('topics');
  try {
    await loadTopics();
  } catch(e) {
    console.error('loadTopics:', e);
    document.getElementById('topicList').innerHTML = '<div class="empty" style="color:#ef4444;font-weight:600;padding:1rem 0">Не удалось загрузить темы. Проверьте интернет и обновите страницу.</div>';
  }
  hideSplash();
}

showTab('desc');
boot();
})();
