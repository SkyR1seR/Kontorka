// Рендерер: сцена в низком разрешении + постобработка (дизеринг, 15-битный цвет,
// виньетка, зерно), камера из-за плеча / сверху / кинематографическая, персонажи, эффекты.
import * as THREE from 'three';
import { ZONES, ZONE_BY_ID, MapRuntime, NPCS, STATION_BY_ID, DOOR_BY_ID } from '../../shared/map.js';
import { STAFF, NPC_LOOKS } from '../../shared/content.js';
import { buildWorld } from './world.js';
import { buildCharacter } from './character.js';
import { U, MAX_GLOW, lambert, lambertUnique, basic } from './materials.js';
import { tex } from './textures.js';

const POST_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FS = `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uLowRes;
uniform float uTime;
uniform float uDither;
uniform float uVignette;
uniform float uGrain;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uFade;
varying vec2 vUv;
float bayer4(vec2 p){
  int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16];
  m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
  m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
  float v = 0.0;
  for (int k = 0; k < 16; k++) { if (k == i) v = m[k]; }
  return v / 16.0;
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec2 px = floor(vUv * uLowRes);
  vec3 c = texture2D(tDiffuse, (px + 0.5) / uLowRes).rgb;
  c = toSRGB(c);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.18);
  c = (c - 0.5) * 1.1 + 0.52;
  c *= vec3(1.03, 1.0, 0.95);
  float b = bayer4(px) - 0.5;
  c = floor(c * 31.0 + 0.5 + b * uDither) / 31.0;
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 1.6 * uVignette;
  c += (hash(px + fract(uTime) * 97.0) - 0.5) * uGrain;
  c = mix(c, uFlashColor, uFlash);
  c *= (1.0 - uFade);
  gl_FragColor = vec4(c, 1.0);
}`;

const ANIM_NAMES = ['idle', 'walk', 'work', 'sit', 'carry', 'wave', 'panic', 'fired', 'drink'];

