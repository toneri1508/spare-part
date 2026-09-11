import { html, raw, mount } from './html.js';
import { icon, fmtNum, fmtTime, timeAgo, toast, showError, openSheet, confirmDialog, withBusy, go } from './ui.js';
import * as M from './model.js';
import { store, mutate, isAdmin, canEditItems, pref, setPref, setItemPhoto, removeItemPhoto, photoPath } from './store.js';
import { startScanner } from './scanner.js';
import { qrSvg } from './qr.js';
import { compressAvatar } from './photo.js';
import { avatarSpan, bindAvatars, loadAvatarNow } from './avatar.js';

/* ---------- thước tồn kho: vạch là mức tối thiểu ---------- */

export function gauge(item) {
  const t = M.totalQty(item);
  const min = M.num(item.min);
  const scale = Math.max(min * 2, t, 1);
  const fill = Math.max(0, Math.min(100, (t / scale) * 100));
  const mark = min > 0 ? (min / scale) * 100 : null;
  return html`<span class="gauge" aria-hidden="true"><span class="gauge-fill" style="width:${fill.toFixed(1)}%"></span>${
    mark != null && html`<span class="gauge-min" style="left:${mark.toFixed(1)}%"></span>`
  }</span>`;
}

export function itemRow(item) {
  const st = M.statusOf(item);
  return html`<li><button type="button" class="item-row st-${st}" data-item="${item.id}">
    ${avatarSpan(item, 'sm')}
    <span class="ir-code">${item.code}</span>
    <span class="ir-name">${item.name}</span>
    <span class="ir-qty"><b>${fmtNum(M.totalQty(item))}</b> ${item.unit}</span>
    ${gauge(item)}
    <span class="ir-foot"><span class="st-text">${M.STATUS_LABEL[st]}</span><span>tối thiểu ${fmtNum(item.min)}</span></span>
  </button></li>`;
}

/* ---------- ô tìm vật tư + quét QR ---------- */

export function itemPicker({ value = '', placeholder, big = false }) {
  return html`<div class="picker${big ? ' picker-big' : ''}" data-picker>
    <div class="searchbar">
      ${icon('search')}
      <input type="search" data-picker-input value="${value}" placeholder="${placeholder}" aria-label="${placeholder}"
        autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
      <button type="button" class="btn btn-scan" data-picker-scan>${icon('scan')}<span>Quét QR</span></button>
    </div>
    <div class="scanner" data-scanner hidden>
      <video playsinline muted></video>
      <div class="scanner-bar"><span>Đưa mã QR trên tem vào khung hình</span><button type="button" class="btn btn-sm" data-scan-stop>Tắt camera</button></div>
    </div>
    <ul class="suggest" data-suggest></ul>
  </div>`;
}

export function bindPicker(root, { onPick, onType, onScan, limit = 8 }) {
  const box = root.querySelector('[data-picker]');
  const input = box.querySelector('[data-picker-input]');
  const list = box.querySelector('[data-suggest]');
  const scanBox = box.querySelector('[data-scanner]');
  const scanBtn = box.querySelector('[data-picker-scan]');
  let scanner = null;

  const draw = () => {
    const q = input.value.trim();
    onType?.(q);
    if (!q) { list.innerHTML = ''; return; }
    const v = store.view;
    const exact = M.findByCode(v.items, q);
    const matches = v.items
      .filter((i) => M.matchesItem(i, q))
      .sort((a, b) => (b === exact) - (a === exact) || a.code.localeCompare(b.code))
      .slice(0, limit);
    if (!matches.length) {
      mount(list, html`<li class="suggest-empty">Không có vật tư khớp “${q}”.</li>`);
      return;
    }
    mount(list, matches.map((i) => html`<li><button type="button" class="suggest-item st-${M.statusOf(i)}" data-pick="${i.id}">
      ${avatarSpan(i, 'sm')}
      <span class="si-code">${i.code}</span><span class="si-name">${i.name}</span><span class="si-qty">${fmtNum(M.totalQty(i))} ${i.unit}</span>
    </button></li>`));
    bindAvatars(list);
  };

  const pick = (item) => {
    if (!item) return;
    list.innerHTML = '';
    onPick(item, input);
  };

  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const exact = M.findByCode(store.view.items, input.value);
    const first = list.querySelector('[data-pick]');
    pick(exact || (first && store.view.itemById.get(first.dataset.pick)));
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (b) pick(store.view.itemById.get(b.dataset.pick));
  });

  scanBtn.addEventListener('click', async () => {
    if (scanner) { scanner.stop(); return; }
    try {
      scanBtn.classList.add('on');
      scanner = await startScanner(scanBox, (code) => {
        const item = M.findByCode(store.view.items, code);
        if (onScan) onScan(code, item);
        else if (item) pick(item);
        else {
          input.value = code;
          draw();
          toast(`Chưa có vật tư mã ${M.normCode(code)}.`, 'warn');
        }
      });
    } catch (e) {
      scanBtn.classList.remove('on');
      showError(e);
    }
  });
  scanBox.addEventListener('scanner-stop', () => {
    scanner = null;
    scanBtn.classList.remove('on');
  });
  scanBox.querySelector('[data-scan-stop]').addEventListener('click', () => scanner?.stop());

  draw();
  return { input, redraw: draw };
}

