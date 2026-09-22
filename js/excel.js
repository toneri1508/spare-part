import * as M from './model.js';
import { fmtTime } from './ui.js';

const LIB = {
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  exceljs: 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
};
const loading = {};

/* Chỉ tải thư viện Excel khi thật sự cần → mở web trên điện thoại nhanh hơn. */
function loadScript(src) {
  if (!loading[src]) {
    loading[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        delete loading[src];
        s.remove();
        reject(new M.UserError('Không tải được thư viện Excel. Kiểm tra mạng rồi thử lại.'));
      };
      document.head.appendChild(s);
    });
  }
  return loading[src];
}

function saveBuffer(buf, filename) {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/* ---------- file mẫu nhập kho (giữ đúng cột của bản cũ để dùng lại file đã có) ---------- */

export async function downloadTemplate(v) {
  await loadScript(LIB.exceljs);
  const whNames = v.meta.warehouses.map((w) => w.name);
  const userNames = v.meta.users.map((u) => u.name);
  const wb = new window.ExcelJS.Workbook();

  const lists = wb.addWorksheet('_DanhSach');
  whNames.forEach((n, i) => { lists.getCell(`A${i + 1}`).value = n; });
  userNames.forEach((n, i) => { lists.getCell(`B${i + 1}`).value = n; });
  lists.state = 'veryHidden';

  const ws = wb.addWorksheet('Nhap kho');
  ws.columns = [
    { header: 'Mã spare part', key: 'code', width: 16 },
    { header: 'Tên vật tư', key: 'name', width: 28 },
    { header: 'Nhóm', key: 'group', width: 14 },
    { header: 'Đơn vị', key: 'unit', width: 10 },
    { header: 'Tồn tối thiểu', key: 'min', width: 13 },
    { header: 'Kho nhập', key: 'wh', width: 22 },
    { header: 'Số lượng nhập', key: 'qty', width: 14 },
    { header: 'Người nhập', key: 'user', width: 18 },
    { header: 'Ghi chú', key: 'note', width: 24 },
    { header: 'Detail', key: 'detail', width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.addRow({ code: 'SP-BM-050', name: 'Bo mạch cảm biến ánh sáng', group: 'Bo mạch', unit: 'cái', min: 10, wh: whNames[0] || '', qty: 25, user: userNames[0] || '', note: 'Hàng về đợt mới', detail: 'Cảm biến quang NPN, 12-24VDC' });
  ws.addRow({ code: 'SP-CK-060', name: 'Ốc vít M4x10', group: 'Cơ khí', unit: 'gói', min: 20, wh: whNames[1] || whNames[0] || '', qty: 100 });

  for (let r = 2; r <= 500; r++) {
    if (whNames.length) {
      ws.getCell(`F${r}`).dataValidation = {
        type: 'list', allowBlank: true, showErrorMessage: true,
        formulae: [`_DanhSach!$A$1:$A$${whNames.length}`],
        errorTitle: 'Tên kho không đúng', error: 'Chọn tên kho trong danh sách sổ xuống.',
      };
    }
    if (userNames.length) {
      ws.getCell(`H${r}`).dataValidation = {
        type: 'list', allowBlank: true, showErrorMessage: false,
        formulae: [`_DanhSach!$B$1:$B$${userNames.length}`],
      };
    }
  }

  const guide = wb.addWorksheet('Huong dan');
  guide.getColumn(1).width = 90;
  [
    'Cách điền file',
    'Mã spare part: bắt buộc. Mã đã có trong hệ thống thì chỉ cần điền các cột muốn cập nhật.',
    'Tên vật tư: bắt buộc với mã mới.',
    'Kho nhập: chọn trong danh sách sổ xuống để không sai chính tả.',
    'Số lượng nhập: để trống nếu chỉ tạo hoặc sửa thông tin vật tư.',
    'Người nhập: chọn trong danh sách; để trống sẽ ghi là người đang tải file lên.',
    'Xóa hai dòng ví dụ trước khi điền dữ liệu thật.',
  ].forEach((line) => guide.addRow([line]));

  saveBuffer(await wb.xlsx.writeBuffer(), 'mau-nhap-kho.xlsx');
}

/* ---------- đọc file nhập ---------- */

function mapRow(rawRow) {
  const out = { code: '', name: '', group: '', unit: '', min: '', wh: '', qty: '', user: '', note: '', detail: '' };
  for (const [header, value] of Object.entries(rawRow)) {
    const h = M.fold(header);
    const s = String(value ?? '').trim();
    if (/\bma\b|\bcode\b/.test(h)) out.code = M.normCode(s);
    else if (/\bten\b/.test(h)) out.name = s;
    else if (/\bnhom\b/.test(h)) out.group = s;
    else if (h.includes('don vi')) out.unit = s;
    else if (h.includes('toi thieu')) out.min = s;
    else if (/\bkho\b/.test(h)) out.wh = s;
    else if (h.includes('so luong')) out.qty = s;
    else if (/\bnguoi\b/.test(h)) out.user = s;
    else if (h.includes('detail') || h.includes('mo ta')) out.detail = s;
    else if (h.includes('ghi chu')) out.note = s;
  }
  return out;
}

const isPositive = (s) => s !== '' && Number.isFinite(Number(s)) && Number(s) > 0;

export function validateRow(row, items, meta) {
  if (!row.code) return { status: 'err', reason: 'Thiếu mã spare part' };
  const existing = M.findByCode(items, row.code);
  if (!existing && !row.name) return { status: 'err', reason: 'Mã mới nhưng thiếu tên' };
  if (row.qty !== '' && !isPositive(row.qty)) return { status: 'err', reason: `Số lượng "${row.qty}" không hợp lệ` };
  if (row.min !== '' && !Number.isFinite(Number(row.min))) return { status: 'err', reason: `Tồn tối thiểu "${row.min}" không hợp lệ` };
  if (isPositive(row.qty)) {
    if (!row.wh) return { status: 'err', reason: 'Có số lượng nhưng thiếu kho' };
    if (!meta.warehouses.some((w) => M.fold(w.name) === M.fold(row.wh))) return { status: 'err', reason: `Không có kho "${row.wh}"` };
  }
  if (row.user && !meta.users.some((u) => M.fold(u.name) === M.fold(row.user))) {
    return { status: 'warn', reason: `Chưa có người dùng "${row.user}", vẫn ghi theo tên` };
  }
  return { status: 'ok', reason: existing ? 'Cập nhật vật tư có sẵn' : 'Tạo vật tư mới' };
}

export async function readImportFile(file) {
  await loadScript(LIB.xlsx);
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const name = wb.SheetNames.find((n) => M.fold(n).includes('nhap')) || wb.SheetNames.find((n) => !n.startsWith('_')) || wb.SheetNames[0];
  const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
  return rows.map(mapRow).filter((r) => r.code || r.name);
}

/* Áp dụng các dòng hợp lệ vào bản nháp — chạy bên trong store.mutate. */
export function applyImport(d, rows, user) {
  const items = M.draftItems(d);
  const meta = M.draftMeta(d);
  const res = { created: 0, updated: 0, moves: 0 };
  const now = Date.now();
  rows.forEach((row, i) => {
    if (validateRow(row, items, meta).status === 'err') return;
    let item = M.findByCode(items, row.code);
    if (!item) {
      item = {
        id: M.uid('it'), code: row.code, name: row.name, group: row.group || 'Khác', unit: row.unit || 'cái',
        min: row.min !== '' ? Math.max(0, Math.round(Number(row.min))) : 0, detail: row.detail || '',
      };
      items.push(item);
      res.created++;
    } else {
      if (row.name) item.name = row.name;
      if (row.group) item.group = row.group;
      if (row.unit) item.unit = row.unit;
      if (row.min !== '') item.min = Math.max(0, Math.round(Number(row.min)));
      if (row.detail) item.detail = row.detail;
      res.updated++;
    }
    if (isPositive(row.qty)) {
      const wh = meta.warehouses.find((w) => M.fold(w.name) === M.fold(row.wh));
      const qty = Math.round(Number(row.qty));
      const matched = row.user ? meta.users.find((u) => M.fold(u.name) === M.fold(row.user)) : null;
      M.addStock(d, item.id, wh.id, qty);
      M.pushTx(d, {
        id: M.uid('tx'), ts: now + i, type: 'nhap', itemId: item.id, qty, whId: wh.id, lineId: null,
        userId: matched ? matched.id : row.user ? null : user.id, rawUser: matched || !row.user ? null : row.user,
        note: row.note || '', source: 'excel',
      });
      res.moves++;
    }
  });
  return res;
}

/* ---------- xuất báo cáo ---------- */

async function writeSheet(rows, sheetName, filename, widths) {
  await loadScript(LIB.xlsx);
  const ws = window.XLSX.utils.json_to_sheet(rows);
  if (widths) ws['!cols'] = widths.map((wch) => ({ wch }));
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
  window.XLSX.writeFile(wb, filename);
}

export function exportInventory(v, items) {
  const rows = items.map((it) => {
    const row = {
      'Mã spare part': it.code, 'Tên vật tư': it.name, 'Nhóm': it.group || '', 'Đơn vị': it.unit || '',
      'Tồn tối thiểu': M.num(it.min), 'Tổng tồn': M.totalQty(it), 'Trạng thái': M.STATUS_LABEL[M.statusOf(it)],
    };
    for (const w of v.meta.warehouses) row[w.name] = M.num(it.stocks?.[w.id]);
    row.Detail = it.detail || '';
    return row;
  });
  return writeSheet(rows, 'Ton kho', `ton-kho-${stamp()}.xlsx`, [16, 30, 14, 8, 12, 10, 10]);
}

export function exportHistory(v, list) {
  const rows = list.map((t) => {
    const it = v.itemById.get(t.itemId);
    return {
      'Thời gian': fmtTime(t.ts), 'Loại': M.TYPE_LABEL[t.type] || t.type, 'Mã spare part': it ? it.code : '(đã xóa)',
      'Tên vật tư': it ? it.name : '', 'Số lượng': M.num(t.qty), 'Đơn vị': it ? it.unit : '', 'Kho': M.whName(v, t.whId),
      'Dây chuyền': t.lineId ? M.lineName(v, t.lineId) : '', 'Người thực hiện': M.userName(v, t.userId, t.rawUser), 'Ghi chú': t.note || '',
    };
  });
  return writeSheet(rows, 'Lich su', `lich-su-kho-${stamp()}.xlsx`, [17, 6, 16, 30, 9, 8, 18, 16, 20, 30]);
}
