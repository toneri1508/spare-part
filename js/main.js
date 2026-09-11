import { html, mount } from './html.js';
import { icon, toast, errorText, fmtClock, openSheet, isSheetOpen, onSheetsClosed, closeAllSheets, routeId, routeParams, withBusy, showError } from './ui.js';
import * as S from './store.js';
import { stopAllScanners, scannerActive } from './scanner.js';
import { renderSetup } from './views/setup.js';
import { renderInit } from './views/init.js';
import { renderLogin } from './views/login.js';
import * as overview from './views/overview.js';
import * as inventory from './views/inventory.js';
import * as receive from './views/receive.js';
import * as historyView from './views/history.js';
import * as admin from './views/admin.js';

const ROUTES = {
  'tong-quan': { label: 'Tổng quan', icon: 'home', mod: overview },
  'vat-tu': { label: 'Vật tư', icon: 'box', mod: inventory },
  'nhap-kho': { label: 'Nhập kho', icon: 'in', mod: receive },
  'lich-su': { label: 'Lịch sử', icon: 'clock', mod: historyView },
  'quan-ly': { label: 'Quản lý', icon: 'gear', mod: admin, admin: true },
};

const app = document.getElementById('app');
const { store } = S;
let shellMounted = false;
let shellSig = '';
let pendingView = false;
let pendingShell = false;
let setupPrefill = null;
let lastRoute = null;

/* ---------- link kết nối: #ket-noi=... ---------- */

function consumeConnectLink() {
  const m = location.hash.match(/ket-noi=([A-Za-z0-9_-]+)/);
  if (!m) return;
  history.replaceState(null, '', `${location.pathname}${location.search}#/tong-quan`);
  const conn = S.decodeConnLink(m[1]);
  if (!conn) { toast('Link kết nối không hợp lệ hoặc bị cắt mất một phần.', 'error'); return; }
  const current = S.loadConn();
  if (current && (current.owner !== conn.owner || current.repo !== conn.repo)) S.clearUserId();
  S.saveConn(conn);
  toast(`Đã kết nối thiết bị với ${conn.owner}/${conn.repo}.`);
}

/* ---------- vẽ theo trạng thái ---------- */

function renderRoot() {
  shellMounted = false;
  pendingView = pendingShell = false;
  closeAllSheets();
  stopAllScanners();

  if (!store.conn) {
    renderSetup(app, {
      prefill: setupPrefill,
      onConnected: (conn) => {
        setupPrefill = null;
        S.saveConn(conn);
        S.connect(conn);
      },
    });
    return;
  }
  if (store.status === 'idle' || store.status === 'loading') {
    mount(app, html`<div class="gate"><p class="loading">Đang Xin Cấp Phép Từ Quản Trị Viên…</p></div>`);
    return;
  }
  if (store.status === 'error') return renderError();
  if (store.status === 'uninitialized') return renderInit(app);

  const user = store.view.userById.get(S.loadUserId() || '');
  if (!user) {
    store.user = null;
    renderLogin(app, { onDone: renderRoot });
    return;
  }
  store.user = user;
  renderShell();
  renderView(true);
}

function renderError() {
  const e = store.error;
  mount(app, html`<div class="gate"><div class="gate-card">
    <h1 class="gate-title">Chưa mở được dữ liệu kho</h1>
    <p>${errorText(e)}</p>
    <div class="btn-col">
      <button type="button" class="btn btn-primary btn-block" data-retry>${icon('refresh')}Thử lại</button>
      <button type="button" class="btn btn-block" data-reconnect>Kết nối lại bằng khóa khác</button>
    </div>
  </div></div>`);
  app.querySelector('[data-retry]').onclick = () => S.connect(store.conn);
  app.querySelector('[data-reconnect]').onclick = () => {
    setupPrefill = { ...store.conn };
    S.disconnect();
  };
}

const signature = () => {
  const s = store.view.meta.settings;
  return [s.title, s.subtitle, store.user?.name, store.user?.role].join('|');
};

function renderShell() {
  const s = store.view.meta.settings;
  const isAdmin = S.isAdmin();
  mount(app, html`
    <a class="skip" href="#view">Bỏ qua thanh điều hướng</a>
    <header class="topbar">
      <div class="topbar-in">
        <a class="brand" href="#/tong-quan"><span class="brand-title">${s.title}</span>${s.subtitle && html`<span class="brand-sub">${s.subtitle}</span>`}</a>
        <nav class="nav" aria-label="Các trang">
          ${Object.entries(ROUTES).filter(([, r]) => !r.admin || isAdmin).map(([id, r]) => html`<a href="#/${id}" data-route="${id}">${icon(r.icon)}<span>${r.label}</span></a>`)}
        </nav>
        <button type="button" class="who" data-who>
          <span class="sync-dot" data-sync></span>
          <span class="who-name">${store.user.name}</span>
          <span class="sync-text" data-sync-text></span>
        </button>
      </div>
    </header>
    <div class="banner" data-banner hidden></div>
    <main id="view" class="page" tabindex="-1"></main>
  `);
  shellMounted = true;
  shellSig = signature();
  app.querySelector('[data-who]').addEventListener('click', openAccount);
  updateSync();
}

function currentRoute() {
  let id = routeId();
  if (!ROUTES[id] || (ROUTES[id].admin && !S.isAdmin())) id = 'tong-quan';
  return id;
}