/* ---------- ô số lượng ---------- */

export function stepper(name, value = 1, min = 1) {
  return html`<div class="stepper">
    <button type="button" class="step" data-step="-1" aria-label="Giảm">${icon('minus')}</button>
    <input name="${name}" type="number" inputmode="numeric" min="${min}" step="1" value="${value}" aria-label="Số lượng">
    <button type="button" class="step" data-step="1" aria-label="Tăng">${icon('plus')}</button>
  </div>`;
}

export function bindSteppers(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const input = b.parentElement.querySelector('input');
    const min = Number(input.min) || 0;
    input.value = Math.max(min, (parseInt(input.value, 10) || 0) + Number(b.dataset.step));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function readQty(input) {
  const n = Number(input.value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/* ---------- xem vật tư ---------- */

function itemHead(item) {
  const st = M.statusOf(item);
  return html`<div class="item-head st-${st}">
    <p class="ih-code">${item.code}</p>
    <p class="ih-name">${item.name}</p>
    <p class="ih-group">${item.group || 'Chưa phân nhóm'}</p>
  </div>`;
}

function txMini(v, t, item) {
  return html`<li class="tx-mini tx-${t.type}">
    <b class="tm-qty">${t.type === 'xuat' ? '−' : '+'}${fmtNum(t.qty)} ${item.unit}</b>
    <span class="tm-place">${M.whName(v, t.whId)}${t.lineId && html` → ${M.lineName(v, t.lineId)}`}</span>
    <span class="tm-who">${M.userName(v, t.userId, t.rawUser)}, ${timeAgo(t.ts)}</span>
    ${t.note && html`<span class="tm-note">${t.note}</span>`}
  </li>`;
}

export function openItemSheet(itemId) {
  const v = store.view;
  const item = v.itemById.get(itemId);
  if (!item) return;
  const st = M.statusOf(item);
  const t = M.totalQty(item);
  const stocks = Object.entries(item.stocks || {}).filter(([, q]) => M.num(q) !== 0);
  const recent = (v.txByItem.get(item.id) || []).slice(0, 6);

  const s = openSheet(html`
    <div class="item-head-row">${avatarSpan(item, 'lg')}${itemHead(item)}</div>
    <div class="stock-big st-${st}">
      <span class="sb-num">${fmtNum(t)}</span><span class="sb-unit">${item.unit}</span>
      <span class="st-pill">${M.STATUS_LABEL[st]}</span>
    </div>
    ${gauge(item)}
    <p class="hint">Tồn tối thiểu ${fmtNum(item.min)} ${item.unit}</p>
    ${item.detail && html`<p class="detail-text">${item.detail}</p>`}
    <div class="action-grid">
      <button type="button" class="btn btn-primary" data-act="out">${icon('out')}Xuất kho</button>
      <button type="button" class="btn" data-act="in">${icon('in')}Nhập kho</button>
      <button type="button" class="btn" data-act="qr">${icon('qr')}Tem QR</button>
      ${canEditItems() && html`<button type="button" class="btn" data-act="edit">${icon('edit')}Sửa</button>`}
    </div>
    <h3 class="sub-title">Tồn theo kho</h3>
    ${stocks.length
      ? html`<dl class="kv">${stocks.map(([wh, q]) => html`<div><dt>${M.whName(v, wh)}</dt><dd>${fmtNum(q)} ${item.unit}</dd></div>`)}</dl>`
      : html`<p class="hint">Không còn ở kho nào.</p>`}
    <h3 class="sub-title">Giao dịch gần đây</h3>
    ${recent.length ? html`<ul class="tx-mini-list">${recent.map((x) => txMini(v, x, item))}</ul>` : html`<p class="hint">Chưa có giao dịch.</p>`}
  `, { title: 'Vật tư' });
  bindAvatars(s.body);

  s.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'out') { s.close(); openCheckout(item.id); }
    if (act === 'in') { s.close(); go('nhap-kho', { ma: item.code }); }
    if (act === 'qr') openQrSheet(item);
    if (act === 'edit') { s.close(); openItemEditor(item.id); }
  });
}

