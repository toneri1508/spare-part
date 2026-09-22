import { html, raw, mount } from '../html.js';
import { icon, toast, showError, withBusy, confirmDialog, openSheet, download, fmtNum, fmtTime } from '../ui.js';
import * as M from '../model.js';
import { store, mutate, encodeConnLink, backupObject, disconnect } from '../store.js';
import { qrSvg } from '../qr.js';
import { renderRestore } from './restore.js';

const SECTIONS = [
  ['nguoi-dung', 'Người dùng'],
  ['kho', 'Kho và dây chuyền'],
  ['cai-dat', 'Cài đặt'],
  ['thiet-bi', 'Kết nối thiết bị'],
  ['sao-luu', 'Sao lưu, khôi phục'],
];

export function render(el, params) {
  const sec = SECTIONS.some(([id]) => id === params.muc) ? params.muc : 'nguoi-dung';
  mount(el, html`
    <div class="page-head"><h1>Quản lý</h1></div>
    <nav class="seg seg-scroll" aria-label="Mục quản lý">
      ${SECTIONS.map(([id, label]) => html`<a href="#/quan-ly?muc=${id}" aria-current="${id === sec ? 'page' : 'false'}">${label}</a>`)}
    </nav>
    <div data-sec></div>
  `);
  const box = el.querySelector('[data-sec]');
  ({ 'nguoi-dung': users, kho: places, 'cai-dat': settings, 'thiet-bi': devices, 'sao-luu': backup })[sec](box);
}

async function save(btn, message, fn, opts, done) {
  try {
    await withBusy(btn, 'Đang lưu…', () => mutate(message, fn, opts));
    done?.();
    return true;
  } catch (e) {
    showError(e);
    return false;
  }
}

/* ---------- người dùng ---------- */

function users(box) {
  const v = store.view;
  const list = [...v.meta.users].sort((a, b) => (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) || a.name.localeCompare(b.name, 'vi'));
  mount(box, html`
    <div class="block-head"><h2>Người dùng</h2><button type="button" class="btn btn-primary" data-add>${icon('plus')}Thêm người dùng</button></div>
    <p class="hint">Mỗi người đăng nhập bằng ID riêng để app ghi nhận ai nhập, ai xuất. Quản trị viên sửa được mọi dữ liệu.</p>
    <ul class="rows">${list.map((u) => html`<li><button type="button" class="row" data-user="${u.id}">
      <span class="row-main"><b>${u.name}</b><span class="hint">ID ${u.id}</span></span>
      ${u.role === 'admin' && html`<span class="tag tag-admin">Quản trị</span>`}
      ${u.id === store.user.id && html`<span class="tag">Bạn</span>`}
      ${icon('chevron', 'row-chev')}
    </button></li>`)}</ul>
  `);
  box.onclick = (e) => {
    if (e.target.closest('[data-add]')) return userEditor(null);
    const r = e.target.closest('[data-user]');
    if (r) userEditor(r.dataset.user);
  };
}