export class GameRenderer {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;
    container.appendChild(renderer.domElement);
    renderer.domElement.className = 'game-canvas';
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b0a0a');
    this.scene.fog = new THREE.Fog('#0b0a0a', 18, 42);
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.08, 80);
    this.map = new MapRuntime();

    const hemi = new THREE.HemisphereLight('#fff4dc', '#5a4c3e', 3.0);
    const dir = new THREE.DirectionalLight('#ffffff', 1.6);
    dir.position.set(0.4, 1, 0.7);
    this.scene.add(hemi, dir);
    this.hemi = hemi;
    this.dir = dir;

    this.world = buildWorld(this.scene);
    this.chars = new Map();
    this.items = new Map();
    this.fx = [];
    this.smokeMat = basic({ color: '#6a6a6a', transparent: true, opacity: 0.55 });
    this.zoneDark = {};
    this.zoneDarkF = Object.fromEntries(ZONES.map((z) => [z.id, 1]));
    this.dim = new Set();
    this.flash = 0;
    this.shake = 0;
    this.fade = 0;
    this.time = 0;
    this.krediki = 0;
    this.camMode = 'follow';
    this.cam = { yaw: Math.PI, pitch: 0.34, dist: 3.9, x: 28, z: 32, tx: 28, tz: 32, smoothYaw: Math.PI };
    this.cine = null;
    this.pixelScale = 3;
    this.dither = 1;
    this.showCeiling = true;

    // Постобработка
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: null }, uLowRes: { value: new THREE.Vector2(320, 180) }, uTime: { value: 0 },
        uDither: { value: 1 }, uVignette: { value: 1 }, uGrain: { value: 0.035 }, uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Color('#ffffff') }, uFade: { value: 0 },
      },
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat));
    this.rt = null;

    this._buildNPCs();
    this._buildItemsBase();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setPixelScale(s) { this.pixelScale = s; this.resize(); }
  setJitter(on) { U.uSnapOn.value = on ? 1 : 0; }
  setDither(on) { this.postMat.uniforms.uDither.value = on ? 1 : 0; }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    const s = Math.max(1, this.pixelScale);
    const lw = Math.max(160, Math.round(w / s));
    const lh = Math.max(90, Math.round(h / s));
    if (this.rt) this.rt.dispose();
    const type = this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.rt = new THREE.WebGLRenderTarget(lw, lh, { type, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: true });
    this.postMat.uniforms.tDiffuse.value = this.rt.texture;
    this.postMat.uniforms.uLowRes.value.set(lw, lh);
    U.uSnap.value.set(lw / 2, lh / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewW = w;
    this.viewH = h;
  }

  // ---------------------------------------------------------- characters
  lookFor(staff) { return STAFF[staff]?.look || STAFF[0].look; }

  addCharacter(id, staff, name) {
    if (this.chars.has(id)) return this.chars.get(id);
    const rig = buildCharacter(this.lookFor(staff));
    this.scene.add(rig.root);
    const c = { id, rig, name, staff, x: 0, z: 0, rot: 0, anim: 'idle', kind: null, visible: true, alpha: 1, talkUntil: 0, carry: null, speed: 0 };
    this.chars.set(id, c);
    return c;
  }

  removeCharacter(id) {
    const c = this.chars.get(id);
    if (!c) return;
    this.scene.remove(c.rig.root);
    this.chars.delete(id);
  }

  clearCharacters() { for (const id of [...this.chars.keys()]) if (!id.startsWith('npc_')) this.removeCharacter(id); }

  setCharState(id, st) {
    const c = this.chars.get(id);
    if (!c) return;
    Object.assign(c, st);
  }

  talk(id, seconds = 3) {
    const c = this.chars.get(id);
    if (c) c.talkUntil = this.time + seconds;
  }

  _buildNPCs() {
    for (const n of NPCS) {
      const rig = buildCharacter(NPC_LOOKS[n.look]);
      rig.root.position.set(n.x, 0, n.z);
      rig.root.rotation.y = n.rot;
      this.scene.add(rig.root);
      this.chars.set(n.id, { id: n.id, rig, name: n.name, npc: true, x: n.x, z: n.z, rot: n.rot, anim: n.id === 'npc_bidonya' ? 'work' : 'idle', kind: 'stir', visible: true, alpha: 1, talkUntil: 0 });
    }
  }

  // ---------------------------------------------------------- items
  _buildItemsBase() {
    const cart = new THREE.Group();
    const m = lambert({ tex: 'metal' });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.7), m); base.position.y = 0.35;
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 0.65), lambert({ color: '#7a7f84' })); basket.position.y = 0.65;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.7), m); handle.position.set(-0.55, 1.0, 0);
    cart.add(base, basket, handle);
    for (const [x, z] of [[-0.4, -0.28], [0.4, -0.28], [-0.4, 0.28], [0.4, 0.28]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 6), lambert({ color: '#1a1a1a' }));
      w.rotation.x = Math.PI / 2; w.position.set(x, 0.1, z);
      cart.add(w);
    }
    // мешки со слоповиной в тележке
    for (let i = 0; i < 3; i++) {
      const sack = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), lambert({ color: '#6a7a3a' }));
      sack.position.set(-0.25 + i * 0.25, 0.95, 0);
      cart.add(sack);
    }
    cart.visible = false;
    this.scene.add(cart);
    this.cartMesh = cart;
  }

  setItems(items) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      if (it.kind === 'cart') {
        this.cartMesh.visible = true;
        this.cartMesh.position.set(it.x, 0, it.z);
        const carrier = it.carriedBy ? this.chars.get(it.carriedBy) : null;
        if (carrier) this.cartMesh.rotation.y = carrier.rot + Math.PI / 2;
        else if (it.door) {
          const d = DOOR_BY_ID[it.door];
          this.cartMesh.rotation.y = d && d.h ? 0 : Math.PI / 2;
        }
        continue;
      }
      if (it.kind === 'folder') {
        let m = this.items.get(it.id);
        if (!m) {
          m = new THREE.Group();
          const f = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.44), lambert({ color: '#b02a2a' }));
          f.position.y = 0.04;
          const paper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.4), lambert({ tex: 'paper' }));
          paper.position.y = 0.08;
          m.add(f, paper);
          m.rotation.y = Math.random() * Math.PI;
          this.scene.add(m);
          this.items.set(it.id, m);
        }
        m.visible = !it.carriedBy;
        m.position.set(it.x, 0, it.z);
      }
    }
    for (const [id, m] of this.items) if (!seen.has(id)) { this.scene.remove(m); this.items.delete(id); }
  }

  // ---------------------------------------------------------- world state visuals
  applyWorld(w, extra = {}) {
    if (!w) return;
    // свет
    this.zoneDark = {};
    for (const z of Object.keys(w.dark || {})) this.zoneDark[z] = true;
    this.dim = new Set(w.dim || []);
    this.krediki = w.krediki || 0;
    // двери
    for (const [id, h] of Object.entries(this.world.doors)) {
      const st = w.doors?.[id];
      h.leaf.visible = st === 'locked' || st === 'sealed';
      for (const t of h.tape) t.visible = st === 'sealed';
      this.map.setDoor(id, { locked: st === 'locked' || st === 'sealed', cart: st === 'cart' });
    }
    // экраны и принтеры
    for (const [stId, scr] of Object.entries(this.world.screens)) {
      const err = w.broken?.[stId] === 'status_corrupt';
      if (scr._err !== err) { scr.material.map = tex(err ? 'screen_err' : 'screen'); scr.material.needsUpdate = true; scr._err = err; }
    }
    for (const [stId, p] of Object.entries(this.world.printers)) {
      p.broken = w.broken?.[stId] === 'printer_break';
      p.lamp.material.color.set(p.broken ? '#ff2020' : '#30ff40');
    }
    const open = (type) => (w.incidents || []).some((i) => i.open && i.type === type);
    if (this.world.lockerLamp) this.world.lockerLamp.material.color.set(open('locker_lock') ? '#ff2020' : '#30ff40');
    if (this.world.pot) {
      const spoiled = open('soup_spoil');
      this.world.pot.soupMat.color.set(spoiled ? '#5a8a20' : '#c8a040');
      this.world.pot.spoiled = spoiled;
    }
    if (this.world.keybox) this.world.keybox.visible = !open('archive_lock');
    this.accelAlarm = !!w.accel;
    if (this.world.boardNote) {
      const forged = (w.order?.version || 1) >= 2;
      this.world.boardStamp.material.color.set(forged ? '#a02a6a' : '#2a4ac0');
    }
    for (const c of this.world.chairs) c.visible = w.order?.id !== 'no_chairs';
    this.setItems(w.items || []);
    void extra;
  }

  explosion() { this.flash = 1; this.shake = 1.2; }

  // ---------------------------------------------------------- camera
  setCamMode(mode) { this.camMode = mode; }

  setCinematic(c) { this.cine = c; }

  _updateCamera(dt, focus) {
    const cam = this.camera;
    if (this.cine) {
      const c = this.cine;
      const t = c.t = (c.t || 0) + dt;
      if (c.fn) {
        c.fn(cam, t);
      } else {
        const k = c.lerp ? Math.min(1, dt * c.lerp) : 1;
        if (!c.cur) c.cur = { pos: c.pos.clone(), look: c.look.clone() };
        c.cur.pos.lerp(c.pos, k);
        c.cur.look.lerp(c.look, k);
        cam.position.copy(c.cur.pos);
        if (c.drift) cam.position.x += Math.sin(t * 0.3) * c.drift;
        cam.lookAt(c.cur.look);
      }
      cam.fov = c.fov || 50;
      cam.updateProjectionMatrix();
      return;
    }
    if (cam.fov !== 62) { cam.fov = 62; cam.updateProjectionMatrix(); }
    const st = this.cam;
    if (!focus) return;
    // плавное следование
    st.tx += (focus.x - st.tx) * Math.min(1, dt * 14);
    st.tz += (focus.z - st.tz) * Math.min(1, dt * 14);
    let dy = 0;
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 1.5); dy = (Math.random() - 0.5) * 0.12 * this.shake; }
    if (this.camMode === 'top') {
      const dist = 11 + st.dist * 1.2;
      const pitch = 1.0;
      const yaw = st.yaw;
      cam.position.set(st.tx - Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + dy, st.tz - Math.cos(yaw) * Math.cos(pitch) * dist);
      cam.lookAt(st.tx, 0.8, st.tz);
      return;
    }
    const yaw = st.yaw;
    const pitch = st.pitch;
    const head = new THREE.Vector3(st.tx, 1.55, st.tz);
    const dirX = Math.sin(yaw) * Math.cos(pitch);
    const dirZ = Math.cos(yaw) * Math.cos(pitch);
    const dirY = -Math.sin(pitch);
    // камера за плечом: назад по направлению взгляда + сдвиг вправо
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    let dist = st.dist;
    const desired = (dd) => new THREE.Vector3(head.x - dirX * dd + right.x * 0.42, head.y - dirY * dd + 0.25, head.z - dirZ * dd + right.z * 0.42);
    // столкновение со стенами по сетке видимости
    for (let k = 0; k < 12; k++) {
      const p = desired(dist);
      if (this.map.lineOfSight(head.x, head.z, p.x, p.z) && p.x > 0.3 && p.z > 0.3) break;
      dist *= 0.8;
    }
    const p = desired(dist);
    p.y = Math.min(2.72, Math.max(0.5, p.y)) + dy;
    cam.position.copy(p);
    const look = new THREE.Vector3(head.x + dirX * 4, head.y + dirY * 4 + 0.1, head.z + dirZ * 4);
    cam.lookAt(look);
  }

  // ---------------------------------------------------------- frame
  render(dt, focus) {
    this.time += dt;
    const t = this.time;
    // свет по зонам: плавное затухание при отключении, мерцание при высоких кредиках
    ZONES.forEach((z, i) => {
      const target = this.zoneDark[z.id] ? 0.06 : (this.dim.has(z.id) ? 0.45 : 1);
      const cur = this.zoneDarkF[z.id];
      this.zoneDarkF[z.id] = cur + (target - cur) * Math.min(1, dt * (target < cur ? 10 : 2.5));
      let lum = z.lum * this.zoneDarkF[z.id];
      if (this.krediki >= 80 && Math.sin(t * 23 + i * 3) > 0.92) lum *= 0.4;
      U.uZoneLum.value[i] = lum;
      const lamp = this.world.fluor[z.id];
      if (lamp) lamp.color.setScalar(Math.max(0.08, this.zoneDarkF[z.id]));
    });
    // мониторы светятся в темноте
    const glows = [];
    for (const g of this.world.glow) {
      const zone = STATION_BY_ID[g.st]?.zone;
      const darkK = zone ? 1 - this.zoneDarkF[zone] : 0;
      if (darkK > 0.05 && focus) glows.push({ g, d: Math.hypot(g.pos.x - focus.x, g.pos.z - focus.z), k: darkK });
    }
    glows.sort((a, b) => a.d - b.d);
    for (let i = 0; i < MAX_GLOW; i++) {
      const v = U.uGlow.value[i];
      const gg = glows[i];
      if (gg) v.set(gg.g.pos.x, gg.g.pos.y, gg.g.pos.z, 0.9 * gg.k);
      else v.set(0, 0, 0, 0);
    }
    // ускоритель
    const A = this.world.accel;
    if (A) {
      const alarm = this.accelAlarm;
      A.rings.forEach((r, i) => {
        r.rotation.z += dt * (alarm ? 6 : 1.2) * (i % 2 ? 1 : -1);
        r.material.color.set(alarm ? (Math.sin(t * 12) > 0 ? '#ff2020' : '#ffb020') : '#40ffd0');
      });
      A.core.material.color.set(alarm ? '#ff4020' : '#2ac0a0');
      for (const l of A.lamps) l.material.color.set(alarm ? (Math.sin(t * 10) > 0 ? '#ff2020' : '#401010') : '#30ff40');
    }
    // дым из сломанных принтеров и пузыри испорченных щей
    this._fxTick(dt);
    // персонажи
    for (const c of this.chars.values()) {
      const r = c.rig;
      r.root.position.set(c.x, 0, c.z);
      let dr = c.rot - r.root.rotation.y;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      r.root.rotation.y += dr * Math.min(1, dt * 12);
      const targetA = c.visible ? 1 : 0;
      c.alpha += (targetA - c.alpha) * Math.min(1, dt * 8);
      r.root.visible = c.alpha > 0.05;
      if (r.root.visible) {
        r.update(dt, { anim: c.anim, kind: c.kind, talking: c.talkUntil > this.time, speed: c.speed, lookAround: c.npc });
        r.setHeld(c.carry === 'folder' || c.carry === 'cabbage' ? c.carry : null);
      }
    }
    this.world.ceilingGroup.visible = this.showCeiling && this.camMode !== 'top';
    this._updateCamera(dt, focus);
    // рендер в низком разрешении
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.postMat.uniforms.uFlash.value = this.flash * 0.8;
    this.postMat.uniforms.uTime.value = t;
    this.postMat.uniforms.uFade.value = this.fade;
    this.renderer.render(this.postScene, this.postCam);
  }

  _fxTick(dt) {
    for (const p of Object.values(this.world.printers)) {
      if (p.broken && Math.random() < dt * 8) this._spawnPuff(p.pos.x + (Math.random() - 0.5) * 0.4, 1.2, p.pos.z + (Math.random() - 0.5) * 0.3, '#5a5a5a');
    }
    if (this.world.pot?.spoiled && Math.random() < dt * 5) {
      const pp = this.world.pot.pos;
      this._spawnPuff(pp.x + (Math.random() - 0.5) * 0.8, 0.95, pp.z + (Math.random() - 0.5) * 0.8, '#7aa02a', 0.08);
    }
    if (this.accelAlarm && Math.random() < dt * 6) {
      const ap = this.world.accel.pos;
      this._spawnPuff(ap.x + (Math.random() - 0.5) * 2, 2.8, ap.z + (Math.random() - 0.5) * 2, '#d0d0d0');
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      f.m.position.y += dt * f.vy;
      f.m.scale.multiplyScalar(1 + dt * 0.8);
      f.m.material.opacity = Math.max(0, f.life / f.max) * 0.6;
      f.m.quaternion.copy(this.camera.quaternion);
      if (f.life <= 0) { this.scene.remove(f.m); f.m.material.dispose(); this.fx.splice(i, 1); }
    }
  }

  _spawnPuff(x, y, z, color, size = 0.22) {
    if (this.fx.length > 120) return;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }));
    m.position.set(x, y, z);
    this.scene.add(m);
    this.fx.push({ m, life: 1.6, max: 1.6, vy: 0.5 + Math.random() * 0.3 });
  }

  // Экранные координаты точки (для табличек с именами)
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * this.viewW, y: (-v.y * 0.5 + 0.5) * this.viewH, depth: this.camera.position.distanceTo(new THREE.Vector3(x, y, z)) };
  }

  // ---------------------------------------------------------- portraits
  portrait(staff, size = 128, npcLook = null) {
    this._portraits = this._portraits || new Map();
    const key = npcLook ? `npc:${npcLook}` : staff;
    if (this._portraits.has(key)) return this._portraits.get(key);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1c1a20');
    scene.add(new THREE.HemisphereLight('#fff4dc', '#3a3030', 3.2));
    const dl = new THREE.DirectionalLight('#ffffff', 2.2);
    dl.position.set(0.6, 0.8, 1);
    scene.add(dl);
    const rig = buildCharacter(npcLook ? NPC_LOOKS[npcLook] : this.lookFor(staff));
    rig.update(0.01, { anim: 'idle' });
    scene.add(rig.root);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 10);
    rig.root.updateMatrixWorld(true);
    const hp = new THREE.Vector3();
    rig.head.getWorldPosition(hp);
    const headY = hp.y + rig.face.height * 0.5 * rig.root.scale.x;
    cam.position.set(0.32, headY + 0.03, 1.3);
    cam.lookAt(0, headY - 0.04, 0);
    const rt = new THREE.WebGLRenderTarget(size, size);
    const prevSnap = U.uSnapOn.value;
    U.uSnapOn.value = 0;
    const lums = U.uZoneLum.value.slice();
    for (let i = 0; i < lums.length; i++) U.uZoneLum.value[i] = 1;
    this.renderer.setRenderTarget(rt);
    this.renderer.render(scene, cam);
    const buf = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    this.renderer.setRenderTarget(null);
    U.uSnapOn.value = prevSnap;
    lums.forEach((v, i) => { U.uZoneLum.value[i] = v; });
    rt.dispose();
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const si = ((size - 1 - y) * size + x) * 4;
        const di = (y * size + x) * 4;
        // линейный -> sRGB (упрощённо)
        img.data[di] = Math.min(255, Math.pow(buf[si] / 255, 1 / 2.2) * 255);
        img.data[di + 1] = Math.min(255, Math.pow(buf[si + 1] / 255, 1 / 2.2) * 255);
        img.data[di + 2] = Math.min(255, Math.pow(buf[si + 2] / 255, 1 / 2.2) * 255);
        img.data[di + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    this._portraits.set(key, url);
    return url;
  }
}

export { ANIM_NAMES, ZONE_BY_ID };
void lambertUnique;