/* ---------- xuất kho ---------- */

export function openCheckout(itemId) {
  const v = store.view;
  const item = v.itemById.get(itemId);
  if (!item) return;
  const withStock = v.meta.warehouses.filter((w) => M.num(item.stocks?.[w.id]) > 0);

  if (!withStock.length) {
    const last = (v.txByItem.get(item.id) || []).find((x) => x.type === 'xuat');
    openSheet(html`
      ${itemHead(item)}
      <div class="notice notice-out"><b>Hết hàng.</b> Tổng tồn hiện tại là ${fmtNum(M.totalQty(item))} ${item.unit}.</div>
      <h3 class="sub-title">Lần xuất gần nhất</h3>
      ${last
        ? html`<p>${M.userName(v, last.userId, last.rawUser)} xuất ${fmtNum(last.qty)} ${item.unit} từ ${M.whName(v, last.whId)}${last.lineId && html` cho ${M.lineName(v, last.lineId)}`}, lúc ${fmtTime(last.ts)}.</p>`
        : html`<p class="hint">Chưa từng xuất vật tư này.</p>`}
      <div class="sheet-actions"><button type="button" class="btn" data-close>Đóng</button></div>
    `, { title: 'Xuất kho' });
    return;
  }

  const lastWh = pref('outWh');
  const defWh = withStock.find((w) => w.id === lastWh)
    || withStock.reduce((a, b) => (M.num(item.stocks[b.id]) > M.num(item.stocks[a.id]) ? b : a));
  const lineFor = (w) => (w.type === 'sub' && w.lineId && v.lineById.has(w.lineId) ? w.lineId : pref('outLine') || '');

  const s = openSheet(html`
    ${itemHead(item)}
    <form class="form" data-form novalidate>
      <label class="field"><span class="label">Lấy từ kho</span>
        <select name="wh">${withStock.map((w) => html`<option value="${w.id}" ${w.id === defWh.id && raw('selected')}>${w.name} (còn ${fmtNum(item.stocks[w.id])} ${item.unit})</option>`)}</select>
      </label>
      <label class="field"><span class="label">Dây chuyền nhận</span>
        <select name="line"><option value="">Không ghi dây chuyền</option>${v.meta.lines.map((l) => html`<option value="${l.id}">${l.name}</option>`)}</select>
      </label>
      <div class="row2">
        <div class="field"><span class="label">Số lượng</span>${stepper('qty', 1)}</div>
        <label class="field"><span class="label">Lý do <i>không bắt buộc</i></span><input name="note" maxlength="300" placeholder="Thay thế hỏng định kỳ"></label>
      </div>
      <p class="who-line">Người xuất: <b>${store.user.name}</b></p>
      <button type="submit" class="btn btn-primary btn-block btn-lg">${icon('out')}Xuất kho</button>
    </form>
  `, { title: 'Xuất kho' });

  const form = s.body.querySelector('[data-form]');
  bindSteppers(form);
  form.line.value = lineFor(defWh);
  form.wh.addEventListener('change', () => {
    const w = v.whById.get(form.wh.value);
    if (w && w.type === 'sub' && w.lineId) form.line.value = w.lineId;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const whId = form.wh.value;
    const lineId = form.line.value || null;
    const qty = readQty(form.qty);
    const note = form.note.value.trim();
    if (!qty) { toast('Số lượng phải là số nguyên lớn hơn 0.', 'warn'); form.qty.focus(); return; }

    const current = M.num(store.view.itemById.get(itemId)?.stocks?.[whId]);
    let allowNegative = false;
    if (qty > current) {
      const r = await confirmDialog({
        title: 'Xuất nhiều hơn số tồn?',
        message: `${M.whName(v, whId)} chỉ còn ${current} ${item.unit}. Nếu vẫn xuất ${qty}, tồn kho sẽ bị âm.`,
        confirmText: `Vẫn xuất ${qty}`,
        danger: true,
      });
      if (!r.ok) return;
      allowNegative = true;
    }

    try {
      const left = await withBusy(form.querySelector('[type=submit]'), 'Đang lưu…', () =>
        mutate(`Xuất ${qty} ${item.unit} ${item.code}`, (d) => {
          const it = M.requireItem(d, itemId);
          const now = M.num(it.stocks[whId]);
          if (qty > now && !allowNegative) {
            throw new M.UserError(`Số tồn vừa thay đổi: ${M.whName(store.view, whId)} chỉ còn ${now} ${it.unit}.`);
          }
          M.addStock(it, whId, -qty);
          M.pushTx(d, { id: M.uid('tx'), ts: Date.now(), type: 'xuat', itemId, qty, whId, lineId, userId: store.user.id, note });
          return M.num(it.stocks[whId]);
        })
      );
      setPref('outWh', whId);
      if (lineId) setPref('outLine', lineId);
      s.close();
      toast(`Đã xuất ${qty} ${item.unit} ${item.code}. ${M.whName(store.view, whId)} còn ${left}.`);
    } catch (err) {
      showError(err);
    }
  });
}

