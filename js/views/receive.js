import { html, raw, mount } from '../html.js';
import { icon, toast, showError, withBusy, fmtNum, rerender } from '../ui.js';
import * as M from '../model.js';
import { store, mutate, pref, setPref } from '../store.js';
import { itemPicker, bindPicker, stepper, bindSteppers, readQty, openItemEditor } from '../components.js';
import { downloadTemplate, readImportFile, validateRow, applyImport } from '../excel.js';

const form = { sub: 'quick', code: '', whId: null, qty: 1, note: '' };
let importRows = null;
let importName = '';

export function render(el, params) {
  if (params.ma || params.muc) {
    if (params.ma) { form.code = params.ma; form.sub = 'quick'; }
    if (params.muc === 'excel') form.sub = 'excel';
    history.replaceState(null, '', '#/nhap-kho');
  }

  mount(el, html`
    <div class="page-head"><h1>Nhập kho</h1></div>
    <div class="seg" role="tablist" aria-label="Cách nhập">
      <button type="button" role="tab" aria-selected="${form.sub === 'quick'}" data-sub="quick">Nhập nhanh</button>
      <button type="button" role="tab" aria-selected="${form.sub === 'excel'}" data-sub="excel">Nhập từ Excel</button>
    </div>
    <div data-body></div>
  `);

  el.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sub]');
    if (!b || b.dataset.sub === form.sub) return;
    form.sub = b.dataset.sub;
    rerender();
  });

  const body = el.querySelector('[data-body]');
  if (form.sub === 'quick') renderQuick(body);
  else renderExcel(body);
}

/* ---------- nhập nhanh ---------- */

function renderQuick(box) {
  const v = store.view;
  if (!v.meta.warehouses.length) {
    mount(box, html`<p class="notice">Chưa có kho nào. Quản trị viên cần thêm kho trong mục Quản lý.</p>`);
    return;
  }
  if (!form.whId || !v.whById.has(form.whId)) {
    const last = pref('inWh');
    form.whId = last && v.whById.has(last) ? last : v.meta.warehouses[0].id;
  }

  mount(box, html`
    <form class="form panel" data-form novalidate>
      <div class="field"><span class="label">Vật tư</span>${itemPicker({ value: form.code, placeholder: 'Quét hoặc gõ mã, tên vật tư' })}</div>
      <div data-match aria-live="polite"></div>
      <label class="field"><span class="label">Kho nhập vào</span>
        <select name="wh">${v.meta.warehouses.map((w) => html`<option value="${w.id}" ${w.id === form.whId && raw('selected')}>${w.name}</option>`)}</select></label>
      <div class="row2">
        <div class="field"><span class="label">Số lượng</span>${stepper('qty', form.qty)}</div>
        <label class="field"><span class="label">Ghi chú <i>không bắt buộc</i></span><input name="note" value="${form.note}" maxlength="300" placeholder="Hàng về đợt mới"></label>
      </div>
      <p class="who-line">Người nhập: <b>${store.user.name}</b></p>
      <button type="submit" class="btn btn-primary btn-block btn-lg">${icon('in')}Nhập kho</button>
    </form>
  `);

  const f = box.querySelector('[data-form]');
  const match = box.querySelector('[data-match]');
  bindSteppers(f);

  const drawMatch = () => {
    const it = M.findByCode(store.view.items, form.code);
    if (!form.code) mount(match, '');
    else if (it) {
      const here = M.num(it.stocks?.[form.whId]);
      mount(match, html`<div class="match match-hit st-${M.statusOf(it)}">
        <span class="ir-code">${it.code}</span><span class="match-name">${it.name}</span>
        <span class="hint">Tổng tồn ${fmtNum(M.totalQty(it))} ${it.unit}, kho đang chọn ${fmtNum(here)}</span>
      </div>`);
    } else {
      mount(match, html`<div class="match match-miss">
        <span>Chưa có vật tư mã <b>${M.normCode(form.code)}</b>.</span>
        <button type="button" class="btn btn-sm" data-create>${icon('plus')}Tạo vật tư mới</button>
      </div>`);
    }
  };

  const picker = bindPicker(box, {
    onType: (q) => { form.code = q; drawMatch(); },
    onPick: (it, input) => {
      form.code = it.code;
      input.value = it.code;
      drawMatch();
      f.qty.focus();
      f.qty.select();
    },
    onScan: (code, it) => {
      form.code = it ? it.code : M.normCode(code);
      picker.input.value = form.code;
      picker.redraw();
      box.querySelector('[data-suggest]').innerHTML = '';
      if (it) f.qty.focus();
    },
  });

  f.addEventListener('input', (e) => {
    if (e.target.name === 'qty') form.qty = e.target.value;
    if (e.target.name === 'note') form.note = e.target.value;
    if (e.target.name === 'wh') { form.whId = e.target.value; drawMatch(); }
  });
  f.addEventListener('change', (e) => {
    if (e.target.name === 'wh') { form.whId = e.target.value; drawMatch(); }
  });

  match.addEventListener('click', (e) => {
    if (e.target.closest('[data-create]')) openItemEditor(null, { code: form.code });
  });

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]');
    if (btn.disabled) return; // chặn bấm hai lần
    const it = M.findByCode(store.view.items, form.code);
    if (!it) { toast('Chọn vật tư có sẵn, hoặc tạo vật tư mới trước.', 'warn'); picker.input.focus(); return; }
    const qty = readQty(f.qty);
    if (!qty) { toast('Số lượng phải là số nguyên lớn hơn 0.', 'warn'); f.qty.focus(); return; }
    const whId = f.wh.value;
    const note = f.note.value.trim();
    btn.disabled = true;

    /* Ghi lên GitHub mất vài giây — người đứng ở kho quét liên tục nhiều mã không nên
       phải đợi từng lượt. Báo đã nhập và sẵn sàng cho mã tiếp theo ngay, còn lưu thật
       sự chạy ngầm phía sau (store chỉ thật sự đổi khi mutate() xong, nên không có gì
       ghi đè hai lần). Nếu lưu ngầm lỗi thì báo rõ để nhập lại đúng mã đó. */
    const estNow = M.num(it.stocks?.[whId]) + qty;
    setPref('inWh', whId);
    toast(`Đã nhập ${qty} ${it.unit} ${it.code} vào ${M.whName(store.view, whId)}. Kho này dự kiến có ${estNow}.`);
    Object.assign(form, { code: '', qty: 1, note: '', whId });
    rerender();
    requestAnimationFrame(() => document.querySelector('#view [data-picker-input]')?.focus());

    mutate(`Nhập ${qty} ${it.unit} ${it.code}`, (d) => {
      const x = M.requireItem(d, it.id);
      M.addStock(x, whId, qty);
      M.pushTx(d, { id: M.uid('tx'), ts: Date.now(), type: 'nhap', itemId: it.id, qty, whId, lineId: null, userId: store.user.id, note });
      return M.num(x.stocks[whId]);
    }).catch((err) => {
      showError(new M.UserError(`Không lưu được lượt nhập ${qty} ${it.unit} ${it.code}: ${err?.message || 'có lỗi.'} Vui lòng nhập lại.`));
    });
  });

  drawMatch();
}

