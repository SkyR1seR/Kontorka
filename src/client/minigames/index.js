// Панель задачи (TZ 7.1 «Task Panel»): шаги, прогресс, отмена. Окно в стиле КонторОС 98.
import { h, win98 } from '../ui/dom.js';
import { MINIGAMES } from './tasks.js';
import { audio } from '../audio.js';

export function openMinigame(layer, { mg, title, hint, stepLabel, extra, data, myName, onDone, onCancel }) {
  const body = h('div', { class: 'mg-body' });
  let finished = false;
  const ctx = {
    extra, data, stepLabel, myName,
    sound: (k) => {
      if (['click', 'good', 'bad', 'type', 'notice'].includes(k)) audio.ui(k);
      else audio.play(k);
    },
    done: (result) => {
      if (finished) return;
      finished = true;
      audio.ui('good');
      wrap.classList.add('mg-success');
      setTimeout(() => { close(); onDone(result || {}); }, 380);
    },
    cancel: () => cancel(),
  };
  const cancel = () => {
    if (finished) return;
    finished = true;
    close();
    onCancel();
  };
  const w = win98(`КонторОС 98 — ${title}`, body, {
    onClose: cancel,
    status: h('span', {}, hint ? `${hint} ` : '', h('span', { class: 'mg-esc' }, '[Esc] — бросить')),
    class: 'mg-window',
  });
  const wrap = h('div', { class: 'mg-overlay' }, w);
  layer.append(wrap);
  const fn = MINIGAMES[mg] || MINIGAMES.stamp;
  const cleanup = fn(body, ctx);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
  window.addEventListener('keydown', onKey);
  function close() {
    window.removeEventListener('keydown', onKey);
    if (typeof cleanup === 'function') cleanup();
    wrap.remove();
  }
  return { cancel, close: () => { finished = true; close(); } };
}

// Кольцо удержания: саботаж, ремонт, подбор предметов и т.п.
export function openHold(layer, { label, seconds, key, requireHold, held, onDone, onCancel }) {
  const ring = h('div', { class: 'hold-ring' }, h('div', { class: 'hold-fill' }));
  const lab = h('div', { class: 'hold-label' }, label, requireHold ? h('div', { class: 'hold-key' }, `удерживай [${key}]`) : null);
  const wrap = h('div', { class: 'hold-wrap' }, ring, lab);
  layer.append(wrap);
  const start = performance.now();
  let raf;
  let done = false;
  let released = false;
  const onUp = (e) => { if (requireHold && e.code === `Key${key}`) released = true; };
  const onKey = (e) => { if (e.key === 'Escape') finish(false); };
  window.addEventListener('keyup', onUp);
  window.addEventListener('keydown', onKey);
  const tick = () => {
    const p = Math.min(1, (performance.now() - start) / (seconds * 1000));
    ring.style.setProperty('--p', `${p * 360}deg`);
    if (released || (requireHold && held && !held())) { finish(false); return; }
    if (p >= 1) { finish(true); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  function finish(ok) {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('keydown', onKey);
    wrap.remove();
    if (ok) onDone(); else onCancel();
  }
  return { cancel: () => finish(false), close: () => { done = true; cancelAnimationFrame(raf); wrap.remove(); window.removeEventListener('keyup', onUp); window.removeEventListener('keydown', onKey); } };
}
