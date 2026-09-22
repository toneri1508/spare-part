import { html, mount } from '../html.js';
import { fmtNum, icon } from '../ui.js';
import * as M from '../model.js';
import { store } from '../store.js';
import { itemPicker, bindPicker, itemRow, txRow, openCheckout, openItemSheet, openTxSheet } from '../components.js';

const LIMIT = 12;
let query = '';

export function render(el) {
  const v = store.view;
  const items = v.items;
  const out = items.filter((i) => M.statusOf(i) === 'out');
  const low = items.filter((i) => M.statusOf(i) === 'low');
  const attention = [...out, ...low].sort((a, b) =>
    (M.statusOf(a) === 'out' ? 0 : 1) - (M.statusOf(b) === 'out' ? 0 : 1)
    || (M.totalQty(a) - M.num(a.min)) - (M.totalQty(b) - M.num(b.min))
  );

  mount(el, html`
    <section class="hero">
      <h1 class="hero-title">Xuất kho</h1>
      <p class="hero-lead">Tìm vật tư cần lấy, hoặc quét mã QR trên tem kho.</p>
      ${itemPicker({ value: query, placeholder: 'Mã, tên hoặc nhóm vật tư', big: true })}
    </section>

    ${!items.length
      ? html`<section class="empty">
          <h2>Kho chưa có vật tư</h2>
          <p>Thêm từng vật tư ở trang Nhập kho, hoặc nhập cả danh sách từ file Excel.</p>
          <div class="btn-row">
            <a class="btn btn-primary" href="#/nhap-kho">${icon('in')}Nhập kho</a>
            <a class="btn" href="#/nhap-kho?muc=excel">${icon('upload')}Nhập từ Excel</a>
          </div>
        </section>`
      : html`
        <section class="tally" aria-label="Tình trạng kho">
          <a class="tally-item" href="#/vat-tu"><b>${fmtNum(items.length)}</b><span>mã vật tư</span></a>
          <a class="tally-item tally-low" href="#/vat-tu?tt=low"><b>${fmtNum(low.length)}</b><span>sắp hết</span></a>
          <a class="tally-item tally-out" href="#/vat-tu?tt=out"><b>${fmtNum(out.length)}</b><span>hết hàng</span></a>
        </section>

        <section class="block">
          <div class="block-head">
            <h2>Cần bổ sung</h2>
            ${attention.length > LIMIT && html`<a href="#/vat-tu?tt=attention">Xem cả ${fmtNum(attention.length)}</a>`}
          </div>
          ${attention.length
            ? html`<ul class="item-list">${attention.slice(0, LIMIT).map(itemRow)}</ul>`
            : html`<p class="empty-line">Mọi vật tư đều đang trên mức tồn tối thiểu.</p>`}
        </section>

        <section class="block">
          <div class="block-head"><h2>Hoạt động gần đây</h2><a href="#/lich-su">Xem lịch sử</a></div>
          ${v.tx.length
            ? html`<ul class="tx-list">${v.tx.slice(0, 6).map((t) => txRow(v, t))}</ul>`
            : html`<p class="empty-line">Chưa có giao dịch nào.</p>`}
        </section>`}
  `);

  bindPicker(el, {
    onType: (q) => { query = q; },
    onPick: (item, input) => {
      query = '';
      input.value = '';
      openCheckout(item.id);
    },
  });

  el.addEventListener('click', (e) => {
    const it = e.target.closest('[data-item]');
    if (it) return openItemSheet(it.dataset.item);
    const tx = e.target.closest('[data-tx]');
    if (tx) openTxSheet(tx.dataset.tx);
  });
}
