// Мини-игры батрачки. Принцип «узнаваемого идиотизма» (GDD 5.1): название абсурдное,
// действие — мгновенно понятное. Каждая длится 6–15 секунд.
import { h, clear } from '../ui/dom.js';

const R = {
  int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  shuffle: (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
};

function flash(el, cls = 'mg-bad') {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function numpad(onKey) {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '⌫', '0', 'OK'];
  return h('div', { class: 'mg-numpad' }, keys.map((k) => h('button', { class: 'mg-key', onclick: () => onKey(k) }, k)));
}

const COLORS = { red: ['#c0302a', 'красные'], blue: ['#2a5ab0', 'синие'], green: ['#2f8a3a', 'зелёные'], yellow: ['#d8b02a', 'жёлтые'] };
const NAMES = ['Евпраксия Кукишева', 'Пафнутий Скрепкин', 'Агафья Печатько', 'Феофан Дырокол', 'Акакий Бланков', 'Ефросинья Справкина', 'Мокий Протоколов', 'Аполлинария Штампель'];

export const MINIGAMES = {
  // Колупание цифер: вписать пропущенные числа
  numbers(root, ctx) {
    const rows = [];
    const n = ctx.extra ? 4 : 3;
    for (let i = 0; i < 4; i++) {
      const a = R.int(12, 89);
      const b = R.int(11, 79);
      const miss = i < n ? R.pick(['a', 'b', 'c']) : null;
      rows.push({ a, b, c: a + b, miss, val: '' });
    }
    let active = rows.findIndex((r) => r.miss);
    const table = h('div', { class: 'mg-ledger' });
    const render = () => {
      clear(table);
      table.append(h('div', { class: 'mg-row mg-head' }, h('span', {}, 'Квартал'), h('span', {}, 'Приход'), h('span', {}, 'Расход'), h('span', {}, 'Итого')));
      rows.forEach((r, i) => {
        const cell = (k) => {
          if (r.miss !== k) return h('span', { class: 'mg-cell' }, String(r[k]));
          return h('span', { class: `mg-cell mg-input ${active === i ? 'mg-active' : ''}`, onclick: () => { active = i; render(); } }, r.val || '?');
        };
        table.append(h('div', { class: 'mg-row' }, h('span', {}, `${i + 1}`), cell('a'), cell('b'), cell('c')));
      });
    };
    const check = () => {
      let ok = true;
      for (const r of rows) {
        if (!r.miss) continue;
        if (Number(r.val) !== r[r.miss]) { ok = false; r.val = ''; }
      }
      if (ok) ctx.done();
      else { flash(table); ctx.sound('bad'); active = rows.findIndex((r) => r.miss && !r.val); render(); }
    };
    const onKey = (k) => {
      ctx.sound('type');
      if (k === 'OK') return check();
      const r = rows[active];
      if (!r || !r.miss) return;
      if (k === '⌫') r.val = r.val.slice(0, -1);
      else if (r.val.length < 3) r.val += k;
      render();
    };
    const keyHandler = (e) => {
      if (/^[0-9]$/.test(e.key)) onKey(e.key);
      else if (e.key === 'Backspace') onKey('⌫');
      else if (e.key === 'Enter') onKey('OK');
      else if (e.key === 'Tab' || e.key === 'ArrowDown') { e.preventDefault(); const next = rows.findIndex((r, i) => i > active && r.miss); active = next >= 0 ? next : rows.findIndex((r) => r.miss); render(); }
    };
    window.addEventListener('keydown', keyHandler);
    render();
    root.append(h('div', { class: 'mg-split' }, table, h('div', {}, numpad(onKey), h('button', { class: 'mg-btn mg-wide', onclick: check }, 'Пересчитать'))));
    return () => window.removeEventListener('keydown', keyHandler);
  },

  // Размусоливание букв: привести строки к шаблону
  format(root, ctx) {
    const words = R.shuffle(['колупание цифер', 'отчёт о батрачке', 'ведомость кукишей', 'записюлька хозяина', 'план конторки', 'квадровая справка']).slice(0, 3);
    const CASES = ['lower', 'upper', 'title'];
    const ALIGNS = ['left', 'center', 'right'];
    const lines = words.map((w) => {
      const target = { c: R.pick(CASES), a: R.pick(ALIGNS), b: Math.random() < 0.5 };
      let cur;
      do { cur = { c: R.pick(CASES), a: R.pick(ALIGNS), b: Math.random() < 0.5 }; } while (cur.c === target.c && cur.a === target.a && cur.b === target.b);
      return { w, target, cur };
    });
    const fmt = (w, s) => (s.c === 'upper' ? w.toUpperCase() : s.c === 'title' ? w.replace(/(^|\s)\S/g, (m) => m.toUpperCase()) : w.toLowerCase());
    const box = h('div', { class: 'mg-format' });
    const render = () => {
      clear(box);
      box.append(h('div', { class: 'mg-row mg-head' }, h('span', {}, 'Шаблон'), h('span', {}, 'Документ')));
      lines.forEach((l) => {
        const ok = l.cur.c === l.target.c && l.cur.a === l.target.a && l.cur.b === l.target.b;
        const sample = h('div', { class: 'mg-line', style: { textAlign: l.target.a, fontWeight: l.target.b ? 800 : 400 } }, fmt(l.w, l.target));
        const doc = h('div', { class: `mg-line ${ok ? 'mg-okline' : ''}`, style: { textAlign: l.cur.a, fontWeight: l.cur.b ? 800 : 400 } }, fmt(l.w, l.cur));
        const btns = h('div', { class: 'mg-tools' },
          h('button', { class: 'mg-btn mg-small', title: 'Регистр', onclick: () => { l.cur.c = CASES[(CASES.indexOf(l.cur.c) + 1) % 3]; ctx.sound('click'); render(); } }, 'Аа'),
          h('button', { class: 'mg-btn mg-small', title: 'Выравнивание', onclick: () => { l.cur.a = ALIGNS[(ALIGNS.indexOf(l.cur.a) + 1) % 3]; ctx.sound('click'); render(); } }, '≡'),
          h('button', { class: 'mg-btn mg-small', title: 'Жирный', onclick: () => { l.cur.b = !l.cur.b; ctx.sound('click'); render(); } }, h('b', {}, 'Ж')));
        box.append(h('div', { class: 'mg-row mg-fmtrow' }, sample, h('div', { class: 'mg-docline' }, doc, btns)));
      });
      if (lines.every((l) => l.cur.c === l.target.c && l.cur.a === l.target.a && l.cur.b === l.target.b)) setTimeout(() => ctx.done(), 250);
    };
    render();
    root.append(box);
  },

  // Копошение в листочках: по цвету, затем по номеру
  sortFolders(root, ctx) {
    const order = R.shuffle(['red', 'blue', 'green']);
    const folders = [];
    for (const c of order) {
      const nums = R.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 2).sort((a, b) => a - b);
      for (const n of nums) folders.push({ c, n });
    }
    let step = 0;
    const shelf = h('div', { class: 'mg-folders' });
    const legend = h('div', { class: 'mg-legend' }, 'Порядок: ', order.map((c, i) => [h('b', { style: { color: COLORS[c][0] } }, COLORS[c][1]), i < 2 ? ' → ' : '']), ', внутри цвета — по номеру.');
    const shuffled = R.shuffle(folders);
    const render = () => {
      clear(shelf);
      shuffled.forEach((f) => {
        const idx = folders.indexOf(f);
        const done = idx < step;
        shelf.append(h('button', {
          class: `mg-folder ${done ? 'mg-done' : ''}`, style: { background: COLORS[f.c][0] }, disabled: done,
          onclick: (e) => {
            if (idx === step) { step++; ctx.sound('paper'); render(); if (step === folders.length) ctx.done(); }
            else { step = 0; flash(e.currentTarget); ctx.sound('bad'); setTimeout(render, 300); }
          },
        }, h('span', {}, String(f.n))));
      });
    };
    render();
    root.append(legend, shelf, h('div', { class: 'mg-hint' }, 'Ошибка — начинай заново. Сложено: ', h('b', {}, `${step}`)));
  },

  // Переукладка папок: документ → ячейка с тем же номером
  slots(root, ctx) {
    const nums = R.shuffle([3, 7, 9, 14, 22, 31, 40, 56]).slice(0, 5);
    const docs = R.shuffle(nums).map((n) => ({ n, placed: false }));
    let sel = null;
    const left = h('div', { class: 'mg-docs' });
    const right = h('div', { class: 'mg-slots' });
    const slots = R.shuffle(nums).map((n) => ({ n, filled: false }));
    const render = () => {
      clear(left); clear(right);
      docs.forEach((d) => left.append(h('button', { class: `mg-doc ${sel === d ? 'mg-active' : ''} ${d.placed ? 'mg-done' : ''}`, disabled: d.placed, onclick: () => { sel = d; ctx.sound('click'); render(); } }, `Дело №${d.n}`)));
      slots.forEach((s) => right.append(h('button', {
        class: `mg-slot ${s.filled ? 'mg-filled' : ''}`,
        onclick: (e) => {
          if (!sel || s.filled) return;
          if (sel.n === s.n) { sel.placed = true; s.filled = true; sel = null; ctx.sound('paper'); render(); if (docs.every((d) => d.placed)) ctx.done(); }
          else { flash(e.currentTarget); ctx.sound('bad'); }
        },
      }, `ячейка ${s.n}`)));
    };
    render();
    root.append(h('div', { class: 'mg-split' }, left, right));
  },

  // Проверка шкапчика: опись против содержимого
  inventory(root, ctx) {
    const ITEMS = ['Кружка', 'Степлер', 'Кукиш-купон', 'Скрепочница', 'Пропуск', 'Калоша', 'Печать'];
    const list = R.shuffle(ITEMS).slice(0, 5).map((name) => {
      const want = R.int(1, 3);
      const has = Math.random() < 0.45 ? want : Math.max(0, want + R.pick([-1, 1, -2]));
      return { name, want, has, ans: null };
    });
    const locker = h('div', { class: 'mg-locker' }, list.map((it) => h('div', { class: 'mg-shelfitem' }, h('span', {}, it.name), h('span', { class: 'mg-count' }, '▮'.repeat(it.has) || '—'))));
    const opis = h('div', { class: 'mg-opis' });
    const render = () => {
      clear(opis);
      opis.append(h('div', { class: 'mg-head' }, 'ОПИСЬ ШКАПЧИКА №', String(R.int(1, 12))));
      list.forEach((it) => opis.append(h('div', { class: 'mg-row' },
        h('span', {}, `${it.name} — ${it.want} шт.`),
        h('button', { class: `mg-btn mg-small ${it.ans === true ? 'mg-on' : ''}`, onclick: () => { it.ans = true; ctx.sound('click'); render(); } }, 'Сходится'),
        h('button', { class: `mg-btn mg-small ${it.ans === false ? 'mg-on' : ''}`, onclick: () => { it.ans = false; ctx.sound('click'); render(); } }, 'Нет'),
      )));
      opis.append(h('button', {
        class: 'mg-btn mg-wide',
        onclick: () => {
          const ok = list.every((it) => it.ans === (it.has === it.want));
          if (ok) ctx.done();
          else { flash(opis); ctx.sound('bad'); for (const it of list) if (it.ans !== (it.has === it.want)) it.ans = null; render(); }
        },
      }, 'Подписать опись'));
    };
    render();
    root.append(h('div', { class: 'mg-split' }, locker, opis));
  },

  // Протирка таблички: стереть лишние символы
  wipe(root, ctx) {
    const target = R.pick(['ООО КОНТОРКА', 'ДИРЕКТОР', 'ОТДЕЛ КВАДРОВ', 'КАССА']);
    const junk = '#%~*&@§¤±';
    const chars = [];
    for (const ch of target) {
      if (Math.random() < 0.35) chars.push({ ch: R.pick(junk.split('')), junk: true, hp: 2 });
      chars.push({ ch, junk: false });
    }
    for (let i = 0; i < 2; i++) chars.splice(R.int(0, chars.length), 0, { ch: R.pick(junk.split('')), junk: true, hp: 2 });
    const plate = h('div', { class: 'mg-plate' });
    const render = () => {
      clear(plate);
      chars.forEach((c) => {
        if (c.junk && c.hp <= 0) return;
        plate.append(h('span', {
          class: `mg-ch ${c.junk ? 'mg-junk' : ''} ${c.hp === 1 ? 'mg-half' : ''}`,
          onclick: (e) => {
            if (!c.junk) { flash(e.currentTarget); ctx.sound('bad'); return; }
            c.hp--; ctx.sound('wipe'); render();
            if (chars.every((x) => !x.junk || x.hp <= 0)) ctx.done();
          },
        }, c.ch === ' ' ? ' ' : c.ch));
      });
    };
    render();
    root.append(h('div', { class: 'mg-hint' }, 'Должно остаться: ', h('b', {}, target), '. Лишнее — протри (по 2 клика).'), plate);
  },

  // Кормление принтера
  printer(root, ctx) {
    const need = ctx.extra ? 6 : 5;
    let sheets = 0;
    let printing = false;
    const tray = h('div', { class: 'mg-tray' });
    const out = h('div', { class: 'mg-printout' });
    const render = () => {
      clear(tray);
      tray.append(h('div', { class: 'mg-traylabel' }, `Лоток: ${sheets}/${need}`));
      for (let i = 0; i < sheets; i++) tray.append(h('div', { class: 'mg-sheet', style: { bottom: `${4 + i * 6}px` } }));
    };
    const ream = h('button', { class: 'mg-btn mg-ream', onclick: () => { if (sheets < need && !printing) { sheets++; ctx.sound('paper'); render(); } } }, 'Взять лист из пачки');
    const test = h('button', {
      class: 'mg-btn mg-red',
      onclick: () => {
        if (printing) return;
        if (sheets < need) { flash(tray); ctx.sound('bad'); out.textContent = 'ОШИБКА: МАЛО БУМАГИ'; return; }
        printing = true;
        ctx.sound('printer');
        out.textContent = '';
        const page = h('div', { class: 'mg-page' }, 'ТЕСТОВАЯ СТРАНИЦА', h('br'), 'КОНТОРКА-ПРИНТ 3000', h('br'), '▓▓▓▒▒░░');
        out.append(page);
        setTimeout(() => ctx.done(), 1300);
      },
    }, 'ТЕСТ');
    render();
    root.append(h('div', { class: 'mg-split' }, h('div', { class: 'mg-printer' }, tray, out), h('div', { class: 'mg-col' }, ream, test)));
  },

  // Отметка на посту (шаг обходов)
  stamp(root, ctx) {
    let stamped = false;
    const paper = h('div', { class: 'mg-form' }, h('div', {}, 'ЛИСТ ОБХОДА'), h('div', {}, ctx.stepLabel || 'Отметка поста'), h('div', { class: 'mg-stampzone' }, '______'));
    const btn = h('button', {
      class: 'mg-btn mg-red mg-big',
      onclick: () => {
        if (stamped) return;
        stamped = true;
        ctx.sound('stamp');
        paper.querySelector('.mg-stampzone').replaceChildren(h('span', { class: 'mg-stampmark' }, 'ОТМЕЧЕНО'));
        setTimeout(() => ctx.done(), 450);
      },
    }, 'ШЛЁП!');
    root.append(h('div', { class: 'mg-split' }, paper, btn));
  },

  // Сверка кукишей: сопоставить строки двух ведомостей
  ledger(root, ctx) {
    const people = R.shuffle(['Колупень', 'Шуруп', 'Глафира', 'Лёня', 'Зинаида', 'Евлампий', 'Клава', 'Гена']).slice(0, 5);
    const rows = people.map((p) => ({ p, sum: R.int(3, 48) * 5, matched: false }));
    const right = R.shuffle(rows);
    let sel = null;
    const L = h('div', { class: 'mg-col mg-ledgercol' });
    const Rr = h('div', { class: 'mg-col mg-ledgercol' });
    const render = () => {
      clear(L); clear(Rr);
      L.append(h('div', { class: 'mg-head' }, 'Ведомость А'));
      Rr.append(h('div', { class: 'mg-head' }, 'Ведомость Б'));
      rows.forEach((r) => L.append(h('button', { class: `mg-lrow ${sel === r ? 'mg-active' : ''} ${r.matched ? 'mg-done' : ''}`, disabled: r.matched, onclick: () => { sel = r; ctx.sound('click'); render(); } }, `${r.p} … ${r.sum}`)));
      right.forEach((r) => Rr.append(h('button', {
        class: `mg-lrow ${r.matched ? 'mg-done' : ''}`, disabled: r.matched,
        onclick: (e) => {
          if (!sel) return;
          if (sel === r) { r.matched = true; sel = null; ctx.sound('coins'); render(); if (rows.every((x) => x.matched)) ctx.done(); }
          else { flash(e.currentTarget); ctx.sound('bad'); }
        },
      }, `${r.sum} кук. — ${r.p}`)));
    };
    render();
    root.append(h('div', { class: 'mg-split' }, L, Rr));
  },

  // Пересчёт кукишей
  coins(root, ctx) {
    const coins = [];
    const n = R.int(7, 11);
    const cells = R.shuffle([...Array(12).keys()]);
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      coins.push({ v: R.pick([1, 1, 5, 5, 10]), x: 4 + (c % 4) * 23 + R.int(0, 8), y: 4 + Math.floor(c / 4) * 30 + R.int(0, 10) });
    }
    const total = coins.reduce((s, c) => s + c.v, 0);
    let val = '';
    const pile = h('div', { class: 'mg-pile' }, coins.map((c) => h('div', { class: `mg-coin mg-c${c.v}`, style: { left: `${c.x}%`, top: `${c.y}%` } }, String(c.v))));
    const disp = h('div', { class: 'mg-display' }, '0');
    const onKey = (k) => {
      ctx.sound('type');
      if (k === 'OK') {
        if (Number(val) === total) ctx.done();
        else { flash(disp); ctx.sound('bad'); val = ''; disp.textContent = '0'; }
        return;
      }
      if (k === '⌫') val = val.slice(0, -1);
      else if (val.length < 3) val += k;
      disp.textContent = val || '0';
    };
    const keyHandler = (e) => { if (/^[0-9]$/.test(e.key)) onKey(e.key); else if (e.key === 'Backspace') onKey('⌫'); else if (e.key === 'Enter') onKey('OK'); };
    window.addEventListener('keydown', keyHandler);
    root.append(h('div', { class: 'mg-split' }, pile, h('div', { class: 'mg-col' }, h('div', { class: 'mg-hint' }, 'Сумма кукишей:'), disp, numpad(onKey))));
    return () => window.removeEventListener('keydown', keyHandler);
  },

  // Подпись ведомости: соединить точки по порядку
  signature(root, ctx) {
    const n = 7;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: 30 + i * 50 + R.int(-10, 10), y: 70 + Math.sin(i * 1.7) * 40 + R.int(-12, 12) });
    let next = 0;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 380 150');
    svg.setAttribute('class', 'mg-sign');
    const path = document.createElementNS(svgNS, 'polyline');
    path.setAttribute('class', 'mg-ink');
    svg.append(path);
    const circles = pts.map((p, i) => {
      const g = document.createElementNS(svgNS, 'g');
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', 13);
      const t = document.createElementNS(svgNS, 'text');
      t.setAttribute('x', p.x); t.setAttribute('y', p.y + 5); t.textContent = String(i + 1);
      g.append(c, t);
      g.setAttribute('class', 'mg-dot');
      g.addEventListener('click', () => {
        if (i !== next) { ctx.sound('bad'); g.classList.add('mg-baddot'); setTimeout(() => g.classList.remove('mg-baddot'), 300); return; }
        next++;
        g.classList.add('mg-hit');
        ctx.sound('write');
        path.setAttribute('points', pts.slice(0, next).map((q) => `${q.x},${q.y}`).join(' '));
        if (next === n) setTimeout(() => ctx.done(), 300);
      });
      svg.append(g);
      return g;
    });
    void circles;
    root.append(h('div', { class: 'mg-hint' }, 'Распишитесь: соедините точки по порядку.'), svg);
  },

  // Техобслуживание ускорителя: панели с задержкой
  timedPanels(root, ctx) {
    const panels = [0, 1, 2].map(() => ({ state: 'off', t: 0 }));
    const box = h('div', { class: 'mg-panels' });
    let raf;
    const loop = () => {
      const now = performance.now();
      panels.forEach((p) => { if (p.state === 'charging' && now - p.t > 1400) p.state = 'on'; });
      render();
      raf = requestAnimationFrame(loop);
    };
    const render = () => {
      clear(box);
      panels.forEach((p, i) => {
        const prevOk = i === 0 || panels[i - 1].state === 'on';
        box.append(h('button', {
          class: `mg-panel mg-${p.state}`,
          onclick: () => {
            if (p.state !== 'off') return;
            if (!prevOk) { panels.forEach((q, j) => { if (j >= i - 1 && q.state === 'charging') q.state = 'off'; }); ctx.sound('bad'); return; }
            p.state = 'charging'; p.t = performance.now(); ctx.sound('press');
          },
        }, h('div', { class: 'mg-lamp' }), `Панель ${i + 1}`));
      });
      if (panels.every((p) => p.state === 'on')) { cancelAnimationFrame(raf); setTimeout(() => ctx.done(), 200); }
    };
    raf = requestAnimationFrame(loop);
    root.append(h('div', { class: 'mg-hint' }, 'Включай панели по порядку. Следующую — только когда предыдущая загорится зелёным.'), box);
    return () => cancelAnimationFrame(raf);
  },

  // Проверка ускорителя: повтор последовательности
  simon(root, ctx) {
    const cols = ['#d02a2a', '#2ab040', '#2a6ad0', '#e0c020'];
    const seq = [0, 1, 2, 3].map(() => R.int(0, 3));
    let input = [];
    let showing = true;
    const pads = cols.map((c, i) => h('button', {
      class: 'mg-simon', style: { background: c },
      onclick: () => {
        if (showing) return;
        light(i);
        input.push(i);
        if (seq[input.length - 1] !== i) { ctx.sound('bad'); input = []; setTimeout(play, 700); return; }
        ctx.sound('press');
        if (input.length === seq.length) setTimeout(() => ctx.done(), 300);
      },
    }));
    const light = (i) => { pads[i].classList.add('mg-lit'); setTimeout(() => pads[i].classList.remove('mg-lit'), 300); };
    const label = h('div', { class: 'mg-hint' }, 'Смотри...');
    let timers = [];
    const play = () => {
      showing = true;
      label.textContent = 'Смотри...';
      timers = seq.map((s, k) => setTimeout(() => { light(s); ctx.sound('click'); }, 500 + k * 550));
      timers.push(setTimeout(() => { showing = false; label.textContent = 'Повтори!'; }, 500 + seq.length * 550));
    };
    play();
    root.append(label, h('div', { class: 'mg-simonbox' }, pads));
    return () => timers.forEach(clearTimeout);
  },

  // Регистрация посетителя / восстановление записи: перепечатать текст
  typeName(root, ctx) {
    const text = ctx.data?.text || R.pick(NAMES);
    const input = h('input', { class: 'mg-input-text', autocomplete: 'off', spellcheck: false, placeholder: 'Печатайте здесь...' });
    const check = () => {
      const a = input.value.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
      const b = text.toLowerCase().replace(/ё/g, 'е');
      if (a === b) ctx.done();
      else { flash(input); ctx.sound('bad'); }
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') check(); else if (e.key === 'Escape') ctx.cancel(); else ctx.sound('type'); });
    input.addEventListener('input', () => {
      const a = input.value.toLowerCase().replace(/ё/g, 'е');
      const b = text.toLowerCase().replace(/ё/g, 'е');
      input.classList.toggle('mg-typo', !b.startsWith(a));
      if (a.trim() === b) setTimeout(check, 100);
    });
    root.append(
      h('div', { class: 'mg-card' }, h('div', { class: 'mg-head' }, ctx.data?.title || 'КАРТОЧКА ПОСЕТИТЕЛЯ'), h('div', { class: 'mg-big-text' }, text)),
      h('div', { class: 'mg-hint' }, 'Перепишите в журнал (регистр не важен):'),
      input, h('button', { class: 'mg-btn mg-wide', onclick: check }, 'Записать'),
    );
    setTimeout(() => input.focus(), 50);
  },

  // Капуста: выбрать кондиционный кочан
  pickup(root, ctx) {
    const good = R.int(0, 3);
    const box = h('div', { class: 'mg-cabbages' }, [0, 1, 2, 3].map((i) => h('button', {
      class: 'mg-cabbage',
      onclick: (e) => {
        if (i === good) { ctx.sound('paper'); ctx.done(); }
        else { flash(e.currentTarget); ctx.sound('bad'); e.currentTarget.textContent = 'гнилой'; }
      },
    }, i === good ? h('span', { class: 'mg-tag' }, 'ГОСТ') : null)));
    root.append(h('div', { class: 'mg-hint' }, 'Возьми кочан с биркой «ГОСТ».'), box);
  },

  // Заправка щей: засыпать капусту и помешать по кругу
  stir(root, ctx) { return circular(root, ctx, { title: 'Мешай щи по кругу (мышью над бидоном)', turns: 3, cls: 'mg-potview', sound: 'stir' }); },

  // Заточка карандашей: крутить точилку
  sharpen(root, ctx) { return circular(root, ctx, { title: 'Крути точилку по кругу', turns: 3.5, cls: 'mg-sharpener', sound: 'write' }); },

  // Штампование записюлек
  stampDocs(root, ctx) {
    const rule = R.pick([
      { text: 'Одобрять только с подписью И датой', ok: (d) => d.sign && d.date },
      { text: 'Одобрять только с печатью Хозяина', ok: (d) => d.seal },
      { text: 'Отклонять всё, где нет подписи', ok: (d) => d.sign },
    ]);
    const queue = [];
    for (let i = 0; i < 5; i++) queue.push({ sign: Math.random() < 0.6, date: Math.random() < 0.6, seal: Math.random() < 0.55, n: R.int(100, 999) });
    let done = 0;
    const docBox = h('div', { class: 'mg-docview' });
    const render = () => {
      clear(docBox);
      const d = queue[0];
      if (!d) return;
      docBox.append(h('div', { class: 'mg-paper' },
        h('div', { class: 'mg-head' }, `Записюлька №${d.n}`),
        h('div', {}, 'Прошу выдать ', R.pick(['степлер', 'кукиш', 'скрепку', 'отгул', 'калошу']), '.'),
        h('div', {}, 'Подпись: ', d.sign ? h('i', { class: 'mg-signed' }, '~Кракозябр~') : '______'),
        h('div', {}, 'Дата: ', d.date ? '05.10' : '__.__'),
        d.seal ? h('div', { class: 'mg-seal' }, 'ХОЗЯИН') : null),
      );
    };
    const decide = (approve) => {
      const d = queue.shift();
      if (rule.ok(d) === approve) { done++; ctx.sound('stamp'); } else { queue.push(d); ctx.sound('bad'); flash(docBox); }
      counter.textContent = `Обработано: ${done}/5`;
      if (done >= 5) ctx.done(); else render();
    };
    const counter = h('div', { class: 'mg-hint' }, 'Обработано: 0/5');
    render();
    root.append(h('div', { class: 'mg-rule' }, 'Правило: ', h('b', {}, rule.text)), docBox,
      h('div', { class: 'mg-row' }, h('button', { class: 'mg-btn mg-green', onclick: () => decide(true) }, 'ОДОБРЕНО'), h('button', { class: 'mg-btn mg-red', onclick: () => decide(false) }, 'ОТКАЗАНО')), counter);
  },

  // Полив фикуса: удерживать и отпустить на отметке
  water(root, ctx) {
    let level = 0;
    let pouring = false;
    let raf;
    const lo = R.int(55, 70);
    const hi = lo + 12;
    const fill = h('div', { class: 'mg-water' });
    const band = h('div', { class: 'mg-band', style: { bottom: `${lo}%`, height: `${hi - lo}%` } });
    const pot = h('div', { class: 'mg-pot' }, band, fill);
    const btn = h('button', { class: 'mg-btn mg-big' }, 'Лить (держать)');
    const start = () => { pouring = true; ctx.sound('pour'); };
    const stop = () => {
      if (!pouring) return;
      pouring = false;
      if (level >= lo && level <= hi) { ctx.done(); return; }
      ctx.sound('bad');
      flash(pot);
      if (level > hi) level = 0;
    };
    btn.addEventListener('pointerdown', start);
    window.addEventListener('pointerup', stop);
    const key = (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); start(); } };
    const keyUp = (e) => { if (e.code === 'Space') stop(); };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', keyUp);
    let last = performance.now();
    const loop = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      if (pouring) level = Math.min(100, level + dt * 38);
      fill.style.height = `${level}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    root.append(h('div', { class: 'mg-hint' }, 'Держи кнопку (или Пробел) и отпусти в зелёной зоне.'), h('div', { class: 'mg-split' }, pot, btn));
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointerup', stop); window.removeEventListener('keydown', key); window.removeEventListener('keyup', keyUp); };
  },

  // Сортировка скрепок
  clips(root, ctx) {
    const cols = ['red', 'blue', 'yellow'];
    const spots = R.shuffle([...Array(15).keys()]);
    const clips = R.shuffle([...Array(9)].map((_, i) => ({ c: cols[i % 3], done: false, x: 3 + (spots[i] % 5) * 19 + R.int(0, 6), y: 6 + Math.floor(spots[i] / 5) * 28 + R.int(0, 8) })));
    let sel = null;
    const tray = h('div', { class: 'mg-cliptray' });
    const boxes = h('div', { class: 'mg-clipboxes' });
    const render = () => {
      clear(tray); clear(boxes);
      clips.forEach((c) => { if (!c.done) tray.append(h('button', { class: `mg-clip ${sel === c ? 'mg-active' : ''}`, style: { left: `${c.x}%`, top: `${c.y}%`, color: COLORS[c.c][0] }, onclick: () => { sel = c; ctx.sound('click'); render(); } }, '⊂⊃')); });
      cols.forEach((col) => boxes.append(h('button', {
        class: 'mg-clipbox', style: { borderColor: COLORS[col][0] },
        onclick: (e) => {
          if (!sel) return;
          if (sel.c === col) { sel.done = true; sel = null; ctx.sound('coins'); render(); if (clips.every((c) => c.done)) ctx.done(); }
          else { flash(e.currentTarget); ctx.sound('bad'); }
        },
      }, COLORS[col][1])));
    };
    render();
    root.append(tray, boxes);
  },

  // Звонок Хозяину
  phone(root, ctx) {
    const name = ctx.myName || 'Батракан';
    const QS = R.shuffle([
      { q: 'Кто у аппарата?', a: [`Батракан ${name}, слушаю внимательно!`, 'Алло, чего надо?', 'Никого нет дома.'], ok: 0 },
      { q: 'Как продвигается батрачка?', a: ['Нормально вроде.', 'Согласно плану, с опережением графика!', 'А вам какое дело?'], ok: 1 },
      { q: 'Кукиши на месте?', a: ['Все до единого, по ведомости!', 'Какие кукиши?', 'Спросите у Дуси.'], ok: 0 },
      { q: 'Записюльку получили?', a: ['Какую ещё записюльку?', 'Получили, приняли к исполнению!', 'Её Колупень съел.'], ok: 1 },
    ]).slice(0, 2);
    let i = 0;
    const box = h('div', { class: 'mg-phonebox' });
    const ringing = h('button', {
      class: 'mg-btn mg-big mg-green',
      onclick: () => { ctx.sound('click'); ask(); },
    }, '☎ Снять трубку');
    const ask = () => {
      clear(box);
      const q = QS[i];
      box.append(h('div', { class: 'mg-owner' }, h('b', {}, 'ХОЗЯИН: '), q.q));
      R.shuffle(q.a.map((a, k) => ({ a, k }))).forEach(({ a, k }) => box.append(h('button', {
        class: 'mg-btn mg-wide mg-answer',
        onclick: (e) => {
          if (k === q.ok) { i++; ctx.sound('good'); if (i >= QS.length) ctx.done(); else ask(); }
          else { flash(e.currentTarget); ctx.sound('bad'); box.querySelector('.mg-owner').append(h('div', { class: 'mg-angry' }, '— Не по регламенту! Ещё раз.')); }
        },
      }, a)));
    };
    ctx.sound('phone');
    box.append(h('div', { class: 'mg-hint' }, 'Звонит Хозяин! Отвечай по регламенту.'), ringing);
    root.append(box);
  },

  // Вычерпывание слоповины: качать в такт
  pump(root, ctx) {
    let progress = 0;
    let t = 0;
    let raf;
    const needle = h('div', { class: 'mg-needle' });
    const gauge = h('div', { class: 'mg-gauge' }, h('div', { class: 'mg-gzone' }), needle);
    const bar = h('div', { class: 'mg-progress' }, h('div', { class: 'mg-progfill' }));
    let last = performance.now();
    const val = () => (Math.sin(t * 2.6) * 0.5 + 0.5) * 100;
    const loop = (now) => {
      t += (now - last) / 1000;
      last = now;
      needle.style.left = `${val()}%`;
      bar.firstChild.style.width = `${progress}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const press = () => {
      const v = val();
      if (v > 40 && v < 62) { progress = Math.min(100, progress + 25); ctx.sound('pump'); if (progress >= 100) ctx.done(); }
      else { progress = Math.max(0, progress - 15); ctx.sound('bad'); flash(gauge); }
    };
    const key = (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); press(); } };
    window.addEventListener('keydown', key);
    root.append(h('div', { class: 'mg-hint' }, 'Качай, когда стрелка в зелёной зоне (кнопка или Пробел).'), gauge, bar, h('button', { class: 'mg-btn mg-big', onclick: press }, 'КАЧНУТЬ'));
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key); };
  },

  // Замена бидона: отпустить точно над горлышком
  bidon(root, ctx) {
    let t = Math.random() * 3;
    let raf;
    let dropping = false;
    const bottle = h('div', { class: 'mg-bottle' });
    const neck = h('div', { class: 'mg-neck' });
    const scene = h('div', { class: 'mg-cooler' }, bottle, neck);
    let last = performance.now();
    const x = () => 50 + Math.sin(t * 2.2) * 40;
    const loop = (now) => {
      t += (now - last) / 1000;
      last = now;
      if (!dropping) bottle.style.left = `${x()}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const drop = () => {
      if (dropping) return;
      dropping = true;
      const pos = x();
      bottle.classList.add('mg-drop');
      if (Math.abs(pos - 50) < 7) { ctx.sound('lift'); setTimeout(() => ctx.done(), 500); }
      else { ctx.sound('bad'); setTimeout(() => { bottle.classList.remove('mg-drop'); dropping = false; }, 700); }
    };
    const key = (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); drop(); } };
    window.addEventListener('keydown', key);
    root.append(h('div', { class: 'mg-hint' }, 'Отпусти бидон над горлышком кулера.'), scene, h('button', { class: 'mg-btn mg-big', onclick: drop }, 'ОТПУСТИТЬ'));
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key); };
  },

  // ---- ремонтные мини-игры
  // Принтер зажевал бумагу
  jam(root, ctx) {
    const pieces = [...Array(5)].map(() => ({ hp: R.int(2, 3), x: R.int(8, 82), y: R.int(10, 70), r: R.int(-40, 40) }));
    const box = h('div', { class: 'mg-jam' });
    const render = () => {
      clear(box);
      pieces.forEach((p) => {
        if (p.hp <= 0) return;
        box.append(h('button', { class: 'mg-scrap', style: { left: `${p.x}%`, top: `${p.y}%`, transform: `rotate(${p.r}deg)` }, onclick: () => { p.hp--; ctx.sound('paper'); render(); if (pieces.every((q) => q.hp <= 0)) ctx.done(); } }, '≋'));
      });
    };
    render();
    root.append(h('div', { class: 'mg-hint' }, 'Вытащи зажёванные клочки (по несколько рывков).'), box);
  },

  // Подбор кода шкапчиков
  code(root, ctx) {
    const code = [R.int(0, 9), R.int(0, 9), R.int(0, 9)];
    const cur = [0, 0, 0];
    const dials = h('div', { class: 'mg-dials' });
    const render = () => {
      clear(dials);
      cur.forEach((d, i) => dials.append(h('div', { class: 'mg-dial' },
        h('button', { class: 'mg-btn mg-small', onclick: () => { cur[i] = (cur[i] + 1) % 10; ctx.sound('click'); render(); } }, '▲'),
        h('div', { class: 'mg-digit' }, String(d)),
        h('button', { class: 'mg-btn mg-small', onclick: () => { cur[i] = (cur[i] + 9) % 10; ctx.sound('click'); render(); } }, '▼'))));
    };
    render();
    root.append(
      h('div', { class: 'mg-sticker' }, 'Мастер-код (из сейфа Дуси): ', h('b', {}, code.join('-'))),
      dials,
      h('button', { class: 'mg-btn mg-wide', onclick: () => { if (cur.join('') === code.join('')) { ctx.sound('locker'); ctx.done(); } else { ctx.sound('bad'); flash(dials); } } }, 'Открыть'),
    );
  },

  // Сравнение версий записюльки (подлинность печати)
  compare(root, ctx) {
    const a = ctx.data?.stampA || 'ХОЗЯИН · УТВЕРЖДАЮ';
    const b = ctx.data?.stampB || 'ХОЗЯИН · УТВЕРЖДАЮ';
    const note = (title, stamp, v) => h('div', { class: 'mg-paper mg-note' }, h('div', { class: 'mg-head' }, `Версия ${v}`), h('div', {}, title), h('div', { class: 'mg-seal mg-seal-big' }, stamp));
    root.append(
      h('div', { class: 'mg-hint' }, 'Сравни печати двух версий. Подделку выдаёт опечатка в печати.'),
      h('div', { class: 'mg-split' }, note(ctx.data?.titleA || 'Исходная записюлька', a, 1), note(ctx.data?.titleB || 'Уточнение', b, 2)),
      h('div', { class: 'mg-row' },
        h('button', { class: 'mg-btn mg-green', onclick: () => ctx.done({ answer: 'same' }) }, 'Печать подлинная'),
        h('button', { class: 'mg-btn mg-red', onclick: () => ctx.done({ answer: 'fake' }) }, 'Подделка!')),
    );
  },
};

// Круговые движения мышью (щи, точилка)
function circular(root, ctx, { title, turns, cls, sound }) {
  const area = h('div', { class: `mg-circle ${cls}` }, h('div', { class: 'mg-circle-center' }));
  const bar = h('div', { class: 'mg-progress' }, h('div', { class: 'mg-progfill' }));
  let acc = 0;
  let lastA = null;
  let lastSound = 0;
  const move = (e) => {
    const r = area.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(x, y) < 12) return;
    const a = Math.atan2(y, x);
    if (lastA !== null) {
      let d = a - lastA;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      acc += Math.abs(d);
      if (performance.now() - lastSound > 400) { ctx.sound(sound); lastSound = performance.now(); }
    }
    lastA = a;
    const p = Math.min(1, acc / (Math.PI * 2 * turns));
    bar.firstChild.style.width = `${p * 100}%`;
    area.style.setProperty('--rot', `${acc * 57}deg`);
    if (p >= 1) { area.removeEventListener('pointermove', move); ctx.done(); }
  };
  area.addEventListener('pointermove', move);
  root.append(h('div', { class: 'mg-hint' }, title), area, bar);
}
