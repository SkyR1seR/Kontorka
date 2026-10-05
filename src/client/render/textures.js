// Процедурные текстуры низкого разрешения (как у игр конца 90-х):
// шум, грубые паттерны, фильтрация «ближайший сосед».
import * as THREE from 'three';

const cache = new Map();

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function noise(ctx, w, h, amount, seed = 1, mono = true) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    if (mono) {
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    } else {
      d[i] += (r() - 0.5) * amount; d[i + 1] += (r() - 0.5) * amount; d[i + 2] += (r() - 0.5) * amount;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function toTex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 1;
  return t;
}

const BUILDERS = {
  carpet_green(c, x) {
    x.fillStyle = '#4f7a3a'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 46, 3);
    x.fillStyle = 'rgba(210,190,60,0.18)';
    for (let i = 0; i < 64; i += 16) { x.fillRect(i, 0, 1, 64); x.fillRect(0, i, 64, 1); }
  },
  carpet_grey(c, x) {
    x.fillStyle = '#7d7f86'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 40, 5);
    x.fillStyle = 'rgba(60,60,80,0.25)';
    for (let i = 0; i < 64; i += 8) x.fillRect(0, i, 64, 1);
  },
  carpet_red(c, x) {
    x.fillStyle = '#8a2a26'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 40, 7);
    x.strokeStyle = 'rgba(230,180,60,0.45)';
    x.lineWidth = 2;
    x.strokeRect(4, 4, 56, 56);
    x.fillStyle = 'rgba(230,180,60,0.35)';
    x.fillRect(30, 30, 4, 4);
  },
  parquet(c, x) {
    const r = rng(9);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 2; col++) {
        const v = 110 + r() * 50;
        x.fillStyle = `rgb(${v + 40},${v},${v * 0.55})`;
        x.fillRect(col * 32 + (row % 2) * 16, row * 8, 32, 8);
      }
      x.fillStyle = 'rgba(40,20,10,0.6)';
      x.fillRect(0, row * 8, 64, 1);
      x.fillRect(((row % 2) * 16 + 32) % 64, row * 8, 1, 8);
      x.fillRect((row % 2) * 16, row * 8, 1, 8);
    }
    noise(x, 64, 64, 22, 10);
  },
  linoleum(c, x) {
    x.fillStyle = '#b9a77c'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 30, 11);
    const r = rng(12);
    for (let i = 0; i < 30; i++) {
      x.fillStyle = `rgba(${r() > 0.5 ? '90,70,40' : '220,210,170'},0.35)`;
      x.fillRect(r() * 64, r() * 64, 2 + r() * 4, 1 + r() * 2);
    }
    x.fillStyle = 'rgba(80,60,40,0.35)';
    x.fillRect(0, 0, 64, 1); x.fillRect(0, 0, 1, 64);
  },
  tiles_white(c, x) {
    x.fillStyle = '#d9d6cc'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 18, 13);
    x.fillStyle = '#8c887c';
    x.fillRect(0, 0, 64, 2); x.fillRect(0, 0, 2, 64); x.fillRect(31, 0, 2, 64); x.fillRect(0, 31, 64, 2);
  },
  checker(c, x) {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      x.fillStyle = (i + j) % 2 ? '#2d2d33' : '#d8d2bf';
      x.fillRect(i * 16, j * 16, 16, 16);
    }
    noise(x, 64, 64, 20, 14);
  },
  concrete(c, x) {
    x.fillStyle = '#8b8d8a'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 36, 15);
    const r = rng(16);
    for (let i = 0; i < 12; i++) {
      x.fillStyle = 'rgba(50,50,50,0.2)';
      x.fillRect(r() * 64, r() * 64, 6 + r() * 10, 1);
    }
    x.fillStyle = 'rgba(40,40,40,0.4)';
    x.fillRect(0, 0, 64, 1); x.fillRect(0, 0, 1, 64);
  },
  slop(c, x) {
    x.fillStyle = '#5d6340'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 50, 17, false);
    const r = rng(18);
    for (let i = 0; i < 8; i++) {
      x.fillStyle = `rgba(${60 + r() * 40},${90 + r() * 50},30,0.45)`;
      x.beginPath();
      x.ellipse(r() * 64, r() * 64, 4 + r() * 10, 2 + r() * 6, r() * 3, 0, Math.PI * 2);
      x.fill();
    }
  },
  wall_beige(c, x) {
    x.fillStyle = '#d6c79f'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 14, 19);
    x.fillStyle = '#7a6a4a'; x.fillRect(0, 44, 64, 20);
    noise(x, 64, 64, 6, 20);
    x.fillStyle = '#5c4c30'; x.fillRect(0, 43, 64, 2);
  },
  wall_wood(c, x) {
    const r = rng(21);
    for (let i = 0; i < 8; i++) {
      const v = 80 + r() * 30;
      x.fillStyle = `rgb(${v + 30},${v * 0.75},${v * 0.45})`;
      x.fillRect(i * 8, 0, 8, 64);
      x.fillStyle = 'rgba(30,15,5,0.5)';
      x.fillRect(i * 8, 0, 1, 64);
    }
    noise(x, 64, 64, 18, 22);
    x.fillStyle = 'rgba(30,15,5,0.4)'; x.fillRect(0, 40, 64, 2);
  },
  wall_green(c, x) {
    x.fillStyle = '#9bb38f'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 14, 23);
    x.fillStyle = '#4c6a4a'; x.fillRect(0, 40, 64, 24);
    x.fillStyle = '#2f442e'; x.fillRect(0, 39, 64, 2);
  },
  wall_tiles(c, x) {
    x.fillStyle = '#e8e6dc'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 10, 24);
    x.fillStyle = '#a7a397';
    for (let i = 0; i < 64; i += 16) { x.fillRect(i, 0, 1, 64); x.fillRect(0, i, 64, 1); }
  },
  wall_tech(c, x) {
    x.fillStyle = '#7f8a8f'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 18, 25);
    x.fillStyle = '#4f585c';
    x.fillRect(0, 0, 64, 2); x.fillRect(31, 0, 2, 64);
    x.fillStyle = '#c9a42a';
    for (let i = -64; i < 64; i += 12) {
      x.save(); x.beginPath(); x.rect(0, 56, 64, 8); x.clip();
      x.fillRect(i + 0, 56, 6, 8);
      x.restore();
    }
  },
  wall_slop(c, x) {
    x.fillStyle = '#6a6b55'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 34, 26, false);
    const r = rng(27);
    for (let i = 0; i < 10; i++) {
      x.fillStyle = 'rgba(60,80,30,0.45)';
      const px = r() * 64;
      x.fillRect(px, 0, 1 + r() * 2, 20 + r() * 40);
    }
  },
  wall_archive(c, x) {
    x.fillStyle = '#b8a27a'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = 'rgba(120,80,50,0.35)';
    for (let i = 0; i < 64; i += 8) for (let j = 0; j < 64; j += 8) if ((i + j) % 16 === 0) x.fillRect(i + 2, j + 2, 3, 3);
    noise(x, 64, 64, 16, 28);
    x.fillStyle = '#5c4630'; x.fillRect(0, 46, 64, 18);
  },
  ceiling(c, x) {
    x.fillStyle = '#d7d3c6'; x.fillRect(0, 0, 64, 64);
    const r = rng(29);
    for (let i = 0; i < 160; i++) { x.fillStyle = 'rgba(90,90,80,0.35)'; x.fillRect(r() * 64, r() * 64, 1, 1); }
    x.fillStyle = '#8a877c';
    x.fillRect(0, 0, 64, 2); x.fillRect(0, 0, 2, 64);
  },
  wood(c, x) {
    x.fillStyle = '#8a5a32'; x.fillRect(0, 0, 64, 64);
    const r = rng(30);
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `rgba(${r() > 0.5 ? '60,30,12' : '170,110,60'},0.35)`;
      x.fillRect(0, r() * 64, 64, 1);
    }
    noise(x, 64, 64, 14, 31);
  },
  wood_light(c, x) {
    x.fillStyle = '#c99a62'; x.fillRect(0, 0, 64, 64);
    const r = rng(32);
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `rgba(${r() > 0.5 ? '110,70,30' : '230,190,130'},0.3)`;
      x.fillRect(0, r() * 64, 64, 1);
    }
    noise(x, 64, 64, 12, 33);
  },
  metal(c, x) {
    x.fillStyle = '#9aa0a3'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 18, 34);
    x.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 64; i += 4) x.fillRect(0, i, 64, 1);
  },
  steel(c, x) {
    const g = x.createLinearGradient(0, 0, 64, 64);
    g.addColorStop(0, '#c9ced1'); g.addColorStop(0.5, '#8e9598'); g.addColorStop(1, '#bfc5c8');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 12, 35);
  },
  beige_plastic(c, x) {
    x.fillStyle = '#cfc4a3'; x.fillRect(0, 0, 32, 32);
    noise(x, 32, 32, 14, 36);
  },
  screen(c, x) {
    x.fillStyle = '#163d8c'; x.fillRect(0, 0, 64, 48);
    x.fillStyle = '#c0c0c0'; x.fillRect(0, 0, 64, 6);
    x.fillStyle = '#000080'; x.fillRect(1, 1, 62, 4);
    x.fillStyle = '#e8e8ff';
    const r = rng(37);
    for (let i = 0; i < 9; i++) x.fillRect(4, 9 + i * 4, 8 + r() * 46, 2);
    x.fillStyle = '#f0e050'; x.fillRect(4, 42, 16, 3);
  },
  screen_err(c, x) {
    x.fillStyle = '#7a0d0d'; x.fillRect(0, 0, 64, 48);
    x.fillStyle = '#fff';
    x.font = 'bold 9px monospace';
    x.fillText('ОШИБКА', 12, 20);
    x.fillText('СТАТУСА', 10, 32);
  },
  folders(c, x) {
    const cols = ['#b02a2a', '#2a5ab0', '#2f8a3a', '#d8b02a', '#7a3a9a', '#e07a2a', '#3a9aa0', '#d8d0c0'];
    const r = rng(38);
    for (let i = 0; i < 16; i++) {
      x.fillStyle = cols[Math.floor(r() * cols.length)];
      x.fillRect(i * 4, 4 + r() * 6, 4, 60);
      x.fillStyle = 'rgba(0,0,0,0.35)';
      x.fillRect(i * 4, 0, 1, 64);
      x.fillStyle = 'rgba(255,255,255,0.6)';
      x.fillRect(i * 4 + 1, 30, 2, 6);
    }
  },
  folders_red(c, x) {
    const r = rng(39);
    for (let i = 0; i < 16; i++) {
      const v = 140 + r() * 60;
      x.fillStyle = `rgb(${v},${v * 0.2},${v * 0.2})`;
      x.fillRect(i * 4, 3 + r() * 6, 4, 61);
      x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(i * 4, 0, 1, 64);
      x.fillStyle = 'rgba(255,255,255,0.7)'; x.fillRect(i * 4 + 1, 28, 2, 6);
    }
  },
  keyboard(c, x) {
    x.fillStyle = '#d6d0bc'; x.fillRect(0, 0, 64, 24);
    x.fillStyle = '#9a947f';
    for (let r = 0; r < 4; r++) for (let k = 0; k < 14; k++) x.fillRect(2 + k * 4.4, 2 + r * 5, 3, 4);
  },
  paper(c, x) {
    x.fillStyle = '#f0ead6'; x.fillRect(0, 0, 32, 32);
    x.fillStyle = 'rgba(60,60,80,0.45)';
    for (let i = 0; i < 7; i++) x.fillRect(4, 5 + i * 3.5, 18 + (i % 3) * 3, 1);
  },
  cork(c, x) {
    x.fillStyle = '#b4895a'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 40, 40, false);
    const cols = ['#f4f0d8', '#f8e870', '#f6c0c0', '#c0e0f8'];
    const r = rng(41);
    for (let i = 0; i < 7; i++) {
      x.fillStyle = cols[i % cols.length];
      const px = 4 + r() * 44;
      const py = 4 + r() * 44;
      x.fillRect(px, py, 12, 14);
      x.fillStyle = 'rgba(40,40,40,0.5)';
      for (let l = 0; l < 4; l++) x.fillRect(px + 2, py + 3 + l * 3, 8, 1);
      x.fillStyle = '#c02020'; x.fillRect(px + 5, py, 2, 2);
    }
  },
  locker(c, x) {
    x.fillStyle = '#6f8a9a'; x.fillRect(0, 0, 32, 64);
    noise(x, 32, 64, 16, 42);
    x.fillStyle = '#3e5260'; x.fillRect(0, 0, 1, 64); x.fillRect(31, 0, 1, 64);
    for (let i = 0; i < 4; i++) x.fillRect(8, 6 + i * 3, 16, 1);
    x.fillStyle = '#d0d0d0'; x.fillRect(24, 30, 3, 6);
  },
  poster(c, x) {
    x.fillStyle = '#e9e1c6'; x.fillRect(0, 0, 32, 40);
    x.fillStyle = '#b02a2a'; x.fillRect(3, 3, 26, 10);
    x.fillStyle = '#333'; for (let i = 0; i < 6; i++) x.fillRect(4, 17 + i * 3.5, 24 - (i % 2) * 6, 1.5);
    x.fillStyle = '#2a5ab0'; x.beginPath(); x.arc(24, 33, 4, 0, Math.PI * 2); x.fill();
  },
  painting(c, x) {
    const g = x.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, '#6aa0d0'); g.addColorStop(0.6, '#e0d0a0'); g.addColorStop(1, '#4a7a3a');
    x.fillStyle = g; x.fillRect(0, 0, 48, 32);
    x.fillStyle = '#3a5a2a'; x.beginPath(); x.moveTo(0, 26); x.lineTo(14, 14); x.lineTo(26, 24); x.lineTo(40, 10); x.lineTo(48, 20); x.lineTo(48, 32); x.lineTo(0, 32); x.fill();
    noise(x, 48, 32, 20, 43);
  },
  owner(c, x) {
    // Портрет Хозяина: строгий силуэт в раме
    x.fillStyle = '#3a2a1a'; x.fillRect(0, 0, 48, 64);
    x.fillStyle = '#5a4a32'; x.fillRect(3, 3, 42, 58);
    const g = x.createRadialGradient(24, 26, 4, 24, 30, 30);
    g.addColorStop(0, '#d9a07a'); g.addColorStop(1, '#5a4a32');
    x.fillStyle = '#20202a'; x.beginPath(); x.moveTo(6, 64); x.lineTo(10, 46); x.lineTo(38, 46); x.lineTo(42, 64); x.fill();
    x.fillStyle = g; x.beginPath(); x.ellipse(24, 28, 11, 14, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#1a1a1a'; x.fillRect(16, 25, 5, 2); x.fillRect(27, 25, 5, 2); x.fillRect(17, 34, 14, 3);
    x.fillStyle = '#c9a42a'; x.font = 'bold 6px sans-serif'; x.fillText('ХОЗЯИН', 13, 60);
  },
  sign(c, x) {
    x.fillStyle = '#1d3a6a'; x.fillRect(0, 0, 128, 32);
    x.fillStyle = '#e8d070'; x.fillRect(2, 2, 124, 1); x.fillRect(2, 29, 124, 1);
    x.font = 'bold 15px sans-serif';
    x.fillStyle = '#f2e6b0';
    x.textAlign = 'center';
    x.fillText('ООО «КОНТОРКА»', 64, 21);
  },
  plate(c, x) {
    x.fillStyle = '#c9a42a'; x.fillRect(0, 0, 64, 16);
    x.fillStyle = '#3a2a0a'; x.font = 'bold 10px sans-serif'; x.textAlign = 'center';
    x.fillText('ДИРЕКТОР', 32, 12);
  },
  hazard(c, x) {
    x.fillStyle = '#202020'; x.fillRect(0, 0, 32, 32);
    x.fillStyle = '#e0b020';
    for (let i = -32; i < 64; i += 12) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 6, 0); x.lineTo(i + 38, 32); x.lineTo(i + 32, 32); x.fill(); }
  },
  machine(c, x) {
    x.fillStyle = '#4a5a62'; x.fillRect(0, 0, 64, 64);
    noise(x, 64, 64, 20, 44);
    x.fillStyle = '#2a3238';
    for (let i = 0; i < 64; i += 16) x.fillRect(0, i, 64, 2);
    x.fillStyle = '#c03030'; x.fillRect(6, 6, 6, 4);
    x.fillStyle = '#30c040'; x.fillRect(16, 6, 6, 4);
    x.fillStyle = '#e0c030'; x.fillRect(26, 6, 6, 4);
    for (let i = 0; i < 6; i++) { x.fillStyle = '#9aa'; x.beginPath(); x.arc(10 + i * 9, 40, 2.5, 0, Math.PI * 2); x.fill(); }
  },
  crate(c, x) {
    x.fillStyle = '#8a6a3a'; x.fillRect(0, 0, 32, 32);
    noise(x, 32, 32, 26, 45);
    x.fillStyle = '#5a4020';
    x.fillRect(0, 0, 32, 3); x.fillRect(0, 29, 32, 3); x.fillRect(0, 0, 3, 32); x.fillRect(29, 0, 3, 32);
    x.save(); x.translate(16, 16); x.rotate(Math.PI / 4); x.fillRect(-22, -1.5, 44, 3); x.restore();
  },
  slop_liquid(c, x) {
    x.fillStyle = '#6a8a2a'; x.fillRect(0, 0, 32, 32);
    noise(x, 32, 32, 40, 46, false);
    x.fillStyle = 'rgba(200,230,120,0.4)';
    const r = rng(47);
    for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(r() * 32, r() * 32, 1 + r() * 2, 0, Math.PI * 2); x.fill(); }
  },
  fabric(c, x) {
    x.fillStyle = '#5a5248'; x.fillRect(0, 0, 32, 32);
    noise(x, 32, 32, 30, 48);
  },
  menu_board(c, x) {
    x.fillStyle = '#1e2a1e'; x.fillRect(0, 0, 64, 48);
    x.fillStyle = '#e8e8d0'; x.font = 'bold 7px sans-serif';
    x.fillText('МЕНЮ', 22, 9);
    x.font = '6px sans-serif';
    ['Щи кислые ....... 5', 'Котлета ......... 7', 'Компот ........... 2', 'Кукиш-пирог ... 3'].forEach((t, i) => x.fillText(t, 3, 19 + i * 8));
  },
  wallpaper_flowers(c, x) {
    x.fillStyle = '#c8b48a'; x.fillRect(0, 0, 32, 32);
    x.fillStyle = 'rgba(140,60,60,0.4)';
    for (const [px, py] of [[8, 8], [24, 24]]) { x.beginPath(); x.arc(px, py, 3, 0, Math.PI * 2); x.fill(); }
    noise(x, 32, 32, 10, 49);
  },
};