function userEditor(id) {
  const v = store.view;
  const u = id ? v.userById.get(id) : null;
  const self = u && u.id === store.user.id;
  const txCount = u ? v.tx.filter((t) => t.userId === u.id).length : 0;
  const s = openSheet(html`
    <form class="form" data-form novalidate>
      <label class="field"><span class="label">ID nhân viên</span>
        <input name="id" value="${u?.id || ''}" ${u ? raw('readonly') : raw('autofocus')} autocomplete="off" spellcheck="false">
        ${u && html`<span class="hint">Không đổi được ID vì lịch sử giao dịch gắn với ID này.</span>`}</label>
      <label class="field"><span class="label">Tên hiển thị</span><input name="name" value="${u?.name || ''}" ${u && raw('autofocus')}></label>
      <fieldset class="field"><legend class="label">Quyền</legend>
        <label class="check"><input type="radio" name="role" value="user" ${(!u || u.role !== 'admin') && raw('checked')}><span>Nhân viên: nhập, xuất kho, tạo vật tư và sửa mọi thông số của vật tư kể cả số tồn</span></label>
        <label class="check"><input type="radio" name="role" value="admin" ${u?.role === 'admin' && raw('checked')}><span>Quản trị viên: thêm quyền xóa vật tư, sửa lịch sử, quản lý người dùng, kho và cài đặt</span></label>
      </fieldset>
      <div class="sheet-actions">
        ${u && !self && html`<button type="button" class="btn btn-danger-ghost" data-delete>Xóa người dùng</button>`}
        <button type="submit" class="btn btn-primary">${u ? 'Lưu' : 'Thêm người dùng'}</button>
      </div>
    </form>
  `, { title: u ? 'Sửa người dùng' : 'Người dùng mới' });
  const f = s.body.querySelector('form');

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const nid = f.id.value.trim();
    const name = f.name.value.trim();
    const role = f.role.value;
    if (!nid || !name) { toast('Nhập đủ ID và tên.', 'warn'); return; }
    save(f.querySelector('[type=submit]'), u ? `Sửa người dùng ${name}` : `Thêm người dùng ${name}`, (d) => {
      const m = M.draftMeta(d);
      if (!u) {
        if (m.users.some((x) => x.id === nid)) throw new M.UserError(`ID ${nid} đã có người dùng.`);
        m.users.push({ id: nid, name, role });
        return;
      }
      const x = m.users.find((y) => y.id === u.id);
      if (!x) throw new M.UserError('Người dùng này vừa bị xóa.');
      if (x.role === 'admin' && role !== 'admin' && m.users.filter((y) => y.role === 'admin').length <= 1) {
        throw new M.UserError('Cần giữ ít nhất một quản trị viên.');
      }
      x.name = name;
      x.role = role;
    }, {}, () => { s.close(); toast('Đã lưu người dùng.'); });
  });

  s.body.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const r = await confirmDialog({
      title: 'Xóa người dùng?',
      message: `${u.name} sẽ không đăng nhập được nữa.${txCount ? ` ${txCount} giao dịch cũ vẫn giữ nhưng hiện ID thay cho tên.` : ''}`,
      confirmText: 'Xóa', danger: true,
    });
    if (!r.ok) return;
    save(null, `Xóa người dùng ${u.name}`, (d) => {
      const m = M.draftMeta(d);
      if (u.role === 'admin' && m.users.filter((y) => y.role === 'admin').length <= 1) throw new M.UserError('Cần giữ ít nhất một quản trị viên.');
      m.users = m.users.filter((y) => y.id !== u.id);
    }, { allowRemove: { users: 1 } }, () => { s.close(); toast('Đã xóa người dùng.'); });
  });
}

/* ---------- kho và dây chuyền ---------- */

function places(box) {
  const v = store.view;
  const stockIn = (whId) => v.items.filter((i) => M.num(i.stocks?.[whId]) !== 0).length;
  mount(box, html`
    <div class="block-head"><h2>Kho</h2><button type="button" class="btn btn-primary" data-add-wh>${icon('plus')}Thêm kho</button></div>
    <ul class="rows">${v.meta.warehouses.map((w) => html`<li><button type="button" class="row" data-wh="${w.id}">
      <span class="row-main"><b>${w.name}</b><span class="hint">${w.type === 'sub' ? `Kho phụ của ${M.lineName(v, w.lineId)}` : 'Kho chính'}, ${fmtNum(stockIn(w.id))} mã đang có tồn</span></span>
      ${icon('chevron', 'row-chev')}
    </button></li>`)}</ul>

    <div class="block-head"><h2>Dây chuyền</h2><button type="button" class="btn btn-primary" data-add-line>${icon('plus')}Thêm dây chuyền</button></div>
    <ul class="rows">${v.meta.lines.map((l) => html`<li><button type="button" class="row" data-line="${l.id}">
      <span class="row-main"><b>${l.name}</b><span class="hint">${v.meta.warehouses.filter((w) => w.lineId === l.id).map((w) => w.name).join(', ') || 'Chưa có kho phụ'}</span></span>
      ${icon('chevron', 'row-chev')}
    </button></li>`)}</ul>
  `);
  box.onclick = (e) => {
    if (e.target.closest('[data-add-wh]')) return whEditor(null);
    if (e.target.closest('[data-add-line]')) return lineEditor(null);
    const w = e.target.closest('[data-wh]');
    if (w) return whEditor(w.dataset.wh);
    const l = e.target.closest('[data-line]');
    if (l) lineEditor(l.dataset.line);
  };
}

