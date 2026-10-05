// Главное меню и лобби (TZ 3.1): приватное/публичное лобби, вход по коду и по
// приглашению, число игроков и длина матча, готовность, пинг/регион/версия.
import { h, clear } from './dom.js';
import { STAFF, ROLES } from '../../shared/content.js';
import { PROTOCOL_VERSION } from '../../shared/game.js';
import { settings, saveSettings } from '../settings.js';

export function createMenu(root, api) {
  const el = {};
  const screen = h('div', { class: 'menu-screen' });
  root.append(screen);
  let lobby = null;
  let me = null;

  function nameInput() {
    const inp = h('input', { class: 'name-input', maxlength: 18, placeholder: 'Ваше имя в Конторке', value: settings.name || '' });
    inp.addEventListener('change', () => { saveSettings({ name: inp.value.trim().slice(0, 18) }); api.rename(settings.name); });
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    return inp;
  }

  function statusLine() {
    const s = api.status();
    return h('div', { class: 'conn-status' },
      s.connected ? `Сервер: ${s.server} · регион ${s.region} · пинг ${s.ping ?? '—'} мс · версия ${PROTOCOL_VERSION}` : s.text);
  }

  const M = {
    setMe(m) { me = m; },

    showMain(message) {
      lobby = null;
      clear(screen);
      screen.className = 'menu-screen menu-main';
      const codeInp = h('input', { class: 'code-input', maxlength: 4, placeholder: 'КОД' });
      codeInp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') join(); });
      const join = () => { const c = codeInp.value.trim().toUpperCase(); if (c) api.join(c); };
      const pub = h('input', { type: 'checkbox' });
      el.status = statusLine();
      screen.append(
        h('div', { class: 'logo' },
          h('div', { class: 'logo-small' }, 'ООО'),
          h('div', { class: 'logo-big' }, '«КОНТОРКА»'),
          h('div', { class: 'logo-sub' }, 'ПРОВЕРКА'),
        ),
        h('div', { class: 'menu-tag sub-text' }, 'ВЫДЫХАЙ. ЭТО ПРОСТО ОЧЕРЕДНАЯ ШАБАШКА'),
        h('div', { class: 'menu-card panel' },
          h('label', { class: 'menu-label' }, 'Как вас записать в журнал?'), nameInput(),
          h('div', { class: 'menu-row' },
            h('button', { class: 'btn btn-primary', onclick: () => api.create({ isPublic: pub.checked }) }, 'Создать лобби'),
            h('label', { class: 'menu-check' }, pub, ' публичное'),
          ),
          h('div', { class: 'menu-row' }, codeInp, h('button', { class: 'btn', onclick: join }, 'Войти по коду')),
          h('div', { class: 'menu-row' },
            h('button', { class: 'btn', onclick: () => api.listLobbies() }, 'Публичные лобби'),
            h('button', { class: 'btn', onclick: () => api.help() }, 'Как играть'),
            h('button', { class: 'btn', onclick: () => api.settings() }, 'Настройки'),
          ),
          api.dev ? h('div', { class: 'menu-dev' },
            h('div', { class: 'menu-label' }, 'Режим разработчика'),
            h('div', { class: 'menu-row' },
              h('button', { class: 'btn btn-dev', onclick: () => api.devLobby(false) }, 'Тест с ботами (сервер)'),
              h('button', { class: 'btn btn-dev', onclick: () => api.devLobby(true) }, 'Тест с ботами (локально)'),
            )) : null,
          el.lobbies = h('div', { class: 'lobby-list' }),
          message ? h('div', { class: 'menu-error' }, message) : null,
        ),
        h('div', { class: 'menu-foot' }, 'Матч для 6–12 игроков, 20–30 минут. Голос — рация [V] или текстовый чат.'),
        el.status,
      );
    },

    updateStatus() {
      if (el.status && el.status.isConnected) el.status.replaceWith(el.status = statusLine());
    },

    showLobbies(list) {
      if (!el.lobbies) return;
      clear(el.lobbies);
      if (!list.length) { el.lobbies.append(h('div', { class: 'lobby-empty' }, 'Публичных лобби нет. Создайте своё!')); return; }
      for (const l of list) {
        el.lobbies.append(h('button', { class: 'lobby-item', disabled: l.state !== 'lobby' || l.count >= l.max, onclick: () => api.join(l.code) },
          h('b', {}, l.code), ` · хост ${l.host} · ${l.count}/${l.max} · ${l.state === 'lobby' ? 'ждут' : 'идёт матч'}`));
      }
    },

    showLobby(l) {
      lobby = l;
      clear(screen);
      screen.className = 'menu-screen menu-lobby';
      const meM = l.members.find((m) => m.id === me);
      const isHost = l.hostId === me;
      const link = `${location.origin}${location.pathname}?join=${encodeURIComponent(l.code)}`;
      const minP = l.minPlayers;
      const ready = l.members.filter((m) => m.ready || m.id === l.hostId).length;
      const canStart = l.members.length >= minP && l.members.every((m) => m.ready || m.id === l.hostId);
      const taken = new Set(l.members.map((m) => m.staff));

      const settingsBox = h('div', { class: 'lobby-settings panel' }, h('div', { class: 'panel-title' }, 'Настройки матча'));
      const sel = (key, opts, val) => {
        const s = h('select', { disabled: !isHost }, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(val) }, t)));
        s.addEventListener('change', () => api.lobbySettings({ [key]: isNaN(Number(s.value)) ? s.value : Number(s.value) }));
        return s;
      };
      settingsBox.append(
        h('label', { class: 'set-row' }, h('span', {}, 'Мест в лобби'), sel('maxPlayers', [6, 7, 8, 9, 10, 11, 12].map((n) => [n, `${n}`]), l.settings.maxPlayers)),
        h('label', { class: 'set-row' }, h('span', {}, 'Длина матча'), sel('length', Object.entries(l.lengths), l.settings.length)),
        h('label', { class: 'set-row' }, h('span', {}, 'Доступ'), sel('isPublic', [['true', 'Публичное'], ['false', 'По приглашению']], String(l.isPublic))),
      );
      // select для isPublic отдаёт строку — исправим на лету
      settingsBox.querySelectorAll('select')[2]?.addEventListener('change', (e) => api.lobbySettings({ isPublic: e.target.value === 'true' }));
      if (l.dev) {
        settingsBox.append(
          h('div', { class: 'menu-label' }, 'Тестовый режим'),
          h('label', { class: 'set-row' }, h('span', {}, 'Ботов добавить'), sel('bots', [...Array(12).keys()].map((n) => [n, `${n}`]), l.settings.bots)),
        );
        const rs = h('select', {}, [['', 'Случайная']].concat(Object.values(ROLES).map((r) => [r.id, r.name])).map(([v, t]) => h('option', { value: v, selected: (meM?.rolePref || '') === v }, t)));
        rs.addEventListener('change', () => api.rolePref(rs.value || null));
        settingsBox.append(h('label', { class: 'set-row' }, h('span', {}, 'Моя роль'), rs));
      }

      const players = h('div', { class: 'lobby-players panel' }, h('div', { class: 'panel-title' }, `Сотрудники ${l.members.length}/${l.settings.maxPlayers}`));
      for (const m of l.members) {
        players.append(h('div', { class: `lp-row ${m.id === me ? 'lp-me' : ''} ${m.connected ? '' : 'lp-off'}` },
          h('img', { src: api.portrait(m.staff), alt: '' }),
          h('div', { class: 'lp-name' }, m.id === l.hostId ? '♛ ' : '', m.name, h('div', { class: 'lp-staff' }, STAFF[m.staff]?.full || '')),
          h('div', { class: 'lp-ping' }, m.connected ? (m.ping != null ? `${m.ping} мс` : '—') : 'нет связи'),
          h('div', { class: `lp-ready ${m.ready || m.id === l.hostId ? 'ok' : ''}` }, m.id === l.hostId ? 'хост' : m.ready ? 'готов' : 'не готов'),
          isHost && m.id !== me ? h('button', { class: 'btn btn-tiny', title: 'Исключить', onclick: () => api.kick(m.id) }, '✕') : null,
        ));
      }
      for (let i = l.members.length; i < l.settings.maxPlayers; i++) players.append(h('div', { class: 'lp-row lp-empty' }, 'свободное место'));

      const picker = h('div', { class: 'staff-picker panel' }, h('div', { class: 'panel-title' }, 'Выберите сотрудника'),
        h('div', { class: 'staff-grid' }, STAFF.map((s, i) => h('button', {
          class: `staff-item ${meM?.staff === i ? 'staff-on' : ''}`, disabled: taken.has(i) && meM?.staff !== i,
          title: s.full, onclick: () => api.staff(i),
        }, h('img', { src: api.portrait(i), alt: '' }), h('span', {}, s.name)))));

      const chatLog = h('div', { class: 'lobby-chatlog' }, (l.chat || []).map((c) => h('div', { class: c.from ? '' : 'sys' }, c.from ? h('b', {}, `${c.from}: `) : null, c.text)));
      const chatInp = h('input', { class: 'chat-input', maxlength: 200, placeholder: 'Чат лобби…' });
      chatInp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && chatInp.value.trim()) { api.lobbyChat(chatInp.value.trim()); chatInp.value = ''; } });

      screen.append(
        h('div', { class: 'lobby-head' },
          h('div', { class: 'lobby-code' }, h('span', {}, 'Код лобби'), h('b', {}, l.code)),
          h('button', { class: 'btn btn-small', onclick: () => { navigator.clipboard?.writeText(link).then(() => api.toast('Ссылка-приглашение скопирована'), () => api.toast(link)); } }, 'Скопировать приглашение'),
          h('div', { class: 'lobby-link' }, link),
          h('button', { class: 'btn btn-small', onclick: () => api.leave() }, 'Выйти'),
        ),
        h('div', { class: 'lobby-body' },
          h('div', { class: 'lobby-col' }, players, settingsBox),
          h('div', { class: 'lobby-col' }, picker,
            h('div', { class: 'lobby-chat panel' }, chatLog, chatInp)),
        ),
        h('div', { class: 'lobby-actions' },
          isHost
            ? h('button', { class: 'btn btn-primary btn-big', disabled: !canStart, onclick: () => api.start() }, canStart ? 'Начать проверку' : `Ждём игроков: ${l.members.length}/${minP}, готовы ${ready}`)
            : h('button', { class: `btn btn-big ${meM?.ready ? 'btn-on' : 'btn-primary'}`, onclick: () => api.ready(!meM?.ready) }, meM?.ready ? 'Готов ✔ (отменить)' : 'Я готов'),
          h('div', { class: 'lobby-hint' }, l.dev ? 'Тестовый режим: свободные места займут боты.' : `Для старта нужно ${minP}–12 игроков. Хост начинает матч, когда все готовы.`),
        ),
        statusLine(),
      );
      setTimeout(() => { chatLog.scrollTop = chatLog.scrollHeight; }, 0);
    },

    hide() { screen.classList.add('hidden'); },
    show() { screen.classList.remove('hidden'); },
    get lobby() { return lobby; },
  };
  return M;
}