const SIZES = {
  screen: [64, 48], screen_err: [64, 48], keyboard: [64, 24], paper: [32, 32], locker: [32, 64], poster: [32, 40],
  painting: [48, 32], owner: [48, 64], sign: [128, 32], plate: [64, 16], hazard: [32, 32], crate: [32, 32],
  slop_liquid: [32, 32], fabric: [32, 32], beige_plastic: [32, 32], menu_board: [64, 48], wallpaper_flowers: [32, 32],
};

export function tex(name, repeatX = 1, repeatY = 1) {
  const key = `${name}|${repeatX}|${repeatY}`;
  if (cache.has(key)) return cache.get(key);
  let base = cache.get(name);
  if (!base) {
    const [w, h] = SIZES[name] || [64, 64];
    const c = canvas(w, h);
    const x = c.getContext('2d', { willReadFrequently: true });
    (BUILDERS[name] || BUILDERS.concrete)(c, x);
    base = toTex(c);
    cache.set(name, base);
  }
  if (repeatX === 1 && repeatY === 1) return base;
  const t = base.clone();
  t.repeat.set(repeatX, repeatY);
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

// Текстура с произвольным текстом (таблички, мониторы)
export function textTex(text, opts = {}) {
  const w = opts.w || 128;
  const h = opts.h || 32;
  const c = canvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = opts.bg || '#1d3a6a';
  x.fillRect(0, 0, w, h);
  x.fillStyle = opts.fg || '#f2e6b0';
  x.font = `bold ${opts.size || 14}px sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 1);
  return toTex(c, false);
}
