// Экраны поверх игры: Role Reveal, записюлька Хозяина, итоги матча, выбор цели,
// журнал кукишей, настройки, «Как играть».
import { h, clear, win98 } from './dom.js';
import { ZONES, ZONE_BY_ID } from '../../shared/map.js';
import { ROLES, TEAM_NAME } from '../../shared/content.js';
import { settings, saveSettings } from '../settings.js';

function overlay(layer, cls, content, onClose) {
  const o = h('div', { class: `overlay ${cls}` }, content);
  if (onClose) o.addEventListener('click', (e) => { if (e.target === o) onClose(); });
  layer.append(o);
  return o;
}

// ---------------------------------------------------------------- Role Reveal
export function showRoleReveal(layer, role, { playerName, allyNames = [], onSkip }) {
  const r = role;
  const o = overlay(layer, 'role-reveal', h('div', { class: 'rr-box' },
    h('div', { class: 'rr-you' }, `${playerName}, ваша роль в Конторке:`),
    h('div', { class: `rr-role sub-text rr-${r.role}` }, r.roleName.toUpperCase()),
    h('div', { class: 'rr-team' }, `Команда: ${TEAM_NAME[r.team]}`),
    h('div', { class: 'rr-goal' }, r.goal),
    h('ul', { class: 'rr-rules' }, r.rules.map((x) => h('li', {}, x))),
    h('div', { class: 'rr-example' }, r.example),
    allyNames.length ? h('div', { class: 'rr-allies' }, 'Ваши союзники-вредители: ', h('b', {}, allyNames.join(', '))) : null,
    h('button', { class: 'btn btn-primary', onclick: () => { onSkip?.(); } }, 'Понятно, к батрачке!'),
  ));
  return o;
}

// ---------------------------------------------------------------- Записюлька
export function showOrder(layer, order, { title = 'Записюлька Хозяина', note, onClose, auto } = {}) {
  if (!order) return null;
  const close = () => { o.remove(); onClose?.(); };
  const o = overlay(layer, 'order-overlay', h('div', { class: 'order-paper' },
    h('div', { class: 'op-head' }, title),
    h('div', { class: 'op-type' }, `${order.type}${order.version > 1 ? ` · уточнение, версия ${order.version}` : ''}`),
    h('div', { class: 'op-title' }, `«${order.title}»`),
    h('div', { class: 'op-text' }, order.text),
    note ? h('div', { class: 'op-note' }, note) : null,
    h('div', { class: 'op-stamp' }, order.stamp),
    h('div', { class: 'op-sign' }, 'Хозяин'),
    h('button', { class: 'btn', onclick: close }, 'Принято к исполнению'),
  ), close);
  if (auto) setTimeout(() => { if (o.isConnected) close(); }, auto);
  return o;
}

// ---------------------------------------------------------------- Выбор
export function pickPlayer(layer, { title, players, portrait, onPick, onCancel, note }) {
  const close = () => { o.remove(); onCancel?.(); };
  const o = overlay(layer, 'picker', win98(title, h('div', {},
    note ? h('div', { class: 'picker-note' }, note) : null,
    h('div', { class: 'picker-grid' }, players.map((p) => h('button', {
      class: 'picker-item', onclick: () => { o.remove(); onPick(p.id); },
    }, h('img', { src: portrait(p.staff), alt: '' }), h('span', {}, p.name)))),
  ), { onClose: close }), close);
  const esc = (e) => { if (e.key === 'Escape') { window.removeEventListener('keydown', esc); close(); } };
  window.addEventListener('keydown', esc);
  return o;
}

export function pickOption(layer, { title, options, onPick, onCancel }) {
  const close = () => { o.remove(); onCancel?.(); };
  const o = overlay(layer, 'picker', win98(title, h('div', { class: 'picker-list' }, options.map((op) => h('button', {
    class: 'btn picker-opt', disabled: op.disabled, onclick: () => { o.remove(); onPick(op.value); },
  }, op.label, op.sub ? h('div', { class: 'picker-sub' }, op.sub) : null))), { onClose: close }), close);
  const esc = (e) => { if (e.key === 'Escape') { window.removeEventListener('keydown', esc); close(); } };
  window.addEventListener('keydown', esc);
  return o;
}

export function pickZone(layer, { title, onPick, onCancel }) {
  return pickOption(layer, { title, options: ZONES.map((z) => ({ label: z.name, value: z.id })), onPick, onCancel });
}

// ---------------------------------------------------------------- Журнал кукишей (Дуся)
export function showKassaLog(layer, log) {
  const close = () => o.remove();
  const rows = log.length ? log.slice().reverse().map((e) => h('div', { class: `klog-row ${e.anomaly ? 'klog-anom' : ''}` },
    h('span', { class: 'jtime' }, e.oc), h('span', {}, e.op),
    h('span', {}, e.delta ? `${e.delta} кук.` : '—'),
    h('span', {}, e.anomaly ? `АНОМАЛИЯ. Рядом были: ${e.near.length ? e.near.join(', ') : 'никого'}` : (e.who || '')))) : [h('div', {}, 'Операций пока нет.')];
  const o = overlay(layer, 'picker', win98('Журнал кукишей — КассОС', h('div', { class: 'klog' }, rows), { onClose: close }), close);
  return o;
}

