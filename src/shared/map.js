// Карта Конторки: зоны, стены с проходами, мебель, станции взаимодействия,
// навигационная сетка, линия видимости и коллизии. Общий модуль для сервера и клиента.
//
// Система координат: x — на восток, z — на юг, единицы — метры.
// Угол поворота персонажа rot: 0 — смотрит на юг (+z), PI/2 — на восток, PI — на север.

export const MAP_W = 56;
export const MAP_D = 42;
export const WALL_T = 0.3;
export const WALL_H = 3.0;
export const AGENT_R = 0.35;
export const CELL = 0.5;
export const GW = Math.round(MAP_W / CELL);
export const GH = Math.round(MAP_D / CELL);
export const USE_RADIUS = 1.7;

// ---------------------------------------------------------------------------
// Зоны
// ---------------------------------------------------------------------------
export const ZONES = [
  { id: 'archive', name: 'Архив', loc: 'в Архиве', x0: 0, z0: 0, x1: 14, z1: 14,
    light: [1.0, 0.86, 0.62], lum: 0.78, floor: 'parquet', wall: 'wall_archive' },
  { id: 'kvadry', name: 'Отдел квадров', loc: 'в Отделе квадров', x0: 14, z0: 0, x1: 28, z1: 14,
    light: [0.92, 0.95, 0.85], lum: 0.95, floor: 'carpet_grey', wall: 'wall_beige' },
  { id: 'cabinet', name: 'Кабинет Директора', loc: 'в Кабинете Директора', x0: 28, z0: 0, x1: 42, z1: 14,
    light: [1.0, 0.85, 0.66], lum: 0.95, floor: 'carpet_red', wall: 'wall_wood' },
  { id: 'tech', name: 'Техзона', loc: 'в Техзоне', x0: 42, z0: 0, x1: 56, z1: 28,
    light: [0.75, 0.9, 1.0], lum: 0.82, floor: 'concrete', wall: 'wall_tech' },
  { id: 'kassa', name: 'Касса', loc: 'на Кассе', x0: 0, z0: 14, x1: 14, z1: 28,
    light: [1.0, 0.95, 0.75], lum: 0.95, floor: 'linoleum', wall: 'wall_green' },
  { id: 'openspace', name: 'Опенспейс', loc: 'в Опенспейсе', x0: 14, z0: 14, x1: 42, z1: 28,
    light: [0.93, 1.0, 0.92], lum: 1.05, floor: 'carpet_green', wall: 'wall_beige' },
  { id: 'canteen', name: 'Столовая', loc: 'в Столовой', x0: 0, z0: 28, x1: 20, z1: 42,
    light: [1.0, 0.92, 0.72], lum: 1.1, floor: 'tiles_white', wall: 'wall_tiles' },
  { id: 'entrance', name: 'Входная', loc: 'во Входной', x0: 20, z0: 28, x1: 36, z1: 42,
    light: [1.0, 0.97, 0.88], lum: 1.0, floor: 'checker', wall: 'wall_beige' },
  { id: 'slop', name: 'Слоповина', loc: 'в Слоповине', x0: 36, z0: 28, x1: 56, z1: 42,
    light: [0.6, 0.95, 0.55], lum: 0.55, floor: 'slop', wall: 'wall_slop' },
];
export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));

