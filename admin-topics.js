/* Админ: добавление и редактирование тем */
(function() {
'use strict';

const API = (window.CONFIG && window.CONFIG.GAS_API) || '';
let ADMIN_PASS = '';
let TOPICS = [];

async function loadTopics() {
  try {
    const d = await fetch(API + '?action=topics').then(r => r.json());
    TOPICS = d.topics || [];
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

document.getElementById('adminLoadBtn').addEventListener('click', async () => {
  const id = document.getElementById('adminTopicId').value.trim();
  const st = document.getElementById('adminTopicStatus');
  if (!id) { st.textContent = 'Введите ID темы'; return; }
  if (!TOPICS.length) await loadTopics();
  const t = TOPICS.find(x => String(x.id) === String(id));
  if (!t) { st.textContent = 'Тема не найдена'; return; }
  document.getElementById('adminTitle').value = t.title;
  document.getElementById('adminDesc').value = t.description || '';
  document.getElementById('adminVideo').value = t.link || '';
  document.getElementById('adminVideoPathogen').value = t.linkPathogen || '';
  document.getElementById('adminCourse').value = t.course || '';
  document.getElementById('adminFaculty').value = t.faculty || '';
  st.textContent = 'Данные загружены. Отредактируйте и нажмите «Сохранить тему».';
});

document.getElementById('adminSaveTopicBtn').addEventListener('click', async () => {
  const st = document.getElementById('adminTopicStatus');
  const id = document.getElementById('adminTopicId').value.trim();
  const title = document.getElementById('adminTitle').value.trim();
  if (!title) { st.textContent = 'Введите название темы'; return; }
  st.textContent = 'Сохраняем…';
  const params = new URLSearchParams();
  params.append('action', id ? 'updateTopic' : 'addTopic');
  params.append('adminPassword', ADMIN_PASS);
  if (id) params.append('topicId', id);
  params.append('title', title);
  params.append('description', document.getElementById('adminDesc').value);
  params.append('videoLink', document.getElementById('adminVideo').value.trim());
  params.append('videoLinkPathogen', document.getElementById('adminVideoPathogen').value.trim());
  params.append('course', document.getElementById('adminCourse').value);
  params.append('faculty', document.getElementById('adminFaculty').value);
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const j = await r.json();
    st.textContent = j.ok ? (id ? 'Тема обновлена ✔' : 'Тема добавлена ✔ (ID: ' + j.topicId + ')') : 'Ошибка: ' + (j.error || 'неверный пароль');
    if (j.ok && !id) document.getElementById('adminTopicId').value = j.topicId;
    if (j.ok) loadTopics();
  } catch { st.textContent = 'Ошибка сети'; }
});

loadTopics();
})();
