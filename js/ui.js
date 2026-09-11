import { html, raw, mount, esc } from './html.js';

/* ---------- biểu tượng ---------- */

const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 20h1M20 14v1"/>',
  in: '<path d="M12 3v10M8 9.5l4 4 4-4"/><path d="M4 14v5.5h16V14"/>',
  out: '<path d="M12 13.5V3.5M8 7l4-4 4 4"/><path d="M4 14v5.5h16V14"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/>',
  box: '<path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z"/><path d="M4 7.5 12 11l8-3.5M12 11v9"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 20h14"/>',
  print: '<path d="M7 9V4h10v5M7 17H4.5V9.5h15V17H17"/><path d="M7 14h10v6H7z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4v4h-4"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
};

export function icon(name, cls = '') {
  return raw(
    `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`
  );
}

/* ---------- định dạng ---------- */

const nf = new Intl.NumberFormat('vi-VN');
export const fmtNum = (n) => nf.format(Number(n) || 0);

export function fmtTime(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return `${time} ${date}`;
}

export function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(ts) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} ngày trước`;
  return fmtTime(ts);
}

/* ---------- thông báo ---------- */

export function toast(message, kind = 'ok') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, kind === 'error' ? 7000 : 3500);
}

export const errorText = (e) => (e && e.message) || 'Có lỗi không xác định.';

export function showError(e) {
  console.error(e);
  toast(errorText(e), 'error');
}

/* Khóa nút trong lúc lưu để không bấm hai lần. */
export async function withBusy(button, label, fn) {
  const old = button ? button.innerHTML : '';
  if (button) {
    button.disabled = true;
    button.classList.add('is-busy');
    button.textContent = label;
  }
  try {
    return await fn();
  } finally {
    if (button && button.isConnected) {
      button.disabled = false;
      button.classList.remove('is-busy');
      button.innerHTML = old;
    }
  }
}

/* ---------- bảng trượt (modal) ---------- */

const stack = [];
const closedListeners = new Set();
export const onSheetsClosed = (fn) => closedListeners.add(fn);
export const isSheetOpen = () => stack.length > 0;

export function openSheet(content, { title = '', wide = false, onClose } = {}) {
  const root = document.getElementById('sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `<div class="sheet${wide ? ' sheet-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="st-${stack.length}" tabindex="-1">
      <div class="sheet-head">
        <h2 class="sheet-title" id="st-${stack.length}">${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('close')}</button>
      </div>
      <div class="sheet-body"></div>
    </div>`;
  const body = wrap.querySelector('.sheet-body');
  if (content) mount(body, content);
  root.appendChild(wrap);
  const previousFocus = document.activeElement;

  let downOnBackdrop = false;
  wrap.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === wrap; });
  wrap.addEventListener('click', (e) => {
    if ((e.target === wrap && downOnBackdrop) || e.target.closest('[data-close]')) api.close();
  });

  const api = {
    el: wrap,
    body,
    setContent: (c) => mount(body, c),
    close() {
      if (!wrap.isConnected) return;
      wrap.classList.remove('in');
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      setTimeout(() => wrap.remove(), 180);
      if (!stack.length) document.body.classList.remove('has-sheet');
      onClose?.();
      if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      if (!stack.length) closedListeners.forEach((fn) => fn());
    },
  };
  stack.push(api);
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => {
    wrap.classList.add('in');
    const target = body.querySelector('[autofocus]') || wrap.querySelector('.sheet');
    target.focus({ preventScroll: true });
  });
  return api;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
});

export function closeAllSheets() {
  [...stack].reverse().forEach((s) => s.close());
}

export function confirmDialog({ title, message, confirmText = 'Đồng ý', cancelText = 'Hủy', danger = false, checkbox = null }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = openSheet(
      html`<div class="confirm-msg">${message}</div>
        ${checkbox && html`<label class="check"><input type="checkbox" data-check ${checkbox.checked ? raw('checked') : ''}><span>${checkbox.label}</span></label>`}
        <div class="sheet-actions">
          <button type="button" class="btn" data-cancel>${cancelText}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok autofocus>${confirmText}</button>
        </div>`,
      { title, onClose: () => { if (!answered) resolve({ ok: false }); } }
    );
    s.body.querySelector('[data-cancel]').onclick = () => s.close();
    s.body.querySelector('[data-ok]').onclick = () => {
      answered = true;
      const c = s.body.querySelector('[data-check]');
      const checked = c ? c.checked : false;
      s.close();
      resolve({ ok: true, checked });
    };
  });
}

/* ---------- điều hướng ---------- */

export function routeId() {
  return location.hash.replace(/^#\/?/, '').split('?')[0];
}

export function routeParams() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}

export function go(id, params) {
  const q = params ? `?${new URLSearchParams(params)}` : '';
  const target = `#/${id}${q}`;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Yêu cầu vẽ lại trang hiện tại (sau khi lưu xong). */
export const rerender = () => window.dispatchEvent(new CustomEvent('app:rerender'));