function renderView(scrollTop = false) {
  if (!shellMounted) return;
  pendingView = false;
  stopAllScanners();
  const id = currentRoute();
  const old = document.getElementById('view');
  const fresh = old.cloneNode(false); // thay phần tử mới để không dồn trùng sự kiện
  old.replaceWith(fresh);
  app.querySelectorAll('[data-route]').forEach((a) => a.setAttribute('aria-current', a.dataset.route === id ? 'page' : 'false'));
  try {
    ROUTES[id].mod.render(fresh, routeParams());
  } catch (e) {
    console.error(e);
    mount(fresh, html`<p class="notice notice-out">Trang này gặp lỗi hiển thị: ${errorText(e)}</p>`);
  }
  if (scrollTop || id !== lastRoute) window.scrollTo(0, 0);
  lastRoute = id;
}

/* ---------- dữ liệu đổi từ thiết bị khác: vẽ lại nhưng không phá thao tác đang làm ---------- */

function isEditing() {
  const a = document.activeElement;
  const view = document.getElementById('view');
  return !!(a && view && view.contains(a) && a.matches('input, textarea, select') && (a.value || a.tagName === 'SELECT'));
}

function flush() {
  if (!shellMounted || (!pendingView && !pendingShell)) return;
  if (store.saving || isSheetOpen() || isEditing() || scannerActive()) return;
  if (pendingShell) {
    pendingShell = false;
    renderShell();
  }
  renderView();
}

S.subscribe((reason) => {
  if (reason === 'status') return renderRoot();
  if (reason === 'data') {
    if (store.status !== 'ready' || !shellMounted) return;
    const u = store.view.userById.get(store.user?.id);
    if (!u) {
      S.clearUserId();
      toast('Tài khoản của bạn không còn trong hệ thống.', 'warn');
      return renderRoot();
    }
    store.user = u;
    if (signature() !== shellSig) pendingShell = true;
    if (!S.isAdmin() && ROUTES[routeId()]?.admin) location.hash = '#/tong-quan';
    pendingView = true;
    flush();
    return;
  }
  updateSync();
  if (reason === 'saving' || reason === 'synced') flush();
});

onSheetsClosed(() => setTimeout(flush, 0));
app.addEventListener('focusout', () => setTimeout(flush, 80));
window.addEventListener('app:rerender', () => renderView());
window.addEventListener('hashchange', () => {
  if (/ket-noi=/.test(location.hash)) {
    consumeConnectLink();
    const c = S.loadConn();
    if (c) S.connect(c);
    return;
  }
  if (!shellMounted) return;
  closeAllSheets();
  renderView();
});

/* ---------- trạng thái đồng bộ ---------- */

function updateSync() {
  const dot = app.querySelector('[data-sync]');
  if (!dot) return;
  const text = app.querySelector('[data-sync-text]');
  const banner = app.querySelector('[data-banner]');
  let cls = 'ok';
  let label = store.syncedAt ? `Đã đồng bộ lúc ${fmtClock(store.syncedAt)}` : 'Đã đồng bộ';
  let short = '';
  if (store.saving) { cls = 'busy'; label = 'Đang lưu lên GitHub…'; short = 'Đang lưu…'; }
  else if (store.syncError) { cls = 'err'; label = `Chưa đồng bộ được: ${errorText(store.syncError)}`; short = 'Mất đồng bộ'; }
  dot.className = `sync-dot sync-${cls}`;
  text.textContent = short;
  const who = dot.parentElement;
  who.title = label;
  who.setAttribute('aria-label', `${store.user?.name || ''}. ${label}`);

  const authLost = store.syncError && ['auth', 'forbidden', 'notfound'].includes(store.syncError.kind);
  banner.hidden = !authLost;
  if (authLost) {
    mount(banner, html`<span>${errorText(store.syncError)}</span><button type="button" class="btn btn-sm" data-reconnect>Kết nối lại</button>`);
    banner.querySelector('[data-reconnect]').onclick = () => {
      setupPrefill = { ...store.conn };
      S.disconnect();
    };
  }
}

function openAccount() {
  const u = store.user;
  const s = openSheet(html`
    <dl class="kv">
      <div><dt>Tên</dt><dd>${u.name}</dd></div>
      <div><dt>ID</dt><dd>${u.id}</dd></div>
      <div><dt>Quyền</dt><dd>${u.role === 'admin' ? 'Quản trị viên' : 'Nhân viên'}</dd></div>
      <div><dt>Dữ liệu</dt><dd>${store.conn.owner}/${store.conn.repo}${store.syncedAt ? `, đồng bộ lúc ${fmtClock(store.syncedAt)}` : ''}</dd></div>
    </dl>
    <div class="sheet-actions">
      <button type="button" class="btn" data-reload>${icon('refresh')}Tải lại dữ liệu</button>
      <button type="button" class="btn btn-primary" data-logout>${icon('user')}Đổi người dùng</button>
    </div>
  `, { title: 'Tài khoản trên máy này' });
  s.body.querySelector('[data-reload]').addEventListener('click', async (e) => {
    try {
      const changed = await withBusy(e.currentTarget, 'Đang tải…', () => S.refresh(true));
      toast(changed ? 'Đã tải dữ liệu mới nhất.' : 'Dữ liệu đã là bản mới nhất.');
      s.close();
    } catch (x) {
      showError(x);
    }
  });
  s.body.querySelector('[data-logout]').addEventListener('click', () => {
    S.clearUserId();
    store.user = null;
    s.close();
    renderRoot();
  });
}

/* ---------- khởi động ---------- */

consumeConnectLink();
const saved = S.loadConn();
if (saved) S.connect(saved);
else renderRoot();