function whEditor(id) {
  const v = store.view;
  const w = id ? v.whById.get(id) : null;
  const s = openSheet(html`
    <form class="form" data-form novalidate>
      <label class="field"><span class="label">Tên kho</span><input name="name" value="${w?.name || ''}" autofocus></label>
      <div class="row2">
        <label class="field"><span class="label">Loại kho</span>
          <select name="type"><option value="main" ${w?.type !== 'sub' && raw('selected')}>Kho chính</option><option value="sub" ${w?.type === 'sub' && raw('selected')}>Kho phụ của dây chuyền</option></select></label>
        <label class="field" data-line-field><span class="label">Dây chuyền</span>
          <select name="line">${v.meta.lines.map((l) => html`<option value="${l.id}" ${l.id === w?.lineId && raw('selected')}>${l.name}</option>`)}</select></label>
      </div>
      <div class="sheet-actions">
        ${w && html`<button type="button" class="btn btn-danger-ghost" data-delete>Xóa kho</button>`}
        <button type="submit" class="btn btn-primary">${w ? 'Lưu' : 'Thêm kho'}</button>
      </div>
    </form>
  `, { title: w ? 'Sửa kho' : 'Kho mới' });
  const f = s.body.querySelector('form');
  const lineField = f.querySelector('[data-line-field]');
  const syncLine = () => { lineField.hidden = f.type.value !== 'sub'; };
  f.type.addEventListener('change', syncLine);
  syncLine();

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    const type = f.type.value;
    const lineId = type === 'sub' ? f.line.value : undefined;
    if (!name) { toast('Nhập tên kho.', 'warn'); return; }
    if (type === 'sub' && !lineId) { toast('Kho phụ cần chọn dây chuyền. Thêm dây chuyền trước.', 'warn'); return; }
    save(f.querySelector('[type=submit]'), w ? `Sửa kho ${name}` : `Thêm kho ${name}`, (d) => {
      const m = M.draftMeta(d);
      const data = { name, type, ...(lineId ? { lineId } : {}) };
      if (!w) { m.warehouses.push({ id: M.uid('wh'), ...data }); return; }
      const i = m.warehouses.findIndex((x) => x.id === w.id);
      if (i < 0) throw new M.UserError('Kho này vừa bị xóa.');
      m.warehouses[i] = { id: w.id, ...data };
    }, {}, () => { s.close(); toast('Đã lưu kho.'); });
  });

  s.body.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const holding = v.items.filter((i) => M.num(i.stocks?.[w.id]) !== 0);
    if (holding.length) {
      toast(`Kho còn tồn ${holding.length} mã vật tư. Chuyển hoặc điều chỉnh tồn về 0 trước khi xóa.`, 'warn');
      return;
    }
    const r = await confirmDialog({ title: 'Xóa kho?', message: `Xóa ${w.name}? Lịch sử giao dịch cũ vẫn giữ.`, confirmText: 'Xóa kho', danger: true });
    if (!r.ok) return;
    save(null, `Xóa kho ${w.name}`, (d) => {
      const m = M.draftMeta(d);
      if (M.draftItems(d).some((i) => M.stockOf(d, i.id, w.id) !== 0)) throw new M.UserError('Kho vừa có tồn kho mới, chưa xóa được.');
      m.warehouses = m.warehouses.filter((x) => x.id !== w.id);
      for (const it of M.draftItems(d)) M.setStock(d, it.id, w.id, 0);
    }, { allowRemove: { warehouses: 1 } }, () => { s.close(); toast('Đã xóa kho.'); });
  });
}

