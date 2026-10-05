// Минимальные DOM-помощники без фреймворка.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function $(sel, root = document) { return root.querySelector(sel); }

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Окно «внутреннего корпоративного софта» (КонторОС 98)
export function win98(title, body, opts = {}) {
  const close = opts.onClose ? h('button', { class: 'w98-x', title: 'Закрыть (Esc)', onclick: opts.onClose }, '×') : null;
  return h('div', { class: `w98 ${opts.class || ''}` },
    h('div', { class: 'w98-title' }, h('span', { class: 'w98-ico' }, '▣'), h('span', { class: 'w98-t' }, title), close),
    h('div', { class: 'w98-body' }, body),
    opts.status ? h('div', { class: 'w98-status' }, opts.status) : null,
  );
}
