// Персонажи Конторки: цельные low-poly модели. Голова — одна сетка с вылепленными
// скулами, надбровной дугой, глазницами, челюстью и подбородком плюс нарисованная
// текстура лица. Тело — сплошная сетка по сечениям (плечи, грудь, живот, пояс),
// руки и ноги — сужающиеся трубки с рукавами, кистями и ботинками.
// Анимация — по суставам, как у моделей эпохи PS1/PS2.
import * as THREE from 'three';
import { patchPS1, basic, lambertUnique } from './materials.js';

const C = (hex) => new THREE.Color(hex);
const shade = (hex, k) => C(hex).multiplyScalar(k);
const mix = (a, b, k) => C(a).lerp(C(b), k);

function vcMat(flat = false) {
  return patchPS1(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: flat, side: THREE.DoubleSide }));
}

// Лофт по сечениям: суперэллипсы вокруг оси Y. a=0 — перед (+z), a=π/2 — +x.
function loft(rings, n, { capTop = false, capBottom = false } = {}) {
  const pos = [];
  const col = [];
  const idx = [];
  for (const r of rings) {
    const e = 2 / (r.sq || 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      let x = (r.cx || 0) + r.rx * Math.sign(s) * Math.abs(s) ** e;
      let z = (r.cz || 0) + r.rz * Math.sign(c) * Math.abs(c) ** e;
      if (r.front && c > 0) z += r.front * c * c;
      if (r.back && c < 0) z -= r.back * c * c;
      if (r.flatBack && c < 0) z = (r.cz || 0) + (z - (r.cz || 0)) * r.flatBack;
      pos.push(x, r.y, z);
      const cc = r.colFn ? r.colFn(a, c, s) : r.col;
      col.push(cc.r, cc.g, cc.b);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const a = k * n + i;
      const b = k * n + ((i + 1) % n);
      const c = (k + 1) * n + i;
      const d = (k + 1) * n + ((i + 1) % n);
      idx.push(a, c, b, b, c, d);
    }
  }
  const cap = (k) => {
    const r = rings[k];
    const center = pos.length / 3;
    pos.push(r.cx || 0, r.y, r.cz || 0);
    const cc = r.col || r.colFn(0, 1, 0);
    col.push(cc.r, cc.g, cc.b);
    for (let i = 0; i < n; i++) idx.push(center, k * n + i, k * n + ((i + 1) % n));
  };
  if (capBottom) cap(0);
  if (capTop) cap(rings.length - 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Профиль ширины тела по высоте: куда «прикреплять» галстук, карман и т.п.
function frontAt(rings, y) {
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k];
    const b = rings[k + 1];
    if (y >= a.y && y <= b.y) {
      const t = (y - a.y) / (b.y - a.y || 1);
      return (a.rz + (b.rz - a.rz) * t) + ((a.front || 0) + ((b.front || 0) - (a.front || 0)) * t) + (a.cz || 0);
    }
  }
  return rings[rings.length - 1].rz;
}

// ---------------------------------------------------------------- голова
const HEAD_SHAPES = {
  round: { w: 0.2, h: 0.215, d: 0.2, jaw: 0.82, chin: 0.12, chinLen: 0.12, cranium: 0.6, brow: 1.0, cheek: 1.0 },
  long: { w: 0.165, h: 0.255, d: 0.19, jaw: 0.58, chin: 0.42, chinLen: 0.38, cranium: 0.3, brow: 1.5, cheek: 1.3 },
  wide: { w: 0.245, h: 0.205, d: 0.21, jaw: 1.06, chin: 0.06, chinLen: 0.08, cranium: 0.4, brow: 0.9, cheek: 1.7 },
};

function gauss(dt, dp, wt, wp) { return Math.exp(-((dt * dt) / (wt * wt) + (dp * dp) / (wp * wp))); }

// Точка поверхности головы по широте theta (−π/2..π/2) и долготе phi (0 — лицо)
function headPoint(P, theta, phi) {
  const ct = Math.cos(theta);
  let x = Math.sin(phi) * ct;
  let y = Math.sin(theta);
  let z = Math.cos(phi) * ct;
  if (y < 0) {
    const k = -y;
    const fr = Math.min(1, Math.max(0, (z + 0.35) / 1.1)); // удлиняем только лицевую часть
    x *= 1 - (1 - P.jaw) * k * (0.4 + 0.6 * fr);
    if (z > 0) z += P.chin * k * k * z;
    y *= 1 + P.chinLen * k * fr;
    if (z < 0) z *= 1 - 0.25 * k; // затылок переходит в шею
  } else {
    if (z < 0) z *= 1 + P.cranium * 0.12 * y;
    x *= 1 + 0.05 * y;
  }
  if (z > 0.74) z = 0.74 + (z - 0.74) * 0.35; // плоскость лица
  z += gauss(theta - 0.3, phi, 0.11, 0.75) * 0.085 * P.brow; // надбровная дуга
  for (const sg of [-1, 1]) {
    z -= gauss(theta - 0.12, phi - sg * 0.36, 0.11, 0.15) * 0.07; // глазницы
    const ch = gauss(theta + 0.1, phi - sg * 0.66, 0.2, 0.22) * 0.07 * P.cheek; // скулы/щёки
    x += sg * ch;
    z += ch * 0.3;
  }
  z += gauss(theta + 0.62, phi, 0.1, 0.25) * 0.03; // губы
  return new THREE.Vector3(x * P.w, y * P.h + P.h, z * P.d);
}

