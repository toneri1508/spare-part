import { html, mount } from '../html.js';
import { icon, toast, showError, withBusy, fmtNum } from '../ui.js';
import * as M from '../model.js';
import { mutate } from '../store.js';
import { analyze } from '../migrate.js';

let result = null;

export function renderRestore(box, { replacing = false, onDone } = {}) {
  const draw = () => {
    mount(box, html`
      <p class="hint">Chọn file sao lưu đã tải trước đó từ web này, hoặc file JSON dữ liệu cũ (ví dụ <code>sao-luu-trinh-duyet.json</code> xuất từ trình duyệt, hay file có sp_items, sp_meta, sp_tx).</p>
      <label class="btn file-btn">${icon('upload')}Chọn file JSON<input type="file" accept=".json,application/json" data-file></label>
      <div data-result>${result && preview(result, replacing)}</div>
    `);
  };

  box.onclick = async (e) => {
    const apply = e.target.closest('[data-apply]');
    if (apply) await doApply(apply);
  };

  box.onchange = async (e) => {
    if (!e.target.matches('[data-file]')) return;
    const file = e.target.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      result = analyze(json, `file ${file.name}`);
      draw();
    } catch (err) {
      result = null;
      showError(err instanceof SyntaxError ? new M.UserError('File này không phải JSON hợp lệ.') : err);
      draw();
    }
  };

  async function doApply(btn) {
    const agree = box.querySelector('[data-agree]');
    if (agree && !agree.checked) {
      toast('Đánh dấu ô xác nhận thay thế dữ liệu trước.', 'warn');
      agree.focus();
      return;
    }
    const files = result.files;
    const label = result.label;
    try {
      await withBusy(btn, 'Đang ghi lên GitHub…', () =>
        mutate(`Khôi phục dữ liệu từ ${label}`, (d) => {
          for (const k of Object.keys(d)) if (k.startsWith('data/')) delete d[k];
          for (const [k, v] of Object.entries(files)) d[k] = structuredClone(v);
        }, { replaceAll: true, allowUninitialized: true })
      );
      const c = result.counts;
      result = null;
      toast(`Đã khôi phục ${fmtNum(c.items)} vật tư và ${fmtNum(c.tx)} giao dịch.`);
      onDone?.();
      if (box.isConnected) draw();
    } catch (err) {
      showError(err);
    }
  }

  draw();
}

function preview(r, replacing) {
  const c = r.counts;
  const sample = (r.files[M.ITEMS] || []).slice(0, 5);
  return html`<div class="restore-preview">
    <h3 class="sub-title">Dữ liệu tìm được</h3>
    <dl class="counts">
      <div><dt>Vật tư</dt><dd>${fmtNum(c.items)}</dd></div>
      <div><dt>Giao dịch</dt><dd>${fmtNum(c.tx)}</dd></div>
      <div><dt>Người dùng</dt><dd>${fmtNum(c.users)}</dd></div>
      <div><dt>Kho</dt><dd>${fmtNum(c.warehouses)}</dd></div>
      <div><dt>Dây chuyền</dt><dd>${fmtNum(c.lines)}</dd></div>
    </dl>
    ${sample.length > 0 && html`<table class="mini-table"><thead><tr><th>Mã</th><th>Tên</th><th>Tồn</th></tr></thead><tbody>
      ${sample.map((i) => html`<tr><td>${i.code}</td><td>${i.name}</td><td>${fmtNum(M.totalQty(i))} ${i.unit}</td></tr>`)}
    </tbody></table>${c.items > sample.length && html`<p class="hint">và ${fmtNum(c.items - sample.length)} vật tư khác.</p>`}`}
    ${r.notes.map((n) => html`<p class="hint">${n}</p>`)}
    ${r.warnings.map((w) => html`<p class="notice notice-low">${w}</p>`)}
    ${replacing && html`<label class="check"><input type="checkbox" data-agree>
      <span>Thay thế toàn bộ dữ liệu hiện tại bằng dữ liệu này. Bản hiện tại vẫn còn trong lịch sử commit trên GitHub.</span></label>`}
    <button type="button" class="btn btn-primary btn-block" data-apply>Khôi phục ${fmtNum(c.items)} vật tư, ${fmtNum(c.tx)} giao dịch</button>
  </div>`;
}
