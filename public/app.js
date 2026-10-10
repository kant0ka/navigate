const $ = (id) => document.getElementById(id);
const video = $('video');
const synth = window.speechSynthesis;
const ENDPOINT = '/.netlify/functions/describe';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

const state = { stream: null, starting: false, controller: null, version: 0, last: '' };

// ---------- речь и вывод ----------
function say(text, { remember = true } = {}) {
  if (remember) state.last = text;
  $('answer').textContent = text;
  const sound = $('sound').checked && synth;
  // Если приложение молчит, ответ читает экранный диктор через live-область.
  $('announcer').textContent = sound ? '' : text;
  $('repeat').disabled = !state.last;
  if (!sound) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU';
  u.rate = 0.95;
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('ru'));
  if (voice) u.voice = voice;
  synth.speak(u);
}

function render() {
  const busy = !!state.controller || state.starting;
  const main = $('main');
  main.setAttribute('aria-busy', String(busy));
  main.textContent = busy ? 'Смотрю…' : state.stream ? 'Что передо мной?' : 'Нажмите, чтобы начать';
}

// ---------- камера ----------
async function startCamera(version) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Для камеры откройте сайт по HTTPS.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  if (version !== state.version) { stream.getTracks().forEach((t) => t.stop()); return false; }
  state.stream = stream;
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Камера не передала изображение.')), 8000);
      video.addEventListener('loadeddata', () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    if (state.stream === stream) stop('Доступ к камере прервался. Нажмите кнопку, чтобы начать заново.');
  });
  video.dataset.active = 'true';
  await new Promise((r) => setTimeout(r, 700)); // время на экспозицию и фокус
  return version === state.version;
}

function cameraError(error) {
  return ({
    NotAllowedError: 'Доступ к камере запрещён. Сопровождающему нужно разрешить камеру в настройках сайта.',
    NotFoundError: 'Не нашёл камеру на устройстве.',
    NotReadableError: 'Камера занята другим приложением. Закройте его и повторите.',
  })[error.name] || error.message || 'Не удалось включить камеру.';
}

function snapshot() {
  const w = Math.min(1024, video.videoWidth);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = Math.round((w * video.videoHeight) / video.videoWidth);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

// ---------- главное действие ----------
async function look() {
  // Любое нажатие = «посмотри сейчас»: прерываем прошлый ответ и запрос.
  const version = ++state.version;
  state.controller?.abort();
  state.controller = null;

  if (!$('consent').checked) {
    $('setup').open = true;
    $('consent').focus();
    return say('Сначала сопровождающий должен разрешить отправку снимков. Откройте раздел «Для сопровождающего».', { remember: false });
  }

  say(state.stream ? 'Смотрю.' : 'Включаю камеру.', { remember: false }); // в обработчике нажатия — разблокирует озвучку на iPhone
  state.starting = !state.stream;
  render();

  try {
    if (!state.stream && !(await startCamera(version))) return;
    state.starting = false;
    if (video.readyState < 2 || !video.videoWidth) throw new Error('Камера ещё не передала кадр. Нажмите ещё раз.');

    const controller = new AbortController();
    state.controller = controller;
    render();
    const timer = setTimeout(() => controller.abort(), 25000);
    let data;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Code': $('code').value.trim() },
        body: JSON.stringify({ image: snapshot() }),
        signal: controller.signal,
        cache: 'no-store',
      });
      try { data = await res.json(); } catch { throw new Error('Сервер анализа не подключён или вернул некорректный ответ.'); }
      if (!res.ok) {
        if (res.status === 401) $('setup').open = true;
        throw new Error(data.error || 'Не удалось выполнить анализ снимка.');
      }
    } finally { clearTimeout(timer); }

    if (version !== state.version) return;
    say(data.text.replace(/[*_#`>]+/g, '').replace(/\s+/g, ' ').trim());
  } catch (error) {
    if (version !== state.version) return;
    state.starting = false;
    if (error.name === 'AbortError') say('Анализ не успел завершиться. Нажмите кнопку ещё раз.', { remember: false });
    else if (!state.stream) { stop(null); say(cameraError(error), { remember: false }); }
    else say(error.message, { remember: false });
  } finally {
    if (version === state.version) { state.controller = null; state.starting = false; render(); }
  }
}

function stop(message = 'Выключено. Камера остановлена.') {
  ++state.version;
  state.controller?.abort();
  state.controller = null;
  state.starting = false;
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  video.srcObject = null;
  delete video.dataset.active;
  synth?.cancel();
  render();
  if (message) say(message, { remember: false });
}

// ---------- настройки сопровождающего ----------
$('consent').checked = store.get('consent') === '1';
$('code').value = store.get('code') || '';
if (store.get('sound') === '0') $('sound').checked = false;
if (!synth) { $('sound').checked = false; $('sound').disabled = true; }

$('consent').addEventListener('change', () => {
  store.set('consent', $('consent').checked ? '1' : '0');
  if (!$('consent').checked) stop();
});
$('code').addEventListener('change', () => store.set('code', $('code').value.trim()));
$('sound').addEventListener('change', () => { synth?.cancel(); store.set('sound', $('sound').checked ? '1' : '0'); });

// ---------- кнопки ----------
$('main').addEventListener('click', look);
$('repeat').addEventListener('click', () => state.last && say(state.last));
$('off').addEventListener('click', () => stop());
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(null); });
window.addEventListener('pagehide', () => stop(null));
render();