function headCenter(P) { return new THREE.Vector3(0, P.h, 0); }

function buildHeadMesh(P, map, flat, LAT = 14, LON = 18) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let k = 0; k <= LAT; k++) {
    const theta = -Math.PI / 2 + (k / LAT) * Math.PI;
    for (let j = 0; j <= LON; j++) {
      const phi = -Math.PI + (j / LON) * Math.PI * 2;
      const p = headPoint(P, theta, phi);
      pos.push(p.x, p.y, p.z);
      uv.push(j / LON, k / LAT);
    }
  }
  const W = LON + 1;
  for (let k = 0; k < LAT; k++) {
    for (let j = 0; j < LON; j++) {
      const a = k * W + j;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // сшиваем нормали на шве
  const nrm = g.attributes.normal;
  for (let k = 0; k <= LAT; k++) {
    const a = k * W;
    const b = k * W + LON;
    const nx = nrm.getX(a) + nrm.getX(b);
    const ny = nrm.getY(a) + nrm.getY(b);
    const nz = nrm.getZ(a) + nrm.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(a, nx / l, ny / l, nz / l);
    nrm.setXYZ(b, nx / l, ny / l, nz / l);
  }
  const mat = patchPS1(new THREE.MeshLambertMaterial({ map, flatShading: flat, side: THREE.DoubleSide }));
  return new THREE.Mesh(g, mat);
}

// Текстура лица в широтно-долготной развёртке (u — долгота, v — широта)
function faceTexture(L, female) {
  const W = 256;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const skin = C(L.skin);
  const css = (c, a = 1) => {
    const t = {};
    c.getRGB(t, THREE.SRGBColorSpace);
    return `rgba(${Math.round(t.r * 255)},${Math.round(t.g * 255)},${Math.round(t.b * 255)},${a})`;
  };
  x.fillStyle = css(skin);
  x.fillRect(0, 0, W, H);
  const U = (phi) => (0.5 + phi / (Math.PI * 2)) * W;
  const V = (theta) => (1 - (0.5 + theta / Math.PI)) * H;
  // затылок и бока темнее, лицо светлее
  const grd = x.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, 'rgba(60,20,10,0.22)'); grd.addColorStop(0.35, 'rgba(0,0,0,0)');
  grd.addColorStop(0.65, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(60,20,10,0.22)');
  x.fillStyle = grd; x.fillRect(0, 0, W, H);
  // румянец/красноватые щёки
  for (const sg of [-1, 1]) {
    const rg = x.createRadialGradient(U(sg * 0.55), V(-0.12), 1, U(sg * 0.55), V(-0.12), 14);
    rg.addColorStop(0, female ? 'rgba(220,80,90,0.35)' : 'rgba(200,70,60,0.22)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
  }
  const dark = css(shade(L.skin, 0.62), 0.85);
  x.strokeStyle = dark;
  x.lineWidth = 1.3;
  // мешки под глазами
  for (const sg of [-1, 1]) {
    x.beginPath(); x.ellipse(U(sg * 0.36), V(0.03), 9, 4, 0, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    // носогубные складки
    x.beginPath(); x.moveTo(U(sg * 0.14), V(-0.22)); x.quadraticCurveTo(U(sg * 0.27), V(-0.4), U(sg * 0.23), V(-0.62)); x.stroke();
    // уголки рта вниз
    x.beginPath(); x.moveTo(U(sg * 0.16), V(-0.62)); x.lineTo(U(sg * 0.2), V(-0.7)); x.stroke();
  }
  // морщины на лбу у тревожных и злых
  if (L.brow === 'worried' || L.brow === 'angry' || L.head === 'long') {
    x.strokeStyle = css(shade(L.skin, 0.7), 0.7);
    for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(U(-0.35), V(0.48 + i * 0.07)); x.quadraticCurveTo(U(0), V(0.5 + i * 0.07 + (L.brow === 'worried' ? 0.04 : -0.03)), U(0.35), V(0.48 + i * 0.07)); x.stroke(); }
  }
  // губы
  x.fillStyle = L.lipstick ? 'rgba(190,30,50,0.85)' : css(shade(L.skin, 0.72), 0.7);
  x.beginPath(); x.ellipse(U(0), V(-0.63), 11, 2.4, 0, 0, Math.PI * 2); x.fill();
  // щетина у некоторых мужчин
  if (!female && (L.stubble ?? L.brow === 'angry')) {
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    x.fillStyle = 'rgba(40,30,30,0.35)';
    for (let i = 0; i < 260; i++) {
      const ph = (rnd() - 0.5) * 1.6;
      const th = -0.4 - rnd() * 0.6;
      x.fillRect(U(ph), V(th), 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Волосы: оболочка по форме черепа, маска задаёт причёску
function hairMask(style, theta, phi) {
  const ap = Math.abs(phi);
  const front = ap < 0.95;
  const line = front ? 0.4 - (ap / 0.95) * 0.12 : 0.28 - ((ap - 0.95) / (Math.PI - 0.95)) * 0.78;
  switch (style) {
    case 'bald': return theta > -0.25 && theta < 0.18 && ap > 1.25;
    case 'bob': return theta > (front ? 0.3 - (ap / 0.95) * 0.1 : (ap > 1.35 ? -0.55 : 0.0));
    case 'flat': return theta > line;
    default: return theta > line;
  }
}

function buildHair(P, style, color, LAT = 14, LON = 18) {
  const c = C(color);
  const cen = headCenter(P);
  const pos = [];
  const col = [];
  const idx = [];
  const map = new Map();
  const vert = (k, j) => {
    const key = k * 100 + j;
    if (map.has(key)) return map.get(key);
    const theta = -Math.PI / 2 + (k / LAT) * Math.PI;
    const phi = -Math.PI + (j / LON) * Math.PI * 2;
    const p = headPoint(P, theta, phi);
    const d = p.clone().sub(cen);
    let thick = style === 'bob' ? 1.13 : 1.09;
    if (style === 'flat' && theta > 0.9) thick = 1.04;
    p.copy(cen).add(d.multiplyScalar(thick));
    if (style === 'flat') p.y = Math.min(p.y, P.h * 2.02 + 0.015);
    if (style === 'comb' && theta > 0.5) p.x += 0.02 * Math.sin(phi);
    const shadeK = 0.85 + 0.25 * Math.max(0, Math.sin(theta));
    pos.push(p.x, p.y, p.z);
    col.push(c.r * shadeK, c.g * shadeK, c.b * shadeK);
    const i = pos.length / 3 - 1;
    map.set(key, i);
    return i;
  };
  for (let k = 0; k < LAT; k++) {
    for (let j = 0; j < LON; j++) {
      const t0 = -Math.PI / 2 + (k / LAT) * Math.PI;
      const t1 = -Math.PI / 2 + ((k + 1) / LAT) * Math.PI;
      const p0 = -Math.PI + (j / LON) * Math.PI * 2;
      const p1 = -Math.PI + ((j + 1) / LON) * Math.PI * 2;
      if (![[t0, p0], [t0, p1], [t1, p0], [t1, p1]].every(([t, p]) => hairMask(style, t, p))) continue;
      const a = vert(k, j);
      const b = vert(k, j + 1);
      const cc = vert(k + 1, j);
      const d = vert(k + 1, j + 1);
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const grp = new THREE.Group();
  const mat = vcMat(true);
  grp.add(new THREE.Mesh(g, mat));
  const hm = lambertUnique(color);
  if (style === 'spiky') {
    for (let i = 0; i < 11; i++) {
      const theta = 0.55 + (i % 3) * 0.28;
      const phi = (i / 11) * Math.PI * 2 - Math.PI;
      const p = headPoint(P, theta, phi);
      const dir = p.clone().sub(cen).normalize();
      dir.y += 0.6;
      dir.normalize();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 4), hm);
      cone.position.copy(cen).add(p.clone().sub(cen).multiplyScalar(1.05));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      grp.add(cone);
    }
  }
  if (style === 'bun') {
    const bun = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), hm);
    bun.position.copy(headPoint(P, 0.75, Math.PI)).add(new THREE.Vector3(0, 0.05, -0.04));
    grp.add(bun);
  }
  if (style === 'bald') {
    // залысина блестит — ничего не добавляем
  }
  return grp;
}

function featureFrame(P, theta, phi, out = 0) {
  const p = headPoint(P, theta, phi);
  const n = p.clone().sub(headCenter(P)).normalize();
  return { p: p.addScaledVector(n, out), n };
}

function buildHead(L, M) {
  const female = L.female;
  const base = HEAD_SHAPES[L.head] || HEAD_SHAPES.round;
  const P = { ...base };
  const flat = !!(L.head === 'long' || L.angular);
  const g = new THREE.Group();
  g.add(buildHeadMesh(P, faceTexture(L, female), flat));
  // уши
  for (const s of [-1, 1]) {
    const f = featureFrame(P, 0.02, s * Math.PI / 2, -0.01);
    const ear = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 0), M.skinDark);
    ear.position.copy(f.p);
    ear.scale.set(0.45, 1.15, 0.8);
    ear.rotation.y = s * 0.3;
    g.add(ear);
  }
  // Глаза: крупные белки в глазницах, верхние веки
  const eyeR = 0.056 * (L.eyes || 1);
  const eyes = [];
  // веко: отрицательный угол — глаз открыт, «тревожные» глаза чуть прикрыты сверху
  const lidOpen = { angry: -0.35, worried: -0.2, neutral: -0.55, surprised: -0.95 }[L.brow] ?? -0.5;
  for (const s of [-1, 1]) {
    const f = featureFrame(P, 0.12, s * 0.35, 0);
    const eg = new THREE.Group();
    eg.position.copy(f.p).addScaledVector(f.n, -eyeR * 0.45);
    eg.position.x += s * 0.004;
    const white = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 10, 8), M.eyeWhite);
    white.scale.set(1, 1.08, 0.85);
    const look = new THREE.Group();
    const iris = new THREE.Mesh(new THREE.CircleGeometry(eyeR * 0.42, 10), M.iris);
    iris.position.z = eyeR * 0.85 + 0.002;
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(eyeR * 0.2, 8), M.pupil);
    pupil.position.z = eyeR * 0.85 + 0.004;
    look.add(iris, pupil);
    const lidPivot = new THREE.Group();
    const lid = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 1.07, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), M.skin);
    lid.scale.set(1, 1.08, 0.9);
    lidPivot.add(lid);
    lidPivot.rotation.x = lidOpen;
    eg.add(white, look, lidPivot);
    g.add(eg);
    eyes.push({ g: eg, look, white, lid: lidPivot, lidOpen });
  }
  // Брови
  const brows = [];
  for (const s of [-1, 1]) {
    const f = featureFrame(P, 0.29, s * 0.34, 0.012);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.03, 0.035), M.hair);
    b.position.copy(f.p);
    g.add(b);
    brows.push({ m: b, s, y: b.position.y });
  }
  // Нос — вытянутый low-poly клин
  const nk = L.nose || 1;
  {
    const len = 0.075 * nk + 0.035;
    const wk = Math.min(1.35, nk);
    const ng = loft([
      { y: 0, rx: 0.03 * wk, rz: 0.075 * wk, col: C('#ffffff') },
      { y: len * 0.5, rx: 0.033 * wk, rz: 0.06 * wk, col: C('#ffffff') },
      { y: len * 0.85, rx: 0.042 * wk, rz: 0.04 * wk, col: C('#ffffff') },
      { y: len, rx: 0.03 * wk, rz: 0.026 * wk, col: C('#ffffff') },
    ], 7, { capTop: true });
    ng.rotateX(Math.PI / 2);
    // кончик вниз
    const p = ng.attributes.position;
    const droop = 0.35 + 0.3 * Math.max(0, nk - 1);
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - p.getZ(i) * droop);
    ng.computeVertexNormals();
    const nose = new THREE.Mesh(ng, M.skinV);
    const f = featureFrame(P, -0.1, 0, -0.035);
    nose.position.copy(f.p);
    g.add(nose);
  }
  // Рот
  const mf = featureFrame(P, -0.62, 0, -0.008);
  const mouth = new THREE.Group();
  mouth.position.copy(mf.p);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.01, 3, 8, Math.PI), M.mouth);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.034, 8), M.mouthIn);
  inner.position.set(0, -0.012, -0.004);
  inner.scale.set(1.2, 0.01, 1);
  mouth.add(lip, inner);
  g.add(mouth);
  if (L.mustache) {
    const f = featureFrame(P, -0.46, 0, 0.004);
    const mu = new THREE.Mesh(loft([
      { y: -0.07, rx: 0.012, rz: 0.012, col: C(L.hairColor) },
      { y: -0.03, rx: 0.03, rz: 0.02, col: C(L.hairColor) },
      { y: 0.03, rx: 0.03, rz: 0.02, col: C(L.hairColor) },
      { y: 0.07, rx: 0.012, rz: 0.012, col: C(L.hairColor) },
    ], 6, { capTop: true, capBottom: true }), vcMat(true));
    mu.rotation.z = Math.PI / 2;
    mu.position.copy(f.p);
    g.add(mu);
  }
  g.add(buildHair(P, L.hair, L.hairColor));
  // Очки: восьмиугольные (как у Господина Колупня) или круглые
  if (L.glasses) {
    const seg = L.glasses === 'octa' ? 8 : 12;
    for (const e of eyes) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(eyeR * 1.3, 0.011, 3, seg), M.glasses);
      ring.position.copy(e.g.position);
      ring.position.z += eyeR * 0.95;
      ring.rotation.z = Math.PI / seg;
      g.add(ring);
      const s = Math.sign(e.g.position.x);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.2), M.glasses);
      arm.position.set(e.g.position.x + s * eyeR * 1.3, e.g.position.y, e.g.position.z - 0.06);
      g.add(arm);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(eyes[0].g.position.x) * 2 - eyeR * 2.4, 0.012, 0.012), M.glasses);
    bridge.position.set(0, eyes[0].g.position.y + 0.01, eyes[0].g.position.z + eyeR * 0.95);
    g.add(bridge);
  }
  return { group: g, eyes, brows, mouth, lip, inner, brow: L.brow, height: P.h * 2 };
}

