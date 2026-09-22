import { html, mount } from '../html.js';
import { icon, toast, showError, withBusy, fmtNum } from '../ui.js';
import * as M from '../model.js';
import { mutate } from '../store.js';
import { analyze, fetchFirestore, OLD_FIREBASE } from '../migrate.js';

let source = 'file';
let result = null;

export function renderRestore(box, { replacing = false, onDone } = {}) {
  const draw = () => {
    mount(box, html`
      <div class="seg seg-sm" role="tablist" aria-label="Nguồn dữ liệu">
        <button type="button" role="tab" aria-selected="${source === 'file'}" data-src="file">Từ file</button>
        <button type="button" role="tab" aria-selected="${source === 'firebase'}" data-src="firebase">Từ Firebase</button>
      </div>
      ${source === 'file'
        ? html`<div class="restore-src">
            <p class="hint">Chọn file sao lưu của web này, file <code>sao-luu-trinh-duyet.json</code> đã xuất từ trình duyệt, hoặc file JSON có sp_items, sp_meta, sp_tx.</p>
            <label class="btn file-btn">${icon('upload')}Chọn file JSON<input type="file" accept=".json,application/json" data-file></label>
          </div>`
        : html`<form class="form restore-src" data-fb novalidate>
            <div class="row2">
              <label class="field"><span class="label">Project ID</span><input name="projectId" value="${OLD_FIREBASE.projectId}" spellcheck="false"></label>
              <label class="field"><span class="label">Database</span><input name="databaseId" value="${OLD_FIREBASE.databaseId}" spellcheck="false">
                <span class="hint">Để (default), hoặc tên database đã clone.</span></label>
            </div>
            <div class="row2">
              <label class="field"><span class="label">Collection</span><input name="collection" value="${OLD_FIREBASE.collection}" spellcheck="false"></label>
              <label class="field"><span class="label">API key</span><input name="apiKey" value="${OLD_FIREBASE.apiKey}" spellcheck="false"></label>
            </div>
            <label class="field"><span class="label">Đọc dữ liệu tại thời điểm <i>không bắt buộc</i></span>
              <input type="datetime-local" name="at" step="60">
              <span class="hint">Chọn một phút trước lúc dữ liệu bị xóa, ví dụ 15:39 ngày 11/09/2026. Firestore chỉ giữ bản cũ 1 giờ, hoặc 7 ngày nếu PITR đã được bật.</span></label>
            <button type="submit" class="btn btn-primary">Đọc dữ liệu</button>
          </form>`}
      <div data-result>${result && preview(result, replacing)}</div>
    `);
  };

  box.onclick = async (e) => {
    const src = e.target.closest('[data-src]');
    if (src) { source = src.dataset.src; result = null; draw(); return; }
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

  box.onsubmit = async (e) => {
    if (!e.target.matches('[data-fb]')) return;
    e.preventDefault();
    const f = e.target;
    const at = f.at.value ? new Date(f.at.value) : null;
    if (at && Number.isNaN(at.getTime())) { toast('Thời điểm không hợp lệ.', 'warn'); return; }
    if (at) at.setSeconds(0, 0);
    try {
      await withBusy(f.querySelector('[type=submit]'), 'Đang đọc…', async () => {
        const data = await fetchFirestore({
          projectId: f.projectId.value.trim(),
          databaseId: f.databaseId.value.trim() || '(default)',
          collection: f.collection.value.trim(),
          apiKey: f.apiKey.value.trim(),
          readTime: at ? at.toISOString() : null,
        });
        result = analyze(data, `Firebase ${f.databaseId.value.trim()}${at ? ` lúc ${f.at.value.replace('T', ' ')}` : ''}`);
      });
      draw();
    } catch (err) {
      result = null;
      showError(err);
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
      ${sample.map((i) => html`<tr><td>${i.code}</td><td>${i.name}</td><td>${fmtNum(M.totalQtyIn(r.files, i))} ${i.unit}</td></tr>`)}
    </tbody></table>${c.items > sample.length && html`<p class="hint">và ${fmtNum(c.items - sample.length)} vật tư khác.</p>`}`}
    ${r.notes.map((n) => html`<p class="hint">${n}</p>`)}
    ${r.warnings.map((w) => html`<p class="notice notice-low">${w}</p>`)}
    ${replacing && html`<label class="check"><input type="checkbox" data-agree>
      <span>Thay thế toàn bộ dữ liệu hiện tại bằng dữ liệu này. Bản hiện tại vẫn còn trong lịch sử commit trên GitHub.</span></label>`}
    <button type="button" class="btn btn-primary btn-block" data-apply>Khôi phục ${fmtNum(c.items)} vật tư, ${fmtNum(c.tx)} giao dịch</button>
  </div>`;
}

