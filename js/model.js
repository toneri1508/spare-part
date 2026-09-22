/* Cấu trúc dữ liệu trong kho GitHub:
   data/meta.json        { settings, lines[], warehouses[], users[] }
   data/items.json       [ { id, code, name, group, unit, min, detail } ]   ← thông tin ít khi đổi
   data/stocks.json      { itemId: { whId: qty } }                          ← số tồn, đổi mỗi lần nhập/xuất
   data/tx/_hot.json     giao dịch trong ngày hôm nay (file nhỏ)
   data/tx/YYYY-MM.json  kho lưu giao dịch các ngày trước, mỗi tháng một file

   Vì sao tách làm ba: mỗi lần nhập/xuất, app chỉ ghi lại những file thật sự đổi.
   Trước đây một lần xuất kho phải gửi lại cả items.json (nửa MB) và cả file giao dịch
   của tháng (gần 1 MB). Nay chỉ gửi stocks.json và _hot.json — nhẹ hơn khoảng 14 lần,
   nên quét tem ở xưởng bằng 4G không phải chờ. Mỗi ngày một lần, giao dịch của ngày cũ
   được dồn vào file tháng, nên số file trong kho vẫn ít, mở app vẫn nhanh. */

export const META = 'data/meta.json';
export const ITEMS = 'data/items.json';
export const STOCKS = 'data/stocks.json';
export const TX_DIR = 'data/tx/';
export const TX_HOT = `${TX_DIR}_hot.json`;

export class UserError extends Error {}

export const DEFAULT_SETTINGS = {
  title: 'Kho spare part',
  subtitle: 'Maint Line VD3',
};

/* Khóa cài đặt của bản cũ, nay quyền cố định theo vai trò nên không dùng nữa.
   normalizeDraft() dọn đi để meta.json không còn dòng thừa gây hiểu nhầm. */
const RETIRED_SETTINGS = ['staffCanEditItems'];

