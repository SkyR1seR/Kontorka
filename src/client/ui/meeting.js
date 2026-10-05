// Экран планёрки (TZ 7.1 «Meeting»): таймер, список игроков, кнопки запроса/голоса/санкции.
import { h, clear } from './dom.js';
import { ZONES, ZONE_BY_ID } from '../../shared/map.js';
import { fmtSec, declineName } from '../../shared/text.js';

const SUB_NAMES = { gather: 'Сбор', discuss: 'Обсуждение', decide: 'Решение Директора', result: 'Итог' };

export function createMeeting(layer, api) {
  const el = {};
  const root = h('div', { class: 'meeting hidden' },
    el.header = h('div', { class: 'mt-header' },
      el.title = h('div', { class: 'mt-title' }, 'ПЛАНЁРКА'),
      el.timer = h('div', { class: 'mt-timer' }, ''),
      el.reason = h('div', { class: 'mt-reason' }, ''),
    ),
    h('div', { class: 'mt-main' },
      el.left = h('div', { class: 'mt-left panel' }),
      el.center = h('div', { class: 'mt-center' }, el.explain = h('div', { class: 'mt-explain hidden' }), el.subs = h('div', { class: 'subtitles mt-subs' })),
      el.right = h('div', { class: 'mt-right panel' }),
    ),
    el.bottom = h('div', { class: 'mt-bottom panel' },
      el.chatLog = h('div', { class: 'mt-chatlog' }),
      h('div', { class: 'mt-inputrow' },
        el.input = h('input', { class: 'chat-input', maxlength: 220, placeholder: 'Ваша версия событий… (Enter — отправить)' }),
        h('button', { class: 'btn btn-small', onclick: () => openEvidence() }, 'Предъявить из журнала'),
        el.skipBtn = h('button', { class: 'btn btn-small', onclick: () => api.skipReady() }, 'Готов к решению'),
      ),
      el.decision = h('div', { class: 'mt-decision hidden' }),
    ),
    el.evidence = h('div', { class: 'mt-evidence panel hidden' }),
  );
  layer.append(root);

  el.input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const t = el.input.value.trim();
      if (t) api.say(t);
      el.input.value = '';
    }
  });

  let state = null;
  let ctx = null;
  let decisionKey = '';

  function openEvidence() {
    const entries = api.journal().slice().reverse().slice(0, 60);
    clear(el.evidence);
    el.evidence.classList.remove('hidden');
    el.evidence.append(h('div', { class: 'panel-title' }, 'Предъявить запись из журнала', h('button', { class: 'btn-x', onclick: () => el.evidence.classList.add('hidden') }, '×')));
    if (!entries.length) el.evidence.append(h('div', {}, 'Журнал пуст: вы ничего не видели.'));
    for (const e of entries) {
      el.evidence.append(h('button', { class: 'ev-row', onclick: () => { api.say(`Предъявляю из журнала: ${e.oc} — ${e.text}`); el.evidence.classList.add('hidden'); } }, h('span', { class: 'jtime' }, e.oc), ' ', e.text));
    }
  }

  function renderLeft() {
    clear(el.left);
    el.left.append(h('div', { class: 'panel-title' }, 'Инциденты'));
    const incs = state.incidents || [];
    if (!incs.length) el.left.append(h('div', { class: 'mt-empty' }, 'Открытых инцидентов нет. Но это не значит, что их не было.'));
    for (const i of incs.slice().reverse()) {
      el.left.append(h('div', { class: `inc-card ${i.open ? 'inc-open' : 'inc-closed'}` },
        h('div', { class: 'inc-name' }, i.name, h('span', { class: 'inc-state' }, i.open ? ' · открыт' : i.failed ? ' · ущерб' : ' · закрыт')),
        h('div', { class: 'inc-meta' }, `${i.zoneName} · ${i.obj}`),
        h('div', { class: 'inc-meta' }, `Время: ${i.window || '?'}`),
        i.traces.map((t) => h('div', { class: 'inc-trace' }, `• ${t}`)),
        i.audit ? h('div', { class: 'inc-audit' }, `Аудит: ${i.audit}`) : null,
        i.resolvedBy ? h('div', { class: 'inc-meta' }, `Устранил(а): ${i.resolvedBy}`) : null,
      ));
    }
    el.left.append(h('div', { class: 'panel-title' }, 'Журнал Конторки'));
    for (const l of (state.log || []).slice().reverse()) el.left.append(h('div', { class: `log-row log-${l.kind}` }, h('span', { class: 'jtime' }, l.oc), ` ${l.text}`));
  }

  function renderRight() {
    clear(el.right);
    el.right.append(h('div', { class: 'panel-title' }, 'Сотрудники'));
    const sub = state.sub;
    const canVote = ctx.alive && (sub === 'discuss' || sub === 'decide');
    const myVote = state.votes?.[ctx.myId];
    const tally = state.tally || {};
    for (const p of ctx.players) {
      const alive = ctx.aliveMap[p.id];
      const voted = state.votes?.[p.id];
      const row = h('div', { class: `mt-player ${alive ? '' : 'mt-fired'} ${p.id === ctx.myId ? 'mt-me' : ''} ${state.explaining?.target === p.id ? 'mt-explaining' : ''}` },
        h('img', { src: ctx.portrait(p.staff), alt: '' }),
        h('div', { class: 'mt-pinfo' },
          h('div', { class: 'mt-pname' }, p.name, ctx.allies.includes(p.id) ? h('span', { class: 'ally-star', title: 'союзник' }, ' ★') : null),
          h('div', { class: 'mt-pstate' }, !alive ? 'уволен' : voted ? 'проголосовал' : sub === 'discuss' ? 'думает…' : '', ctx.afk.includes(p.id) ? ' · АФК' : ''),
        ),
        tally[p.id] ? h('div', { class: 'mt-votes', title: 'голосов «подозреваю»' }, `▲${tally[p.id]}`) : null,
        h('div', { class: 'mt-actions' },
          canVote && alive && p.id !== ctx.myId ? h('button', { class: `btn btn-tiny ${myVote === p.id ? 'btn-on' : ''}`, onclick: () => api.vote(myVote === p.id ? null : p.id) }, 'Подозреваю') : null,
          ctx.alive && alive && p.id !== ctx.myId && sub === 'discuss' ? h('button', { class: 'btn btn-tiny', onclick: () => api.say(`Ручаюсь за ${declineName(p.name, p.gender, 'acc')}: работал${p.gender === 'f' ? 'а' : ''} честно.`) }, 'Ручаюсь') : null,
          ctx.isDirector && ctx.alive && alive && p.id !== ctx.myId && sub === 'discuss' && !state.explainUsed ? h('button', { class: 'btn btn-tiny btn-dir', onclick: () => api.explain(p.id) }, 'На объяснительную') : null,
        ),
      );
      el.right.append(row);
    }
    if (canVote) el.right.append(h('button', { class: `btn btn-small ${myVote === 'skip' ? 'btn-on' : ''}`, onclick: () => api.vote(myVote === 'skip' ? null : 'skip') }, `Воздержаться${tally.skip ? ` (${tally.skip})` : ''}`));
    el.right.append(h('div', { class: 'mt-note' }, 'Голоса — лишь мнение коллектива. Решает Директор.'));
  }

  function renderDecision() {
    const show = ctx.isDirector && ctx.alive && state.sub === 'decide' && !state.decision;
    el.decision.classList.toggle('hidden', !show);
    const key = show ? `${state.id}` : '';
    if (!show || key === decisionKey) return;
    decisionKey = key;
    clear(el.decision);
    const others = ctx.players.filter((p) => ctx.aliveMap[p.id] && p.id !== ctx.myId);
    const incs = (state.incidents || []).filter((i) => !i.audit);
    const sel = (opts) => h('select', {}, opts.map(([v, t]) => h('option', { value: v }, t)));
    const playersOpts = others.map((p) => [p.id, p.name]);
    const f = {
      restrictT: sel(playersOpts), zone: sel(ZONES.map((z) => [z.id, z.name])),
      takeT: sel(playersOpts), to: sel(playersOpts), inc: sel(incs.map((i) => [i.id, `${i.name} (${i.zoneName}, ${i.window || '?'})`])),
      fireT: sel(playersOpts),
    };
    const radios = [
      ['none', 'Без санкций', null],
      ['restrict', 'Ограничить зону (60 с)', [f.restrictT, ' зона: ', f.zone]],
      ['take_task', 'Изъять задачи и передать', [f.takeT, ' → ', f.to]],
      ['audit', 'Запустить аудит инцидента', [f.inc]],
      ['fire', 'УВОЛИТЬ', [f.fireT]],
    ];
    let choice = 'none';
    const box = h('div', { class: 'dec-options' });
    for (const [v, label, extra] of radios) {
      const disabled = (v !== 'none' && state.sanctionsLeft <= 0) || (v === 'audit' && !incs.length) || (v !== 'none' && v !== 'audit' && !others.length);
      const r = h('input', { type: 'radio', name: 'dec', value: v, checked: v === 'none', disabled });
      r.addEventListener('change', () => { choice = v; });
      box.append(h('label', { class: `dec-row ${v === 'fire' ? 'dec-fire' : ''} ${disabled ? 'dec-disabled' : ''}` }, r, h('span', {}, label), extra ? h('span', { class: 'dec-extra' }, extra) : null));
    }
    el.decision.append(
      h('div', { class: 'dec-title' }, `Ваше решение, Директор. Санкций осталось: ${state.sanctionsLeft}`),
      h('div', { class: 'dec-hint' }, 'Каждая необоснованная санкция бьёт по Конторке. Ошибочное увольнение — +25 кредиков.'),
      box,
      h('button', {
        class: 'btn btn-primary',
        onclick: () => {
          const d = { sanction: choice };
          if (choice === 'restrict') Object.assign(d, { target: f.restrictT.value, zone: f.zone.value });
          if (choice === 'take_task') Object.assign(d, { target: f.takeT.value, to: f.to.value });
          if (choice === 'audit') Object.assign(d, { incident: f.inc.value });
          if (choice === 'fire') Object.assign(d, { target: f.fireT.value });
          api.decide(d);
        },
      }, 'Принять решение'),
    );
  }

  const M = {
    show(m, c) {
      state = m; ctx = c; decisionKey = '';
      root.classList.remove('hidden');
      clear(el.chatLog);
      for (const msg of m.chat || []) M.addChat(c.nameOf(msg.from), msg.text, msg.from === c.myId);
      el.reason.textContent = c.reason || '';
      M.update(m, c);
    },
    update(m, c) {
      state = m; ctx = c;
      el.title.textContent = `ПЛАНЁРКА · ${SUB_NAMES[m.sub] || ''}`;
      renderLeft();
      renderRight();
      renderDecision();
      el.skipBtn.disabled = m.sub !== 'discuss' || !c.alive;
      el.input.disabled = !(m.sub === 'gather' || m.sub === 'discuss' || m.sub === 'decide');
      if (!c.alive) el.input.placeholder = 'Вы уволены: вас слышат только уволенные';
      const ex = m.explaining;
      el.explain.classList.toggle('hidden', !ex);
      if (ex) {
        const p = c.players.find((x) => x.id === ex.target);
        el.explain.textContent = ex.target === c.myId ? 'ВАС ВЫЗВАЛИ НА ОБЪЯСНИТЕЛЬНУЮ! Объяснитесь в чате.' : `Объяснительная: ${p?.name}`;
      }
      if (m.decision && m.sub === 'result') el.explain.classList.add('hidden');
    },
    tick(left) { el.timer.textContent = fmtSec(left); },
    hide() { root.classList.add('hidden'); el.evidence.classList.add('hidden'); },
    visible() { return !root.classList.contains('hidden'); },
    addChat(name, text, mine) {
      el.chatLog.append(h('div', { class: `mt-msg ${mine ? 'mt-mine' : ''}` }, h('b', {}, `${name}: `), text));
      while (el.chatLog.children.length > 80) el.chatLog.firstChild.remove();
      el.chatLog.scrollTop = el.chatLog.scrollHeight;
    },
    subtitle(name, text) {
      const s = h('div', { class: 'sub' }, h('div', { class: 'sub-name' }, name), h('div', { class: 'sub-text' }, text));
      el.subs.append(s);
      while (el.subs.children.length > 2) el.subs.firstChild.remove();
      setTimeout(() => { s.classList.add('sub-out'); setTimeout(() => s.remove(), 300); }, Math.min(7000, 2200 + text.length * 50));
    },
    focusInput() { el.input.focus(); },
    inputFocused() { return document.activeElement === el.input; },
  };
  return M;
}

export { ZONE_BY_ID };