/* ---------- tạo / sửa vật tư ---------- */

export function openItemEditor(itemId, { code = '' } = {}) {
  const v = store.view;
  const item = itemId ? v.itemById.get(itemId) : null;
  const isNew = !item;
  if (!isNew && !canEditItems()) return;
  const admin = isAdmin();
  const orig = item
    ? { code: item.code, name: item.name, unit: item.unit || '', group: item.group || '', min: M.num(item.min), detail: item.detail || '' }
    : null;
  const units = [...new Set(['cái', 'bộ', ...v.items.map((i) => i.unit)].filter(Boolean))];

  const s = openSheet(html`
    <form class="form" data-form novalidate>
      ${!isNew && html`<div class="field avatar-row">
        <span class="avatar-pick">
          ${avatarSpan(item, 'lg')}
          <label class="avatar-pick-btn" aria-label="Đổi ảnh vật tư">
            <input type="file" accept="image/*" capture="environment" data-photo-input>
          </label>
          <span class="avatar-pick-edge">${icon('edit')}</span>
        </span>
        <span class="avatar-row-text">
          <span class="label">Ảnh đại diện</span>
          <span class="hint" data-photo-hint>${item.photo ? 'Chạm vào ảnh để thay ảnh khác.' : 'Chạm vào khung để chụp hoặc chọn ảnh.'}</span>
          ${item.photo && html`<button type="button" class="btn-link" data-photo-remove>Xóa ảnh</button>`}
        </span>
      </div>`}
      ${isNew && html`<p class="hint">Lưu vật tư trước, sau đó mở lại để thêm ảnh đại diện.</p>`}
      <div class="row2">
        <label class="field"><span class="label">Mã spare part</span>
          <input name="code" value="${item ? item.code : M.normCode(code)}" autocapitalize="characters" spellcheck="false" ${isNew && !code && raw('autofocus')}></label>
        <label class="field"><span class="label">Đơn vị</span><input name="unit" value="${item ? item.unit : 'cái'}" list="dl-units"></label>
      </div>
      <label class="field"><span class="label">Tên vật tư</span><input name="name" value="${item?.name || ''}" ${isNew && code && raw('autofocus')}></label>
      <div class="row2">
        <label class="field"><span class="label">Nhóm</span><input name="group" value="${item?.group || ''}" list="dl-groups" placeholder="Bo mạch"></label>
        <label class="field"><span class="label">Tồn tối thiểu</span><input name="min" type="number" inputmode="numeric" min="0" value="${item ? M.num(item.min) : 5}"></label>
      </div>
      <label class="field"><span class="label">Mô tả chi tiết <i>không bắt buộc</i></span><textarea name="detail" rows="2">${item?.detail || ''}</textarea></label>
      ${!isNew && admin && html`<fieldset class="stock-edit"><legend>Tồn theo kho</legend>
        ${v.meta.warehouses.map((w) => html`<label class="field field-inline"><span class="label">${w.name}</span>
          <input type="number" inputmode="numeric" data-stock="${w.id}" data-orig="${M.num(item.stocks?.[w.id])}" value="${M.num(item.stocks?.[w.id])}"></label>`)}
        <p class="hint">Mỗi thay đổi số tồn được ghi thành giao dịch "Điều chỉnh tồn kho" trong Lịch sử.</p>
      </fieldset>`}
      <datalist id="dl-groups">${v.groups.map((g) => html`<option value="${g}"></option>`)}</datalist>
      <datalist id="dl-units">${units.map((u) => html`<option value="${u}"></option>`)}</datalist>
      <div class="sheet-actions">
        ${!isNew && admin && html`<button type="button" class="btn btn-danger-ghost" data-delete>Xóa vật tư</button>`}
        <button type="submit" class="btn btn-primary">${isNew ? 'Tạo vật tư' : 'Lưu thay đổi'}</button>
      </div>
    </form>
  `, { title: isNew ? 'Vật tư mới' : 'Sửa vật tư' });

  const form = s.body.querySelector('[data-form]');

  if (!isNew) {
    const avatarEl = s.body.querySelector('.avatar');
    if (avatarEl) loadAvatarNow(avatarEl);
    const photoInput = s.body.querySelector('[data-photo-input]');
    const photoHint = s.body.querySelector('[data-photo-hint]');
    photoInput?.addEventListener('change', async () => {
      const file = photoInput.files[0];
      photoInput.value = '';
      if (!file) return;
      const original = photoHint.textContent;
      try {
        photoHint.textContent = 'Đang nén ảnh…';
        const blob = await compressAvatar(file);
        avatarEl.style.backgroundImage = `url("${URL.createObjectURL(blob)}")`;
        avatarEl.classList.add('has-photo');
        photoHint.textContent = `Đang tải lên GitHub… (${Math.round(blob.size / 1024)}KB)`;
        await setItemPhoto(itemId, blob);
        photoHint.textContent = 'Đã lưu ảnh.';
        toast('Đã cập nhật ảnh vật tư.');
        if (!s.body.querySelector('[data-photo-remove]')) {
          const btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'btn-link'; btn.dataset.photoRemove = '';
          btn.textContent = 'Xóa ảnh';
          s.body.querySelector('.avatar-row-text').appendChild(btn);
        }
      } catch (err) {
        photoHint.textContent = original;
        showError(err);
      }
    });
    s.body.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-photo-remove]')) return;
      const r = await confirmDialog({ title: 'Xóa ảnh vật tư?', message: `Xóa ảnh của ${item.code}?`, confirmText: 'Xóa ảnh', danger: true });
      if (!r.ok) return;
      try {
        await removeItemPhoto(itemId);
        avatarEl.style.backgroundImage = '';
        avatarEl.classList.remove('has-photo');
        photoHint.textContent = 'Chạm vào khung để chụp hoặc chọn ảnh.';
        e.target.closest('[data-photo-remove]').remove();
        toast('Đã xóa ảnh vật tư.');
      } catch (err) {
        showError(err);
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = {
      code: M.normCode(form.code.value),
      name: form.name.value.trim(),
      unit: form.unit.value.trim() || 'cái',
      group: form.group.value.trim() || 'Khác',
      min: Math.max(0, Math.round(Number(form.min.value) || 0)),
      detail: form.detail.value.trim(),
    };
    if (!next.code || !next.name) { toast('Cần có mã và tên vật tư.', 'warn'); return; }
    // Chỉ ghi những ô đã sửa, để không đè lên thay đổi của người khác trong lúc đang mở form.
    const changedFields = orig ? Object.keys(next).filter((k) => next[k] !== orig[k]) : Object.keys(next);
    const stockEdits = [...form.querySelectorAll('[data-stock]')]
      .map((i) => ({ whId: i.dataset.stock, qty: Math.round(Number(i.value) || 0), orig: Number(i.dataset.orig) }))
      .filter((x) => x.qty !== x.orig);

    try {
      await withBusy(form.querySelector('[type=submit]'), 'Đang lưu…', () =>
        mutate(isNew ? `Tạo vật tư ${next.code}` : `Sửa vật tư ${next.code}`, (d) => {
          const items = M.draftItems(d);
          const dup = items.find((i) => M.normCode(i.code) === next.code && i.id !== itemId);
          if (dup) throw new M.UserError(`Mã ${next.code} đã được dùng cho "${dup.name}".`);
          if (isNew) {
            items.push({ id: M.uid('it'), ...next, stocks: {} });
            return;
          }
          const it = M.requireItem(d, itemId);
          for (const k of changedFields) it[k] = next[k];
          const now = Date.now();
          stockEdits.forEach(({ whId, qty }, n) => {
            const diff = qty - M.num(it.stocks[whId]);
            if (!diff) return;
            if (qty === 0) delete it.stocks[whId];
            else it.stocks[whId] = qty;
            M.pushTx(d, {
              id: M.uid('tx'), ts: now + n, type: diff > 0 ? 'nhap' : 'xuat', itemId, qty: Math.abs(diff), whId,
              lineId: null, userId: store.user.id, note: 'Điều chỉnh tồn kho', source: 'adjust',
            });
          });
        })
      );
      s.close();
      toast(isNew ? `Đã tạo vật tư ${next.code}.` : `Đã lưu ${next.code}.`);
    } catch (err) {
      showError(err);
    }
  });

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const t = M.totalQty(item);
    const r = await confirmDialog({
      title: 'Xóa vật tư?',
      message: html`Xóa <b>${item.code}</b> ${item.name}?${t !== 0 && html` Vật tư này vẫn còn ${fmtNum(t)} ${item.unit} trong kho.`} Lịch sử giao dịch được giữ lại.`,
      confirmText: 'Xóa vật tư',
      danger: true,
    });
    if (!r.ok) return;
    try {
      await mutate(`Xóa vật tư ${item.code}`, (d) => {
        const items = M.draftItems(d);
        const i = items.findIndex((x) => x.id === itemId);
        if (i >= 0) items.splice(i, 1);
      }, { allowRemove: { items: 1 }, extraFiles: item.photo ? [{ path: photoPath(itemId), delete: true }] : undefined });
      s.close();
      toast(`Đã xóa ${item.code}.`);
    } catch (err) {
      showError(err);
    }
  });
}

