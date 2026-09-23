/* Cấu trúc dữ liệu trong kho GitHub:
   data/meta.json        { settings, lines[], warehouses[], users[] }
   data/items.json       [ { id, code, name, group, unit, min, detail, stocks: { whId: qty } } ]
   data/tx/YYYY-MM.json  [ { id, ts, type: 'nhap'|'xuat', itemId, qty, whId, lineId, userId, rawUser, note, source } ]
   Mỗi tháng một file giao dịch để file luôn nhỏ, không giới hạn số giao dịch. */

export const META = 'data/meta.json';
export const ITEMS = 'data/items.json';
export const TX_DIR = 'data/tx/';

export class UserError extends Error {}

export const DEFAULT_SETTINGS = {
  title: 'Kho spare part',
  subtitle: 'Maint Line VD3',
  staffCanEditItems: false,
};

export const STATUS_LABEL = { out: 'Hết hàng', low: 'Sắp hết', ok: 'Đủ hàng' };
export const TYPE_LABEL = { nhap: 'Nhập', xuat: 'Xuất' };

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function monthKey(ts) {
  const d = new Date(Number.isFinite(ts) ? ts : 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const txPath = (ts) => `${TX_DIR}${monthKey(ts)}.json`;

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
  const items = Array.isArray(docs[ITEMS]) ? docs[ITEMS] : [];
  const tx = [];
  const months = [];
  for (const [path, list] of Object.entries(docs)) {
    if (!path.startsWith(TX_DIR) || !Array.isArray(list)) continue;
    months.push(path.slice(TX_DIR.length, -5));
    for (const t of list) if (t && !t.hidden) tx.push(t);
  }
  tx.sort((a, b) => num(b.ts) - num(a.ts));
  months.sort().reverse();

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
  if (!item.stocks || typeof item.stocks !== 'object') item.stocks = {};
  return item;
}

export function addStock(item, whId, delta) {
  if (!item.stocks) item.stocks = {};
  item.stocks[whId] = num(item.stocks[whId]) + delta;
}

export const stockDelta = (tx) => (tx.type === 'xuat' ? -num(tx.qty) : num(tx.qty));

export function pushTx(d, tx) {
  const path = txPath(tx.ts);
  if (!Array.isArray(d[path])) d[path] = [];
  d[path].unshift(tx);
  return tx;
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

/* Mỗi vật tư / giao dịch một dòng → xem thay đổi trên GitHub rất dễ đọc. */
export function serialize(value) {
  if (Array.isArray(value)) {
    return value.length ? `[\n${value.map((v) => JSON.stringify(v)).join(',\n')}\n]\n` : '[]\n';
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
    const content = serialize(after[path]);
    if (!(path in before) || serialize(before[path]) !== content) changes.push({ path, content });
  }
  return changes;
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
}
