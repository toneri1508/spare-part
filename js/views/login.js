import { html, mount } from '../html.js';
import { toast, showError, withBusy } from '../ui.js';
import * as M from '../model.js';
import { store, mutate, saveUserId } from '../store.js';

export function renderLogin(el, { onDone }) {
  const v = store.view;
  const hasAdmin = v.meta.users.some((u) => u.role === 'admin');

  mount(el, html`<div class="gate"><div class="gate-card">
    <p class="gate-brand">${v.meta.settings.title}</p>
    <h1 class="gate-title">Ai đang dùng máy này?</h1>
    <p class="hint">Nhập ID nhân viên. Thiết bị sẽ ghi nhớ, lần sau không cần nhập lại.</p>
    <form class="form" data-login novalidate>
      <label class="field"><span class="label">ID nhân viên</span>
        <input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" ${hasAdmin && 'autofocus'}></label>
      <p class="form-error" data-err hidden></p>
      <button type="submit" class="btn btn-primary btn-block btn-lg">Vào kho</button>
    </form>
    ${!hasAdmin && html`<section class="choice">
      <h2>Chưa có quản trị viên</h2>
      <p class="hint">Dữ liệu hiện chưa có ai quyền quản trị. Tạo quản trị viên để quản lý người dùng, kho và vật tư.</p>
      <form class="form" data-admin novalidate>
        <div class="row2">
          <label class="field"><span class="label">ID</span><input name="id" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span class="label">Tên hiển thị</span><input name="name"></label>
        </div>
        <button type="submit" class="btn">Tạo quản trị viên</button>
      </form>
    </section>`}
  </div></div>`);

  const loginForm = el.querySelector('[data-login]');
  const err = el.querySelector('[data-err]');
  if (hasAdmin) loginForm.id.focus();

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = loginForm.id.value.trim();
    if (!id) { err.textContent = 'Nhập ID nhân viên.'; err.hidden = false; return; }
    const user = store.view.meta.users.find((u) => u.id === id)
      || store.view.meta.users.find((u) => M.fold(u.id) === M.fold(id));
    if (!user) {
      err.textContent = `ID "${id}" chưa có trong hệ thống. Nhờ quản trị viên thêm bạn trong mục Quản lý.`;
      err.hidden = false;
      return;
    }
    saveUserId(user.id);
    onDone();
  });

  const adminForm = el.querySelector('[data-admin]');
  adminForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = adminForm.id.value.trim();
    const name = adminForm.name.value.trim();
    if (!id || !name) { toast('Nhập ID và tên.', 'warn'); return; }
    try {
      await withBusy(adminForm.querySelector('[type=submit]'), 'Đang tạo…', () =>
        mutate(`Tạo quản trị viên ${name}`, (d) => {
          const m = M.draftMeta(d);
          if (m.users.some((u) => u.role === 'admin')) throw new M.UserError('Đã có quản trị viên. Đăng nhập bằng ID được cấp.');
          const existing = m.users.find((u) => u.id === id);
          if (existing) { existing.role = 'admin'; existing.name = name; }
          else m.users.push({ id, name, role: 'admin' });
        })
      );
      saveUserId(id);
      onDone();
    } catch (x) {
      showError(x);
    }
  });
}