// ---------------------------------------------------------------- Итоги
export function showResult(layer, r, { portrait, myId, onLobby }) {
  const winCls = r.winner === 'vrediteli' ? 'res-vred' : r.winner === 'none' ? 'res-none' : 'res-kont';
  const o = overlay(layer, `result ${winCls}`, h('div', { class: 'res-box' },
    h('div', { class: 'res-title sub-text' }, r.outcome.toUpperCase()),
    h('div', { class: 'res-stats' },
      h('div', {}, `План: ${r.plan}/${r.planTarget} (${r.planPct}%)`),
      h('div', {}, `Саботажей: найдено ${r.found}, пропущено ${r.missed}, не закрыто ${r.openSab}`),
      h('div', {}, `Дебики ${r.debiki} · Кредики ${r.krediki}`),
      h('div', {}, `Цена ошибок Конторки: ${r.costs.total} кукишей`),
    ),
    h('div', { class: 'res-section' }, 'Сотрудники'),
    h('div', { class: 'res-players' }, r.players.map((p) => h('div', { class: `res-p ${p.team === 'vrediteli' ? 'res-p-vred' : ''} ${p.id === myId ? 'res-me' : ''}` },
      h('img', { src: portrait(p.staff), alt: '' }),
      h('div', { class: 'res-pname' }, p.name, p.bot ? ' (бот)' : ''),
      h('div', { class: 'res-prole' }, p.roleName, p.fired ? ' · уволен' : p.left ? ' · ушёл' : ''),
      h('div', { class: 'res-pstat' }, `задач ${p.tasksDone} · ремонтов ${p.repairs}${p.team === 'vrediteli' ? ` · саботажей ${p.sabotages}` : ''}`),
      h('div', { class: 'res-pmoney' }, `${p.kukishi} кук. + обещания ${p.promiseKukishi} = ${p.total}`),
    ))),
    h('div', { class: 'res-cols' },
      h('div', { class: 'res-col' },
        h('div', { class: 'res-section' }, 'История матча: саботажи'),
        r.timeline.length ? r.timeline.map((t) => h('div', { class: 'res-line' },
          h('span', { class: 'jtime' }, t.oc), ` ${t.name} — ${t.zone}. Сделал: `, h('b', {}, t.culprit),
          t.nearby.length ? `; рядом были: ${t.nearby.join(', ')}` : '; рядом никого',
          t.planted.length ? `; подброшен пропуск: ${t.planted.join(', ')}` : '',
          !t.discovered ? ' — НЕ ЗАМЕЧЕН' : t.failed ? ' — не устранён вовремя' : t.open ? ' — не закрыт' : t.resolvedBy ? ` — устранил(а) ${t.resolvedBy}` : ' — закрыт',
        )) : h('div', {}, 'Саботажей не было.'),
      ),
      h('div', { class: 'res-col' },
        h('div', { class: 'res-section' }, 'Решения Директора'),
        r.decisions.length ? r.decisions.map((d) => h('div', { class: `res-line ${d.correct === true ? 'res-ok' : d.correct === false ? 'res-bad' : ''}` },
          h('span', { class: 'jtime' }, d.oc), ` ${d.text}`, d.correct === true ? ' ✔ верно' : d.correct === false ? ' ✘ ошибка' : '')) : h('div', {}, 'Решений не было.'),
        h('div', { class: 'res-section' }, 'Обещания'),
        h('div', {}, `Хозяин выполнил обещания на ${Math.round(r.promiseRate * 100)}%.`),
      ),
    ),
    h('div', { class: 'res-actions' },
      h('button', { class: 'btn btn-primary', onclick: onLobby }, 'Вернуться в лобби'),
      h('button', { class: 'btn', onclick: () => downloadLog(r) }, 'Скачать журнал матча'),
    ),
  ));
  return o;
}

