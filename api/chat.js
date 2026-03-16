/** Vercel Serverless — ИИ чат и карточки */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY не задан в Vercel' });

  try {
    const d = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const isCards = d.channel === 'cards';
    const sysPrompt = isCards
      ? 'Ты генерируешь учебные карточки. Отвечай ТОЛЬКО валидным JSON-массивом без markdown, без пояснений. Формат: [{"q":"Вопрос?","a":"Ответ."}]'
      : `Ты — помощник для студентов педиатрии ТГМУ. Отвечай на русском, медицински точно.

ВАЖНО: Давай сразу суть — без вступлений. Запрещено: «Привет!», «Давай разберёмся», «Итак», «Хороший вопрос» и т.п.
Формат: сразу по делу, 2–3 пунктами, без лишних слов.`;
    const userPrompt = isCards
      ? 'Тема: ' + (d.topicTitle||'') + '\nОписание: ' + (d.topicDesc||'').slice(0, 3500) + '\n\n' + (d.question||'')
      : 'Тема: ' + (d.topicTitle||'') + '\n\nКонтекст:\n' + (d.topicDesc||'') + '\n\n---\nВопрос: ' + (d.question||'');
    const fullPrompt = sysPrompt + '\n\n' + userPrompt;
    const maxTokens = isCards ? 2500 : 700;

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens }
      })
    });
    const text = await r.text();
    if (!r.ok) return res.status(500).json({ error: 'Gemini: ' + text.slice(0, 200) });
    const j = JSON.parse(text);
    const part = j.candidates?.[0]?.content?.parts?.[0];
    const answer = String(part?.text || '').trim();
    res.status(200).json({ answer });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
}
