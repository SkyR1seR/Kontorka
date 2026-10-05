// Построение 3D-конторы по общей карте: полы, стены, потолки с люминесцентными
// панелями, двери и мебель. Статика сливается в батчи по материалам.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ZONES, WALLS, DOORS, FURNITURE, STATIONS, WALL_H, MAP_W, MAP_D, FURN_BY_ID,
} from '../../shared/map.js';
import { lambert, basic, lambertUnique } from './materials.js';
import { tex, textTex } from './textures.js';

// ------------------------------------------------------------ batching
class StaticBatch {
  constructor() { this.byMat = new Map(); }
  add(geo, mat, matrix) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    if (!this.byMat.has(mat)) this.byMat.set(mat, []);
    this.byMat.get(mat).push(g);
  }
  build(parent) {
    for (const [mat, list] of this.byMat) {
      const merged = mergeGeometries(list, false);
      const m = new THREE.Mesh(merged, mat);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      parent.add(m);
    }
    this.byMat.clear();
  }
}

const FRONT_ROT = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

class PropBuilder {
  constructor(batch, dynParent) {
    this.batch = batch;
    this.dyn = dynParent;
    this.base = new THREE.Matrix4();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3(1, 1, 1);
    this._p = new THREE.Vector3();
  }
  begin(x, z, rot = 0, y = 0) {
    this.rot = rot;
    this.base.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(1, 1, 1));
    return this;
  }
  _local(x, y, z, o) {
    this._e.set(o.rx || 0, o.ry || 0, o.rz || 0);
    this._q.setFromEuler(this._e);
    this._p.set(x, y, z);
    this._s.set(o.sx || 1, o.sy || 1, o.sz || 1);
    this._m.compose(this._p, this._q, this._s);
    return new THREE.Matrix4().multiplyMatrices(this.base, this._m);
  }
  put(geo, mat, x, y, z, o = {}) {
    const m = this._local(x, y, z, o);
    if (o.dynamic) {
      const mesh = new THREE.Mesh(geo, mat);
      m.decompose(mesh.position, mesh.quaternion, mesh.scale);
      (o.parent || this.dyn).add(mesh);
      return mesh;
    }
    this.batch.add(geo, mat, m);
    return null;
  }
  box(w, h, d, mat, x, y, z, o) { return this.put(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z, o); }
  cyl(rt, rb, h, seg, mat, x, y, z, o) { return this.put(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y + h / 2, z, o); }
  ico(r, mat, x, y, z, o, detail = 0) { return this.put(new THREE.IcosahedronGeometry(r, detail), mat, x, y, z, o); }
  plane(w, h, mat, x, y, z, o) { return this.put(new THREE.PlaneGeometry(w, h), mat, x, y, z, o); }
  worldPos(x, y, z) { return new THREE.Vector3(x, y, z).applyMatrix4(this.base); }
}

// ------------------------------------------------------------ materials
const MAT = {
  wood: () => lambert({ tex: 'wood' }),
  woodLight: () => lambert({ tex: 'wood_light' }),
  dark: () => lambert({ color: '#2a2622' }),
  metal: () => lambert({ tex: 'metal' }),
  steel: () => lambert({ tex: 'steel' }),
  beige: () => lambert({ tex: 'beige_plastic' }),
  black: () => lambert({ color: '#1a1a1c' }),
  white: () => lambert({ color: '#e8e4d8' }),
  red: () => lambert({ color: '#a82424' }),
  green: () => lambert({ color: '#3f7a32' }),
  leaf: () => lambert({ color: '#2f6e2a' }),
  paper: () => lambert({ tex: 'paper' }),
  fabric: () => lambert({ tex: 'fabric' }),
  chairFabric: () => lambert({ color: '#2e3a5a' }),
  folders: () => lambert({ tex: 'folders' }),
  foldersRed: () => lambert({ tex: 'folders_red' }),
  gold: () => lambert({ color: '#c9a42a' }),
  terra: () => lambert({ color: '#9a5a3a' }),
  glass: () => lambert({ color: '#9fc4d8', transparent: true, opacity: 0.35 }),
};
const mat = (k) => MAT[k]();

