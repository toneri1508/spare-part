/* Đưa dữ liệu cũ vào kho GitHub. Nhận được:
   - file sao lưu của web này
   - dữ liệu dạng { sp_meta, sp_items, sp_tx, sp_tx_hidden } của bản Firebase cũ
   - file "sao-luu-trinh-duyet.json" xuất từ bộ nhớ đệm trình duyệt (định dạng nội bộ Firestore)
   - đọc thẳng Firestore qua REST, kể cả đọc lại dữ liệu tại một thời điểm trong quá khứ (PITR) */

import * as M from './model.js';

export const OLD_FIREBASE = {
  projectId: 'spare-part-dashboard',
  databaseId: '(default)',
  collection: 'sparePartDashboard',
  apiKey: 'AIzaSyDa8nngf0HhSOtthRaPEUZ11SD6WjzyeJw',
};

const KEYS = ['sp_meta', 'sp_items', 'sp_tx', 'sp_tx_hidden'];

/* ---------- giải mã giá trị Firestore ---------- */

function fsValue(v) {
  if (v == null || typeof v !== 'object') return v;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fsValue);
  if ('mapValue' in v) return fsFields((v.mapValue && v.mapValue.fields) || {});
  if ('referenceValue' in v) return v.referenceValue;
  return v;
}

function fsFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fsValue(v);
  return out;
}

function tsToMs(t) {
  if (!t) return 0;
  if (typeof t === 'string') return Date.parse(t) || 0;
  if (typeof t === 'object' && 'seconds' in t) return Number(t.seconds) * 1000;
  return Number(t) || 0;
}

/* ---------- dò tìm mọi phiên bản dữ liệu trong một khối JSON bất kỳ ---------- */

function collect(root) {
  const found = []; // { key, value, time, origin }
  const seen = new WeakSet();
  let budget = 2_000_000;

  const visit = (node, depth) => {
    if (budget-- <= 0 || depth > 60) return;
    if (typeof node === 'string') {
      const s = node.trim();
      if (s.length > 20 && (s[0] === '{' || s[0] === '[') && /sp_(items|meta|tx)/.test(s)) {
        try { visit(JSON.parse(s), depth + 1); } catch { /* không phải JSON */ }
      }
      return;
    }
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (typeof node.name === 'string' && node.fields && typeof node.fields === 'object') {
      const key = KEYS.find((k) => node.name.endsWith(`/${k}`));
      if (key) {
        const f = fsFields(node.fields);
        if ('value' in f) {
          found.push({ key, value: f.value, time: Number(f.updatedAt) || tsToMs(node.updateTime), origin: 'Firestore' });
        }
      }
    }
    for (const key of KEYS) {
      if (key in node && node[key] != null && typeof node[key] === 'object') {
        const v = node[key];
        const value = !Array.isArray(v) && 'value' in v ? v.value : v;
        found.push({ key, value, time: Number(v.updatedAt) || 0, origin: 'JSON' });
      }
    }
    const children = Array.isArray(node) ? node : Object.values(node);
    for (const child of children) visit(child, depth + 1);
  };

  visit(root, 0);
  return found;
}

/* Bản cấu hình mặc định mà lỗi cũ ghi đè lên: 12 "Nhân viên 01..12", không có quản trị viên. */
function looksLikeResetMeta(m) {
  const users = Array.isArray(m.users) ? m.users : [];
  return users.length > 0 && users.every((u) => /^u\d+$/.test(u.id) && /^Nhân viên \d+$/.test(u.name));
}

const sizeOf = (key, value) => {
  if (key === 'sp_meta') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return -1;
    const n = (value.users?.length || 0) + (value.warehouses?.length || 0) + (value.lines?.length || 0);
    return looksLikeResetMeta(value) ? Math.min(n, 1) : 1000 + n;
  }
  return Array.isArray(value) ? value.length : -1;
};

/* Mỗi loại dữ liệu có thể có nhiều phiên bản (bản bị xóa trắng và bản còn đủ).
   Chọn bản nhiều dữ liệu nhất; nếu bằng nhau thì lấy bản mới hơn. */