function lineEditor(id) {
  const v = store.view;
  const l = id ? v.lineById.get(id) : null;
  const s = openSheet(html`
    <form class="form" data-form novalidate>
      <label class="field"><span class="label">Tên dây chuyền</span><input name="name" value="${l?.name || ''}" autofocus></label>
      <div class="sheet-actions">
        ${l && html`<button type="button" class="btn btn-danger-ghost" data-delete>Xóa dây chuyền</button>`}
        <button type="submit" class="btn btn-primary">${l ? 'Lưu' : 'Thêm dây chuyền'}</button>
      </div>
    </form>
  `, { title: l ? 'Sửa dây chuyền' : 'Dây chuyền mới' });
  const f = s.body.querySelector('form');

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) { toast('Nhập tên dây chuyền.', 'warn'); return; }
    save(f.querySelector('[type=submit]'), l ? `Sửa dây chuyền ${name}` : `Thêm dây chuyền ${name}`, (d) => {
      const m = M.draftMeta(d);
      if (!l) { m.lines.push({ id: M.uid('ln'), name }); return; }
      const x = m.lines.find((y) => y.id === l.id);
      if (!x) throw new M.UserError('Dây chuyền này vừa bị xóa.');
      x.name = name;
    }, {}, () => { s.close(); toast('Đã lưu dây chuyền.'); });
  });

  s.body.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const linked = v.meta.warehouses.filter((w) => w.lineId === l.id);
    if (linked.length) {
      toast(`Dây chuyền đang gắn với ${linked.map((w) => w.name).join(', ')}. Đổi hoặc xóa kho phụ đó trước.`, 'warn');
      return;
    }
    const r = await confirmDialog({ title: 'Xóa dây chuyền?', message: `Xóa ${l.name}? Lịch sử giao dịch cũ vẫn giữ.`, confirmText: 'Xóa', danger: true });
    if (!r.ok) return;
    save(null, `Xóa dây chuyền ${l.name}`, (d) => {
      const m = M.draftMeta(d);
      if (m.warehouses.some((w) => w.lineId === l.id)) throw new M.UserError('Dây chuyền vừa được gắn với một kho phụ.');
      m.lines = m.lines.filter((x) => x.id !== l.id);
    }, { allowRemove: { lines: 1 } }, () => { s.close(); toast('Đã xóa dây chuyền.'); });
  });
}

/* ---------- cài đặt ---------- */

function settings(box) {
  const st = store.view.meta.settings;
  mount(box, html`
    <form class="form panel" data-form novalidate>
      <h2 class="sub-title">Tên hiển thị</h2>
      <div class="row2">
        <label class="field"><span class="label">Tên web</span><input name="title" value="${st.title}"></label>
        <label class="field"><span class="label">Dòng phụ</span><input name="subtitle" value="${st.subtitle}"></label>
      </div>
      <div class="btn-row"><button type="submit" class="btn btn-primary">Lưu cài đặt</button></div>
    </form>
    <section class="panel">
      <h2 class="sub-title">Quyền</h2>
      <p class="hint">Quyền cố định theo vai trò, đổi vai trò từng người ở mục Người dùng.</p>
      <dl class="kv">
        <div><dt>Nhân viên</dt><dd>Nhập kho, xuất kho, quét QR, nhập Excel, tạo vật tư, sửa mọi thông số của vật tư kể cả số tồn từng kho.</dd></div>
        <div><dt>Quản trị viên</dt><dd>Mọi quyền của nhân viên, thêm xóa vật tư, sửa và xóa giao dịch, quản lý người dùng, kho, dây chuyền, cài đặt và sao lưu.</dd></div>
      </dl>
    </section>
  `);
  const f = box.querySelector('form');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = { title: f.title.value.trim() || M.DEFAULT_SETTINGS.title, subtitle: f.subtitle.value.trim() };
    save(f.querySelector('[type=submit]'), 'Sửa cài đặt', (d) => {
      const m = M.draftMeta(d);
      m.settings = { ...m.settings, ...next };
    }, {}, () => toast('Đã lưu cài đặt.'));
  });
}

/* ---------- kết nối thiết bị ---------- */