// ------------------------------------------------------------ world build
export function buildWorld(scene) {
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);
  const staticGroup = new THREE.Group();
  const dyn = new THREE.Group();
  const ceilingGroup = new THREE.Group();
  root.add(staticGroup, dyn, ceilingGroup);
  const batch = new StaticBatch();
  const ceilBatch = new StaticBatch();
  const B = new PropBuilder(batch, dyn);
  const H = {
    screens: {}, printers: {}, glow: [], chairs: [], doors: {}, pot: null, accel: null, keybox: null,
    lockerLamp: null, boardNote: null, ceilingGroup, zoneLamps: {}, wallMeshes: [], fluor: {},
  };

  // --- полы
  for (const z of ZONES) {
    const w = z.x1 - z.x0;
    const d = z.z1 - z.z0;
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv;
    const rep = z.floor === 'tiles_white' || z.floor === 'checker' ? 1.2 : 2;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / rep), uv.getY(i) * (d / rep));
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition((z.x0 + z.x1) / 2, 0, (z.z0 + z.z1) / 2);
    batch.add(g, lambert({ tex: z.floor }), m);
  }

  // --- стены (разбиваем по границам зон, чтобы с каждой стороны была своя отделка)
  const cutsX = [0, 14, 20, 28, 36, 42, 56];
  const cutsZ = [0, 14, 28, 42];
  for (const w of WALLS) {
    const pieces = [];
    if (w.h) {
      const xs = [w.x0, ...cutsX.filter((c) => c > w.x0 + 0.01 && c < w.x1 - 0.01), w.x1];
      for (let i = 0; i < xs.length - 1; i++) pieces.push({ ...w, x0: xs[i], x1: xs[i + 1] });
    } else {
      const zs = [w.z0, ...cutsZ.filter((c) => c > w.z0 + 0.01 && c < w.z1 - 0.01), w.z1];
      for (let i = 0; i < zs.length - 1; i++) pieces.push({ ...w, z0: zs[i], z1: zs[i + 1] });
    }
    for (const p of pieces) addWall(batch, p, 0, WALL_H, H);
  }
  // --- проёмы: косяки и стена над дверью
  for (const d of DOORS) {
    const r = d.rect;
    const top = 2.25;
    addWall(batch, { ...r, h: d.h }, top, WALL_H - top, H);
    const len = d.b - d.a;
    const frameMat = mat('wood');
    if (d.h) {
      B.begin(d.x, d.z, 0);
      for (const s of [-1, 1]) B.box(0.1, top, 0.38, frameMat, s * (len / 2 - 0.05), 0, 0);
      B.box(len, 0.1, 0.38, frameMat, 0, top - 0.1, 0);
    } else {
      B.begin(d.x, d.z, Math.PI / 2);
      for (const s of [-1, 1]) B.box(0.1, top, 0.38, frameMat, s * (len / 2 - 0.05), 0, 0);
      B.box(len, 0.1, 0.38, frameMat, 0, top - 0.1, 0);
    }
    // Створка двери (видна, когда дверь заперта/опечатана)
    const leaf = new THREE.Group();
    const leafMesh = new THREE.Mesh(new THREE.BoxGeometry(len - 0.15, top - 0.1, 0.08), lambertUnique('#7a5030'));
    leafMesh.position.y = (top - 0.1) / 2;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.14), lambert({ color: '#c9a42a' }));
    handle.position.set(len / 2 - 0.35, 1.0, 0);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(len - 0.1, 0.12, 0.1), lambert({ color: '#e8d040' }));
    tape.position.set(0, 1.3, 0);
    tape.rotation.z = 0.35;
    const tape2 = tape.clone();
    tape2.rotation.z = -0.35;
    leaf.add(leafMesh, handle, tape, tape2);
    leaf.position.set(d.x, 0, d.z);
    leaf.rotation.y = d.h ? 0 : Math.PI / 2;
    leaf.visible = false;
    dyn.add(leaf);
    H.doors[d.id] = { leaf, tape: [tape, tape2] };
  }

  // --- потолки и светильники
  for (const z of ZONES) {
    const w = z.x1 - z.x0;
    const d = z.z1 - z.z0;
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 1.2), uv.getY(i) * (d / 1.2));
    const m = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition((z.x0 + z.x1) / 2, WALL_H, (z.z0 + z.z1) / 2);
    ceilBatch.add(g, lambert({ tex: z.id === 'slop' ? 'concrete' : 'ceiling', emissive: z.id === 'slop' ? '#3a3a30' : '#8a867a', emissiveMap: true }), m);
    // люминесцентные панели
    const lampMat = basic({ color: z.id === 'slop' ? '#c8e8a0' : '#fffbea', unique: true });
    H.fluor[z.id] = lampMat;
    if (z.id === 'canteen') continue;
    for (let x = z.x0 + 2.4; x < z.x1 - 1; x += 4.2) {
      for (let zz = z.z0 + 2.4; zz < z.z1 - 1; zz += 4.2) {
        const pm = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, WALL_H - 0.02, zz);
        ceilBatch.add(new THREE.PlaneGeometry(0.6, 1.2), lampMat, pm);
        const fm = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, WALL_H - 0.015, zz);
        ceilBatch.add(new THREE.PlaneGeometry(0.72, 1.32), lambert({ color: '#9a978a' }), fm);
      }
    }
  }
  // Подвесные лампы-«купола» в Столовой (как на кухне Бидоньи)
  {
    const lampMat = H.fluor.canteen;
    for (const [x, z] of [[3, 33], [9, 33], [14.5, 33], [9, 38.5], [14.5, 38.5], [4, 38.5]]) {
      B.begin(x, z, 0);
      B.cyl(0.01, 0.01, 0.9, 4, mat('dark'), 0, WALL_H - 0.9, 0, { parent: ceilingGroup, dynamic: true });
      B.put(new THREE.CylinderGeometry(0.12, 0.42, 0.3, 8, 1, true), lambert({ color: '#c9ced1', side: 'double' }), 0, WALL_H - 1.05, 0, { dynamic: true, parent: ceilingGroup });
      B.put(new THREE.CircleGeometry(0.36, 8), lampMat, 0, WALL_H - 1.19, 0, { rx: Math.PI / 2, dynamic: true, parent: ceilingGroup });
    }
  }

  // --- мебель
  const stationsByFurn = {};
  for (const s of STATIONS) (stationsByFurn[s.furn] = stationsByFurn[s.furn] || []).push(s);
  for (const f of FURNITURE) {
    const rot = FRONT_ROT[f.front] ?? 0;
    const sideways = f.front === 'E' || f.front === 'W';
    const L = { w: sideways ? f.d : f.w, d: sideways ? f.w : f.d, h: f.h };
    B.begin(f.x, f.z, rot);
    const fn = PROPS[f.type];
    if (fn) fn(B, L, f, H, stationsByFurn[f.id] || []);
  }

  // --- декор стен: картины, плакаты, часы
  decorateWalls(B);

  batch.build(staticGroup);
  ceilBatch.build(ceilingGroup);
  return H;
}

function addWall(batch, r, y0, h, H) {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  if (w <= 0.001 || d <= 0.001 || h <= 0.001) return;
  const g = new THREE.BoxGeometry(w, h, d);
  // UV в мировом масштабе: плитка 2 м по горизонтали, по вертикали — вся высота стены
  const uv = g.attributes.uv;
  const faceDims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fw] = faceDims[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      const u = uv.getX(i) * (fw / 2);
      const v = (y0 + uv.getY(i) * h) / WALL_H;
      uv.setXY(i, u, v);
    }
  }
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  // зона с каждой стороны стены
  const zoneOf = (x, z) => ZONES.find((zn) => x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1);
  const sideMat = (x, z) => {
    const zn = zoneOf(x, z);
    return lambert({ tex: zn ? zn.wall : 'wall_beige' });
  };
  const top = lambert({ color: '#3a3630' });
  // Разбиваем бокс по граням, чтобы раздать материалы
  const m = new THREE.Matrix4().makeTranslation(cx, y0 + h / 2, cz);
  const faces = [
    { mat: sideMat(r.x1 + 0.3, cz), idx: 0 }, { mat: sideMat(r.x0 - 0.3, cz), idx: 1 },
    { mat: top, idx: 2 }, { mat: top, idx: 3 },
    { mat: sideMat(cx, r.z1 + 0.3), idx: 4 }, { mat: sideMat(cx, r.z0 - 0.3), idx: 5 },
  ];
  const ng = g.toNonIndexed();
  for (const f of faces) {
    const part = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = ng.attributes[name];
      const size = a.itemSize;
      const arr = a.array.slice(f.idx * 6 * size, (f.idx + 1) * 6 * size);
      part.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    batch.add(part, f.mat, m);
  }
}