function pickBest(found) {
  const best = {};
  const versions = {};
  for (const f of found) {
    const size = sizeOf(f.key, f.value);
    if (size < 0) continue;
    (versions[f.key] ||= []).push(size);
    const cur = best[f.key];
    if (!cur || size > cur.size || (size === cur.size && f.time > cur.time)) best[f.key] = { ...f, size };
  }
  return { best, versions };
}

/* ---------- chuyển sang cấu trúc mới ---------- */

function cleanItem(raw, warnings) {
  const stocks = {};
  for (const [wh, q] of Object.entries(raw.stocks || {})) {
    const n = Number(q);
    if (Number.isFinite(n) && n !== 0) stocks[wh] = n;
  }
  const code = M.normCode(raw.code);
  if (!code) warnings.add('Có vật tư không có mã — đã tạo mã tạm, cần sửa lại.');
  return {
    id: String(raw.id || M.uid('it')),
    code: code || `CHUA-CO-MA-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    name: String(raw.name || code || 'Chưa đặt tên'),
    group: String(raw.group || 'Khác'),
    unit: String(raw.unit || 'cái'),
    min: Math.max(0, Math.round(Number(raw.min) || 0)),
    detail: String(raw.detail || ''),
    stocks,
  };
}

export function convertOld({ meta, items, tx, hidden }) {
  const warnings = new Set();
  const newMeta = meta && typeof meta === 'object' ? structuredClone(meta) : null;
  const base = M.defaultMeta(null);
  const outMeta = {
    schema: 1,
    settings: { ...M.DEFAULT_SETTINGS, ...(newMeta?.settings || {}) },
    lines: Array.isArray(newMeta?.lines) ? newMeta.lines.map((l) => ({ id: String(l.id), name: String(l.name || l.id) })) : base.lines,
    warehouses: Array.isArray(newMeta?.warehouses)
      ? newMeta.warehouses.map((w) => ({ id: String(w.id), name: String(w.name || w.id), type: w.type === 'sub' ? 'sub' : 'main', ...(w.lineId ? { lineId: String(w.lineId) } : {}) }))
      : base.warehouses,
    users: Array.isArray(newMeta?.users) ? newMeta.users.filter((u) => u && u.id).map((u) => ({ id: String(u.id), name: String(u.name || u.id), role: u.role === 'admin' ? 'admin' : 'user' })) : [],
  };
  if (!newMeta) warnings.add('Không tìm thấy danh sách kho và người dùng — dùng danh sách kho mặc định. Cần thêm lại người dùng.');

  const outItems = (Array.isArray(items) ? items : []).filter((i) => i && typeof i === 'object').map((i) => cleanItem(i, warnings));

  // Kho được nhắc tới trong tồn kho nhưng không có trong danh sách → thêm để không mất số liệu.
  const whIds = new Set(outMeta.warehouses.map((w) => w.id));
  for (const it of outItems) {
    for (const wh of Object.keys(it.stocks)) {
      if (!whIds.has(wh)) {
        whIds.add(wh);
        outMeta.warehouses.push({ id: wh, name: `Kho ${wh}`, type: 'main' });
        warnings.add(`Đã thêm kho "${wh}" (có tồn kho nhưng thiếu trong danh sách) — đổi tên trong Quản lý.`);
      }
    }
  }

  // Tách tồn kho ra file riêng đúng cấu trúc hiện tại.
  const outStocks = {};
  for (const it of outItems) {
    if (Object.keys(it.stocks).length) outStocks[it.id] = it.stocks;
    delete it.stocks;
  }

  const hiddenSet = new Set(Array.isArray(hidden) ? hidden : []);
  const files = { [M.META]: outMeta, [M.ITEMS]: outItems, [M.STOCKS]: outStocks };
  const seenTx = new Set();
  const txList = (Array.isArray(tx) ? tx : []).filter((t) => t && typeof t === 'object');
  for (const t of txList) {
    const id = String(t.id || M.uid('tx'));
    if (seenTx.has(id)) continue;
    seenTx.add(id);
    const clean = {
      id,
      ts: Number(t.ts) || 0,
      type: t.type === 'xuat' ? 'xuat' : 'nhap',
      itemId: t.itemId ?? null,
      qty: Number(t.qty) || 0,
      whId: t.whId ?? null,
      lineId: t.lineId ?? null,
      userId: t.userId ?? null,
      ...(t.rawUser ? { rawUser: t.rawUser } : {}),
      note: String(t.note || ''),
      ...(t.source ? { source: t.source } : {}),
      ...(hiddenSet.has(t.id) ? { hidden: true } : {}),
    };
    const path = M.txArchivePath(clean.ts);
    (files[path] ||= []).push(clean);
  }
  for (const [p, list] of Object.entries(files)) {
    if (p.startsWith(M.TX_DIR)) list.sort((a, b) => b.ts - a.ts);
  }
  return { files, warnings: [...warnings] };
}

/* ---------- điểm vào: nhận JSON bất kỳ, trả về bản xem trước ---------- */

export function analyze(json, label) {
  if (json && json.format === 'spare-part-github-backup' && json.files && typeof json.files === 'object') {
    const files = json.files;
    if (!files[M.META] || !Array.isArray(files[M.ITEMS])) throw new M.UserError('File sao lưu thiếu dữ liệu cấu hình hoặc vật tư.');
    return { files, counts: M.countDocs(files), warnings: [], notes: [`Bản sao lưu lúc ${json.exportedAt || 'không rõ'}`], label };
  }

  const { best, versions } = pickBest(collect(json));
  if (!best.sp_items && !best.sp_meta && !best.sp_tx) {
    throw new M.UserError('Không tìm thấy dữ liệu spare part trong nguồn này.');
  }
  const { files, warnings } = convertOld({
    meta: best.sp_meta?.value,
    items: best.sp_items?.value,
    tx: best.sp_tx?.value,
    hidden: best.sp_tx_hidden?.value,
  });
  const notes = [];
  for (const [key, list] of Object.entries(versions)) {
    if (list.length > 1) {
      const name = { sp_items: 'vật tư', sp_tx: 'giao dịch', sp_meta: 'cấu hình', sp_tx_hidden: 'giao dịch ẩn' }[key];
      const detail = key === 'sp_meta' ? '' : ` (số dòng: ${list.join(', ')})`;
      notes.push(`Tìm thấy ${list.length} phiên bản ${name}${detail}. Đã chọn bản đầy đủ nhất.`);
    }
  }
  if (best.sp_items && best.sp_items.size === 0) warnings.push('Danh sách vật tư tìm được đang trống — có thể đây là bản đã bị xóa trắng.');
  if (best.sp_meta && looksLikeResetMeta(best.sp_meta.value)) warnings.push('Danh sách người dùng giống bản mặc định (Nhân viên 01, 02…) — có thể đã bị ghi đè. Kiểm tra lại sau khi khôi phục.');
  return { files, counts: M.countDocs(files), warnings, notes, label };
}

/* ---------- đọc thẳng từ Firestore ---------- */

export async function fetchFirestore({ projectId, databaseId, collection, apiKey, readTime }) {
  const params = new URLSearchParams({ pageSize: '100' });
  if (apiKey) params.set('key', apiKey);
  if (readTime) params.set('readTime', readTime);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId || '(default)')}/documents/${encodeURIComponent(collection)}?${params}`;
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new M.UserError('Không kết nối được Firebase. Kiểm tra mạng.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Lỗi ${res.status}`;
    if (res.status === 403) throw new M.UserError(`Firebase từ chối quyền đọc: ${msg}`);
    if (/readTime|read_time|PITR|version/i.test(msg)) throw new M.UserError(`Không đọc được tại thời điểm đã chọn: ${msg}. Thời điểm phải trong 1 giờ qua, hoặc trong 7 ngày nếu đã bật PITR trước đó.`);
    throw new M.UserError(`Firebase báo lỗi: ${msg}`);
  }
  if (!data.documents || !data.documents.length) throw new M.UserError('Collection này không có document nào (tại thời điểm đã chọn).');
  return data;
}