/* ---------- tem QR ---------- */

export function openQrSheet(item) {
  const s = openSheet(html`
    <div class="qr-card">
      <div class="qr-img">${raw(qrSvg(item.code))}</div>
      <p class="qr-code">${item.code}</p>
      <p class="qr-name">${item.name}</p>
    </div>
    <div class="sheet-actions">
      <button type="button" class="btn" data-close>Đóng</button>
      <button type="button" class="btn btn-primary" data-print>${icon('print')}In tem</button>
    </div>
  `, { title: 'Tem QR' });
  s.body.querySelector('[data-print]').addEventListener('click', () => printLabels([item]));
}

export function printLabels(items) {
  const root = document.getElementById('print-root');
  mount(root, html`<div class="labels">${items.map((it) => html`<div class="label">
    <div class="label-qr">${raw(qrSvg(it.code, { margin: 1 }))}</div>
    <div class="label-text"><b>${it.code}</b><span>${it.name}</span></div>
  </div>`)}</div>`);
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    root.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
}

/* ---------- giao dịch ---------- */

const SOURCE_LABEL = { excel: 'Nhập từ Excel', import: 'Nhập từ Excel', adjust: 'Điều chỉnh khi sửa vật tư' };

export function txRow(v, t) {
  const it = v.itemById.get(t.itemId);
  const iso = Number.isFinite(t.ts) ? new Date(t.ts).toISOString() : '';
  return html`<li><button type="button" class="tx-row tx-${t.type}" data-tx="${t.id}">
    <span class="tx-qty"><b>${t.type === 'xuat' ? '−' : '+'}${fmtNum(t.qty)}</b><small>${it?.unit || ''}</small></span>
    <span class="tx-main">
      <span class="tx-item">${it ? html`<span class="tx-code">${it.code}</span> ${it.name}` : html`<span class="hint">Vật tư đã xóa</span>`}</span>
      <span class="tx-place">${M.TYPE_LABEL[t.type]} ${t.type === 'xuat' ? 'từ' : 'vào'} ${M.whName(v, t.whId)}${t.lineId && html` → ${M.lineName(v, t.lineId)}`}</span>
      ${t.note && html`<span class="tx-note">${t.note}</span>`}
    </span>
    <span class="tx-meta"><span>${M.userName(v, t.userId, t.rawUser)}</span><time datetime="${iso}">${fmtTime(t.ts)}</time></span>
  </button></li>`;
}

