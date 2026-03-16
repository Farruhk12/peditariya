/**
 * Локальный сервер с ИИ-обработкой (Google Gemini)
 * Запуск: node server.js
 * Требуется: GEMINI_API_KEY в .env (ключ из Google AI Studio)
 *
 * Запуск: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY || (() => {
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = env.match(/GEMINI_API_KEY=(.+)/);
    return m ? m[1].trim() : '';
  } catch { return ''; }
})();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

async function callAI(systemPrompt, userPrompt, maxTokens = 700, temp = 0.2) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY не задан. Создайте .env с GEMINI_API_KEY=...');
  const fullPrompt = systemPrompt + '\n\n' + userPrompt;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: temp,
        maxOutputTokens: maxTokens,
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Gemini HTTP ' + res.status + ': ' + text.slice(0, 200));
  const j = JSON.parse(text);
  const part = j.candidates?.[0]?.content?.parts?.[0];
  return String(part?.text || '').trim();
}

const server = http.createServer(async (req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const [pathname, query] = url.split('?');

  if (req.method === 'POST' && pathname === '/api/chat') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const d = JSON.parse(body || '{}');
      const answer = await callAI(
        `Ты — помощник для студентов педиатрии ТГМУ. Отвечай на русском, медицински точно.

ВАЖНО: Давай сразу суть — без вступлений. Запрещено: «Привет!», «Давай разберёмся», «Итак», «Хороший вопрос» и т.п.
Формат: сразу по делу, 2–3 пунктами, без лишних слов.`,
        'Тема: ' + (d.topicTitle||'') + '\n\nКонтекст:\n' + (d.topicDesc||'') + '\n\n---\nВопрос: ' + (d.question||''),
        d.channel === 'cards' ? 2000 : 700, 0.2
      );
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ answer }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/grade') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const d = JSON.parse(body || '{}');
      const answers = d.answers || [];
      const hasPerTopic = answers.some(a => a.topicTitle);
      const qtext = hasPerTopic
        ? answers.map((a,i)=>`Вопрос ${i+1} (тема: ${a.topicTitle||'—'}): ${a.question}\nОтвет студента: ${a.answer||'(не ответил)'}`).join('\n\n')
        : answers.map((a,i)=>`Вопрос ${i+1}: ${a.question}\nОтвет студента: ${a.answer||'(не ответил)'}`).join('\n\n');
      const topicCtx = hasPerTopic
        ? 'Вопросы из разных тем курса. Оцени каждый ответ по контексту своей темы.'
        : 'Тема: ' + (d.topicTitle||'') + '\n\nКонтекст:\n' + (d.topicDesc||'').slice(0,4000);
      const raw = await callAI(
        `Ты — строгий экзаменатор педиатрии. Оцени ответы как на реальном экзамене у будущих врачей. Будь максимально требовательным.

Критерии оценок:
- 5: Полный, точный ответ. Медицинская терминология, структура, все ключевые пункты. Без ошибок.
- 4: В целом верно, но есть неточности или незначительные пропуски.
- 3: Частичный ответ, пропущены важные аспекты, нет структуры.
- 2: Поверхностно, общие фразы, много ошибок или неверная трактовка.
- 1: Не ответил по существу, неверно, не по теме.

Не завышай оценки. Неполный ответ — максимум 3. «Думаю», «наверное», общие фразы без конкретики — 2 или ниже. Отсутствие ответа — 1.

Для каждого вопроса: оценка 1–5 и краткий, конкретный комментарий на русском (что упущено, что неверно).
Верни ТОЛЬКО JSON: [{"grade":N,"comment":"..."}]. Количество элементов = количеству вопросов.`,
        topicCtx + '\n\n' + qtext,
        1500, 0.2
      );
      let grades = [];
      const m = raw.match(/\[[\s\S]*\]/);
      if (m) { try { grades = JSON.parse(m[0]); } catch {} }
      const avg = grades.length ? +(grades.reduce((s,g)=>s+(Number(g.grade)||0),0)/grades.length).toFixed(1) : 0;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, grades, avgGrade: avg }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: String(e.message) }));
    }
    return;
  }

  const filePath = path.join(__dirname, pathname.replace(/^\//, ''));
  const ext = path.extname(filePath);
  if (!ext || !MIME[ext]) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('Сервер: http://localhost:' + PORT);
      console.log('ИИ: ' + (GEMINI_KEY ? 'OK (Gemini)' : 'НЕТ КЛЮЧА — создайте .env с GEMINI_API_KEY=...'));
});
