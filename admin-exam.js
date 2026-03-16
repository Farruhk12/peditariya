/* Админ: добавление экзаменационных вопросов */
(function() {
'use strict';

const API = (window.CONFIG && window.CONFIG.GAS_API) || '';
let ADMIN_PASS = '';
let TOPICS = [];
let ADMIN_PARSED_Q = [];

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (v != null) node.setAttribute(k, v);
  });
  [].concat(children || []).filter(Boolean).forEach(c => node.append(c));
  return node;
}
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function parseExamList(text) {
  if (!text) return [];
  const raw = text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const items = [];

  // Формат @5Вопрос (каждая строка — отдельный вопрос)
  const at5Lines = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('@5'));
  if (at5Lines.length) {
    at5Lines.forEach(l => {
      const q = l.slice(2).trim(); // убираем @5
      if (q.length > 0) items.push(q);
    });
    return items;
  }

  // Формат 1. Вопрос или 1) Вопрос
  const blocks = raw.split(/\n\s*(?=\d+[.)]\s)/m).filter(b => b.trim());
  for (const block of blocks) {
    const first = block.split('\n')[0].trim();
    const m = first.match(/^(\d+)[.)]\s*(.+)$/);
    let q = m ? m[2].trim() : first;
    const rest = block.split('\n').slice(1).map(l => l.trim()).filter(Boolean).join(' ');
    if (rest) q = (q || first) + ' ' + rest;
    if (q && q.length > 2) items.push(q);
  }
  if (!items.length) {
    raw.split(/\n\s*\n/).forEach(p => {
      const q = p.trim().replace(/\n/g, ' ');
      if (q.length > 5) items.push(q);
    });
  }
  return items;
}

async function loadTopics() {
  try {
    const course = document.getElementById('adminExamCourse').value;
    const faculty = document.getElementById('adminExamFaculty').value;
    let url = API + '?action=topics';
    if (course) url += '&course=' + encodeURIComponent(course);
    if (faculty) url += '&faculty=' + encodeURIComponent(faculty);
    const d = await fetch(url).then(r => r.json());
    TOPICS = d.topics || [];
    const sel = document.getElementById('adminExamTopic');
    sel.innerHTML = '<option value="">— Выберите тему —</option>';
    TOPICS.forEach(t => sel.append(el('option', { value: t.id }, [t.title])));
    document.getElementById('adminExamSaveBtn').disabled = true;
  } catch (e) { console.error(e); }
}

document.getElementById('adminLoginBtn').addEventListener('click', () => {
  const pwd = document.getElementById('adminPwd').value.trim();
  if (!pwd) return;
  ADMIN_PASS = pwd;
  document.getElementById('admin-login').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'block';
  document.getElementById('adminLoginStatus').textContent = '';
  loadTopics();
});

document.getElementById('adminExamCourse').addEventListener('change', loadTopics);
document.getElementById('adminExamFaculty').addEventListener('change', loadTopics);

document.getElementById('adminExamParseBtn').addEventListener('click', () => {
  const text = document.getElementById('adminExamText').value.trim();
  const st = document.getElementById('adminExamStatus');
  const prev = document.getElementById('adminExamPreview');
  ADMIN_PARSED_Q = parseExamList(text);
  if (!ADMIN_PARSED_Q.length) {
    st.textContent = 'Не удалось распознать вопросы. Формат: «@5Вопрос» (каждая строка) или «1. Вопрос».';
    prev.style.display = 'none';
    document.getElementById('adminExamSaveBtn').disabled = true;
    return;
  }
  st.textContent = 'Распознано ' + ADMIN_PARSED_Q.length + ' вопросов.';
  prev.style.display = 'block';
  prev.innerHTML = ADMIN_PARSED_Q.slice(0, 8).map((q, i) =>
    `<div style="padding:8px 12px;margin:4px 0;background:#fff;border-radius:8px;border:1px solid var(--line);font-size:14px"><strong>${i + 1}.</strong> ${esc(q)}</div>`
  ).join('') + (ADMIN_PARSED_Q.length > 8 ? `<div class="status" style="margin-top:8px">…и ещё ${ADMIN_PARSED_Q.length - 8}</div>` : '');
  document.getElementById('adminExamSaveBtn').disabled = !document.getElementById('adminExamTopic').value;
});

document.getElementById('adminExamSaveBtn').addEventListener('click', async () => {
  const topicId = document.getElementById('adminExamTopic').value.trim();
  if (!topicId || !ADMIN_PARSED_Q.length) return;
  const t = TOPICS.find(x => String(x.id) === String(topicId));
  const st = document.getElementById('adminExamStatus');
  st.textContent = 'Сохраняем на сервер…';
  const params = new URLSearchParams();
  params.append('action', 'saveExamQuestions');
  params.append('adminPassword', ADMIN_PASS);
  params.append('topicId', topicId);
  params.append('topicTitle', t ? t.title : '');
  params.append('questions', JSON.stringify(ADMIN_PARSED_Q));
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const j = await r.json();
    st.textContent = j.ok ? `Сохранено ${j.saved} вопросов ✔` : 'Ошибка: ' + (j.error || 'неверный пароль');
    if (j.ok) document.getElementById('adminExamText').value = '';
  } catch { st.textContent = 'Ошибка сети'; }
});

document.getElementById('adminExamTopic').addEventListener('change', () => {
  document.getElementById('adminExamSaveBtn').disabled = !document.getElementById('adminExamTopic').value || !ADMIN_PARSED_Q.length;
});

loadTopics();
})();