export function openTxSheet(txId) {
  const v = store.view;
  const t = v.tx.find((x) => x.id === txId);
  if (!t) return;
  const item = v.itemById.get(t.itemId);
  const unit = item?.unit || '';

  const details = html`<dl class="kv">
    <div><dt>Loại</dt><dd>${M.TYPE_LABEL[t.type]} kho</dd></div>
    <div><dt>Vật tư</dt><dd>${item ? `${item.code} ${item.name}` : 'Đã xóa'}</dd></div>
    <div><dt>Số lượng</dt><dd>${fmtNum(t.qty)} ${unit}</dd></div>
    <div><dt>Kho</dt><dd>${M.whName(v, t.whId)}</dd></div>
    ${t.lineId && html`<div><dt>Dây chuyền</dt><dd>${M.lineName(v, t.lineId)}</dd></div>`}
    <div><dt>Người thực hiện</dt><dd>${M.userName(v, t.userId, t.rawUser)}</dd></div>
    <div><dt>Thời gian</dt><dd>${fmtTime(t.ts)}</dd></div>
    ${t.note && html`<div><dt>Ghi chú</dt><dd>${t.note}</dd></div>`}
    ${SOURCE_LABEL[t.source] && html`<div><dt>Nguồn</dt><dd>${SOURCE_LABEL[t.source]}</dd></div>`}
    ${t.editedAt && html`<div><dt>Sửa lần cuối</dt><dd>${M.userName(v, t.editedBy)}, ${fmtTime(t.editedAt)}</dd></div>`}
  </dl>`;

  if (!isAdmin()) {
    openSheet(html`${details}<div class="sheet-actions"><button type="button" class="btn" data-close>Đóng</button></div>`, { title: 'Giao dịch' });
    return;
  }

  const userOptions = [
    ...v.meta.users.map((u) => html`<option value="${u.id}" ${u.id === t.userId && raw('selected')}>${u.name} (ID ${u.id})</option>`),
    !v.userById.has(t.userId) && html`<option value="__keep" selected>${M.userName(v, t.userId, t.rawUser)}</option>`,
  ];

  const s = openSheet(html`
    <p class="sheet-lead">${item ? html`<b>${item.code}</b> ${item.name}` : 'Vật tư đã xóa'}, ${fmtTime(t.ts)}</p>
    <form class="form" data-form novalidate>
      <div class="row2">
        <div class="field"><span class="label">Số lượng ${t.type === 'xuat' ? 'xuất' : 'nhập'}</span>${stepper('qty', t.qty)}</div>
        <label class="field"><span class="label">Kho</span>
          <select name="wh">${v.meta.warehouses.map((w) => html`<option value="${w.id}" ${w.id === t.whId && raw('selected')}>${w.name}</option>`)}
          ${!v.whById.has(t.whId) && html`<option value="${t.whId}" selected>${t.whId}</option>`}</select></label>
      </div>
      ${t.type === 'xuat' && html`<label class="field"><span class="label">Dây chuyền nhận</span>
        <select name="line"><option value="">Không ghi dây chuyền</option>${v.meta.lines.map((l) => html`<option value="${l.id}" ${l.id === t.lineId && raw('selected')}>${l.name}</option>`)}</select></label>`}
      <label class="field"><span class="label">Người thực hiện</span><select name="user">${userOptions}</select></label>
      <label class="field"><span class="label">Ghi chú</span><input name="note" value="${t.note || ''}" maxlength="300"></label>
      <label class="check"><input type="checkbox" name="sync" ${item ? raw('checked') : raw('disabled')}>
        <span>Cập nhật tồn kho theo số lượng và kho mới${!item && ' (vật tư đã xóa nên không áp dụng được)'}</span></label>
      <div class="sheet-actions">
        <button type="button" class="btn btn-danger-ghost" data-delete>Xóa giao dịch</button>
        <button type="submit" class="btn btn-primary">Lưu giao dịch</button>
      </div>
    </form>
  `, { title: 'Sửa giao dịch' });

  const form = s.body.querySelector('[data-form]');
  bindSteppers(form);
  const label = item ? item.code : 'giao dịch';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const qty = readQty(form.qty);
    if (!qty) { toast('Số lượng phải là số nguyên lớn hơn 0.', 'warn'); return; }
    const whId = form.wh.value;
    const lineId = form.line ? form.line.value || null : null;
    const userChoice = form.user.value;
    const note = form.note.value.trim();
    const sync = form.sync.checked;
    try {
      await withBusy(form.querySelector('[type=submit]'), 'Đang lưu…', () =>
        mutate(`Sửa giao dịch ${label}`, (d) => {
          const loc = M.locateTx(d, txId);
          if (!loc) throw new M.UserError('Giao dịch này vừa bị xóa trên thiết bị khác.');
          const old = loc.tx;
          const next = { ...old, qty, whId, lineId, note, editedBy: store.user.id, editedAt: Date.now() };
          if (userChoice !== '__keep') { next.userId = userChoice; delete next.rawUser; }
          if (sync) {
            const it = M.draftItems(d).find((i) => i.id === old.itemId);
            if (it) {
              M.addStock(it, old.whId, -M.stockDelta(old));
              M.addStock(it, next.whId, M.stockDelta(next));
            }
          }
          d[loc.path][loc.index] = next;
        })
      );
      s.close();
      toast('Đã lưu giao dịch.');
    } catch (err) {
      showError(err);
    }
  });

  form.querySelector('[data-delete]').addEventListener('click', async () => {
    const r = await confirmDialog({
      title: 'Xóa giao dịch?',
      message: 'Giao dịch sẽ biến mất khỏi Lịch sử. Vẫn khôi phục được từ lịch sử commit trên GitHub.',
      confirmText: 'Xóa giao dịch',
      danger: true,
      checkbox: item ? { label: `Hoàn lại tồn kho (${t.type === 'xuat' ? 'cộng lại' : 'trừ đi'} ${t.qty} ${unit})`, checked: true } : null,
    });
    if (!r.ok) return;
    try {
      await mutate(`Xóa giao dịch ${label}`, (d) => {
        const loc = M.locateTx(d, txId);
        if (!loc) return;
        if (r.checked) {
          const it = M.draftItems(d).find((i) => i.id === loc.tx.itemId);
          if (it) M.addStock(it, loc.tx.whId, -M.stockDelta(loc.tx));
        }
        M.removeTxAt(d, loc);
      }, { allowRemove: { tx: 1 } });
      s.close();
      toast('Đã xóa giao dịch.');
    } catch (err) {
      showError(err);
    }
  });
}
