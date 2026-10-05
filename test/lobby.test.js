// Лобби и сеть без браузера (TZ 3.1, 4.1): минимум игроков, готовность, старт,
// роли видны только владельцу, переподключение по токену сохраняет роль.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServerCore } from '../src/shared/server-core.js';
import { PROTOCOL_VERSION } from '../src/shared/game.js';

function makeClient(core, name, token = null) {
  const inbox = [];
  const conn = core.connect({ send: (m) => inbox.push(structuredClone(m)), close: () => {} });
  const c = {
    conn, inbox,
    send: (m) => core.message(conn, m),
    last: (t) => [...inbox].reverse().find((m) => m.t === t),
    all: (t) => inbox.filter((m) => m.t === t),
  };
  c.send({ t: 'hello', name, token, version: PROTOCOL_VERSION });
  c.welcome = c.last('welcome');
  return c;
}

test('лобби: без режима разработчика нужно 6 игроков, роли приватны', () => {
  const core = new ServerCore({ dev: false });
  const host = makeClient(core, 'Хост');
  host.send({ t: 'create_lobby', isPublic: false });
  const code = host.last('lobby').code;
  assert.match(code, /^[A-Z0-9]{4}$/);

  // Ботов вне режима разработчика нет: старт с одним игроком запрещён
  host.send({ t: 'lobby_start' });
  assert.match(host.last('error').text, /минимум 6/);

  const others = [];
  for (let i = 0; i < 5; i++) {
    const c = makeClient(core, `Игрок${i}`);
    c.send({ t: 'join_lobby', code: code.toLowerCase() });
    others.push(c);
  }
  host.send({ t: 'lobby_start' });
  assert.match(host.last('error').text, /Не готовы/);
  for (const c of others) c.send({ t: 'lobby_ready', ready: true });
  host.send({ t: 'lobby_start' });

  const room = core.rooms.get(code);
  assert.equal(room.state, 'game');
  assert.equal(room.game.players.size, 6, 'в матче только живые игроки');
  assert.ok([...room.game.players.values()].every((p) => !p.isBot));

  // Каждый получил только свою роль
  const all = [host, ...others];
  for (const c of all) {
    const roles = c.all('role');
    assert.equal(roles.length, 1);
  }
  const directors = all.filter((c) => c.last('role').role === 'director');
  assert.equal(directors.length, 1);
});

test('переподключение по токену сохраняет роль', () => {
  const core = new ServerCore({ dev: true });
  const a = makeClient(core, 'Тестер');
  a.send({ t: 'create_lobby', dev: true });
  const code = a.last('lobby').code;
  a.send({ t: 'lobby_settings', settings: { bots: 5 } });
  a.send({ t: 'lobby_start' });
  const room = core.rooms.get(code);
  assert.equal(room.state, 'game');
  const role = a.last('role').role;
  const id = a.welcome.id;
  for (let i = 0; i < 30; i++) core.tick(1 / 30);

  core.disconnect(a.conn);
  assert.equal(room.game.players.get(id).connected, false);
  for (let i = 0; i < 60; i++) core.tick(1 / 30);

  const b = makeClient(core, 'Тестер', a.welcome.token);
  assert.equal(b.welcome.id, id, 'тот же игрок');
  assert.equal(b.welcome.rejoined, code);
  assert.equal(b.last('role').role, role);
  assert.equal(room.game.players.get(id).connected, true);
});

test('код лобби понимает кириллические двойники', () => {
  const core = new ServerCore({ dev: false });
  const host = makeClient(core, 'Хост');
  host.send({ t: 'create_lobby' });
  const code = host.last('lobby').code;
  const map = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', X: 'Х', Y: 'У' };
  const cyr = code.split('').map((ch) => map[ch] || ch).join('');
  const g = makeClient(core, 'Гость');
  g.send({ t: 'join_lobby', code: cyr });
  assert.equal(g.last('lobby')?.code, code);
});
