import { html, mount } from '../html.js';
import { toast, showError, withBusy } from '../ui.js';
import * as M from '../model.js';
import { store, mutate, saveUserId, disconnect } from '../store.js';
import { renderRestore } from './restore.js';

export function renderInit(el) {
  const c = store.conn;
  mount(el, html`<div class="gate"><div class="gate-card gate-wide">
    <p class="gate-brand">${c.owner}/${c.repo}</p>
    <h1 class="gate-title">Kho dữ liệu còn trống</h1>
    <p>Đã kết nối được GitHub nhưng kho chưa có dữ liệu spare part. Chọn một trong hai cách bắt đầu.</p>

    <section class="choice">
      <h2>Khôi phục dữ liệu cũ</h2>
      <p class="hint">Từ file sao lưu, file xuất từ trình duyệt, hoặc đọc thẳng từ Firebase của bản cũ.</p>
      <div data-restore></div>
    </section>

    <section class="choice">
      <h2>Bắt đầu với kho trống</h2>
      <p class="hint">Tạo quản trị viên đầu tiên. Danh sách kho và dây chuyền mặc định sửa được sau trong Quản lý.</p>
      <form class="form" data-fresh novalidate>
        <div class="row2">
          <label class="field"><span class="label">ID quản trị viên</span><input name="id" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span class="label">Tên hiển thị</span><input name="name" autocomplete="name"></label>
        </div>
        <button type="submit" class="btn btn-primary">Tạo dữ liệu mới</button>
      </form>
    </section>

    <button type="button" class="btn-link" data-other>Kết nối kho dữ liệu khác</button>
  </div></div>`);

  renderRestore(el.querySelector('[data-restore]'), { replacing: false });

  const form = el.querySelector('[data-fresh]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = form.id.value.trim();
    const name = form.name.value.trim();
    if (!id || !name) { toast('Nhập ID và tên quản trị viên.', 'warn'); return; }
    try {
      saveUserId(id);
      await withBusy(form.querySelector('[type=submit]'), 'Đang tạo…', () =>
        mutate('Khởi tạo dữ liệu kho', (d) => {
          if (d[M.META] || d[M.ITEMS]) throw new M.UserError('Kho vừa được thiết bị khác khởi tạo. Tải lại trang.');
          d[M.META] = M.defaultMeta({ id, name });
          d[M.ITEMS] = [];
        }, { allowUninitialized: true })
      );
      toast('Đã tạo kho dữ liệu mới.');
    } catch (err) {
      showError(err);
    }
  });

  el.querySelector('[data-other]').addEventListener('click', () => disconnect());
}
