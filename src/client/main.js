// Точка входа: рендерер, соединение с сервером, меню/лобби, матч.
import '@fontsource/montserrat/cyrillic-600.css';
import '@fontsource/montserrat/cyrillic-800.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-800.css';
import '@fontsource/pt-sans/cyrillic-400.css';
import '@fontsource/pt-sans/cyrillic-700.css';
import '@fontsource/pt-sans/latin-400.css';
import '@fontsource/pt-sans/latin-700.css';
import '../../styles.css';
import * as THREE from 'three';
import { GameRenderer } from './render/renderer.js';
import { WsConnection, LocalConnection, wsUrl } from './net.js';
import { createMenu } from './ui/menu.js';
import { GameClient } from './game-client.js';
import { showSettings, showHelp, pickOption } from './ui/overlays.js';
import { h } from './ui/dom.js';
import { settings, onSettings } from './settings.js';
import { audio } from './audio.js';
import { initVoice } from './voice.js';

const params = new URLSearchParams(location.search);
const DEV = params.get('dev') === '1';

const view = document.getElementById('view');
const layers = {
  ui: document.getElementById('ui'),
  hud: document.getElementById('hud'),
  meeting: document.getElementById('meeting'),
  overlay: document.getElementById('overlay'),
};

const renderer = new GameRenderer(view);
window.__kontorka = { renderer };
applyVisualSettings();
onSettings(applyVisualSettings);

function applyVisualSettings() {
  renderer.setPixelScale(settings.pixelScale);
  renderer.setJitter(settings.jitter);
  renderer.setDither(settings.dither);
  renderer.setCamMode(settings.camMode);
  document.documentElement.style.setProperty('--text-scale', String(settings.textScale));
}

// ------------------------------------------------------------- connection
let conn = null;
let game = null;
let voice = null;
const status = { connected: false, text: 'Подключение к серверу…', server: '', region: '', ping: null };
let pendingJoin = params.get('join');
let localMode = false;

function connect(local = false) {
  if (conn) conn.close();
  localMode = local;
  conn = local ? new LocalConnection() : new WsConnection(wsUrl());
  conn.onStatus((s) => {
    if (s === 'open') { status.connected = true; status.text = ''; }
    else if (s === 'closed' || s === 'reconnecting') { status.connected = false; status.text = 'Нет связи с сервером. Переподключаемся…'; }
    menu.updateStatus();
  });
  conn.onMessage(onMessage);
}

const menu = createMenu(layers.ui, {
  dev: DEV,
  status: () => ({ ...status, ping: conn?.rtt != null ? Math.round(conn.rtt) : null }),
  rename: (name) => conn?.send({ t: 'rename', name }),
  create: ({ isPublic }) => { audio.init(); conn.send({ t: 'create_lobby', isPublic, settings: { length: 'standard', maxPlayers: 8 } }); },
  join: (code) => { audio.init(); conn.send({ t: 'join_lobby', code }); },
  listLobbies: () => conn.send({ t: 'list_lobbies' }),
  help: () => showHelp(layers.overlay),
  settings: () => showSettings(layers.overlay),
  devLobby: (local) => {
    audio.init();
    if (local && !localMode) { connect(true); setTimeout(() => conn.send({ t: 'create_lobby', dev: true, settings: { length: 'short' } }), 50); return; }
    conn.send({ t: 'create_lobby', dev: true, settings: { length: 'short' } });
  },
  leave: () => conn.send({ t: 'leave_lobby' }),
  ready: (r) => conn.send({ t: 'lobby_ready', ready: r }),
  staff: (i) => conn.send({ t: 'lobby_staff', staff: i }),
  lobbySettings: (s) => conn.send({ t: 'lobby_settings', settings: s }),
  rolePref: (role) => conn.send({ t: 'lobby_role', role }),
  kick: (id) => conn.send({ t: 'lobby_kick', id }),
  start: () => conn.send({ t: 'lobby_start' }),
  lobbyChat: (text) => conn.send({ t: 'lobby_chat', text }),
  portrait: (s) => renderer.portrait(s),
  toast: (text) => toast(text),
});