export const STATUS_LABEL = { out: 'Hết hàng', low: 'Sắp hết', ok: 'Đủ hàng' };
export const TYPE_LABEL = { nhap: 'Nhập', xuat: 'Xuất' };

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function monthKey(ts) {
  const d = new Date(Number.isFinite(ts) ? ts : 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function dayKey(ts) {
  const d = new Date(Number.isFinite(ts) ? ts : 0);
  return `${monthKey(ts)}-${String(d.getDate()).padStart(2, '0')}`;
}

/* File lưu trữ lâu dài của một giao dịch (theo tháng). Giao dịch mới chưa vào đây
   mà nằm ở TX_HOT cho tới khi sang ngày mới. */
export const txArchivePath = (ts) => `${TX_DIR}${monthKey(ts)}.json`;

export function defaultMeta(admin) {
  return {
    schema: 1,
    settings: { ...DEFAULT_SETTINGS },
    lines: [1, 2, 3, 4].map((n) => ({ id: `l${n}`, name: `Dây chuyền ${n}` })),
    warehouses: [
      { id: 'wm1', name: 'Kho chính 1', type: 'main' },
      { id: 'wm2', name: 'Kho chính 2', type: 'main' },
      { id: 'wm3', name: 'Kho chính 3', type: 'main' },
      { id: 'ws1', name: 'Kho phụ - Line 1', type: 'sub', lineId: 'l1' },
      { id: 'ws2', name: 'Kho phụ - Line 2', type: 'sub', lineId: 'l2' },
      { id: 'ws3', name: 'Kho phụ - Line 3', type: 'sub', lineId: 'l3' },
      { id: 'ws4', name: 'Kho phụ - Line 4', type: 'sub', lineId: 'l4' },
    ],
    users: admin ? [{ id: admin.id, name: admin.name, role: 'admin' }] : [],
  };
}

/* ---------- tra cứu, hiển thị ---------- */

export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const normCode = (s) => String(s ?? '').trim().toUpperCase();

/* Bỏ dấu tiếng Việt để tìm "bom" ra "Bơm", "day" ra "Dây". */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export const totalQty = (item) => Object.values(item.stocks || {}).reduce((a, b) => a + num(b), 0);

/* Tổng tồn của một vật tư đọc thẳng từ bộ file (dùng cho bản xem trước khi khôi phục,
   nơi chưa có view). Đọc được cả bộ file kiểu cũ lẫn kiểu mới. */
export function totalQtyIn(docs, item) {
  const s = docs[STOCKS];
  const byWh = (s && typeof s === 'object' && !Array.isArray(s) ? s[item.id] : null) || item.stocks || {};
  return Object.values(byWh).reduce((a, b) => a + num(b), 0);
}

export function statusOf(item) {
  const t = totalQty(item);
  if (t <= 0) return 'out';
  if (t <= num(item.min)) return 'low';
  return 'ok';
}

export function matchesItem(item, q) {
  if (!q) return true;
  const f = fold(q);
  return fold(item.code).includes(f) || fold(item.name).includes(f) || fold(item.group).includes(f);
}

export function findByCode(items, code) {
  const c = normCode(code);
  return c ? items.find((i) => normCode(i.code) === c) : undefined;
}

/* Dữ liệu dẫn xuất để hiển thị — tính một lần mỗi khi dữ liệu đổi. */
export function buildView(docs) {
  const rawMeta = docs[META] || {};
  const meta = {
    ...rawMeta,
    settings: { ...DEFAULT_SETTINGS, ...(rawMeta.settings || {}) },
    lines: Array.isArray(rawMeta.lines) ? rawMeta.lines : [],
    warehouses: Array.isArray(rawMeta.warehouses) ? rawMeta.warehouses : [],
    users: Array.isArray(rawMeta.users) ? rawMeta.users : [],
  };
  /* Tồn kho nằm ở stocks.json. Dữ liệu cũ để tồn ngay trong từng vật tư,
     nên vẫn đọc được cả hai kiểu — kiểu cũ tự chuyển sang kiểu mới ở lần lưu kế tiếp. */
  const stockDoc = docs[STOCKS] && typeof docs[STOCKS] === 'object' && !Array.isArray(docs[STOCKS]) ? docs[STOCKS] : null;
  const rawItems = Array.isArray(docs[ITEMS]) ? docs[ITEMS] : [];
  const items = rawItems.map((it) => ({ ...it, stocks: (stockDoc && stockDoc[it.id]) || it.stocks || {} }));

  const tx = [];
  const monthSet = new Set();
  for (const [path, list] of Object.entries(docs)) {
    if (!path.startsWith(TX_DIR) || !Array.isArray(list)) continue;
    for (const t of list) {
      if (!t || t.hidden) continue;
      tx.push(t);
      monthSet.add(monthKey(t.ts));
    }
  }
  tx.sort((a, b) => num(b.ts) - num(a.ts));
  const months = [...monthSet].sort().reverse();

  const txByItem = new Map();
  for (const t of tx) {
    if (!txByItem.has(t.itemId)) txByItem.set(t.itemId, []);
    txByItem.get(t.itemId).push(t);
  }
  const groups = [...new Set(items.map((i) => i.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));

  return {
    meta,
    items,
    tx,
    months,
    groups,
    txByItem,
    itemById: new Map(items.map((i) => [i.id, i])),
    userById: new Map(meta.users.map((u) => [u.id, u])),
    whById: new Map(meta.warehouses.map((w) => [w.id, w])),
    lineById: new Map(meta.lines.map((l) => [l.id, l])),
  };
}

export const whName = (v, id) => v.whById.get(id)?.name || id || '—';
export const lineName = (v, id) => v.lineById.get(id)?.name || id || '—';
export function userName(v, id, rawUser) {
  const u = v.userById.get(id);
  if (u) return u.name;
  if (rawUser) return `${rawUser} (chưa khớp)`;
  return id || '—';
}

/* ---------- thao tác trên bản nháp (chỉ dùng bên trong store.mutate) ---------- */

export function draftMeta(d) {
  const m = d[META];
  if (!m || !Array.isArray(m.users) || !Array.isArray(m.warehouses) || !Array.isArray(m.lines)) {
    throw new UserError('Dữ liệu cấu hình (meta.json) không hợp lệ.');
  }
  m.settings = { ...DEFAULT_SETTINGS, ...(m.settings || {}) };
  return m;
}

export function draftItems(d) {
  if (!Array.isArray(d[ITEMS])) throw new UserError('Danh sách vật tư (items.json) không hợp lệ.');
  return d[ITEMS];
}

export function requireItem(d, id) {
  const item = draftItems(d).find((i) => i.id === id);
  if (!item) throw new UserError('Vật tư này vừa bị xóa trên thiết bị khác.');
  return item;
}

/* ---------- tồn kho (stocks.json) ---------- */

export function draftStocks(d) {
  const s = d[STOCKS];
  if (s && typeof s === 'object' && !Array.isArray(s)) return s;
  if (s != null) throw new UserError('File data/stocks.json không đúng định dạng.');
  d[STOCKS] = {};
  return d[STOCKS];
}

export const stockOf = (d, itemId, whId) => num(draftStocks(d)[itemId]?.[whId]);

/* Chỉ giữ kho còn số khác 0 → file nhỏ và diff trên GitHub dễ đọc. */
export function setStock(d, itemId, whId, qty) {
  const all = draftStocks(d);
  const n = num(qty);
  if (!n) {
    if (all[itemId]) {
      delete all[itemId][whId];
      if (!Object.keys(all[itemId]).length) delete all[itemId];
    }
    return 0;
  }
  if (!all[itemId]) all[itemId] = {};
  all[itemId][whId] = n;
  return n;
}

export const addStock = (d, itemId, whId, delta) => setStock(d, itemId, whId, stockOf(d, itemId, whId) + delta);

export const stockDelta = (tx) => (tx.type === 'xuat' ? -num(tx.qty) : num(tx.qty));

/* ---------- giao dịch ---------- */

/* Giao dịch mới luôn vào file nóng (nhỏ), không đụng vào file tháng. */
export function pushTx(d, tx) {
  if (!Array.isArray(d[TX_HOT])) d[TX_HOT] = [];
  d[TX_HOT].unshift(tx);
  return tx;
}

/* Dồn giao dịch của những ngày đã qua từ file nóng vào file tháng.
   Chạy mỗi lần lưu nhưng chỉ thực sự ghi một lần mỗi ngày. */
export function foldHotTx(d, now = Date.now()) {
  const hot = d[TX_HOT];
  if (!Array.isArray(hot) || !hot.length) return false;
  const today = dayKey(now);
  const stale = hot.filter((t) => dayKey(t?.ts) !== today);
  if (!stale.length) return false;

  for (const t of stale) {
    const path = txArchivePath(t.ts);
    if (!Array.isArray(d[path])) d[path] = [];
    d[path].push(t);
  }
  for (const path of new Set(stale.map((t) => txArchivePath(t.ts)))) {
    d[path].sort((a, b) => num(b.ts) - num(a.ts));
  }
  const keep = hot.filter((t) => dayKey(t?.ts) === today);
  if (keep.length) d[TX_HOT] = keep;
  else delete d[TX_HOT];
  return true;
}

/* Dữ liệu bản cũ để tồn kho ngay trong từng vật tư. Chuyển sang stocks.json,
   một lần duy nhất, ngay trong thao tác lưu kế tiếp. Không làm mất số nào. */
export function normalizeDraft(d) {
  const settings = d[META]?.settings;
  if (settings) {
    for (const k of RETIRED_SETTINGS) delete settings[k];
  }
  if (!Array.isArray(d[ITEMS])) return false;
  let moved = false;
  for (const it of d[ITEMS]) {
    if (!it || !it.stocks || typeof it.stocks !== 'object') continue;
    // stocks.json là bản chính; chỉ chuyển sang khi vật tư chưa có ở đó (giống buildView).
    if (!draftStocks(d)[it.id]) {
      for (const [whId, qty] of Object.entries(it.stocks)) {
        if (num(qty)) setStock(d, it.id, whId, num(qty));
      }
    }
    delete it.stocks;
    moved = true;
  }
  if (moved && !d[STOCKS]) d[STOCKS] = {};
  return moved;
}

export function locateTx(d, id) {
  for (const path of Object.keys(d)) {
    if (!path.startsWith(TX_DIR) || !Array.isArray(d[path])) continue;
    const index = d[path].findIndex((t) => t.id === id);
    if (index >= 0) return { path, index, tx: d[path][index] };
  }
  return null;
}

export function removeTxAt(d, loc) {
  d[loc.path].splice(loc.index, 1);
  if (!d[loc.path].length) delete d[loc.path];
}

/* ---------- ghi file ---------- */

/* Mỗi vật tư / giao dịch / dòng tồn kho một dòng → xem thay đổi trên GitHub rất dễ đọc:
   xuất 2 cái ở một kho chỉ hiện đúng một dòng đổi. */
export function serialize(value, path) {
  if (Array.isArray(value)) {
    return value.length ? `[\n${value.map((v) => JSON.stringify(v)).join(',\n')}\n]\n` : '[]\n';
  }
  if (path === STOCKS && value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return keys.length ? `{\n${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(value[k])}`).join(',\n')}\n}\n` : '{}\n';
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function diffDocs(before, after) {
  const changes = [];
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const path of [...paths].sort()) {
    if (!(path in after)) {
      changes.push({ path, delete: true });
      continue;
    }
    const content = serialize(after[path], path);
    if (!(path in before) || serialize(before[path], path) !== content) changes.push({ path, content });
  }
  return changes;
}

/* Số vật tư đang có tồn ở ít nhất một kho — dùng cho chốt chặn bên dưới.
   Đọc được cả kiểu cũ (tồn nằm trong từng vật tư) lẫn kiểu mới (stocks.json). */
export function countStocked(docs) {
  const s = docs[STOCKS];
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    return Object.values(s).filter((byWh) => byWh && Object.values(byWh).some((q) => num(q) !== 0)).length;
  }
  const items = Array.isArray(docs[ITEMS]) ? docs[ITEMS] : [];
  return items.filter((i) => i && i.stocks && Object.values(i.stocks).some((q) => num(q) !== 0)).length;
}

export function countDocs(docs) {
  const m = docs[META] || {};
  let tx = 0;
  for (const [p, v] of Object.entries(docs)) if (p.startsWith(TX_DIR) && Array.isArray(v)) tx += v.length;
  return {
    items: Array.isArray(docs[ITEMS]) ? docs[ITEMS].length : 0,
    tx,
    users: Array.isArray(m.users) ? m.users.length : 0,
    warehouses: Array.isArray(m.warehouses) ? m.warehouses.length : 0,
    lines: Array.isArray(m.lines) ? m.lines.length : 0,
  };
}

const COUNT_LABEL = { items: 'vật tư', tx: 'giao dịch', users: 'người dùng', warehouses: 'kho', lines: 'dây chuyền' };

/* Chốt chặn cuối cùng: không một thao tác nào được làm mất dữ liệu ngoài phần nó khai báo.
   Đây chính là lớp bảo vệ mà bản Firebase cũ thiếu. */
export function guardAgainstLoss(before, after, opts = {}) {
  if (!after[META] || !Array.isArray(after[ITEMS])) {
    throw new UserError('Đã chặn lưu để bảo vệ dữ liệu: thiếu cấu hình hoặc danh sách vật tư.');
  }
  if (opts.replaceAll) return;
  const b = countDocs(before);
  const a = countDocs(after);
  const allow = opts.allowRemove || {};
  for (const key of Object.keys(COUNT_LABEL)) {
    if (b[key] - a[key] > (allow[key] || 0)) {
      throw new UserError(`Đã chặn lưu để bảo vệ dữ liệu: số ${COUNT_LABEL[key]} sẽ giảm từ ${b[key]} xuống ${a[key]}.`);
    }
  }

  /* Tồn kho không đếm cứng được: xuất hết một mã thì mã đó rời khỏi stocks.json,
     đó là chuyện bình thường. Chỉ chặn khi cả file tồn kho gần như bay sạch trong
     một thao tác — dấu hiệu của ghi đè hỏng chứ không phải nghiệp vụ thật. */
  const bs = countStocked(before);
  const as = countStocked(after);
  if (bs >= 10 && bs - as >= 10 && as < bs / 2) {
    throw new UserError(`Đã chặn lưu để bảo vệ dữ liệu: số vật tư còn tồn sẽ giảm từ ${bs} xuống ${as}.`);
  }
}