function devices(box) {
  const c = store.conn;
  const link = `${location.origin}${location.pathname}#ket-noi=${encodeConnLink(c)}`;
  mount(box, html`
    <section class="panel">
      <h2 class="sub-title">Thiết bị này</h2>
      <dl class="kv">
        <div><dt>Kho dữ liệu</dt><dd>${c.owner}/${c.repo}</dd></div>
        <div><dt>Nhánh</dt><dd>${c.branch}</dd></div>
        <div><dt>Khóa truy cập</dt><dd>kết thúc bằng ${c.token.slice(-4)}</dd></div>
        <div><dt>Phiên bản dữ liệu</dt><dd>${(store.head || '').slice(0, 7)}, đồng bộ lúc ${fmtTime(store.syncedAt)}</dd></div>
      </dl>
      <div class="btn-row">
        <a class="btn" href="${store.gh.commitsUrl}" target="_blank" rel="noopener">${icon('clock')}Lịch sử thay đổi trên GitHub</a>
        <button type="button" class="btn btn-danger-ghost" data-disconnect>Ngắt kết nối thiết bị này</button>
      </div>
    </section>

    <section class="panel">
      <h2 class="sub-title">Kết nối thêm thiết bị</h2>
      <p>Mở link hoặc quét mã QR này trên điện thoại, máy tính khác là kết nối xong, không cần nhập khóa.</p>
      <p class="notice notice-low">Link chứa khóa truy cập kho dữ liệu. Chỉ gửi cho người trong nhóm. Nếu lỡ lộ, vào GitHub xóa khóa cũ, tạo khóa mới rồi kết nối lại các máy.</p>
      <button type="button" class="btn btn-primary" data-show>${icon('link')}Hiện link kết nối</button>
      <div class="connect-box" data-box hidden>
        <div class="qr-img qr-link">${raw(qrSvg(link, { level: 'L' }))}</div>
        <label class="field"><span class="label">Link kết nối</span><input readonly value="${link}" data-link></label>
        <button type="button" class="btn" data-copy>Sao chép link</button>
      </div>
    </section>
  `);

  box.onclick = async (e) => {
    if (e.target.closest('[data-show]')) {
      box.querySelector('[data-box]').hidden = false;
      e.target.closest('[data-show]').hidden = true;
    }
    if (e.target.closest('[data-copy]')) {
      const input = box.querySelector('[data-link]');
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand('copy');
      }
      toast('Đã sao chép link kết nối.');
    }
    if (e.target.closest('[data-disconnect]')) {
      const r = await confirmDialog({
        title: 'Ngắt kết nối thiết bị này?',
        message: 'Máy này sẽ quên khóa truy cập và người đang đăng nhập. Dữ liệu trên GitHub không bị ảnh hưởng.',
        confirmText: 'Ngắt kết nối', danger: true,
      });
      if (r.ok) disconnect();
    }
  };
}

/* ---------- sao lưu, khôi phục ---------- */

function backup(box) {
  const c = M.countDocs(store.docs);
  mount(box, html`
    <section class="panel">
      <h2 class="sub-title">Sao lưu</h2>
      <p>Mọi thay đổi đã được GitHub giữ thành lịch sử, có thể quay lại bất kỳ lúc nào. Tải thêm một bản về máy để cất riêng.</p>
      <p class="hint">Hiện có ${fmtNum(c.items)} vật tư, ${fmtNum(c.tx)} giao dịch, ${fmtNum(c.users)} người dùng.</p>
      <button type="button" class="btn btn-primary" data-backup>${icon('download')}Tải bản sao lưu</button>
    </section>
    <section class="panel">
      <h2 class="sub-title">Khôi phục hoặc nhập dữ liệu cũ</h2>
      <div data-restore></div>
    </section>
  `);
  box.querySelector('[data-backup]').addEventListener('click', () => {
    download(`sao-luu-kho-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backupObject()));
    toast('Đã tải bản sao lưu.');
  });
  renderRestore(box.querySelector('[data-restore]'), { replacing: true });
}