// ---------------------------------------------------------------- тело
export function buildCharacter(look, opts = {}) {
  const L = {
    body: 'normal', head: 'round', skin: '#f0b890', hair: 'flat', hairColor: '#553311', shirt: '#e8e4d4',
    pants: '#303038', nose: 1, eyes: 1.2, brow: 'neutral', ...look,
  };
  L.female = !!(L.lipstick || L.dress || L.apron || L.hair === 'bun' || L.hair === 'bob');
  const M = {
    skin: lambertUnique(L.skin, { side: THREE.DoubleSide }),
    skinV: lambertUnique(L.skin),
    skinDark: lambertUnique(shade(L.skin, 0.8)),
    hair: lambertUnique(L.hairColor),
    eyeWhite: basic({ color: '#f4f2ea', unique: true }),
    iris: basic({ color: L.irisColor || (L.hairColor === '#20201f' ? '#4a2a14' : '#2a5fa8'), unique: true }),
    pupil: basic({ color: '#0a0a0a', unique: true }),
    mouth: lambertUnique(L.lipstick ? '#b0283a' : '#6a2a22'),
    mouthIn: basic({ color: '#2a0806', unique: true }),
    glasses: lambertUnique('#151515'),
    body: vcMat(false),
    bodyFlat: vcMat(true),
  };
  const skin = C(L.skin);
  const shirt = C(L.shirt);
  const jacket = C(L.jacket || L.shirt);
  const pants = C(L.pants);
  const belt = C('#2a2018');
  const hasJacket = L.jacket && L.jacket !== L.shirt;
  const fat = L.body === 'fat';
  const thin = L.body === 'thin';
  const W = fat ? 1.5 : thin ? 0.86 : 1;
  const bodyMat = L.head === 'long' || L.angular ? M.bodyFlat : M.body;

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  root.scale.setScalar(L.scale || 1);

  const hipY = 0.86;
  // --- торс одним куском
  const shirtFn = (a, c, s, y) => {
    if (hasJacket && c > 0.82 && y > 0.22) return shirt; // рубашка в вырезе пиджака
    return hasJacket ? jacket : shirt;
  };
  const top = 0.6;
  const torsoRings = [
    { y: -0.07, rx: 0.165 * W, rz: 0.12 * W, col: pants },
    { y: 0.03, rx: 0.172 * W, rz: 0.125 * W, col: pants },
    { y: 0.045, rx: 0.176 * W, rz: 0.128 * W, col: L.dress ? pants : belt, front: fat ? 0.06 : 0 },
    { y: 0.09, rx: 0.176 * W, rz: 0.128 * W, col: L.dress ? pants : belt, front: fat ? 0.08 : 0 },
    { y: 0.1, rx: 0.172 * W, rz: 0.126 * W, front: fat ? 0.09 : 0.005 },
    { y: 0.24, rx: 0.18 * W, rz: 0.13 * W, front: fat ? 0.16 : 0.02 },
    { y: 0.4, rx: 0.205 * W, rz: 0.135 * W, front: fat ? 0.08 : 0.01 },
    { y: 0.52, rx: 0.235 * W, rz: 0.128 * W, sq: 3 },
    { y: top - 0.02, rx: 0.2 * W, rz: 0.11 * W, sq: 2.6 },
    { y: top + 0.01, rx: 0.1 + 0.02 * W, rz: 0.09, col: mix(L.shirt, '#ffffff', 0.25) },
    { y: top + 0.03, rx: 0.072, rz: 0.068, col: skin },
    { y: top + 0.13, rx: 0.062, rz: 0.062, col: skin },
  ];
  for (const r of torsoRings) if (!r.col) { const y = r.y; r.colFn = (a, c, s) => shirtFn(a, c, s, y); }
  const torso = new THREE.Group();
  torso.position.y = hipY;
  body.add(torso);
  torso.add(new THREE.Mesh(loft(torsoRings, 12, { capBottom: true }), bodyMat));
  const fz = (y) => frontAt(torsoRings, y);
  // галстук
  if (L.tie) {
    const tc = C(L.tie);
    const tieY0 = top - 0.03;
    const tg = loft([
      { y: tieY0 - 0.38, rx: 0.0, rz: 0.006, col: tc },
      { y: tieY0 - 0.34, rx: 0.042, rz: 0.008, col: tc },
      { y: tieY0 - 0.06, rx: 0.024, rz: 0.008, col: tc },
      { y: tieY0 - 0.045, rx: 0.034, rz: 0.016, col: tc },
      { y: tieY0, rx: 0.03, rz: 0.016, col: tc },
    ], 4);
    const pz = tg.attributes.position;
    for (let i = 0; i < pz.count; i++) pz.setZ(i, pz.getZ(i) + fz(pz.getY(i)) + 0.008);
    tg.computeVertexNormals();
    torso.add(new THREE.Mesh(tg, M.bodyFlat));
  }
  // нагрудный карман и воротник
  if (!fat && !L.apron) {
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.09, 0.012), lambertUnique(shade(hasJacket ? L.jacket : L.shirt, 0.9)));
    pocket.position.set(0.1 * W, 0.4, fz(0.4) + 0.004);
    torso.add(pocket);
  }
  for (const s of [-1, 1]) {
    const flap = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.07, 3), lambertUnique(mix(L.shirt, '#ffffff', 0.3)));
    flap.position.set(s * 0.045, top - 0.015, fz(top - 0.02) + 0.005);
    flap.rotation.set(0.2, 0, Math.PI + s * 0.5);
    flap.scale.z = 0.3;
    torso.add(flap);
  }
  if (L.apron) {
    const ac = C(L.apronColor || '#efe9d8');
    const ag = loft([
      { y: -0.2, rx: 0.17 * W, rz: 0.01, col: ac },
      { y: 0.2, rx: 0.16 * W, rz: 0.01, col: ac },
      { y: 0.42, rx: 0.1 * W, rz: 0.01, col: ac },
    ], 4);
    const pa = ag.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setZ(i, Math.max(0.06, fz(Math.max(0, pa.getY(i)))) + 0.015 + (pa.getY(i) < 0 ? 0.03 : 0));
    ag.computeVertexNormals();
    torso.add(new THREE.Mesh(ag, M.bodyFlat));
  }
  if (L.dress) {
    const sk = loft([
      { y: 0.1, rx: 0.18 * W, rz: 0.14 * W, col: pants, front: fat ? 0.1 : 0 },
      { y: -0.15, rx: 0.24 * W, rz: 0.2 * W, col: pants, front: fat ? 0.06 : 0 },
      { y: -0.48, rx: 0.3 * W, rz: 0.25 * W, col: shade(L.pants, 0.85) },
    ], 12);
    torso.add(new THREE.Mesh(sk, M.body));
  }

  // --- ноги
  const legs = [];
  const LW = fat ? 1.3 : thin ? 0.9 : 1;
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.095 * W, hipY, 0);
    const thigh = loft([
      { y: 0.02, rx: 0.1 * LW, rz: 0.1 * LW, col: pants },
      { y: -0.2, rx: 0.085 * LW, rz: 0.088 * LW, col: pants },
      { y: -0.46, rx: 0.066 * LW, rz: 0.068 * LW, col: pants },
    ], 8);
    hip.add(new THREE.Mesh(thigh, bodyMat));
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    const sock = C('#2a2a30');
    const shin = loft([
      { y: 0.02, rx: 0.068 * LW, rz: 0.07 * LW, col: pants },
      { y: -0.2, rx: 0.062 * LW, rz: 0.064 * LW, col: pants },
      { y: -0.35, rx: 0.06 * LW, rz: 0.06 * LW, col: pants },
      { y: -0.355, rx: 0.042, rz: 0.042, col: L.dress ? skin : sock },
      { y: -0.4, rx: 0.042, rz: 0.042, col: L.dress ? skin : sock },
    ], 8);
    knee.add(new THREE.Mesh(shin, bodyMat));
    const shoeC = C(L.shoes || '#2a1f1a');
    const sg = loft([
      { y: -0.07, rx: 0.048, rz: 0.035, col: shoeC },
      { y: 0.0, rx: 0.058, rz: 0.045, col: shoeC },
      { y: 0.1, rx: 0.06, rz: 0.04, col: shoeC },
      { y: 0.17, rx: 0.04, rz: 0.025, col: shoeC },
    ], 8, { capTop: true, capBottom: true });
    sg.rotateX(Math.PI / 2);
    const shoe = new THREE.Mesh(sg, M.bodyFlat);
    shoe.position.set(0, -0.43, 0.02);
    knee.add(shoe);
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee });
  }

  // --- руки
  const arms = [];
  const longSleeve = hasJacket || L.longSleeve;
  const sleeveC = hasJacket ? jacket : shirt;
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * (0.205 * W + 0.03), 0.5, 0);
    const AW = fat ? 1.35 : thin ? 0.9 : 1;
    const upperRings = longSleeve
      ? [
        { y: 0.06, rx: 0.07 * AW, rz: 0.07 * AW, col: sleeveC },
        { y: -0.15, rx: 0.066 * AW, rz: 0.066 * AW, col: sleeveC },
        { y: -0.31, rx: 0.056 * AW, rz: 0.056 * AW, col: sleeveC },
      ]
      : [
        { y: 0.06, rx: 0.074 * AW, rz: 0.074 * AW, col: sleeveC },
        { y: -0.15, rx: 0.076 * AW, rz: 0.076 * AW, col: sleeveC },
        { y: -0.155, rx: 0.052 * AW, rz: 0.052 * AW, col: skin },
        { y: -0.31, rx: 0.048 * AW, rz: 0.048 * AW, col: skin },
      ];
    sh.add(new THREE.Mesh(loft(upperRings, 8, { capTop: true }), bodyMat));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    const foreC = longSleeve ? sleeveC : skin;
    const fore = loft([
      { y: 0.02, rx: 0.05 * AW, rz: 0.05 * AW, col: foreC },
      { y: -0.24, rx: 0.042 * AW, rz: 0.04 * AW, col: foreC },
      ...(longSleeve ? [{ y: -0.245, rx: 0.036, rz: 0.034, col: skin }] : []),
      { y: -0.27, rx: 0.034, rz: 0.032, col: skin },
    ], 8);
    elbow.add(new THREE.Mesh(fore, bodyMat));
    // кисть: ладонь-«варежка» и большой палец
    const hg = loft([
      { y: -0.26, rx: 0.034, rz: 0.022, col: skin },
      { y: -0.31, rx: 0.045, rz: 0.024, col: skin },
      { y: -0.36, rx: 0.044, rz: 0.021, col: skin },
      { y: -0.39, rx: 0.03, rz: 0.016, col: skin },
    ], 8, { capTop: false, capBottom: true });
    const hand = new THREE.Mesh(hg, M.bodyFlat);
    hand.rotation.y = s * 0.3;
    elbow.add(hand);
    const thumb = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.06, 4), M.skinV);
    thumb.position.set(-s * 0.035, -0.3, 0.02);
    thumb.rotation.set(0.5, 0, -s * 0.7 + Math.PI);
    elbow.add(thumb);
    sh.add(elbow);
    torso.add(sh);
    arms.push({ sh, elbow, hand });
  }

  // --- голова
  const head = new THREE.Group();
  head.position.set(0, top + 0.1, 0.01);
  torso.add(head);
  const face = buildHead(L, M);
  head.add(face.group);

  // тень-пятно
  const blob = new THREE.Mesh(new THREE.CircleGeometry(fat ? 0.5 : 0.38, 10), basic({ color: '#000', transparent: true, opacity: 0.35 }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.012;
  root.add(blob);

  // предмет в руках (папка/капуста)
  const held = new THREE.Group();
  held.position.set(0, 1.05, 0.32 + (fat ? 0.12 : 0));
  root.add(held);
  const heldItems = {
    folder: new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.06), lambertUnique('#b02a2a')),
    cabbage: new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), lambertUnique('#7aa04a')),
  };
  for (const it of Object.values(heldItems)) { it.visible = false; held.add(it); }

  void opts;
  return new CharacterRig({ root, body, torso, legs, arms, head, face, held, heldItems, fat, L });
}