// ------------------------------------------------------------ props
function chair(B, x, z, ry, H, opts = {}) {
  const c = new THREE.Group();
  const fab = opts.fabric || mat('chairFabric');
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.44), fab); seat.position.y = 0.47;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.07), fab); back.position.set(0, 0.8, -0.2);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 5), mat('dark')); pole.position.y = 0.25;
  const star = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 5), mat('dark')); star.position.y = 0.05;
  c.add(seat, back, pole, star);
  c.position.copy(B.worldPos(x, 0, z));
  c.rotation.y = B.rot + ry;
  B.dyn.add(c);
  if (opts.track) H.chairs.push(c);
  return c;
}

function crt(B, x, y, z, H, stId) {
  B.box(0.44, 0.36, 0.4, mat('beige'), x, y + 0.06, z - 0.02);
  B.box(0.3, 0.3, 0.2, mat('beige'), x, y + 0.1, z - 0.3);
  B.box(0.24, 0.06, 0.2, mat('beige'), x, y, z);
  const screenMat = basic({ tex: 'screen', unique: true });
  const scr = B.plane(0.34, 0.27, screenMat, x, y + 0.25, z + 0.181, { dynamic: true });
  if (stId) {
    H.screens[stId] = scr;
    H.glow.push({ pos: B.worldPos(x, y + 0.3, z + 0.5), st: stId });
  }
  return scr;
}

