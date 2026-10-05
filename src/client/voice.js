// Голосовой чат (TZ 7.2): push-to-talk, близкий голос во время шабашки
// (громкость по расстоянию от сервера), общий голос на планёрке.
// P2P WebRTC, сигнализация через игровой сервер.
import { settings } from './settings.js';

export function initVoice({ conn, myId, getGame }) {
  if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
    return { handle() {}, frame() {}, destroy() {} };
  }
  const peers = new Map(); // id -> { pc, audio, stream }
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  let local = null;
  let micState = 'off'; // off | asking | ready | denied
  let pttDown = false;
  const talking = new Map();
  const indicator = document.createElement('div');
  indicator.className = 'ptt-indicator hidden';
  indicator.textContent = '● РАЦИЯ';
  document.body.append(indicator);

  function send(to, data) { conn.send({ t: 'rtc', to, data }); }

  async function ensureMic() {
    if (local || micState === 'asking' || micState === 'denied') return local;
    micState = 'asking';
    try {
      local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      micState = 'ready';
      for (const t of local.getAudioTracks()) t.enabled = false;
      for (const [id, p] of peers) {
        for (const t of local.getAudioTracks()) p.pc.addTrack(t, local);
        renegotiate(id);
      }
    } catch (e) {
      micState = 'denied';
      getGame()?.hud?.toast('Микрофон недоступен — используйте текстовый чат (Enter).', 'warn', 6000);
    }
    return local;
  }

  function makePeer(id) {
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection({ iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    const p = { pc, audio, makingOffer: false, polite: myId > id };
    pc.onicecandidate = (e) => { if (e.candidate) send(id, { cand: e.candidate }); };
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); };
    pc.onnegotiationneeded = () => renegotiate(id);
    if (local) for (const t of local.getAudioTracks()) pc.addTrack(t, local);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    peers.set(id, p);
    return p;
  }

  async function renegotiate(id) {
    const p = peers.get(id);
    if (!p) return;
    try {
      p.makingOffer = true;
      await p.pc.setLocalDescription();
      send(id, { desc: p.pc.localDescription });
    } catch { /* ignore */ } finally { p.makingOffer = false; }
  }

  async function onSignal(from, data) {
    const p = makePeer(from);
    try {
      if (data.desc) {
        const collision = data.desc.type === 'offer' && (p.makingOffer || p.pc.signalingState !== 'stable');
        if (collision && !p.polite) return;
        await p.pc.setRemoteDescription(data.desc);
        if (data.desc.type === 'offer') {
          await p.pc.setLocalDescription();
          send(from, { desc: p.pc.localDescription });
        }
      } else if (data.cand) {
        await p.pc.addIceCandidate(data.cand).catch(() => {});
      }
    } catch { /* ignore */ }
  }

  function setupPeers() {
    const g = getGame();
    if (!g) return;
    for (const pl of g.players.values()) {
      if (pl.bot || pl.id === g.myId) continue;
      const p = makePeer(pl.id);
      if (g.myId < pl.id) renegotiate(pl.id);
      void p;
    }
  }

  const keyDown = async (e) => {
    if (!settings.voice || e.code !== settings.pttKey || e.repeat) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
    pttDown = true;
    await ensureMic();
    if (!local || !pttDown) return;
    for (const t of local.getAudioTracks()) t.enabled = true;
    indicator.classList.remove('hidden');
    conn.send({ t: 'ptt', on: true });
  };
  const keyUp = (e) => {
    if (e.code !== settings.pttKey) return;
    pttDown = false;
    if (local) for (const t of local.getAudioTracks()) t.enabled = false;
    indicator.classList.add('hidden');
    conn.send({ t: 'ptt', on: false });
  };
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);

  return {
    handle(msg) {
      if (msg.t === 'welcome' && msg.iceServers) iceServers = msg.iceServers;
      if (msg.t === 'init') setTimeout(setupPeers, 300);
      if (msg.t === 'rtc') onSignal(msg.from, msg.data);
      if (msg.t === 'ptt') talking.set(msg.from, msg.on);
    },
    frame() {
      const g = getGame();
      if (!g) return;
      const phase = g.phase?.name;
      const aliveMap = g.world?.alive || {};
      const meAlive = g.alive;
      for (const [id, p] of peers) {
        const peerAlive = aliveMap[id] !== false;
        let vol = 0;
        if (!settings.voice) vol = 0;
        else if (meAlive && !peerAlive) vol = 0; // уволенных живые не слышат
        else if (phase === 'meeting' || phase === 'intro' || phase === 'final' || phase === 'smoke') vol = 1;
        else vol = g.aud?.[id] ?? (meAlive ? 0 : 1);
        p.audio.volume = Math.max(0, Math.min(1, vol * settings.volVoice * settings.volMaster));
        if (talking.get(id) && vol > 0.05) g.r.talk(id, 0.3);
      }
      if (pttDown && local) g.r.talk(g.myId, 0.3);
    },
    destroy() {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      for (const p of peers.values()) { try { p.pc.close(); } catch { /* ignore */ } p.audio.srcObject = null; }
      peers.clear();
      if (local) for (const t of local.getTracks()) t.stop();
      local = null;
      indicator.remove();
    },
  };
}
