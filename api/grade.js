/** Vercel Serverless — оценка ответов ИИ */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY не задан в Vercel' });

  try {
    const d = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const answers = d.answers || [];
    const hasPerTopic = answers.some(a => a.topicTitle);
    const qtext = hasPerTopic
      ? answers.map((a,i)=>`Вопрос ${i+1} (тема: ${a.topicTitle||'—'}): ${a.question}\nОтвет студента: ${a.answer||'(не ответил)'}`).join('\n\n')
      : answers.map((a,i)=>`Вопрос ${i+1}: ${a.question}\nОтвет студента: ${a.answer||'(не ответил)'}`).join('\n\n');
    const topicCtx = hasPerTopic
      ? 'Вопросы из разных тем курса. Оцени каждый ответ по контексту своей темы.'
      : 'Тема: ' + (d.topicTitle||'') + '\n\nКонтекст:\n' + (d.topicDesc||'').slice(0,4000);
    const sysPrompt = `Ты — строгий экзаменатор педиатрии. Оцени ответы как на реальном экзамене у будущих врачей. Будь максимально требовательным.

Критерии оценок:
- 5: Полный, точный ответ. Медицинская терминология, структура, все ключевые пункты. Без ошибок.
- 4: В целом верно, но есть неточности или незначительные пропуски.
- 3: Частичный ответ, пропущены важные аспекты, нет структуры.
- 2: Поверхностно, общие фразы, много ошибок или неверная трактовка.
- 1: Не ответил по существу, неверно, не по теме.

Не завывай оценки. Неполный ответ — максимум 3. «Думаю», «наверное», общие фразы без конкретики — 2 или ниже. Отсутствие ответа — 1.

Для каждого вопроса: оценка 1–5 и краткий, конкретный комментарий на русском (что упущено, что неверно).
Верни ТОЛЬКО JSON: [{"grade":N,"comment":"..."}]. Количество элементов = количеству вопросов.`;
    const fullPrompt = sysPrompt + '\n\n' + topicCtx + '\n\n' + qtext;

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1500 }
      })
    });
    const text = await r.text();
    if (!r.ok) return res.status(500).json({ ok: false, error: 'Gemini: ' + text.slice(0, 200) });
    const j = JSON.parse(text);
    const part = j.candidates?.[0]?.content?.parts?.[0];
    const raw = String(part?.text || '').trim();
    let grades = [];
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) { try { grades = JSON.parse(m[0]); } catch {} }
    const avg = grades.length ? +(grades.reduce((s,g)=>s+(Number(g.grade)||0),0)/grades.length).toFixed(1) : 0;
    res.status(200).json({ ok: true, grades, avgGrade: avg });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message) });
  }
}
