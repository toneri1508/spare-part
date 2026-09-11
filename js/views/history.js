import { html, raw, mount } from '../html.js';
import { icon, showError, withBusy, fmtNum } from '../ui.js';
import * as M from '../model.js';
import { store } from '../store.js';
import { txRow, openTxSheet } from '../components.js';
import { exportHistory } from '../excel.js';

const PAGE = 100;
const f = { q: '', user: '', wh: '', type: '', month: '' };
let limit = PAGE;

function filtered() {
  const v = store.view;
  return v.tx.filter((t) => {
    if (f.type && t.type !== f.type) return false;
    if (f.user && t.userId !== f.user) return false;
    if (f.wh && t.whId !== f.wh) return false;
    if (f.month && M.monthKey(t.ts) !== f.month) return false;
    if (f.q) {
      const it = v.itemById.get(t.itemId);
      const hay = `${it ? `${it.code} ${it.name}` : ''} ${t.note || ''}`;
      if (!M.fold(hay).includes(M.fold(f.q))) return false;
    }
    return true;
  });
}

export function render(el, params) {
  if (params.ma) {
    f.q = params.ma;
    history.replaceState(null, '', '#/lich-su');
  }
  const v = store.view;
  const sel = (c) => (c ? raw('selected') : '');

  mount(el, html`
    <div class="page-head">
      <h1>Lịch sử</h1>
      <div class="btn-row"><button type="button" class="btn" data-export>${icon('download')}Tải Excel</button></div>
    </div>
    <div class="filters">
      <label class="search-inline">${icon('search')}<input type="search" data-f="q" value="${f.q}" placeholder="Tìm mã, tên vật tư, ghi chú" aria-label="Tìm giao dịch"></label>
      <select data-f="type" aria-label="Loại"><option value="">Nhập và xuất</option><option value="nhap" ${sel(f.type === 'nhap')}>Chỉ nhập</option><option value="xuat" ${sel(f.type === 'xuat')}>Chỉ xuất</option></select>
      <select data-f="user" aria-label="Người thực hiện"><option value="">Mọi người</option>${v.meta.users.map((u) => html`<option value="${u.id}" ${sel(f.user === u.id)}>${u.name}</option>`)}</select>
      <select data-f="wh" aria-label="Kho"><option value="">Mọi kho</option>${v.meta.warehouses.map((w) => html`<option value="${w.id}" ${sel(f.wh === w.id)}>${w.name}</option>`)}</select>
      <select data-f="month" aria-label="Tháng"><option value="">Mọi tháng</option>${v.months.map((m) => html`<option value="${m}" ${sel(f.month === m)}>Tháng ${m.slice(5)}/${m.slice(0, 4)}</option>`)}</select>
    </div>
    <p class="result-count" data-count aria-live="polite"></p>
    <ul class="tx-list" data-list></ul>
    <div class="more" data-more></div>
  `);

  const listEl = el.querySelector('[data-list]');
  const countEl = el.querySelector('[data-count]');
  const moreEl = el.querySelector('[data-more]');

  const draw = () => {
    const list = filtered();
    countEl.textContent = `${fmtNum(list.length)} giao dịch`;
    mount(listEl, list.length ? list.slice(0, limit).map((t) => txRow(store.view, t)) : html`<li class="empty-line">Không có giao dịch khớp bộ lọc.</li>`);
    mount(moreEl, list.length > limit ? html`<button type="button" class="btn" data-more-btn>Xem thêm ${fmtNum(Math.min(PAGE, list.length - limit))} giao dịch</button>` : '');
  };

  el.addEventListener('input', (e) => {
    const k = e.target.dataset.f;
    if (!k) return;
    f[k] = e.target.value;
    limit = PAGE;
    draw();
  });

  el.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-tx]');
    if (row) return openTxSheet(row.dataset.tx);
    if (e.target.closest('[data-more-btn]')) { limit += PAGE; draw(); return; }
    const exp = e.target.closest('[data-export]');
    if (exp) {
      try { await withBusy(exp, 'Đang tạo file…', () => exportHistory(store.view, filtered())); } catch (x) { showError(x); }
    }
  });

  draw();
}