export function zoneAt(x, z) {
  for (const zn of ZONES) {
    if (x >= zn.x0 && x < zn.x1 && z >= zn.z0 && z < zn.z1) return zn.id;
  }
  // На стыке — ближайшая зона
  let best = ZONES[0].id;
  let bd = Infinity;
  for (const zn of ZONES) {
    const cx = Math.max(zn.x0, Math.min(zn.x1, x));
    const cz = Math.max(zn.z0, Math.min(zn.z1, z));
    const d = (cx - x) ** 2 + (cz - z) ** 2;
    if (d < bd) { bd = d; best = zn.id; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Стены. h:true — горизонтальная линия z=c от x=a до x=b; h:false — вертикальная x=c.
// В каждой стене — проёмы (двери). У каждой важной зоны не меньше двух входов (GDD 10.1).
// ---------------------------------------------------------------------------
const WALL_LINES = [
  { h: true, c: 0, a: 0, b: 56, doors: [] },
  { h: true, c: 14, a: 0, b: 14, doors: [[5.5, 8, 'd_arch_kassa']] },
  { h: true, c: 14, a: 14, b: 28, doors: [[19.5, 22, 'd_kv_os']] },
  { h: true, c: 14, a: 28, b: 42, doors: [[33.5, 36, 'd_cab_os']] },
  { h: true, c: 28, a: 0, b: 14, doors: [[5.5, 8, 'd_kassa_can']] },
  { h: true, c: 28, a: 14, b: 20, doors: [[15.5, 18, 'd_os_can']] },
  { h: true, c: 28, a: 20, b: 36, doors: [[26, 30, 'd_os_ent']] },
  { h: true, c: 28, a: 36, b: 42, doors: [[39.2, 40.8, 'd_os_slop']] },
  { h: true, c: 28, a: 42, b: 56, doors: [[47.5, 50, 'd_tech_slop']] },
  { h: true, c: 42, a: 0, b: 56, doors: [] },
  { h: false, c: 0, a: 0, b: 42, doors: [] },
  { h: false, c: 14, a: 0, b: 14, doors: [[5.5, 8, 'd_arch_kv']] },
  { h: false, c: 14, a: 14, b: 28, doors: [[19.5, 22, 'd_kassa_os']] },
  { h: false, c: 20, a: 28, b: 42, doors: [[33.5, 36, 'd_can_ent']] },
  { h: false, c: 28, a: 0, b: 14, doors: [[5.5, 8, 'd_kv_cab']] },
  { h: false, c: 36, a: 28, b: 42, doors: [[36, 38.5, 'd_ent_slop']] },
  { h: false, c: 42, a: 0, b: 14, doors: [[5.5, 8, 'd_cab_tech']] },
  { h: false, c: 42, a: 14, b: 28, doors: [[19.5, 22, 'd_os_tech']] },
  { h: false, c: 56, a: 0, b: 42, doors: [] },
];

function rectFromLine(h, c, a, b) {
  const t = WALL_T / 2;
  return h
    ? { x0: a - t, z0: c - t, x1: b + t, z1: c + t }
    : { x0: c - t, z0: a - t, x1: c + t, z1: b + t };
}

export const WALLS = [];
export const DOORS = [];
for (const line of WALL_LINES) {
  let cur = line.a;
  const doors = line.doors.slice().sort((p, q) => p[0] - q[0]);
  for (const [da, db, id] of doors) {
    if (da > cur) WALLS.push({ ...rectFromLine(line.h, line.c, cur, da), h: line.h, outer: false });
    const mid = (da + db) / 2;
    const cx = line.h ? mid : line.c;
    const cz = line.h ? line.c : mid;
    const zA = line.h ? zoneAt(cx, cz - 0.5) : zoneAt(cx - 0.5, cz);
    const zB = line.h ? zoneAt(cx, cz + 0.5) : zoneAt(cx + 0.5, cz);
    DOORS.push({
      id, h: line.h, c: line.c, a: da, b: db, x: cx, z: cz, width: db - da,
      zones: [zA, zB], rect: rectFromLine(line.h, line.c, da, db),
    });
    cur = db;
  }
  if (cur < line.b) WALLS.push({ ...rectFromLine(line.h, line.c, cur, line.b), h: line.h });
}
for (const w of WALLS) {
  w.outer = (w.x0 < 0.2 && w.x1 < 0.2) || (w.z0 < 0.2 && w.z1 < 0.2) ||
    (w.x0 > MAP_W - 0.2) || (w.z0 > MAP_D - 0.2);
}
export const DOOR_BY_ID = Object.fromEntries(DOORS.map((d) => [d.id, d]));

// ---------------------------------------------------------------------------
// Мебель. front — сторона, с которой к предмету подходят (S/N/E/W).
// solid — препятствие для движения, vision — перекрывает обзор (высокие предметы).
// ---------------------------------------------------------------------------
const F = [];
function furn(id, type, x, z, w, d, opts = {}) {
  const f = { id, type, x, z, w, d, h: opts.h ?? 1.0, front: opts.front ?? 'S',
    solid: opts.solid ?? true, vision: opts.vision ?? false, zone: zoneAt(x, z), ...opts };
  F.push(f);
  return f;
}

// Архив
furn('arch_shelf_n', 'shelf', 7, 0.6, 11, 0.7, { h: 2.4, front: 'S', vision: true });
furn('arch_shelf_red', 'shelf_red', 5.5, 5.0, 7, 0.8, { h: 2.2, front: 'S', vision: true });
furn('arch_shelf_b', 'shelf', 5.5, 9.0, 7, 0.8, { h: 2.2, front: 'S', vision: true });
furn('arch_desk', 'desk_papers', 11.5, 11.5, 2.0, 1.0, { front: 'N' });
furn('arch_cards', 'cardfile', 1.0, 12.0, 0.9, 2.0, { h: 1.3, front: 'E' });
furn('arch_lamp', 'floor_lamp', 12.8, 1.2, 0.5, 0.5, { h: 1.8 });

// Отдел квадров
furn('kv_desk1', 'desk_pc', 17.5, 3.0, 2.0, 1.0, { front: 'S' });
furn('kv_desk2', 'desk_pc', 22.5, 3.0, 2.0, 1.0, { front: 'S' });
furn('kv_terminal', 'terminal', 26.9, 11.0, 0.8, 1.4, { h: 1.6, front: 'W' });
furn('kv_cabinets', 'cabinets', 14.8, 11.0, 0.9, 3.0, { h: 1.9, front: 'E', vision: true });
furn('kv_keybox', 'keybox', 14.3, 1.8, 0.3, 0.8, { h: 1.6, front: 'E', solid: false });
furn('kv_stand1', 'stand', 20.0, 0.35, 1.2, 0.2, { h: 1.8, front: 'S', solid: false });
furn('kv_stand2', 'stand', 27.65, 2.4, 0.2, 1.2, { h: 1.8, front: 'W', solid: false });
furn('kv_stand3', 'stand', 24.5, 13.65, 1.2, 0.2, { h: 1.8, front: 'N', solid: false });
furn('kv_plant', 'plant', 27.2, 0.8, 0.6, 0.6, { h: 1.4 });
furn('kv_sofa', 'sofa', 20.5, 9.5, 2.4, 0.9, { h: 0.9, front: 'N' });

// Кабинет Директора
furn('cab_table', 'conf_table', 35, 8.5, 8, 2.4, { h: 0.8 });
furn('cab_desk', 'boss_desk', 35, 1.6, 3.2, 1.2, { front: 'S' });
furn('cab_ficus', 'ficus', 41.1, 0.9, 0.8, 0.8, { h: 2.0 });
furn('cab_bell', 'bell', 28.25, 12.0, 0.2, 0.8, { h: 1.6, front: 'E', solid: false });
furn('cab_portrait', 'portrait', 35, 0.2, 1.6, 0.1, { h: 2.6, solid: false });
furn('cab_safe', 'safe', 29.0, 1.0, 1.0, 1.0, { h: 1.2 });
furn('cab_plate', 'plate', 37.2, 14.2, 0.9, 0.1, { h: 1.7, front: 'S', solid: false });

// Техзона
furn('tech_printer1', 'printer', 45, 1.2, 1.6, 1.0, { h: 1.2, front: 'S' });
furn('tech_printer2', 'printer', 49, 1.2, 1.6, 1.0, { h: 1.2, front: 'S' });
furn('tech_paper', 'paper_shelf', 53.5, 0.9, 2.6, 0.8, { h: 1.8, vision: true });
furn('tech_shield', 'shield', 55.75, 6.5, 0.3, 1.4, { h: 2.0, front: 'W', solid: false });
furn('tech_acc', 'accelerator', 49.5, 14, 5, 4, { h: 2.8, vision: true });
furn('tech_tanks', 'tanks', 55.1, 22.5, 1.4, 5, { h: 2.5, vision: true });
furn('tech_bench', 'workbench', 44.6, 25.6, 2.6, 1.0, { front: 'N' });
furn('tech_cable', 'cable_drum', 44.0, 19.5, 1.0, 1.0, { h: 0.9 });

// Касса
furn('kassa_counter', 'kassa_counter', 7, 18.5, 4, 1.0, { h: 1.1, front: 'S' });
furn('kassa_lockers', 'lockers', 0.5, 21.5, 0.8, 5, { h: 2.0, front: 'E', vision: true });
furn('kassa_desk', 'desk_coins', 11.5, 24.6, 2.0, 1.0, { front: 'N' });
furn('kassa_safe', 'safe', 1.0, 26.9, 1.0, 1.0, { h: 1.2, front: 'E' });
furn('kassa_plant', 'plant', 13.2, 14.9, 0.6, 0.6, { h: 1.4 });
furn('kassa_queue', 'rope_posts', 7, 21.5, 3.4, 0.2, { h: 1.0, solid: false });

// Опенспейс
const OS_X = [18, 23, 28, 33, 38];
OS_X.forEach((x, i) => {
  furn(`os_desk${i + 1}`, 'desk_pc', x, 17.0, 2.2, 1.0, { front: 'S', partition: true });
  furn(`os_desk${i + 6}`, 'desk_pc', x, 23.0, 2.2, 1.0, { front: 'S', partition: true });
});
furn('os_cooler', 'cooler', 41.3, 15.0, 0.6, 0.6, { h: 1.5 });
furn('os_clips', 'stationery', 14.65, 26.3, 0.8, 1.6, { h: 1.6, front: 'E' });
furn('os_plant1', 'plant', 14.8, 14.8, 0.6, 0.6, { h: 1.4 });
furn('os_plant2', 'plant', 41.2, 27.2, 0.6, 0.6, { h: 1.4 });
furn('os_printer', 'copier', 25.5, 27.2, 1.2, 0.8, { h: 1.1 });

// Столовая
furn('can_stove', 'stove', 0.7, 32, 1.2, 2.4, { h: 1.0, front: 'E' });
furn('can_counter', 'kitchen_counter', 0.7, 36, 1.2, 3, { h: 1.0, front: 'E' });
furn('can_fridge', 'fridge', 0.8, 40.4, 1.3, 1.4, { h: 2.0, front: 'E', vision: true });
furn('can_pot', 'pot', 4, 32.5, 1.4, 1.4, { h: 1.0, front: 'S' });
furn('can_coffee', 'coffee', 19.4, 30.2, 0.8, 1.2, { h: 1.0, front: 'W' });
furn('can_table1', 'dining_table', 9, 33, 2.6, 1.2, { h: 0.8 });
furn('can_table2', 'dining_table', 14.5, 33, 2.6, 1.2, { h: 0.8 });
furn('can_table3', 'dining_table', 9, 38.5, 2.6, 1.2, { h: 0.8 });
furn('can_table4', 'dining_table', 14.5, 38.5, 2.6, 1.2, { h: 0.8 });
furn('can_hood', 'hood', 2.2, 31.5, 3.0, 2.0, { h: 3.0, solid: false });

// Входная
furn('ent_desk', 'reception', 23.5, 36, 3.2, 1.0, { h: 1.1, front: 'N' });
furn('ent_board', 'board', 35.75, 31, 0.2, 2.0, { h: 2.0, front: 'W', solid: false });
furn('ent_sign', 'sign', 32, 41.75, 2.2, 0.2, { h: 2.2, front: 'N', solid: false });
furn('ent_turn1', 'turnstile', 27, 40.4, 0.4, 1.0, { h: 1.0 });
furn('ent_turn2', 'turnstile', 29, 40.4, 0.4, 1.0, { h: 1.0 });
furn('ent_bench', 'bench', 33.5, 36.5, 0.8, 2.4, { h: 0.5 });
furn('ent_plant', 'plant', 20.8, 41.2, 0.6, 0.6, { h: 1.4 });
furn('ent_glass', 'glass_door', 28, 41.85, 4.0, 0.15, { h: 2.6, solid: false });

// Слоповина
furn('slop_pump', 'pump', 53, 39.4, 2.0, 1.4, { h: 1.6, front: 'N' });
furn('slop_cabbage', 'barrel_cabbage', 38.4, 41.0, 1.2, 1.2, { h: 1.1, front: 'N' });
furn('slop_crates1', 'crates', 44, 33, 2.2, 2.2, { h: 2.2, vision: true });
furn('slop_crates2', 'crates', 48.5, 38, 1.6, 3.0, { h: 2.0, vision: true });
furn('slop_barrels', 'barrels', 55, 30, 1.6, 2.4, { h: 1.2 });
furn('slop_pipes', 'pipes', 46, 28.45, 7, 0.4, { h: 3.0, solid: false });
furn('slop_cart_home', 'cart_spot', 41, 34.8, 1.0, 1.0, { solid: false });
furn('slop_puddle1', 'puddle', 40, 36, 3.0, 2.0, { solid: false });
furn('slop_puddle2', 'puddle', 51, 33, 2.4, 1.6, { solid: false });

// Контрольные посты (для «Обхода отделов») — по одному в зоне
const CP = {
  archive: [13.6, 3.2, 'W'], kvadry: [14.35, 13.0, 'E'], cabinet: [41.65, 12.0, 'W'],
  tech: [42.35, 26.5, 'E'], kassa: [13.65, 26.8, 'W'], openspace: [30.5, 14.35, 'N'],
  canteen: [10, 41.65, 'S'], entrance: [20.35, 30.0, 'E'], slop: [55.65, 36.5, 'W'],
};
for (const [zone, [x, z, front]] of Object.entries(CP)) {
  const wide = front === 'N' || front === 'S';
  furn(`cp_${zone}`, 'checkpoint', x, z, wide ? 0.6 : 0.1, wide ? 0.1 : 0.6,
    { h: 1.5, front: front === 'N' ? 'S' : front === 'S' ? 'N' : front === 'W' ? 'W' : 'E', solid: false });
}

export const FURNITURE = F;
export const FURN_BY_ID = Object.fromEntries(F.map((f) => [f.id, f]));

// ---------------------------------------------------------------------------
// Станции — точки взаимодействия. Персонаж стоит в (x,z) и смотрит на предмет.
// kind — вид анимации/звука при работе (наблюдаемость: TZ 7.3).
// ---------------------------------------------------------------------------
const ST = [];
function faceTo(x, z, tx, tz) { return Math.atan2(tx - x, tz - z); }
function station(id, name, at, x, z, furnId, kind, extra = {}) {
  const f = FURN_BY_ID[furnId];
  const s = { id, name, at, x, z, furn: furnId, kind, zone: zoneAt(x, z),
    rot: faceTo(x, z, f ? f.x : x, f ? f.z : z - 1), ...extra };
  ST.push(s);
  return s;
}

station('arch_shelf_n', 'Стеллаж «А–Я»', 'у стеллажа «А–Я»', 7, 1.6, 'arch_shelf_n', 'rummage');
station('arch_shelf_red', 'Красный стеллаж', 'у красного стеллажа', 5.5, 6.1, 'arch_shelf_red', 'rummage');
station('arch_shelf_b', 'Стеллаж «Б»', 'у стеллажа «Б»', 4.0, 10.1, 'arch_shelf_b', 'rummage');
station('arch_desk', 'Стол архивариуса', 'у стола архивариуса', 11.5, 10.4, 'arch_desk', 'rummage');
station('arch_cards', 'Картотека', 'у картотеки', 2.1, 12.0, 'arch_cards', 'rummage');

station('kv_desk1', 'Стол квадровика №1', 'у стола квадровика №1', 17.5, 4.1, 'kv_desk1', 'write');
station('kv_desk2', 'Стол квадровика №2', 'у стола квадровика №2', 22.5, 4.1, 'kv_desk2', 'write');
station('kv_terminal', 'Терминал квадровой проверки', 'у терминала квадровой проверки', 25.9, 11.0, 'kv_terminal', 'type');
station('kv_keybox', 'Ключница Архива', 'у ключницы Архива', 15.1, 1.8, 'kv_keybox', 'press');
station('kv_point1', 'Стенд квадров №1', 'у стенда квадров №1', 20.0, 1.2, 'kv_stand1', 'stamp');
station('kv_point2', 'Стенд квадров №2', 'у стенда квадров №2', 26.8, 2.4, 'kv_stand2', 'stamp');
station('kv_point3', 'Стенд квадров №3', 'у стенда квадров №3', 24.5, 12.8, 'kv_stand3', 'stamp');

station('dir_desk', 'Стол Директора', 'у стола Директора', 34.2, 2.9, 'cab_desk', 'write');
station('dir_phone', 'Телефон Директора', 'у телефона Директора', 36.4, 2.9, 'cab_desk', 'phone');
station('dir_ficus', 'Фикус Директора', 'у фикуса Директора', 40.3, 1.9, 'cab_ficus', 'pour');
station('dir_bell', 'Звонок планёрки', 'у звонка планёрки', 29.1, 12.0, 'cab_bell', 'press');
station('cab_plate', 'Табличка «ДИРЕКТОР»', 'у таблички Директора', 37.2, 15.0, 'cab_plate', 'wipe');

station('tech_printer1', 'Принтер №1', 'у принтера №1', 45, 2.4, 'tech_printer1', 'press');
station('tech_printer2', 'Принтер №2', 'у принтера №2', 49, 2.4, 'tech_printer2', 'press');
station('tech_shield', 'Электрощиток', 'у электрощитка', 54.9, 6.5, 'tech_shield', 'press');
station('tech_acc1', 'Ускоритель: северная панель', 'у калоидного ускорителя', 49.5, 11.2, 'tech_acc', 'press');
station('tech_acc2', 'Ускоритель: западная панель', 'у калоидного ускорителя', 46.2, 14, 'tech_acc', 'press');
station('tech_acc3', 'Ускоритель: восточная панель', 'у калоидного ускорителя', 52.8, 14, 'tech_acc', 'press');

station('kassa_tumba', 'Тумба кассы', 'у тумбы кассы', 7, 19.8, 'kassa_counter', 'type');
station('kassa_lockers', 'Шкапчики', 'у шкапчиков', 1.7, 21.5, 'kassa_lockers', 'locker');
station('kassa_desk', 'Стол пересчёта', 'у стола пересчёта', 11.5, 23.4, 'kassa_desk', 'coins');
station('kassa_safe', 'Сейф с ведомостями', 'у сейфа с ведомостями', 2.2, 26.6, 'kassa_safe', 'write');

OS_X.forEach((x, i) => {
  station(`os_pc${i + 1}`, `Компьютер №${i + 1}`, `у компьютера №${i + 1}`, x, 18.1, `os_desk${i + 1}`, 'type');
  station(`os_pc${i + 6}`, `Компьютер №${i + 6}`, `у компьютера №${i + 6}`, x, 24.1, `os_desk${i + 6}`, 'type');
});
station('os_cooler', 'Кулер', 'у кулера', 40.5, 15.7, 'os_cooler', 'lift');
station('os_clips', 'Шкаф канцелярии', 'у шкафа канцелярии', 15.7, 26.3, 'os_clips', 'rummage');

station('can_pot', 'Бидон кислых щей', 'у бидона кислых щей', 4, 33.9, 'can_pot', 'stir');
station('can_coffee', 'Кофейный аппарат', 'у кофейного аппарата', 18.3, 30.2, 'can_coffee', 'coffee');

station('ent_journal', 'Журнал посетителей', 'у журнала посетителей', 24.3, 34.9, 'ent_desk', 'write');
station('ent_phone', 'Вахтёрский телефон', 'у вахтёрского телефона', 22.5, 34.9, 'ent_desk', 'phone');
station('ent_board', 'Доска поручений', 'у доски поручений', 34.9, 31, 'ent_board', 'read');
station('ent_sign', 'Табличка «ООО КОНТОРКА»', 'у таблички Конторки', 32, 40.8, 'ent_sign', 'wipe');

station('slop_pump', 'Насос слоповины', 'у насоса слоповины', 53, 38.1, 'slop_pump', 'pump');
station('slop_cabbage', 'Бочка с капустой', 'у бочки с капустой', 38.4, 39.8, 'slop_cabbage', 'rummage');

for (const zone of Object.keys(CP)) {
  const f = FURN_BY_ID[`cp_${zone}`];
  const off = { N: [0, -0.8], S: [0, 0.8], E: [0.8, 0], W: [-0.8, 0] }[f.front];
  station(`cp_${zone}`, `Контрольный пост: ${ZONE_BY_ID[zone].name}`, `у контрольного поста`,
    f.x + off[0], f.z + off[1], f.id, 'stamp');
}

export const STATIONS = ST;
export const STATION_BY_ID = Object.fromEntries(ST.map((s) => [s.id, s]));
export const OS_PCS = ST.filter((s) => s.id.startsWith('os_pc')).map((s) => s.id);

// Места за столом планёрки (12)
export const MEETING_SEATS = [];
{
  const xs = [31.8, 33.4, 35, 36.6, 38.2];
  for (const x of xs) MEETING_SEATS.push({ x, z: 6.55, rot: 0 });
  for (const x of xs) MEETING_SEATS.push({ x, z: 10.45, rot: Math.PI });
  MEETING_SEATS.push({ x: 30.05, z: 8.5, rot: Math.PI / 2 });
  MEETING_SEATS.push({ x: 39.95, z: 8.5, rot: -Math.PI / 2 });
}

export const SPAWN_POINTS = [];
for (let i = 0; i < 12; i++) {
  const col = i % 4;
  const row = Math.floor(i / 4);
  SPAWN_POINTS.push({ x: 25.5 + col * 1.6, z: 31.2 + row * 1.5, rot: Math.PI });
}

// NPC (ambient): Бидонья у бидона, Тося Бося на вахте
export const NPCS = [
  { id: 'npc_bidonya', name: 'Бидонья', x: 4, z: 31.25, rot: 0, look: 'bidonya', zone: 'canteen' },
  { id: 'npc_tosya', name: 'Тося Бося', x: 23.5, z: 37.1, rot: Math.PI, look: 'tosya', zone: 'entrance' },
];

// ---------------------------------------------------------------------------
// Рантайм карты: сетки проходимости и обзора с учётом дверей
// ---------------------------------------------------------------------------
function rasterRect(grid, r, inflate, val = 1) {
  const cx0 = Math.max(0, Math.floor((r.x0 - inflate) / CELL));
  const cz0 = Math.max(0, Math.floor((r.z0 - inflate) / CELL));
  const cx1 = Math.min(GW - 1, Math.floor((r.x1 + inflate - 1e-6) / CELL));
  const cz1 = Math.min(GH - 1, Math.floor((r.z1 + inflate - 1e-6) / CELL));
  const cells = [];
  for (let z = cz0; z <= cz1; z++) {
    for (let x = cx0; x <= cx1; x++) {
      // центр клетки внутри раздутого прямоугольника
      const px = (x + 0.5) * CELL;
      const pz = (z + 0.5) * CELL;
      if (px >= r.x0 - inflate && px <= r.x1 + inflate && pz >= r.z0 - inflate && pz <= r.z1 + inflate) {
        if (grid) grid[z * GW + x] = val;
        cells.push(z * GW + x);
      }
    }
  }
  return cells;
}

function rasterRectTouch(grid, r) {
  // Все клетки, которые прямоугольник хотя бы задевает (для обзора)
  const cx0 = Math.max(0, Math.floor(r.x0 / CELL));
  const cz0 = Math.max(0, Math.floor(r.z0 / CELL));
  const cx1 = Math.min(GW - 1, Math.floor((r.x1 - 1e-6) / CELL));
  const cz1 = Math.min(GH - 1, Math.floor((r.z1 - 1e-6) / CELL));
  const cells = [];
  for (let z = cz0; z <= cz1; z++) {
    for (let x = cx0; x <= cx1; x++) {
      if (grid) grid[z * GW + x] = 1;
      cells.push(z * GW + x);
    }
  }
  return cells;
}

export function furnRect(f) {
  return { x0: f.x - f.w / 2, z0: f.z - f.d / 2, x1: f.x + f.w / 2, z1: f.z + f.d / 2 };
}

const STATIC_NAV = new Uint8Array(GW * GH);
const STATIC_LOS = new Uint8Array(GW * GH);
const SOLIDS = [];
for (const w of WALLS) {
  rasterRect(STATIC_NAV, w, AGENT_R);
  rasterRectTouch(STATIC_LOS, w);
  SOLIDS.push(w);
}
for (const f of FURNITURE) {
  if (!f.solid) continue;
  const r = furnRect(f);
  rasterRect(STATIC_NAV, r, AGENT_R);
  if (f.vision) rasterRectTouch(STATIC_LOS, { x0: r.x0 + 0.1, z0: r.z0 + 0.1, x1: r.x1 - 0.1, z1: r.z1 - 0.1 });
  SOLIDS.push(r);
}
const DOOR_NAV_CELLS = {};
const DOOR_LOS_CELLS = {};
for (const d of DOORS) {
  DOOR_NAV_CELLS[d.id] = rasterRect(null, d.rect, AGENT_R);
  DOOR_LOS_CELLS[d.id] = rasterRectTouch(null, d.rect);
}

export class MapRuntime {
  constructor() {
    this.nav = new Uint8Array(STATIC_NAV);
    this.los = new Uint8Array(STATIC_LOS);
    this.doorState = {}; // id -> { locked, cart }
    for (const d of DOORS) this.doorState[d.id] = { locked: false, cart: false };
    this.extraSolids = []; // { id, rect }
    this.version = 0;
  }

  doorClosed(id) {
    const s = this.doorState[id];
    return s.locked || s.cart;
  }

  setDoor(id, patch) {
    const s = this.doorState[id];
    if (!s) return;
    Object.assign(s, patch);
    this._rebuildDoors();
  }

  _rebuildDoors() {
    this.nav.set(STATIC_NAV);
    this.los.set(STATIC_LOS);
    this.extraSolids = [];
    for (const d of DOORS) {
      const s = this.doorState[d.id];
      if (s.locked || s.cart) {
        for (const c of DOOR_NAV_CELLS[d.id]) this.nav[c] = 1;
        this.extraSolids.push(d.rect);
      }
      if (s.locked) for (const c of DOOR_LOS_CELLS[d.id]) this.los[c] = 1;
    }
    this.version++;
  }

  cellBlocked(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= GW || cz >= GH) return true;
    return this.nav[cz * GW + cx] === 1;
  }

  walkable(x, z) {
    return !this.cellBlocked(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  // Линия видимости между точками (учёт стен, высокой мебели и запертых дверей)
  lineOfSight(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / 0.2);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const cx = Math.floor((ax + dx * t) / CELL);
      const cz = Math.floor((az + dz * t) / CELL);
      if (cx < 0 || cz < 0 || cx >= GW || cz >= GH) return false;
      if (this.los[cz * GW + cx]) return false;
    }
    return true;
  }

  walkLine(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / 0.2);
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      if (!this.walkable(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  // Движение круга с радиусом r и выталкиванием из прямоугольников
  collide(x, z, r = AGENT_R) {
    x = Math.max(r, Math.min(MAP_W - r, x));
    z = Math.max(r, Math.min(MAP_D - r, z));
    const lists = [SOLIDS, this.extraSolids];
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const list of lists) {
        for (const s of list) {
          if (x + r <= s.x0 || x - r >= s.x1 || z + r <= s.z0 || z - r >= s.z1) continue;
          const nx = Math.max(s.x0, Math.min(s.x1, x));
          const nz = Math.max(s.z0, Math.min(s.z1, z));
          let ddx = x - nx;
          let ddz = z - nz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            x = nx + (ddx / d) * r;
            z = nz + (ddz / d) * r;
          } else {
            // центр внутри прямоугольника — выталкиваем по кратчайшей оси
            const pushL = x - s.x0 + r;
            const pushR = s.x1 - x + r;
            const pushU = z - s.z0 + r;
            const pushD = s.z1 - z + r;
            const m = Math.min(pushL, pushR, pushU, pushD);
            if (m === pushL) x -= pushL;
            else if (m === pushR) x += pushR;
            else if (m === pushU) z -= pushU;
            else z += pushD;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x, z };
  }

  nearestWalkable(x, z) {
    let cx = Math.floor(x / CELL);
    let cz = Math.floor(z / CELL);
    if (!this.cellBlocked(cx, cz)) return { cx, cz };
    for (let r = 1; r < 12; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          if (!this.cellBlocked(cx + dx, cz + dz)) return { cx: cx + dx, cz: cz + dz };
        }
      }
    }
    return { cx, cz };
  }

  // A* по сетке 8-связности со сглаживанием пути
  findPath(ax, az, bx, bz) {
    const s = this.nearestWalkable(ax, az);
    const g = this.nearestWalkable(bx, bz);
    const start = s.cz * GW + s.cx;
    const goal = g.cz * GW + g.cx;
    if (start === goal) return [{ x: bx, z: bz }];
    const N = GW * GH;
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    gScore[start] = 0;
    const h = (i) => {
      const x = i % GW;
      const z = (i / GW) | 0;
      const ddx = Math.abs(x - g.cx);
      const ddz = Math.abs(z - g.cz);
      return (ddx + ddz) + (Math.SQRT2 - 2) * Math.min(ddx, ddz);
    };
    heap.push(start, h(start));
    let found = false;
    let iterations = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++iterations > 20000) break;
      const cx = cur % GW;
      const cz = (cur / GW) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (this.cellBlocked(nx, nz)) continue;
          if (dx && dz && (this.cellBlocked(cx + dx, cz) || this.cellBlocked(cx, cz + dz))) continue;
          const ni = nz * GW + nx;
          if (closed[ni]) continue;
          const cost = gScore[cur] + (dx && dz ? Math.SQRT2 : 1);
          if (cost < gScore[ni]) {
            gScore[ni] = cost;
            came[ni] = cur;
            heap.push(ni, cost + h(ni));
          }
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = goal; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => ({ x: ((c % GW) + 0.5) * CELL, z: (((c / GW) | 0) + 0.5) * CELL }));
    pts[pts.length - 1] = { x: bx, z: bz };
    // Сглаживание: выкидываем промежуточные точки, если отрезок проходим
    const out = [];
    let anchor = { x: ax, z: az };
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.walkLine(anchor.x, anchor.z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }

  randomPointInZone(zoneId, rng) {
    const zn = ZONE_BY_ID[zoneId];
    for (let k = 0; k < 60; k++) {
      const x = rng.range(zn.x0 + 1, zn.x1 - 1);
      const z = rng.range(zn.z0 + 1, zn.z1 - 1);
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      let ok = true;
      for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) if (this.cellBlocked(cx + dx, cz + dz)) ok = false;
      if (ok) return { x, z };
    }
    return { x: (zn.x0 + zn.x1) / 2, z: (zn.z0 + zn.z1) / 2 };
  }
}

class MinHeap {
  constructor() { this.items = []; this.prios = []; }
  get size() { return this.items.length; }
  push(item, prio) {
    const a = this.items;
    const p = this.prios;
    a.push(item);
    p.push(prio);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= p[i]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      [p[parent], p[i]] = [p[i], p[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.items;
    const p = this.prios;
    const top = a[0];
    const lastI = a.pop();
    const lastP = p.pop();
    if (a.length) {
      a[0] = lastI;
      p[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && p[l] < p[m]) m = l;
        if (r < a.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}

export function nearestDoor(x, z, maxDist = 2.5) {
  let best = null;
  let bd = maxDist;
  for (const d of DOORS) {
    const dist = Math.hypot(d.x - x, d.z - z);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

export function stationsInZone(zoneId) {
  return STATIONS.filter((s) => s.zone === zoneId);
}