const PROPS = {
  shelf(B, L, f) { shelfProp(B, L, mat('folders')); },
  shelf_red(B, L) { shelfProp(B, L, mat('foldersRed')); },
  desk_papers(B, L) {
    deskProp(B, L);
    for (let i = 0; i < 4; i++) B.box(0.32, 0.04 + i * 0.05, 0.24, mat('paper'), -0.6 + i * 0.35, 0.76, -0.1 + (i % 2) * 0.12);
    B.box(0.38, 0.5, 0.06, lambert({ color: '#b02a2a' }), 0.65, 0.76, -0.25, { ry: 0.2 });
  },
  cardfile(B, L) {
    B.box(L.w, L.h, L.d, mat('woodLight'), 0, 0, 0);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      B.box(L.w / 4 - 0.04, 0.22, 0.02, mat('wood'), -L.w / 2 + (c + 0.5) * (L.w / 4), 0.1 + r * 0.3, L.d / 2);
      B.box(0.06, 0.03, 0.03, mat('gold'), -L.w / 2 + (c + 0.5) * (L.w / 4), 0.2 + r * 0.3, L.d / 2 + 0.02);
    }
  },
  floor_lamp(B) {
    B.cyl(0.18, 0.2, 0.04, 6, mat('dark'), 0, 0, 0);
    B.cyl(0.02, 0.02, 1.5, 4, mat('dark'), 0, 0, 0);
    B.put(new THREE.CylinderGeometry(0.12, 0.25, 0.3, 6, 1, true), lambert({ color: '#e0c880', side: 'double' }), 0, 1.6, 0);
  },
  desk_pc(B, L, f, H, sts) {
    deskProp(B, L);
    const stId = sts[0]?.id;
    crt(B, 0, 0.76, -0.1, H, stId);
    B.plane(0.46, 0.17, lambert({ tex: 'keyboard' }), 0, 0.775, 0.27, { rx: -Math.PI / 2 + 0.1 });
    B.box(0.06, 0.03, 0.1, mat('beige'), 0.36, 0.76, 0.27);
    B.box(0.22, 0.03, 0.3, mat('paper'), -0.65, 0.76, 0.1, { ry: 0.3 });
    B.cyl(0.04, 0.035, 0.1, 6, lambert({ color: '#c04030' }), 0.7, 0.76, -0.2);
    if (f.partition) {
      B.box(L.w + 0.2, 1.35, 0.06, mat('fabric'), 0, 0, -L.d / 2 - 0.06);
      B.box(L.w + 0.24, 0.05, 0.1, mat('metal'), 0, 1.35, -L.d / 2 - 0.06);
    }
    chair(B, 0, L.d / 2 + 0.45, Math.PI, H, { track: f.id.startsWith('os_') });
  },
  terminal(B, L, f, H, sts) {
    B.box(L.w, L.h, L.d, lambert({ color: '#5a5f6a' }), 0, 0, 0);
    B.box(L.w * 0.86, 0.5, 0.04, mat('black'), 0, 0.9, L.d / 2 + 0.01);
    const sm = basic({ map: textTex('КВАДР-ПРОВЕРКА', { bg: '#0a2a0a', fg: '#6cff6c', size: 11, w: 128, h: 64 }) });
    const scr = B.plane(L.w * 0.8, 0.45, sm, 0, 1.15, L.d / 2 + 0.035, { dynamic: true });
    H.glow.push({ pos: B.worldPos(0, 1.1, L.d / 2 + 0.6), st: sts[0]?.id });
    B.box(L.w * 0.9, 0.04, 0.3, lambert({ color: '#4a4f5a' }), 0, 0.82, L.d / 2 + 0.12);
    void scr;
  },
  cabinets(B, L) {
    const n = Math.max(2, Math.round(L.w / 0.75));
    for (let i = 0; i < n; i++) {
      const x = -L.w / 2 + (i + 0.5) * (L.w / n);
      B.box(L.w / n - 0.04, L.h, L.d, mat('metal'), x, 0, 0);
      for (let r = 0; r < 4; r++) {
        B.box(L.w / n - 0.12, 0.02, 0.02, mat('dark'), x, 0.2 + r * (L.h / 4), L.d / 2 + 0.005);
        B.box(0.12, 0.03, 0.04, mat('steel'), x, 0.3 + r * (L.h / 4), L.d / 2 + 0.02);
      }
    }
  },
  keybox(B, L, f, H) {
    B.box(0.5, 0.6, 0.08, mat('wood'), 0, 1.2, 0);
    const keys = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const k = B.box(0.04, 0.12, 0.02, mat('gold'), -0.15 + i * 0.1, 1.38, 0.06, { dynamic: true, parent: keys });
      void k;
    }
    B.dyn.add(keys);
    H.keybox = keys;
    B.box(0.3, 0.08, 0.02, lambert({ color: '#e8e0c0' }), 0, 1.55, 0.05);
  },
  stand(B, L) {
    B.box(L.w, 1.0, 0.04, lambert({ tex: 'poster' }), 0, 0.8, 0);
    B.box(L.w + 0.06, 0.06, 0.06, mat('wood'), 0, 1.8, 0);
    B.box(0.25, 0.12, 0.08, lambert({ color: '#2a5ab0' }), L.w / 2 - 0.2, 0.9, 0.05);
  },
  checkpoint(B) {
    B.box(0.42, 0.55, 0.04, lambert({ color: '#5a3a1a' }), 0, 1.05, 0);
    B.box(0.36, 0.45, 0.02, mat('paper'), 0, 1.08, 0.03);
    B.box(0.1, 0.06, 0.06, lambert({ color: '#c02020' }), 0.12, 1.35, 0.05);
  },
  plant(B, L) {
    B.cyl(0.2, 0.15, 0.4, 6, mat('terra'), 0, 0, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      B.put(new THREE.ConeGeometry(0.1, 0.7, 4), mat('leaf'), Math.cos(a) * 0.12, 0.75, Math.sin(a) * 0.12, { rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5 });
    }
    B.ico(0.18, mat('leaf'), 0, 0.85, 0);
  },
  ficus(B) {
    B.cyl(0.32, 0.25, 0.5, 7, mat('terra'), 0, 0, 0);
    B.cyl(0.04, 0.06, 1.2, 5, lambert({ color: '#5a3a1a' }), 0, 0.5, 0);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      B.ico(0.28, mat('leaf'), Math.cos(a) * 0.32, 1.3 + (i % 3) * 0.22, Math.sin(a) * 0.32, { sx: 1, sy: 0.6, sz: 1 });
    }
  },
  sofa(B, L) {
    const fab = lambert({ color: '#6a3a2a' });
    B.box(L.w, 0.4, L.d, fab, 0, 0, 0);
    B.box(L.w, 0.5, 0.2, fab, 0, 0.4, -L.d / 2 + 0.1);
    for (const s of [-1, 1]) B.box(0.18, 0.3, L.d, fab, s * (L.w / 2 - 0.09), 0.4, 0);
  },
  conf_table(B, L, f, H) {
    B.box(L.w, 0.07, L.d, mat('wood'), 0, 0.72, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(0.1, 0.72, 0.1, mat('dark'), sx * (L.w / 2 - 0.3), 0, sz * (L.d / 2 - 0.2));
    // бумаги и графин на столе
    for (let i = 0; i < 6; i++) B.box(0.22, 0.01, 0.3, mat('paper'), -3 + i * 1.2, 0.795, (i % 2 ? 0.7 : -0.7), { ry: (i % 3) * 0.2 });
    B.cyl(0.08, 0.1, 0.3, 6, mat('glass'), 0, 0.79, 0);
    const xs = [-3.2, -1.6, 0, 1.6, 3.2];
    for (const x of xs) {
      chair(B, x, -1.95, 0, H, { fabric: lambert({ color: '#5a2a22' }) });
      chair(B, x, 1.95, Math.PI, H, { fabric: lambert({ color: '#5a2a22' }) });
    }
    chair(B, -4.95, 0, Math.PI / 2, H, { fabric: lambert({ color: '#5a2a22' }) });
    chair(B, 4.95, 0, -Math.PI / 2, H, { fabric: lambert({ color: '#5a2a22' }) });
  },
  boss_desk(B, L, f, H) {
    B.box(L.w, 0.08, L.d, mat('wood'), 0, 0.74, 0);
    B.box(L.w, 0.7, 0.06, mat('wood'), 0, 0.04, L.d / 2 - 0.05);
    for (const s of [-1, 1]) B.box(0.08, 0.74, L.d, mat('wood'), s * (L.w / 2 - 0.04), 0, 0);
    B.box(0.5, 0.12, 0.06, lambert({ map: undefined, tex: 'plate' }), 0, 0.82, L.d / 2 - 0.1);
    B.box(0.24, 0.08, 0.18, lambert({ color: '#8a1a1a' }), 0.9, 0.82, 0.1);
    B.cyl(0.02, 0.02, 0.18, 4, mat('dark'), 0.9, 0.9, 0.05);
    B.box(0.5, 0.02, 0.36, mat('paper'), -0.6, 0.82, 0.1, { ry: -0.2 });
    // Кресло Директора
    const leather = lambert({ color: '#2a1a14' });
    B.box(0.7, 0.12, 0.6, leather, 0, 0.45, -L.d / 2 - 0.55);
    B.box(0.72, 1.0, 0.14, leather, 0, 0.55, -L.d / 2 - 0.85);
    B.cyl(0.05, 0.05, 0.4, 5, mat('dark'), 0, 0.05, -L.d / 2 - 0.55);
  },
  bell(B) {
    B.box(0.5, 0.5, 0.1, lambert({ color: '#7a1a1a' }), 0, 1.15, 0);
    B.put(new THREE.SphereGeometry(0.15, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat('gold'), 0, 1.4, 0.08, { rx: Math.PI / 2 });
    B.box(0.16, 0.16, 0.08, lambert({ color: '#e02020' }), 0, 1.1, 0.08);
  },
  portrait(B) {
    B.box(1.3, 1.6, 0.06, lambert({ tex: 'owner' }), 0, 1.0, 0);
  },
  safe(B, L) {
    B.box(L.w, L.h, L.d, lambert({ color: '#3a4040' }), 0, 0, 0);
    B.cyl(0.1, 0.1, 0.04, 8, mat('steel'), 0.1, L.h * 0.55, L.d / 2, { rx: Math.PI / 2 });
    B.box(0.06, 0.25, 0.05, mat('steel'), -0.3, L.h * 0.4, L.d / 2);
  },
  plate(B) { B.box(0.85, 0.22, 0.04, lambert({ tex: 'plate' }), 0, 1.6, 0); },
  printer(B, L, f, H, sts) {
    B.box(L.w, 0.9, L.d, mat('beige'), 0, 0, 0);
    B.box(L.w * 0.9, 0.15, L.d * 0.9, mat('beige'), 0, 0.9, 0);
    B.box(0.4, 0.08, 0.3, lambert({ color: '#4a4a4a' }), L.w / 2 - 0.3, 1.02, L.d / 2 - 0.2);
    B.box(L.w * 0.6, 0.03, 0.4, mat('paper'), 0, 0.92, L.d / 2);
    B.box(L.w * 0.7, 0.04, 0.3, lambert({ color: '#7a7a72' }), 0, 0.55, L.d / 2 + 0.15);
    for (let i = 0; i < 3; i++) B.box(L.w * 0.8, 0.02, 0.02, mat('dark'), 0, 0.2 + i * 0.15, L.d / 2 + 0.005);
    const lamp = B.box(0.06, 0.04, 0.04, basic({ color: '#30ff40', unique: true }), L.w / 2 - 0.15, 1.05, L.d / 2 - 0.1, { dynamic: true });
    if (sts[0]) H.printers[sts[0].id] = { lamp, pos: B.worldPos(0, 1.1, 0) };
  },
  copier(B, L) {
    B.box(L.w, 0.95, L.d, mat('beige'), 0, 0, 0);
    B.box(L.w * 0.95, 0.08, L.d * 0.9, lambert({ color: '#4a4a52' }), 0, 0.95, 0);
  },
  paper_shelf(B, L) {
    for (let i = 0; i < 4; i++) {
      B.box(L.w, 0.04, L.d, mat('metal'), 0, 0.1 + i * 0.55, 0);
      for (let k = 0; k < 4; k++) B.box(0.45, 0.2, 0.3, lambert({ color: k % 2 ? '#f0f0ea' : '#d8e0f0' }), -L.w / 2 + 0.35 + k * 0.6, 0.14 + i * 0.55, 0);
    }
    for (const s of [-1, 1]) B.box(0.04, L.h, L.d, mat('metal'), s * L.w / 2, 0, 0);
  },
  shield(B, L) {
    B.box(1.2, 1.5, 0.25, lambert({ color: '#8a9298' }), 0, 0.6, 0);
    B.box(1.1, 1.4, 0.02, lambert({ color: '#6a7278' }), 0, 0.65, 0.13);
    for (let i = 0; i < 5; i++) {
      B.box(0.06, 0.2, 0.06, mat('dark'), -0.4 + i * 0.2, 1.3, 0.15);
      B.box(0.08, 0.06, 0.1, lambert({ color: '#c02020' }), -0.4 + i * 0.2, 1.42, 0.18);
    }
    B.box(0.5, 0.5, 0.02, lambert({ tex: 'hazard' }), 0, 0.75, 0.15);
  },
  accelerator(B, L, f, H) {
    // Калоидный ускоритель: станина, центральный реактор с кольцами, трубы, три панели
    B.box(L.w, 0.4, L.d, lambert({ tex: 'hazard' }), 0, 0, 0);
    B.box(L.w - 0.6, 1.0, L.d - 0.6, lambert({ tex: 'machine' }), 0, 0.4, 0);
    B.cyl(1.0, 1.2, 1.4, 8, lambert({ color: '#5a6a70' }), 0, 1.4, 0);
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const m = basic({ color: '#40ffd0', unique: true });
      const r = B.put(new THREE.TorusGeometry(1.08 - i * 0.05, 0.06, 4, 10), m, 0, 1.6 + i * 0.4, 0, { rx: Math.PI / 2, dynamic: true });
      rings.push(r);
    }
    const coreMat = basic({ color: '#2ac0a0', unique: true });
    const core = B.cyl(0.35, 0.35, 0.4, 8, coreMat, 0, 2.8, 0, { dynamic: true });
    for (const [x, z] of [[-2.2, -1.6], [2.2, -1.6], [-2.2, 1.6], [2.2, 1.6]]) {
      B.cyl(0.12, 0.12, 2.6, 6, mat('steel'), x, 0, z);
    }
    B.box(L.w - 0.4, 0.2, 0.2, mat('steel'), 0, 2.5, -1.6);
    B.box(L.w - 0.4, 0.2, 0.2, mat('steel'), 0, 2.5, 1.6);
    // панели управления (север, запад, восток)
    const panels = [[0, 0.4 - L.d / 2 - 0.05, 0], [-L.w / 2 - 0.05, 0, Math.PI / 2], [L.w / 2 + 0.05, 0, -Math.PI / 2]];
    const lamps = [];
    for (const [x, z, ry] of [[0, -L.d / 2 - 0.05, Math.PI], [-L.w / 2 - 0.05, 0, -Math.PI / 2], [L.w / 2 + 0.05, 0, Math.PI / 2]]) {
      B.box(0.9, 1.2, 0.3, lambert({ tex: 'machine' }), x, 0, z, { ry });
      const lm = basic({ color: '#30ff40', unique: true });
      const lamp = B.box(0.5, 0.12, 0.05, lm, x + Math.sin(ry) * 0.17, 1.0, z + Math.cos(ry) * 0.17, { ry, dynamic: true });
      lamps.push(lamp);
    }
    void panels;
    H.accel = { rings, core, lamps, pos: B.worldPos(0, 1.5, 0) };
  },
  tanks(B, L) {
    for (let i = 0; i < 3; i++) {
      const z = -L.d / 2 + 0.8 + i * 1.7;
      B.cyl(0.6, 0.6, 2.2, 8, lambert({ color: i === 1 ? '#7a8a3a' : '#5a6a72' }), 0, 0, z);
      B.ico(0.6, lambert({ color: '#5a6a72' }), 0, 2.2, z, { sy: 0.4 });
    }
    B.cyl(0.08, 0.08, L.d, 5, mat('steel'), -0.7, 1.6, 0, { rx: Math.PI / 2 });
  },
  workbench(B, L) {
    B.box(L.w, 0.08, L.d, mat('wood'), 0, 0.82, 0);
    for (const sx of [-1, 1]) B.box(0.08, 0.82, L.d - 0.1, mat('metal'), sx * (L.w / 2 - 0.1), 0, 0);
    B.box(0.5, 0.15, 0.25, lambert({ color: '#c03020' }), -0.6, 0.9, 0);
    B.box(0.3, 0.03, 0.06, mat('steel'), 0.3, 0.9, 0.1, { ry: 0.6 });
    B.box(L.w, 0.8, 0.04, lambert({ tex: 'metal' }), 0, 1.0, -L.d / 2);
  },
  cable_drum(B) {
    B.cyl(0.5, 0.5, 0.08, 8, mat('wood'), 0, 0, -0.35, { rx: Math.PI / 2 });
    B.cyl(0.5, 0.5, 0.08, 8, mat('wood'), 0, 0, 0.35, { rx: Math.PI / 2 });
    B.cyl(0.35, 0.35, 0.62, 8, lambert({ color: '#2a2a2a' }), 0, 0.5 - 0.31, 0, { rx: Math.PI / 2 });
  },
  kassa_counter(B, L, f, H, sts) {
    B.box(L.w, 1.0, L.d, mat('wood'), 0, 0, 0);
    B.box(L.w + 0.1, 0.06, L.d + 0.1, lambert({ color: '#3a2a1a' }), 0, 1.0, 0);
    B.box(L.w, 0.5, 0.04, mat('glass'), 0, 1.06, -L.d / 2 + 0.04);
    // кассовый аппарат
    B.box(0.5, 0.25, 0.4, mat('beige'), -0.8, 1.06, 0.1);
    B.box(0.3, 0.18, 0.04, basic({ color: '#2a6a2a' }), -0.8, 1.32, 0.0);
    B.box(0.4, 0.04, 0.2, mat('dark'), -0.8, 1.31, 0.22);
    crt(B, 1.0, 1.06, 0.0, H, sts[0]?.id);
    B.plane(1.2, 0.3, lambert({ map: undefined, tex: 'sign' }), 0, 1.75, -L.d / 2 + 0.02, { dynamic: false });
  },
  lockers(B, L, f, H) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x = -L.w / 2 + (i + 0.5) * (L.w / n);
      B.box(L.w / n - 0.03, L.h, L.d, lambert({ tex: 'locker' }), x, 0, 0);
    }
    const lamp = B.box(0.12, 0.08, 0.05, basic({ color: '#30ff40', unique: true }), 0, L.h + 0.05, L.d / 2 - 0.05, { dynamic: true });
    H.lockerLamp = lamp;
  },
  desk_coins(B, L, f, H) {
    deskProp(B, L);
    for (let i = 0; i < 7; i++) B.cyl(0.05, 0.05, 0.03 + (i % 4) * 0.04, 8, mat('gold'), -0.7 + i * 0.22, 0.76, 0.1 * (i % 2));
    B.box(0.5, 0.2, 0.06, lambert({ color: '#6a3a1a' }), 0.5, 0.76, -0.2);
    chair(B, 0, L.d / 2 + 0.45, Math.PI, H);
  },
  rope_posts(B, L) {
    for (const s of [-1, 1]) {
      B.cyl(0.15, 0.18, 0.04, 6, mat('gold'), s * L.w / 2, 0, 0);
      B.cyl(0.03, 0.03, 0.9, 5, mat('gold'), s * L.w / 2, 0, 0);
    }
    B.put(new THREE.CylinderGeometry(0.025, 0.025, L.w, 4), lambert({ color: '#a01818' }), 0, 0.8, 0, { rz: Math.PI / 2 });
  },
  cooler(B) {
    B.box(0.45, 1.0, 0.45, lambert({ color: '#e8e8e0' }), 0, 0, 0);
    B.cyl(0.2, 0.2, 0.5, 8, lambert({ color: '#6ab0e8', transparent: true, opacity: 0.75 }), 0, 1.0, 0);
    B.box(0.06, 0.06, 0.06, lambert({ color: '#2a5ab0' }), -0.08, 0.7, 0.24);
    B.box(0.06, 0.06, 0.06, lambert({ color: '#c02020' }), 0.08, 0.7, 0.24);
  },
  stationery(B, L) {
    B.box(L.w, L.h, L.d, mat('woodLight'), 0, 0, 0);
    B.box(L.w - 0.1, L.h * 0.55, 0.02, mat('glass'), 0, L.h * 0.4, L.d / 2 + 0.01);
    const cols = ['#c02020', '#2a5ab0', '#e0c030', '#2f8a3a'];
    for (let i = 0; i < 4; i++) B.box(0.25, 0.2, 0.3, lambert({ color: cols[i] }), -L.w / 2 + 0.25 + i * 0.38, L.h * 0.45, 0.1);
  },
  stove(B, L) {
    B.box(L.w, 0.9, L.d, mat('steel'), 0, 0, 0);
    for (let i = 0; i < 4; i++) B.cyl(0.16, 0.16, 0.03, 8, mat('black'), (i % 2 ? 0.2 : -0.2), 0.9, (i < 2 ? -0.5 : 0.5));
    B.cyl(0.24, 0.22, 0.35, 8, mat('steel'), -0.2, 0.93, -0.5);
    B.cyl(0.2, 0.18, 0.15, 8, mat('steel'), 0.2, 0.93, 0.5);
    B.box(0.04, 0.4, L.d - 0.3, lambert({ color: '#3a3a3a' }), L.w / 2 + 0.02, 0.3, 0);
  },
  kitchen_counter(B, L) {
    B.box(L.w, 0.92, L.d, mat('steel'), 0, 0, 0);
    B.box(L.w * 0.7, 0.05, L.d * 0.4, lambert({ color: '#5a6064' }), 0, 0.9, -0.5);
    B.cyl(0.02, 0.02, 0.35, 4, mat('steel'), -0.3, 0.92, -0.5);
    for (let i = 0; i < 3; i++) B.cyl(0.12, 0.1, 0.05, 8, mat('white'), 0, 0.92 + i * 0.05, 0.6);
  },
  fridge(B, L) {
    B.box(L.w, L.h, L.d, mat('steel'), 0, 0, 0);
    B.box(0.04, 0.6, 0.06, mat('dark'), L.w / 2 - 0.15, 1.1, L.d / 2 + 0.03);
    B.box(L.w - 0.04, 0.02, 0.02, mat('dark'), 0, 1.35, L.d / 2 + 0.005);
  },
  pot(B, L, f, H) {
    // Огромный бидон щей, у которого стоит Бидонья
    B.cyl(0.66, 0.6, 0.95, 10, mat('steel'), 0, 0, 0);
    B.put(new THREE.TorusGeometry(0.66, 0.04, 4, 10), mat('steel'), 0, 0.95, 0, { rx: Math.PI / 2 });
    const soupMat = lambertUnique('#c8a040');
    const soup = B.put(new THREE.CircleGeometry(0.62, 10), soupMat, 0, 0.88, 0, { rx: -Math.PI / 2, dynamic: true });
    B.cyl(0.03, 0.03, 0.9, 4, mat('steel'), 0.25, 0.7, 0.1, { rz: 0.4 });
    B.ico(0.1, mat('steel'), 0.05, 0.72, 0.1, { sy: 0.5 });
    // золотой круг на полу, как на кадре из Столовой
    B.put(new THREE.CircleGeometry(1.15, 12), lambert({ color: '#b08a2a' }), 0, 0.015, 0, { rx: -Math.PI / 2 });
    H.pot = { soup, soupMat, pos: B.worldPos(0, 1, 0) };
  },
  coffee(B, L) {
    B.box(L.w, 0.9, L.d, mat('woodLight'), 0, 0, 0);
    B.box(0.45, 0.55, 0.4, lambert({ color: '#2a2a2e' }), 0, 0.9, -0.15);
    B.box(0.3, 0.1, 0.05, basic({ color: '#e05a20' }), 0, 1.3, 0.06);
    for (let i = 0; i < 3; i++) B.cyl(0.04, 0.035, 0.09, 6, mat('white'), -0.25 + i * 0.2, 0.9, 0.3);
  },
  dining_table(B, L) {
    B.box(L.w, 0.06, L.d, lambert({ color: '#c8c0a8' }), 0, 0.74, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl(0.03, 0.03, 0.74, 4, mat('steel'), sx * (L.w / 2 - 0.15), 0, sz * (L.d / 2 - 0.15));
    for (const sz of [-1, 1]) B.box(L.w - 0.2, 0.06, 0.3, mat('steel'), 0, 0.45, sz * (L.d / 2 + 0.35));
    for (let i = 0; i < 3; i++) B.cyl(0.13, 0.1, 0.06, 8, mat('white'), -0.8 + i * 0.8, 0.8, (i % 2 ? 0.3 : -0.3));
  },
  hood(B, L) {
    B.box(L.w, 0.5, L.d, mat('steel'), 0, 2.2, 0);
    B.put(new THREE.CylinderGeometry(0.3, L.w * 0.5, 0.3, 4), mat('steel'), 0, 2.85, 0, { ry: Math.PI / 4 });
  },
  reception(B, L, f, H) {
    B.box(L.w, 1.1, L.d, mat('wood'), 0, 0, 0);
    B.box(L.w + 0.1, 0.05, L.d + 0.2, lambert({ color: '#3a2a1a' }), 0, 1.1, 0.05);
    B.box(0.5, 0.04, 0.35, lambert({ color: '#2a4a8a' }), 0.4, 1.15, 0.1);
    B.box(0.45, 0.02, 0.3, mat('paper'), 0.4, 1.19, 0.1);
    B.box(0.25, 0.1, 0.2, lambert({ color: '#2a2a2a' }), -0.6, 1.15, 0.1);
    B.cyl(0.02, 0.02, 0.4, 4, mat('dark'), -1.2, 1.15, -0.2);
    B.put(new THREE.CylinderGeometry(0.06, 0.15, 0.15, 6, 1, true), lambert({ color: '#2a6a2a', side: 'double' }), -1.2, 1.6, -0.2);
  },
  board(B, L, f, H) {
    B.box(1.9, 1.2, 0.05, lambert({ tex: 'cork' }), 0, 0.9, 0);
    B.box(2.0, 0.06, 0.07, mat('wood'), 0, 2.1, 0);
    B.box(2.0, 0.06, 0.07, mat('wood'), 0, 0.88, 0);
    const note = B.box(0.5, 0.65, 0.01, lambertUnique('#f4efd8'), 0.55, 1.15, 0.035, { dynamic: true });
    H.boardNote = note;
    H.boardStamp = B.box(0.16, 0.16, 0.012, lambertUnique('#2a4ac0'), 0.65, 1.0, 0.04, { dynamic: true });
  },
  sign(B) { B.box(2.1, 0.55, 0.06, lambert({ tex: 'sign' }), 0, 1.75, 0); },
  turnstile(B, L) {
    B.box(0.3, 1.0, 0.9, mat('steel'), 0, 0, 0);
    for (let i = 0; i < 3; i++) B.cyl(0.02, 0.02, 0.55, 4, mat('steel'), 0.42, 0.85, 0, { rz: Math.PI / 2 + (i - 1) * 0.9 });
    B.box(0.12, 0.08, 0.12, basic({ color: '#30ff40' }), 0, 1.0, 0.3);
  },
  bench(B, L) {
    B.box(L.w, 0.06, L.d, mat('wood'), 0, 0.44, 0);
    for (const s of [-1, 1]) B.box(L.w - 0.1, 0.44, 0.06, mat('dark'), 0, 0, s * (L.d / 2 - 0.2));
  },
  glass_door(B, L) {
    B.box(L.w, 2.4, 0.06, mat('glass'), 0, 0, 0);
    B.box(L.w + 0.2, 0.1, 0.12, mat('steel'), 0, 2.4, 0);
    for (const s of [-1, 0, 1]) B.box(0.08, 2.4, 0.1, mat('steel'), s * L.w / 2, 0, 0);
    B.plane(L.w - 0.2, 2.2, basic({ color: '#8fb8d8' }), 0, 1.2, -0.04, { ry: Math.PI });
  },
  pump(B, L, f, H) {
    B.box(L.w, 0.3, L.d, lambert({ color: '#4a5a3a' }), 0, 0, 0);
    B.cyl(0.45, 0.45, 1.1, 8, lambert({ color: '#6a7a4a' }), -0.4, 0.3, 0);
    B.box(0.6, 0.6, 0.6, lambert({ tex: 'machine' }), 0.5, 0.3, 0);
    B.cyl(0.1, 0.1, 1.6, 6, mat('steel'), -0.4, 1.4, 0);
    B.box(0.06, 0.06, 0.9, mat('dark'), 0.5, 1.1, 0.4, { rx: -0.6 });
    B.ico(0.08, lambert({ color: '#c02020' }), 0.5, 1.3, 0.7);
  },
  barrel_cabbage(B, L) {
    B.cyl(0.55, 0.5, 0.9, 10, mat('wood'), 0, 0, 0);
    for (const y of [0.15, 0.75]) B.put(new THREE.TorusGeometry(0.54, 0.03, 3, 10), mat('dark'), 0, y, 0, { rx: Math.PI / 2 });
    for (let i = 0; i < 5; i++) B.ico(0.17, lambert({ color: '#7aa04a' }), Math.cos(i * 1.3) * 0.25, 0.95, Math.sin(i * 1.3) * 0.25);
  },
  crates(B, L) {
    const cm = lambert({ tex: 'crate' });
    const s = 0.9;
    for (let i = 0; i < Math.floor(L.w / s); i++) {
      for (let j = 0; j < Math.floor(L.d / s); j++) {
        const h = 1 + ((i + j) % 2);
        for (let k = 0; k < h; k++) B.box(s - 0.04, s - 0.04, s - 0.04, cm, -L.w / 2 + (i + 0.5) * s, k * s, -L.d / 2 + (j + 0.5) * s, { ry: (i + j + k) % 3 === 0 ? 0.1 : 0 });
      }
    }
  },
  barrels(B, L) {
    const bm = lambert({ color: '#3a5a7a' });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) B.cyl(0.36, 0.36, 1.0, 8, i === 1 && j === 0 ? lambert({ color: '#8a6a2a' }) : bm, -L.w / 2 + 0.4 + j * 0.8, 0, -L.d / 2 + 0.4 + i * 0.8);
  },
  pipes(B, L) {
    for (let i = 0; i < 3; i++) B.put(new THREE.CylinderGeometry(0.09, 0.09, L.w, 6), lambert({ color: i === 1 ? '#7a4a2a' : '#6a7278' }), 0, 2.2 + i * 0.25, 0, { rz: Math.PI / 2 });
  },
  puddle(B, L) {
    B.put(new THREE.CircleGeometry(0.5, 9), lambert({ tex: 'slop_liquid' }), 0, 0.012, 0, { rx: -Math.PI / 2, sx: L.w, sy: L.d });
  },
  cart_spot(B) {
    B.put(new THREE.PlaneGeometry(1.4, 1.4), lambert({ tex: 'hazard' }), 0, 0.01, 0, { rx: -Math.PI / 2 });
  },
};