function toast(text) {
  const t = h('div', { class: 'menu-toast' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

let myId = null;
let welcomeMsg = null;

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      myId = msg.id;
      welcomeMsg = msg;
      menu.setMe(msg.id);
      Object.assign(status, { connected: true, server: msg.server, region: msg.region });
      if (!msg.rejoined) {
        if (!game) menu.showMain();
        if (pendingJoin) { conn.send({ t: 'join_lobby', code: pendingJoin }); pendingJoin = null; }
      }
      return;
    case 'lobby':
      if (msg.state === 'lobby') {
        if (game) endGame();
        menu.show();
        menu.showLobby(msg);
        startMenuScene();
      }
      return;
    case 'lobbies': menu.showLobbies(msg.list); return;
    case 'left': endGame(); menu.showMain(); startMenuScene(); return;
    case 'kicked': endGame(); menu.showMain('Хост исключил вас из лобби.'); return;
    case 'error':
      toast(msg.text);
      if (msg.fatal) menu.showMain(msg.text);
      return;
    case 'init':
      if (!game) startGame();
      game.handle(msg);
      if (voice) voice.handle(msg);
      return;
    default:
      if (game) game.handle(msg);
      if (voice) voice.handle(msg);
  }
}

function startGame() {
  stopMenuScene();
  menu.hide();
  game = new GameClient({
    conn, renderer, layers,
    onLeave: (where) => { if (where === 'lobby') { /* сервер пришлёт lobby */ } },
    onPause: () => openPause(),
  });
  if (DEV) window.__kontorka.game = game;
  voice = initVoice({ conn, myId, getGame: () => game });
  if (welcomeMsg) voice.handle(welcomeMsg);
}

function endGame() {
  if (game) { game.destroy(); game = null; }
  if (voice) { voice.destroy(); voice = null; }
  layers.overlay.replaceChildren();
}

function openPause() {
  pickOption(layers.overlay, {
    title: 'Пауза (матч продолжается!)',
    options: [
      { label: 'Продолжить', value: 'resume' },
      { label: 'Настройки', value: 'settings' },
      { label: 'Как играть', value: 'help' },
      { label: 'Покинуть матч', value: 'leave', sub: 'Ваш персонаж уйдёт из Конторки' },
    ],
    onPick: (v) => {
      if (v === 'settings') showSettings(layers.overlay);
      if (v === 'help') showHelp(layers.overlay);
      if (v === 'leave') { conn.send({ t: 'leave_lobby' }); }
    },
  });
}

// ------------------------------------------------------------- menu scene
let menuActors = [];
function startMenuScene() {
  if (menuActors.length) return;
  const spots = [
    [18, 18.1, Math.PI, 'work', 'type'], [23, 18.1, Math.PI, 'work', 'type'], [28, 24.1, Math.PI, 'work', 'type'],
    [26, 21, 2.2, 'idle'], [30.5, 20.5, -1.2, 'idle'], [33, 18.1, Math.PI, 'work', 'type'], [38, 24.1, Math.PI, 'work', 'type'],
  ];
  spots.forEach((s, i) => {
    const id = `menu_${i}`;
    const c = renderer.addCharacter(id, (i * 3) % 14, '');
    Object.assign(c, { x: s[0], z: s[1], rot: s[2], anim: s[3], kind: s[4] || null, visible: true, alpha: 1 });
    menuActors.push(id);
  });
  renderer.setCinematic({
    key: 'menu',
    fn: (cam, t) => {
      const a = t * 0.05;
      cam.position.set(28 + Math.sin(a) * 9, 2.1 + Math.sin(t * 0.2) * 0.15, 21 + Math.cos(a) * 5.5);
      cam.lookAt(28, 1.2, 21);
    },
    fov: 55,
  });
}
function stopMenuScene() {
  for (const id of menuActors) renderer.removeCharacter(id);
  menuActors = [];
  renderer.setCinematic(null);
}

// ------------------------------------------------------------- loop
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game) game.frame(dt);
  else renderer.render(dt, { x: 28, z: 21, rot: 0 });
  if (voice) voice.frame?.(dt);
  requestAnimationFrame(loop);
}

window.addEventListener('pointerdown', () => audio.init(), { once: true });
window.addEventListener('keydown', () => audio.init(), { once: true });

startMenuScene();
menu.showMain();
connect(params.get('local') === '1');
requestAnimationFrame(loop);
setInterval(() => menu.updateStatus(), 2000);
void THREE;
