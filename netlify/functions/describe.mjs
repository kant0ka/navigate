// Прокси к OpenRouter. Ключ хранится ТОЛЬКО в переменной окружения Netlify.
import { createHash, timingSafeEqual } from 'node:crypto';

const MODEL = 'google/gemini-2.5-flash-lite';
const MAX_BODY = 4_000_000; // ~4 МБ
const hits = new Map();     // простейший лимит запросов на IP (в памяти одного инстанса)

const PROMPT = `Ты — голосовой помощник для незрячего человека. Он стоит на месте рядом со зрячим сопровождающим и спрашивает: «Что передо мной?». Опиши снимок с камеры телефона.
Правила:
- Отвечай по-русски, простыми короткими фразами, не больше 4 предложений.
- Сначала самое важное: люди, двери, лестницы, ступени, препятствия, проёмы.
- Положение указывай относительно кадра: слева, прямо, справа.
- НЕ называй расстояния в метрах или шагах и НЕ говори, что путь свободен или безопасен.
- Если читается надпись, табличка или номер — прочитай.
- Не называй людей по именам; можно сказать, сколько их и где они.
- Если снимок тёмный, размытый или непонятный — так и скажи и попроси сделать новый снимок.
- Только обычный текст: без markdown, списков, звёздочек и эмодзи.`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const sha = (s) => createHash('sha256').update(s).digest();

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
  return list.length > 20;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return json({ error: 'На сервере не задан ключ OPENROUTER_API_KEY.' }, 500);

  const required = process.env.ACCESS_CODE;
  if (required && !timingSafeEqual(sha(req.headers.get('x-access-code') || ''), sha(required))) {
    return json({ error: 'Неверный код доступа. Сопровождающий может исправить его в настройках.' }, 401);
  }

  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown';
  if (limited(ip)) return json({ error: 'Слишком много запросов. Подождите минуту.' }, 429);

  let image;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: 'Снимок слишком большой.' }, 413);
    ({ image } = JSON.parse(raw));
  } catch {
    return json({ error: 'Некорректный запрос.' }, 400);
  }
  if (typeof image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)) {
    return json({ error: 'Нужен снимок в формате JPEG.' }, 400);
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Navigate',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 350,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(22_000),
    });

    if (!res.ok) {
      console.error('OpenRouter error', res.status, (await res.text()).slice(0, 300));
      return json({ error: 'Сервис анализа сейчас недоступен. Попробуйте ещё раз.' }, 502);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      return json({ error: 'Пустой ответ от сервиса анализа. Попробуйте ещё раз.' }, 502);
    }
    return json({ text: text.trim().slice(0, 1200) });
  } catch (err) {
    console.error('describe failed', err?.name, err?.message);
    return json({ error: err?.name === 'TimeoutError' ? 'Сервис не успел ответить. Попробуйте ещё раз.' : 'Не удалось выполнить анализ.' }, 502);
  }
};
