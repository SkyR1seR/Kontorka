// Настройки игрока (TZ 7 / GDD 13): текст, субтитры, мышь, громкость по каналам, push-to-talk.
const KEY = 'kontorka.settings.v1';

const DEFAULTS = {
  name: '',
  textScale: 1,
  subtitles: true,
  mouseSens: 1,
  invertY: false,
  camMode: 'follow',
  pixelScale: 3,
  jitter: true,
  dither: true,
  volMaster: 0.8,
  volFx: 0.8,
  volVoice: 1,
  volAmbient: 0.5,
  voice: true,
  pttKey: 'KeyV',
  showNames: true,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* приватный режим и т.п. */ }
  return { ...DEFAULTS };
}

export const settings = load();
const listeners = new Set();

export function saveSettings(patch = {}) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  for (const fn of listeners) fn(settings);
}

export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
export function storageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