const BROW = {
  angry: [-0.38, 0.0],
  worried: [0.42, 0.02],
  neutral: [-0.08, 0.0],
  surprised: [0.1, 0.03],
};

export class CharacterRig {
  constructor(parts) {
    Object.assign(this, parts);
    this.t = Math.random() * 10;
    this.anim = 'idle';
    this.kind = null;
    this.talking = 0;
    this.blinkT = 2 + Math.random() * 3;
    this.lookT = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.expr = parts.L.brow || 'neutral';
    this.walkPhase = 0;
    this.speed = 0;
    this.panicT = 0;
    this.setExpression(this.expr);
  }

  setExpression(e) {
    this.expr = e;
    const [rot, dy] = BROW[e] || BROW.neutral;
    for (const b of this.face.brows) {
      b.m.rotation.z = -b.s * rot;
      b.m.position.y = b.y + dy;
    }
  }

  setHeld(kind) {
    for (const [k, m] of Object.entries(this.heldItems)) m.visible = k === kind;
    this.heldKind = kind;
  }

  // anim: idle | walk | work | sit | carry | wave | panic | fired
  update(dt, state = {}) {
    this.t += dt;
    const t = this.t;
    const anim = state.anim || 'idle';
    const kind = state.kind || null;
    const { legs, arms, torso, body, head } = this;
    const speed = state.speed ?? (anim === 'walk' || anim === 'carry' ? 1 : 0);

    // сброс поз
    let hipL = 0; let hipR = 0; let kneeL = 0; let kneeR = 0;
    let shL = 0.08; let shR = -0.08; let shLx = 0; let shRx = 0; let elL = 0; let elR = 0;
    let bodyY = 0; let torsoX = 0; let headX = 0; let headY = 0; let headZ = 0;

    if (anim === 'walk' || anim === 'carry') {
      this.walkPhase += dt * 8.5 * Math.max(0.5, speed);
      const s = Math.sin(this.walkPhase);
      hipL = s * 0.6; hipR = -s * 0.6;
      kneeL = Math.max(0, -Math.cos(this.walkPhase)) * 0.7;
      kneeR = Math.max(0, Math.cos(this.walkPhase)) * 0.7;
      shLx = -s * 0.55; shRx = s * 0.55;
      elL = -0.3; elR = -0.3;
      bodyY = Math.abs(Math.cos(this.walkPhase)) * 0.04;
      torsoX = 0.06;
      if (anim === 'carry') { shLx = -1.2; shRx = -1.2; elL = -0.5; elR = -0.5; shL = 0.25; shR = -0.25; torsoX = 0.15; }
    } else if (anim === 'sit') {
      hipL = hipR = -1.5; kneeL = kneeR = 1.5;
      bodyY = -0.42;
      shLx = shRx = -0.5; elL = elR = -0.6;
    } else if (anim === 'work') {
      const w = WORK_POSES[kind] || WORK_POSES.type;
      const r = w(t);
      ({ shLx = shLx, shRx = shRx, elL = elL, elR = elR, shL = shL, shR = shR, headX = headX, headY = headY, headZ = headZ, torsoX = torsoX, bodyY = bodyY } = r);
    } else if (anim === 'wave') {
      shR = -2.6; elR = -0.4 + Math.sin(t * 12) * 0.4;
      headZ = 0.1;
    } else if (anim === 'panic') {
      shL = 2.6 + Math.sin(t * 20) * 0.2; shR = -2.6 - Math.sin(t * 20) * 0.2;
      bodyY = Math.abs(Math.sin(t * 14)) * 0.05;
    } else {
      // idle: дыхание, переминание
      bodyY = Math.sin(t * 1.8) * 0.006;
      shLx = Math.sin(t * 1.1) * 0.04;
      shRx = Math.sin(t * 1.3 + 1) * 0.04;
      headY = Math.sin(t * 0.4) * 0.25 * (state.lookAround ? 1 : 0.4);
    }

    legs[0].hip.rotation.x = hipL; legs[1].hip.rotation.x = hipR;
    legs[0].knee.rotation.x = kneeL; legs[1].knee.rotation.x = kneeR;
    arms[0].sh.rotation.set(shLx, 0, -shL);
    arms[1].sh.rotation.set(shRx, 0, -shR);
    arms[0].elbow.rotation.x = elL;
    arms[1].elbow.rotation.x = elR;
    body.position.y = bodyY;
    torso.rotation.x = torsoX;
    head.rotation.set(headX, headY, headZ);

    // Моргание
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 4;
    for (const e of this.face.eyes) { if (e.lid) e.lid.rotation.x = blink ? 1.4 : e.lidOpen; else e.g.scale.y = blink ? 0.12 : 1; }
    // Бегающий взгляд
    this.lookT -= dt;
    if (this.lookT < 0) {
      this.lookT = 0.8 + Math.random() * 2.5;
      this.lookX = (Math.random() - 0.5) * 0.024;
      this.lookY = (Math.random() - 0.5) * 0.014;
    }
    for (const e of this.face.eyes) { e.look.position.x += (this.lookX - e.look.position.x) * 0.2; e.look.position.y += (this.lookY - e.look.position.y) * 0.2; }

    // Речь: рот открывается
    const talking = state.talking;
    const open = talking ? 0.4 + Math.abs(Math.sin(t * 17)) * 1.0 * (0.6 + 0.4 * Math.sin(t * 5.3)) : 0;
    this.face.inner.scale.y = Math.max(0.01, open);
    this.face.lip.scale.y = talking ? 0.6 : 1;
    if (talking && !this._wasTalking) this.setExpression(this.expr === 'angry' ? 'angry' : 'surprised');
    if (!talking && this._wasTalking) this.setExpression(this.L.brow || 'neutral');
    this._wasTalking = talking;
  }
}

