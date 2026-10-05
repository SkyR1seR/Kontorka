// Персонажи Конторки: low-poly «пластиковые» сотрудники с большими головами,
// выпученными глазами, тяжёлыми бровями и крупными носами. Процедурная анимация.
import * as THREE from 'three';
import { lambertUnique, basic } from './materials.js';

const HEAD_Y = 1.52;

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return c;
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

function pivot(x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

export function buildCharacter(look, opts = {}) {
  const L = {
    body: 'normal', head: 'round', skin: '#f0b890', hair: 'flat', hairColor: '#553311', shirt: '#e8e4d4',
    pants: '#303038', nose: 1, eyes: 1.2, brow: 'neutral', ...look,
  };
  const M = {
    skin: lambertUnique(L.skin),
    skinDark: lambertUnique(shade(L.skin, 0.75)),
    shirt: lambertUnique(L.shirt),
    jacket: lambertUnique(L.jacket || L.shirt),
    pants: lambertUnique(L.pants),
    shoes: lambertUnique('#2a1f1a'),
    hair: lambertUnique(L.hairColor),
    tie: lambertUnique(L.tie || '#9a1f1f'),
    eyeWhite: basic({ color: '#f4f2ea', unique: true }),
    iris: basic({ color: L.irisColor || '#2a5fa8', unique: true }),
    pupil: basic({ color: '#0a0a0a', unique: true }),
    mouth: lambertUnique(L.lipstick ? '#b0283a' : '#6a2a22'),
    mouthIn: basic({ color: '#2a0806', unique: true }),
    glasses: lambertUnique('#151515'),
    apron: lambertUnique(L.apronColor || '#efe9d8'),
  };

  const root = new THREE.Group();
  const body = pivot(0, 0, 0); // покачивание тела
  root.add(body);
  const scale = L.scale || 1;
  root.scale.setScalar(scale);

  const fat = L.body === 'fat';
  const thin = L.body === 'thin';
  const hipY = 0.88;
  const torsoH = 0.58;
  const torsoW = fat ? 0.34 : thin ? 0.2 : 0.25;

  // --- ноги
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = pivot(s * (fat ? 0.14 : 0.1), hipY, 0);
    const thigh = mesh(new THREE.CylinderGeometry(fat ? 0.1 : 0.075, 0.065, 0.46, 6), M.pants, 0, -0.23, 0);
    hip.add(thigh);
    const knee = pivot(0, -0.46, 0);
    const shin = mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.42, 6), M.pants, 0, -0.21, 0);
    const shoe = mesh(new THREE.BoxGeometry(0.12, 0.08, 0.24), M.shoes, 0, -0.43, 0.05);
    knee.add(shin, shoe);
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee });
  }
  if (L.dress) {
    const skirt = mesh(new THREE.CylinderGeometry(torsoW * 0.95, torsoW * 1.35, 0.55, 8, 1, true), lambertUnique(L.pants, { side: THREE.DoubleSide }), 0, hipY - 0.2, 0);
    body.add(skirt);
  }

  // --- торс
  const torso = pivot(0, hipY, 0);
  body.add(torso);
  let torsoMesh;
  if (fat) {
    torsoMesh = mesh(new THREE.IcosahedronGeometry(0.36, 1), M.jacket, 0, 0.3, 0.03);
    torsoMesh.scale.set(1.05, 1.0, 0.9);
  } else {
    torsoMesh = mesh(new THREE.CylinderGeometry(torsoW * 1.12, torsoW * 0.9, torsoH, 6), M.jacket, 0, torsoH / 2, 0);
    torsoMesh.scale.set(1, 1, 0.72);
  }
  torso.add(torsoMesh);
  const front = fat ? 0.34 : torsoW * 0.78;
  if (L.jacket && L.jacket !== L.shirt) {
    // рубашка «треугольником» в вырезе пиджака
    const v = mesh(new THREE.ConeGeometry(0.11, 0.3, 3), M.shirt, 0, torsoH - 0.13, front - 0.01);
    v.rotation.set(Math.PI, 0, 0);
    v.scale.set(1, 1, 0.25);
    torso.add(v);
  }
  if (L.tie || (!L.apron && !L.dress && !fat)) {
    const tie = mesh(new THREE.BoxGeometry(0.06, 0.34, 0.02), M.tie, 0, torsoH - 0.24, front + 0.005);
    const knot = mesh(new THREE.BoxGeometry(0.07, 0.05, 0.03), M.tie, 0, torsoH - 0.06, front);
    if (L.tie) torso.add(tie, knot);
  }
  if (L.apron) {
    const apron = mesh(new THREE.BoxGeometry(fat ? 0.4 : 0.3, 0.42, 0.02), M.apron, 0, 0.14, front + 0.02);
    torso.add(apron);
  }
  // пояс / карман
  if (!fat && !L.dress) torso.add(mesh(new THREE.BoxGeometry(torsoW * 1.8, 0.05, torsoW * 1.35), lambertUnique('#2a2018'), 0, 0.02, 0));
  if (!fat) torso.add(mesh(new THREE.BoxGeometry(0.1, 0.09, 0.015), M.jacket, -0.12, torsoH - 0.2, front + 0.004));

  // --- руки
  const shoulderY = torsoH - 0.06;
  const arms = [];
  const sleeveLong = !!L.jacket || L.longSleeve;
  for (const s of [-1, 1]) {
    const sh = pivot(s * (torsoW + (fat ? 0.12 : 0.05)), shoulderY, 0);
    const upper = mesh(new THREE.CylinderGeometry(fat ? 0.085 : 0.065, 0.055, 0.3, 5), M.jacket, 0, -0.15, 0);
    sh.add(upper);
    const elbow = pivot(0, -0.3, 0);
    const fore = mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.27, 5), sleeveLong ? M.jacket : M.skin, 0, -0.135, 0);
    const hand = mesh(new THREE.IcosahedronGeometry(0.055, 0), M.skin, 0, -0.3, 0.01);
    hand.scale.set(1, 1.15, 0.8);
    elbow.add(fore, hand);
    sh.add(elbow);
    torso.add(sh);
    arms.push({ sh, elbow, hand });
  }

  // --- шея и голова
  const neck = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 6), M.skin, 0, torsoH + 0.04, 0);
  torso.add(neck);
  const head = pivot(0, torsoH + 0.1, 0);
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
  held.position.set(0, 1.05, 0.32);
  root.add(held);
  const heldItems = {
    folder: mesh(new THREE.BoxGeometry(0.32, 0.4, 0.06), lambertUnique('#b02a2a')),
    cabbage: mesh(new THREE.IcosahedronGeometry(0.17, 0), lambertUnique('#7aa04a')),
  };
  for (const it of Object.values(heldItems)) { it.visible = false; held.add(it); }

  const ch = new CharacterRig({ root, body, torso, torsoMesh, legs, arms, head, face, held, heldItems, fat, L });
  return ch;
}