function downloadLog(r) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kontorka-match-${r.seed}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- Настройки
export function showSettings(layer, { onClose } = {}) {
  const close = () => { o.remove(); onClose?.(); };
  const range = (key, min, max, step, label, fmt = (v) => v) => {
    const val = h('span', { class: 'set-val' }, fmt(settings[key]));
    const inp = h('input', { type: 'range', min, max, step, value: settings[key] });
    inp.addEventListener('input', () => { saveSettings({ [key]: Number(inp.value) }); val.textContent = fmt(Number(inp.value)); });
    return h('label', { class: 'set-row' }, h('span', {}, label), inp, val);
  };
  const check = (key, label) => {
    const inp = h('input', { type: 'checkbox', checked: settings[key] });
    inp.addEventListener('change', () => saveSettings({ [key]: inp.checked }));
    return h('label', { class: 'set-row set-check' }, inp, h('span', {}, label));
  };
  const select = (key, label, opts) => {
    const sel = h('select', {}, opts.map(([v, t]) => h('option', { value: v, selected: String(settings[key]) === String(v) }, t)));
    sel.addEventListener('change', () => saveSettings({ [key]: isNaN(Number(sel.value)) ? sel.value : Number(sel.value) }));
    return h('label', { class: 'set-row' }, h('span', {}, label), sel);
  };
  const pct = (v) => `${Math.round(v * 100)}%`;
  const o = overlay(layer, 'picker', win98('Настройки', h('div', { class: 'settings' },
    h('div', { class: 'set-group' }, 'Изображение'),
    select('camMode', 'Камера', [['follow', 'Из-за плеча (мышь)'], ['top', 'Сверху (Q/E — поворот)']]),
    select('pixelScale', 'Пикселизация', [[1, 'Выкл.'], [2, 'Лёгкая'], [3, 'Как в 1999-м'], [4, 'Сильная']]),
    check('jitter', 'Дрожание вершин (PS1)'),
    check('dither', 'Дизеринг цветов'),
    h('div', { class: 'set-group' }, 'Интерфейс и доступность'),
    range('textScale', 0.8, 1.5, 0.05, 'Размер текста', pct),
    check('subtitles', 'Субтитры реплик'),
    check('showNames', 'Имена над головами'),
    range('mouseSens', 0.2, 3, 0.1, 'Чувствительность мыши', (v) => v.toFixed(1)),
    check('invertY', 'Инвертировать мышь по вертикали'),
    h('div', { class: 'set-group' }, 'Звук'),
    range('volMaster', 0, 1, 0.05, 'Общая громкость', pct),
    range('volFx', 0, 1, 0.05, 'Звуки действий', pct),
    range('volVoice', 0, 1, 0.05, 'Голоса', pct),
    range('volAmbient', 0, 1, 0.05, 'Фон', pct),
    check('voice', 'Голосовой чат (push-to-talk)'),
    select('pttKey', 'Клавиша рации', [['KeyV', 'V'], ['KeyX', 'X'], ['CapsLock', 'Caps Lock']]),
    h('button', { class: 'btn btn-primary', onclick: close }, 'Готово'),
  ), { onClose: close }), close);
  return o;
}

// ---------------------------------------------------------------- Как играть
export function showHelp(layer, { onClose } = {}) {
  const close = () => { o.remove(); onClose?.(); };
  const o = overlay(layer, 'picker', win98('Как играть — Памятка батракана', h('div', { class: 'help' },
    h('p', {}, h('b', {}, 'ООО «Конторка»: Проверка'), ' — социальная дедукция для 6–12 человек. Конторка выполняет план, вредители тайно саботируют, Директор принимает решения на планёрках.'),
    h('h4', {}, 'Матч'),
    h('p', {}, 'Вводная → Шабашка №1 → Планёрка → Шабашка №2 → Планёрка → Финальная шабашка → Итоги. Каждую шабашку Хозяин присылает записюльку — правило, которое меняет всем стратегию.'),
    h('h4', {}, 'Роли'),
    h('ul', {}, Object.values(ROLES).map((r) => h('li', {}, h('b', {}, r.name), ` — ${r.goal}`))),
    h('h4', {}, 'Улики'),
    h('p', {}, 'У каждого саботажа три следа: материальный (сломанный объект), временной (окно, когда это случилось) и поведенческий (кто был рядом). Журнал наблюдений [J] сам записывает, кого и где вы видели. Подозрительный — не значит виновный!'),
    h('h4', {}, 'Управление'),
    h('ul', {},
      h('li', {}, 'WASD — ходить, мышь — камера (клик по экрану захватывает мышь), Z/C или правая кнопка — поворот, колесо — отдалить'),
      h('li', {}, 'E — действие (задача, ремонт, предмет), R — особое действие (проверка, журнал, сравнение, обед)'),
      h('li', {}, 'F — саботаж (вредитель), T — социальный трюк, B — созвать планёрку (Директор)'),
      h('li', {}, 'G — поздороваться, Enter — сказать вслух, 1–5 — быстрые фразы, V — рация (голос)'),
      h('li', {}, 'J — журнал наблюдений, M — карта, O — записюлька, Esc — меню/отмена'),
    ),
    h('h4', {}, 'Победа'),
    h('ul', {},
      h('li', {}, 'Конторка: план выполнен и незакрытых саботажей меньше трёх. Если вредители уволены — полная победа.'),
      h('li', {}, 'Вредители: план сорван или кризис кредиков (100), и хотя бы один вредитель остался в штате.'),
    ),
    h('button', { class: 'btn btn-primary', onclick: close }, 'Понятно'),
  ), { onClose: close }), close);
  return o;
}

export { ZONE_BY_ID };