function shelfProp(B, L, folderMat) {
  const frame = mat('wood');
  const levels = Math.max(3, Math.floor(L.h / 0.48));
  for (const s of [-1, 1]) B.box(0.06, L.h, L.d, frame, s * (L.w / 2 - 0.03), 0, 0);
  B.box(L.w, 0.05, L.d, frame, 0, L.h - 0.05, 0);
  for (let i = 0; i < levels; i++) {
    const y = 0.05 + i * (L.h / levels);
    B.box(L.w - 0.08, 0.04, L.d, frame, 0, y, 0);
    B.box(L.w - 0.16, L.h / levels - 0.12, L.d * 0.8, folderMat, 0, y + 0.04, 0);
  }
}

function deskProp(B, L) {
  B.box(L.w, 0.05, L.d, mat('woodLight'), 0, 0.71, 0);
  for (const s of [-1, 1]) B.box(0.05, 0.71, L.d - 0.06, mat('metal'), s * (L.w / 2 - 0.06), 0, 0);
  B.box(L.w - 0.14, 0.35, 0.03, mat('woodLight'), 0, 0.35, -L.d / 2 + 0.05);
  B.box(0.45, 0.6, L.d - 0.1, mat('woodLight'), L.w / 2 - 0.32, 0.1, 0);
  for (let i = 0; i < 3; i++) B.box(0.1, 0.02, 0.03, mat('steel'), L.w / 2 - 0.32, 0.25 + i * 0.18, L.d / 2 - 0.03);
}

