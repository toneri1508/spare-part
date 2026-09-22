import { html, raw, mount } from '../html.js';
import { icon, confirmDialog, showError, withBusy, fmtNum, rerender } from '../ui.js';
import * as M from '../model.js';
import { store } from '../store.js';
import { itemRow, openItemSheet, openItemEditor, printLabels } from '../components.js';
import { exportInventory } from '../excel.js';

const f = { q: '', wh: '', group: '', st: '' };

/* Màn hình điện thoại chỉ hiện được vài dòng, nên vẽ sẵn cả danh sách là phí:
   trình duyệt phải tính chỗ cho từng dòng, mỗi lần gõ lại tính lại từ đầu.
   Vẽ 20 dòng trước, ai cần xem hết thì bấm một nút. Chỉ giới hạn phần hiển thị —
   Tải Excel và In tem vẫn lấy đủ mọi vật tư khớp bộ lọc. */
const FIRST = 20;
let showAll = false;

function filtered() {
  const v = store.view;
  return v.items
    .filter((i) => {
      if (!M.matchesItem(i, f.q)) return false;
      if (f.wh && !(M.num(i.stocks?.[f.wh]) > 0)) return false;
      if (f.group && i.group !== f.group) return false;
      const st = M.statusOf(i);
      if (f.st === 'attention' && st === 'ok') return false;
      if (f.st && f.st !== 'attention' && st !== f.st) return false;
      return true;
    })
    .sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }));
}

export function render(el, params) {
  showAll = false; // mỗi lần mở lại trang đều bắt đầu ở 20 dòng cho nhẹ
  if (params.tt) {
    f.st = params.tt;
    history.replaceState(null, '', '#/vat-tu');
  }
  const v = store.view;
  const sel = (cond) => (cond ? raw('selected') : '');

  mount(el, html`
    <div class="page-head">
      <h1>Vật tư</h1>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-new>${icon('plus')}Thêm vật tư</button>
        <button type="button" class="btn" data-export>${icon('download')}Tải Excel</button>
        <button type="button" class="btn" data-print>${icon('print')}In tem</button>
      </div>
    </div>
    <div class="filters">
      <label class="search-inline">${icon('search')}<input type="search" data-f="q" value="${f.q}" placeholder="Tìm mã, tên, nhóm" aria-label="Tìm vật tư"></label>
      <select data-f="wh" aria-label="Lọc theo kho"><option value="">Mọi kho</option>${v.meta.warehouses.map((w) => html`<option value="${w.id}" ${sel(f.wh === w.id)}>${w.name}</option>`)}</select>
      <select data-f="group" aria-label="Lọc theo nhóm"><option value="">Mọi nhóm</option>${v.groups.map((g) => html`<option value="${g}" ${sel(f.group === g)}>${g}</option>`)}</select>
      <select data-f="st" aria-label="Lọc theo tình trạng">
        <option value="">Mọi tình trạng</option>
        <option value="attention" ${sel(f.st === 'attention')}>Cần bổ sung</option>
        <option value="low" ${sel(f.st === 'low')}>Sắp hết</option>
        <option value="out" ${sel(f.st === 'out')}>Hết hàng</option>
        <option value="ok" ${sel(f.st === 'ok')}>Đủ hàng</option>
      </select>
    </div>
    <p class="result-count" data-count aria-live="polite"></p>
    <ul class="item-list" data-list></ul>
    <div class="more" data-more></div>
  `);

  const listEl = el.querySelector('[data-list]');
  const countEl = el.querySelector('[data-count]');
  const moreEl = el.querySelector('[data-more]');
  const draw = () => {
    const list = filtered();
    const active = f.q || f.wh || f.group || f.st;
    countEl.textContent = active ? `${fmtNum(list.length)} trên ${fmtNum(v.items.length)} vật tư` : `${fmtNum(list.length)} vật tư`;
    const hidden = showAll ? 0 : Math.max(0, list.length - FIRST);
    mount(listEl, list.length
      ? (hidden ? list.slice(0, FIRST) : list).map(itemRow)
      : html`<li class="empty-line">${v.items.length ? html`Không có vật tư khớp bộ lọc. <button type="button" class="btn-link" data-clear>Bỏ lọc</button>` : 'Chưa có vật tư nào.'}</li>`);
    mount(moreEl, hidden
      ? html`<button type="button" class="btn" data-show-all>Xem toàn bộ ${fmtNum(list.length)} vật tư</button>`
      : '');
  };

  el.addEventListener('input', (e) => {
    const k = e.target.dataset.f;
    if (!k) return;
    f[k] = e.target.value;
    showAll = false; // lọc lại thì thu gọn, khỏi vẽ thừa
    draw();
  });

  el.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-item]');
    if (row) return openItemSheet(row.dataset.item);
    if (e.target.closest('[data-show-all]')) {
      showAll = true;
      draw();
      return;
    }
    if (e.target.closest('[data-clear]')) {
      Object.assign(f, { q: '', wh: '', group: '', st: '' });
      rerender();
      return;
    }
    if (e.target.closest('[data-new]')) return openItemEditor(null);
    const exp = e.target.closest('[data-export]');
    if (exp) {
      try { await withBusy(exp, 'Đang tạo file…', () => exportInventory(store.view, filtered())); } catch (x) { showError(x); }
      return;
    }
    if (e.target.closest('[data-print]')) {
      const list = filtered();
      if (!list.length) return;
      if (list.length > 40) {
        const r = await confirmDialog({ title: 'In nhiều tem?', message: `Sẽ in ${list.length} tem QR theo bộ lọc hiện tại.`, confirmText: `In ${list.length} tem` });
        if (!r.ok) return;
      }
      printLabels(list);
    }
  });

  draw();
}