function buildHead(L, M) {
  const g = new THREE.Group();
  const shape = L.head;
  let headMesh;
  let fz; // z передней поверхности
  let topY;
  let w;
  if (shape === 'long') {
    headMesh = mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.46, 6), M.skin, 0, 0.23, 0);
    headMesh.scale.set(1, 1, 0.95);
    const chin = mesh(new THREE.ConeGeometry(0.12, 0.14, 6), M.skin, 0, -0.04, 0.0);
    chin.rotation.x = Math.PI;
    g.add(chin);
    fz = 0.15;
    topY = 0.46;
    w = 0.17;
  } else if (shape === 'wide') {
    headMesh = mesh(new THREE.IcosahedronGeometry(0.21, 1), M.skin, 0, 0.21, 0);
    headMesh.scale.set(1.2, 1.0, 1.0);
    const jowl = mesh(new THREE.IcosahedronGeometry(0.15, 0), M.skin, 0, 0.08, 0.05);
    jowl.scale.set(1.5, 0.8, 1);
    g.add(jowl);
    fz = 0.19;
    topY = 0.42;
    w = 0.25;
  } else {
    headMesh = mesh(new THREE.IcosahedronGeometry(0.2, 1), M.skin, 0, 0.21, 0);
    headMesh.scale.set(1, 1.12, 0.98);
    fz = 0.18;
    topY = 0.43;
    w = 0.2;
  }
  g.add(headMesh);

  // Уши
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.IcosahedronGeometry(0.05, 0), M.skinDark, s * (w + 0.01), 0.2, 0);
    ear.scale.set(0.5, 1.2, 0.9);
    g.add(ear);
  }

  // Глаза: крупные белки, маленькие радужки
  const eyeR = 0.058 * (L.eyes || 1);
  const eyeY = shape === 'long' ? 0.29 : 0.25;
  const eyes = [];
  for (const s of [-1, 1]) {
    const eg = new THREE.Group();
    eg.position.set(s * (shape === 'wide' ? 0.085 : 0.072), eyeY, fz - eyeR * 0.35);
    const white = mesh(new THREE.SphereGeometry(eyeR, 8, 6), M.eyeWhite);
    white.scale.set(1, 1.15, 0.8);
    const iris = mesh(new THREE.CircleGeometry(eyeR * 0.42, 8), M.iris, 0, 0, eyeR * 0.8 + 0.002);
    const pupil = mesh(new THREE.CircleGeometry(eyeR * 0.2, 6), M.pupil, 0, 0, eyeR * 0.8 + 0.004);
    const look = new THREE.Group();
    look.add(iris, pupil);
    eg.add(white, look);
    g.add(eg);
    eyes.push({ g: eg, look, white });
  }

  // Брови
  const brows = [];
  for (const s of [-1, 1]) {
    const b = mesh(new THREE.BoxGeometry(0.1, 0.028, 0.035), M.hair, s * 0.078, eyeY + eyeR * 1.3, fz + 0.012);
    g.add(b);
    brows.push({ m: b, s, y: b.position.y });
  }

  // Нос
  const nk = L.nose || 1;
  const nose = mesh(new THREE.ConeGeometry(0.035 * nk, 0.13 * nk, 4), M.skin, 0, eyeY - 0.07, fz + 0.04 * nk);
  nose.rotation.x = Math.PI / 2 + 0.25;
  nose.rotation.y = Math.PI / 4;
  g.add(nose);

  // Рот
  const mouthY = shape === 'long' ? 0.07 : 0.1;
  const mouth = new THREE.Group();
  mouth.position.set(0, mouthY, fz + (shape === 'long' ? -0.01 : 0.0));
  const lip = mesh(new THREE.TorusGeometry(0.045, 0.011, 3, 8, Math.PI), M.mouth);
  lip.rotation.z = 0; // дугой вверх — недовольная гримаса
  const inner = mesh(new THREE.CircleGeometry(0.035, 6), M.mouthIn, 0, -0.012, -0.004);
  inner.scale.set(1.2, 0.01, 1);
  mouth.add(lip, inner);
  g.add(mouth);

  if (L.mustache) {
    const mu = mesh(new THREE.BoxGeometry(0.13, 0.035, 0.04), M.hair, 0, mouthY + 0.045, fz + 0.005);
    g.add(mu);
  }

  // Волосы
  const hairM = M.hair;
  const addHair = (geo, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => {
    const h = mesh(geo, hairM, x, y, z);
    h.scale.set(sx, sy, sz);
    h.rotation.set(rx, 0, rz);
    g.add(h);
    return h;
  };
  switch (L.hair) {
    case 'spiky': {
      addHair(new THREE.IcosahedronGeometry(w * 1.0, 0), 0, topY + 0.01, -0.07, 1.05, 0.36, 0.92);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        addHair(new THREE.ConeGeometry(0.05, 0.16, 4), Math.cos(a) * w * 0.55, topY + 0.02, Math.sin(a) * w * 0.5 - 0.02, 1, 1, 1, Math.sin(a) * 0.5, -Math.cos(a) * 0.5);
      }
      addHair(new THREE.ConeGeometry(0.06, 0.18, 4), 0, topY + 0.05, 0.02);
      break;
    }
    case 'flat':
      addHair(new THREE.BoxGeometry(w * 2.1, 0.09, w * 2.0), 0, topY - 0.01, -0.01);
      addHair(new THREE.BoxGeometry(w * 2.15, 0.16, 0.06), 0, topY - 0.1, -w * 0.95);
      break;
    case 'bun':
      addHair(new THREE.SphereGeometry(w * 1.04, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0, topY - 0.17, -0.01, 1, 0.95, 1);
      addHair(new THREE.IcosahedronGeometry(0.1, 0), 0, topY + 0.03, -0.1);
      break;
    case 'comb':
      addHair(new THREE.SphereGeometry(w * 1.03, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.4), 0, topY - 0.15, -0.015, 1, 0.8, 1, 0, 0.12);
      break;
    case 'bob':
      addHair(new THREE.SphereGeometry(w * 1.12, 8, 6, 0, Math.PI * 2, 0, Math.PI / 1.7), 0, topY - 0.2, -0.03, 1, 1.05, 1);
      addHair(new THREE.BoxGeometry(w * 1.6, 0.06, 0.05), 0, topY - 0.08, fz - 0.04);
      break;
    case 'bald':
    default:
      for (const s of [-1, 1]) addHair(new THREE.IcosahedronGeometry(0.06, 0), s * w * 0.95, 0.26, -0.03, 0.6, 1.1, 1.2);
  }

  // Очки: восьмиугольные (как у Господина Колупня) или круглые
  if (L.glasses) {
    const seg = L.glasses === 'octa' ? 8 : 12;
    const gg = new THREE.Group();
    gg.position.set(0, eyeY, fz + 0.03);
    for (const s of [-1, 1]) {
      const ring = mesh(new THREE.TorusGeometry(eyeR * 1.35, 0.011, 3, seg), M.glasses, s * 0.078, 0, 0);
      ring.rotation.z = Math.PI / seg;
      gg.add(ring);
      const arm = mesh(new THREE.BoxGeometry(0.012, 0.012, 0.2), M.glasses, s * (0.078 + eyeR * 1.35), 0, -0.1);
      gg.add(arm);
    }
    gg.add(mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), M.glasses, 0, 0.005, 0));
    g.add(gg);
  }

  return { group: g, eyes, brows, mouth, lip, inner, eyeY, brow: L.brow };
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
    for (const e of this.face.eyes) e.g.scale.y = blink ? 0.12 : 1;
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