function decorateWalls(B) {
  const P = (x, z, ry, t, w, h, y = 1.6) => { B.begin(x, z, ry); B.box(w, h, 0.04, lambert({ tex: t }), 0, y - h / 2, 0); };
  // Картины и плакаты (север: ry=0 смотрит на юг)
  P(24, 14.2, 0, 'painting', 1.2, 0.8);
  P(30.5, 27.8, Math.PI, 'poster', 0.6, 0.75);
  P(17, 27.8, Math.PI, 'poster', 0.6, 0.75);
  P(2.5, 14.2, 0, 'painting', 1.0, 0.7);
  P(0.2, 17, Math.PI / 2, 'poster', 0.6, 0.75);
  P(20.2, 39, Math.PI / 2, 'poster', 0.6, 0.75);
  P(19.8, 39, -Math.PI / 2, 'menu_board', 1.2, 0.9);
  P(10, 28.2, 0, 'menu_board', 1.4, 1.0);
  P(45, 0.2, 0, 'poster', 0.6, 0.75, 2.2);
  P(38, 0.2, 0, 'painting', 1.0, 0.7);
  P(31, 0.2, 0, 'painting', 1.0, 0.7);
  P(22, 0.2, 0, 'painting', 0.9, 0.6, 2.0);
  P(27.8, 6.5, -Math.PI / 2, 'poster', 0.6, 0.75);
  P(41.8, 18, -Math.PI / 2, 'painting', 1.2, 0.8);
  // Настенные часы
  for (const [x, z, ry] of [[28, 14.2, 0], [10, 41.8, Math.PI], [35, 0.2, 0], [7, 0.2, 0]]) {
    B.begin(x, z, ry);
    B.put(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 10), lambert({ color: '#f0ece0' }), 0, 2.45, 0.02, { rx: Math.PI / 2 });
    B.put(new THREE.TorusGeometry(0.22, 0.03, 3, 10), lambert({ color: '#2a2a2a' }), 0, 2.45, 0.04);
    B.box(0.02, 0.15, 0.02, lambert({ color: '#111' }), 0, 2.45, 0.06, { rz: 0.8 });
    B.box(0.02, 0.1, 0.02, lambert({ color: '#111' }), 0, 2.45, 0.06, { rz: -0.4 });
  }
}

export function stationPositions() {
  return STATIONS.map((s) => ({ id: s.id, x: s.x, z: s.z }));
}

export { FURN_BY_ID, MAP_W, MAP_D };