const WORK_POSES = {
  type: (t) => ({ shLx: -1.0, shRx: -1.0, elL: -0.6 + Math.sin(t * 18) * 0.12, elR: -0.6 + Math.sin(t * 18 + 1.6) * 0.12, headX: 0.15 }),
  rummage: (t) => ({ shLx: -1.4 + Math.sin(t * 6) * 0.35, shRx: -1.4 + Math.sin(t * 6 + 2) * 0.35, elL: -0.4, elR: -0.4, headX: -0.05, torsoX: 0.12 }),
  stir: (t) => ({ shLx: -0.9 + Math.sin(t * 4) * 0.3, shRx: -0.9 + Math.cos(t * 4) * 0.3, shL: 0.25 + Math.cos(t * 4) * 0.15, shR: -0.25, elL: -0.8, elR: -0.8, headX: 0.35, torsoX: 0.2 }),
  press: (t) => ({ shRx: -1.3 + Math.max(0, Math.sin(t * 5)) * 0.3, elR: -0.2, shLx: -0.2, headX: 0.15 }),
  write: (t) => ({ shRx: -0.9, elR: -0.8 + Math.sin(t * 9) * 0.1, shR: -0.15 + Math.sin(t * 4) * 0.08, shLx: -0.7, elL: -0.8, headX: 0.35, torsoX: 0.15 }),
  pour: (t) => ({ shRx: -1.4, elR: -0.2, shR: -0.3 + Math.sin(t * 2) * 0.05, headX: 0.25 }),
  phone: (t) => ({ shRx: -0.4, shR: -0.6, elR: -2.3, headY: 0.15 + Math.sin(t * 1.5) * 0.1, headZ: 0.1 }),
  stamp: (t) => ({ shRx: -1.1 + Math.abs(Math.sin(t * 6)) * -0.6, elR: -0.5, headX: 0.25, torsoX: 0.12 }),
  locker: (t) => ({ shLx: -1.3, shRx: -1.5 + Math.sin(t * 3) * 0.2, elL: -0.3, elR: -0.3 }),
  coins: (t) => ({ shLx: -0.9, shRx: -0.9, elL: -0.9 + Math.sin(t * 12) * 0.15, elR: -0.9 + Math.cos(t * 10) * 0.15, headX: 0.4, torsoX: 0.18 }),
  pump: (t) => ({ shLx: -1.0 + Math.sin(t * 5) * 0.6, shRx: -1.0 + Math.sin(t * 5) * 0.6, elL: -0.4, elR: -0.4, torsoX: 0.2 + Math.sin(t * 5) * 0.1 }),
  lift: (t) => ({ shLx: -2.0 - Math.abs(Math.sin(t * 2)) * 0.6, shRx: -2.0 - Math.abs(Math.sin(t * 2)) * 0.6, elL: -0.3, elR: -0.3 }),
  wipe: (t) => ({ shRx: -1.5 + Math.sin(t * 7) * 0.3, shR: -0.2 + Math.cos(t * 7) * 0.3, elR: -0.3 }),
  read: (t) => ({ shLx: -0.5, shRx: -0.5, elL: -1.4, elR: -1.4, shL: -0.3, shR: 0.3, headX: -0.05, headY: Math.sin(t * 0.8) * 0.2 }),
  coffee: (t) => ({ shRx: -0.6, elR: -1.9 + Math.sin(t * 2) * 0.2, headX: -0.1 }),
};