/* ---------- nhập từ Excel ---------- */

function renderExcel(box) {
  const v = store.view;
  let rows = null;
  let counts = null;
  if (importRows) {
    rows = importRows.map((r) => ({ ...r, ...validateRow(r, v.items, v.meta) }));
    counts = { ok: rows.filter((r) => r.status === 'ok').length, warn: rows.filter((r) => r.status === 'warn').length, err: rows.filter((r) => r.status === 'err').length };
  }

  mount(box, html`
    <section class="panel">
      <h2 class="sub-title">Nhập hàng loạt</h2>
      <p class="hint">Tải file mẫu, điền rồi chọn file để xem trước. Chưa có gì được lưu cho tới khi bạn bấm xác nhận.</p>
      <div class="btn-row">
        <button type="button" class="btn" data-template>${icon('download')}Tải file mẫu</button>
        <label class="btn btn-primary file-btn">${icon('upload')}Chọn file Excel<input type="file" accept=".xlsx,.xls,.csv" data-file></label>
      </div>
      ${rows && html`
        <div class="import-preview">
          <p class="import-file">${importName}</p>
          <div class="chips">
            <span class="chip chip-ok">${counts.ok + counts.warn} dòng sẽ được nhập</span>
            ${counts.warn > 0 && html`<span class="chip chip-low">${counts.warn} dòng có lưu ý</span>`}
            ${counts.err > 0 && html`<span class="chip chip-out">${counts.err} dòng lỗi, sẽ bỏ qua</span>`}
          </div>
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Mã</th><th>Tên</th><th>Kho</th><th class="num">SL</th><th>Kết quả</th></tr></thead>
            <tbody>${rows.map((r) => html`<tr class="row-${r.status}">
              <td>${r.code}</td><td>${r.name}</td><td>${r.wh}</td><td class="num">${r.qty}</td><td>${r.reason}</td>
            </tr>`)}</tbody>
          </table></div>
          <div class="btn-row">
            <button type="button" class="btn" data-cancel>Bỏ file này</button>
            <button type="button" class="btn btn-primary" data-commit ${counts.ok + counts.warn === 0 && raw('disabled')}>Xác nhận nhập ${counts.ok + counts.warn} dòng</button>
          </div>
        </div>`}
    </section>
  `);

  box.addEventListener('click', async (e) => {
    const tpl = e.target.closest('[data-template]');
    if (tpl) {
      try { await withBusy(tpl, 'Đang tạo file…', () => downloadTemplate(store.view)); } catch (x) { showError(x); }
      return;
    }
    if (e.target.closest('[data-cancel]')) { importRows = null; rerender(); return; }
    const commit = e.target.closest('[data-commit]');
    if (commit) {
      const list = importRows;
      try {
        const res = await withBusy(commit, 'Đang lưu…', () =>
          mutate(`Nhập kho từ Excel: ${importName}`, (d) => applyImport(d, list, store.user))
        );
        importRows = null;
        toast(`Đã nhập: ${res.created} vật tư mới, ${res.updated} cập nhật, ${res.moves} lượt nhập kho.`);
        rerender();
      } catch (x) {
        showError(x);
      }
    }
  });

  box.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-file]')) return;
    const file = e.target.files[0];
    if (!file) return;
    try {
      importRows = await readImportFile(file);
      importName = file.name;
      if (!importRows.length) {
        importRows = null;
        toast('File không có dòng dữ liệu nào. Kiểm tra cột "Mã spare part".', 'warn');
      }
      rerender();
    } catch (x) {
      showError(x.name === 'UserError' || x.message ? x : new M.UserError('Không đọc được file này.'));
    }
  });
}

