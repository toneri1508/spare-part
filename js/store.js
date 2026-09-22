import { GitHubRepo, GitHubError, gitBlobSha } from './github.js';
import * as M from './model.js';

const CONN_KEY = 'spk.conn.v1';
const USER_KEY = 'spk.user.v1';
const PREFS_KEY = 'spk.prefs.v1';
const POLL_MS = 20000;

export const store = {
  conn: null,
  gh: null,
  status: 'idle', // idle | loading | ready | uninitialized | error
  error: null,
  emptyRepo: false,
  head: null,
  treeSha: null,
  docs: null,
  view: null,
  user: null,
  saving: 0,
  syncedAt: 0,
  syncError: null,
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(reason) {
  for (const fn of listeners) {
    try { fn(reason); } catch (e) { console.error(e); }
  }
}

/* ---------- lưu trên thiết bị (chỉ thông tin kết nối và người đang dùng máy) ---------- */

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

export function loadConn() {
  const c = readJSON(CONN_KEY);
  return c && c.owner && c.repo && c.token ? c : null;
}
export function saveConn(conn) {
  localStorage.setItem(CONN_KEY, JSON.stringify(conn));
}
export function clearConn() {
  localStorage.removeItem(CONN_KEY);
  localStorage.removeItem(USER_KEY);
}

export const loadUserId = () => localStorage.getItem(USER_KEY);
export const saveUserId = (id) => localStorage.setItem(USER_KEY, id);
export const clearUserId = () => localStorage.removeItem(USER_KEY);

export function pref(key, fallback = null) {
  const p = readJSON(PREFS_KEY) || {};
  return key in p ? p[key] : fallback;
}
export function setPref(key, value) {
  const p = readJSON(PREFS_KEY) || {};
  p[key] = value;
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

function toBase64Url(text) {
  return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))));
}
export function encodeConnLink(c) {
  return toBase64Url(JSON.stringify({ v: 1, o: c.owner, r: c.repo, b: c.branch, t: c.token }));
}
export function decodeConnLink(s) {
  try {
    const j = JSON.parse(fromBase64Url(s));
    return j && j.o && j.r && j.t ? { owner: j.o, repo: j.r, branch: j.b || 'main', token: j.t } : null;
  } catch {
    return null;
  }
}

/* ---------- quyền ---------- */

/* Hai vai trò:
   - Quản trị viên: sửa được mọi thứ của ứng dụng (người dùng, kho, dây chuyền, cài đặt,
     lịch sử giao dịch, sao lưu) và xóa được vật tư.
   - Nhân viên: nhập/xuất kho, tạo vật tư, sửa mọi thông số của vật tư kể cả số tồn
     theo từng kho. Không xóa vật tư và không đụng tới phần quản lý. */
export const isAdmin = () => store.user?.role === 'admin';

/* ---------- đọc dữ liệu ---------- */

/* Bộ nhớ đệm nội dung file theo sha của Git. Cùng một sha thì chắc chắn cùng nội dung,
   nên file nào chưa đổi thì khỏi tải lại — đó là lý do khi máy khác lưu, máy này chỉ
   tải về đúng phần thay đổi.
   Mỗi lần lưu sinh ra sha mới, bản cũ thành rác và không bao giờ dùng lại nữa, nên sau
   mỗi lần đọc hoặc ghi ta dọn sạch những sha không còn thuộc phiên bản hiện tại.
   Không dọn thì bộ nhớ tab cứ phình theo số lần nhập/xuất trong ca làm. */
const blobCache = new Map(); // sha -> text
let docShas = new Map(); // path -> sha của phiên bản đang dùng

function pruneBlobCache() {
  const live = new Set(docShas.values());
  for (const sha of blobCache.keys()) {
    if (!live.has(sha)) blobCache.delete(sha);
  }
}
let headEtag = null;
let inflight = null;
let pollTimer = null;

export async function connect(conn) {
  stopPolling();
  store.conn = conn;
  store.gh = new GitHubRepo(conn);
  Object.assign(store, { status: 'loading', error: null, emptyRepo: false, head: null, treeSha: null, docs: null, view: null, syncError: null });
  headEtag = null;
  emit('status');
  try {
    await refresh(true);
  } catch (e) {
    if (e instanceof GitHubError && e.kind === 'empty') {
      Object.assign(store, { status: 'uninitialized', emptyRepo: true, docs: {} });
    } else {
      Object.assign(store, { status: 'error', error: e });
    }
    emit('status');
  }
  startPolling();
}

export function disconnect() {
  stopPolling();
  clearConn();
  Object.assign(store, { conn: null, gh: null, status: 'idle', docs: null, view: null, user: null, head: null });
  emit('status');
}

async function readSnapshot(headSha) {
  const { treeSha } = await store.gh.getCommit(headSha);
  const entries = await store.gh.listTree(treeSha);
  const files = entries.filter((e) => e.path.startsWith('data/') && e.path.endsWith('.json'));
  const docs = {};
  await Promise.all(
    files.map(async (f) => {
      let text = blobCache.get(f.sha);
      if (text == null) {
        text = await store.gh.getBlobText(f.sha);
        blobCache.set(f.sha, text);
      }
      try {
        docs[f.path] = JSON.parse(text);
      } catch {
        // Tuyệt đối không coi file hỏng là "trống" — dừng lại và báo.
        throw new M.UserError(`File ${f.path} trên GitHub bị hỏng (không đọc được). Mở lịch sử commit để khôi phục phiên bản trước.`);
      }
    })
  );
  // Danh sách file trên GitHub là bản chính xác nhất — lấy luôn làm mốc để dọn cache.
  docShas = new Map(files.map((f) => [f.path, f.sha]));
  pruneBlobCache();
  return { head: headSha, treeSha, docs };
}

function classify(docs) {
  const hasMeta = M.META in docs;
  const hasItems = M.ITEMS in docs;
  if (!hasMeta && !hasItems) return 'uninitialized';
  if (!hasMeta || !hasItems) {
    throw new M.UserError(`Kho dữ liệu thiếu file ${hasMeta ? M.ITEMS : M.META}. Mở lịch sử commit trên GitHub để khôi phục file này.`);
  }
  if (!Array.isArray(docs[M.ITEMS])) throw new M.UserError('File data/items.json không đúng định dạng.');
  const s = docs[M.STOCKS];
  if (s != null && (typeof s !== 'object' || Array.isArray(s))) throw new M.UserError('File data/stocks.json không đúng định dạng.');
  return 'ready';
}

function applySnapshot(snap) {
  const status = classify(snap.docs); // ném lỗi trước khi đụng vào dữ liệu đang có
  const prev = store.status;
  Object.assign(store, {
    head: snap.head,
    treeSha: snap.treeSha,
    docs: snap.docs,
    view: status === 'ready' ? M.buildView(snap.docs) : null,
    status,
    error: null,
    syncError: null,
    syncedAt: Date.now(),
  });
  return prev !== status ? 'status' : 'data';
}

export function refresh(force = false) {
  if (inflight) return inflight;
  inflight = (async () => {
    const r = await store.gh.getHead(force || !store.docs ? null : headEtag);
    if (r.notModified || (r.sha === store.head && store.docs)) {
      if (r.etag) headEtag = r.etag;
      store.syncedAt = Date.now();
      store.syncError = null;
      emit('synced');
      return false;
    }
    const snap = await readSnapshot(r.sha);
    const reason = applySnapshot(snap);
    headEtag = r.etag;
    emit(reason);
    return true;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function backgroundRefresh() {
  if (store.status !== 'ready' || store.saving || document.visibilityState !== 'visible') return;
  refresh().catch((e) => {
    store.syncError = e;
    emit('syncError');
  });
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(backgroundRefresh, POLL_MS);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
document.addEventListener('visibilitychange', backgroundRefresh);
window.addEventListener('online', backgroundRefresh);

/* ---------- ghi dữ liệu ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let queue = Promise.resolve();

/* Mọi thay đổi đều đi qua đây:
   1) đọc phiên bản mới nhất  2) chạy thao tác trên bản sao  3) kiểm tra không mất dữ liệu
   4) commit nối tiếp đúng phiên bản vừa đọc  5) nếu có người lưu trước → lặp lại từ bước 1.
   Nếu bất kỳ bước đọc nào lỗi, thao tác dừng và KHÔNG ghi gì cả. */
export function mutate(message, fn, opts = {}) {
  const run = () => doMutate(message, fn, opts);
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

async function doMutate(message, fn, opts) {
  if (!store.gh) throw new M.UserError('Chưa kết nối kho dữ liệu.');
  store.saving++;
  emit('saving');
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (store.emptyRepo) {
        await store.gh.initEmptyRepo();
        store.emptyRepo = false;
      }
      await refresh(true);
      if (store.status !== 'ready' && !(opts.allowUninitialized && store.status === 'uninitialized')) {
        throw new M.UserError('Dữ liệu chưa sẵn sàng, chưa thể lưu.');
      }

      const before = store.docs || {};
      const draft = structuredClone(before);
      /* Chuyển dữ liệu kiểu cũ (tồn nằm trong vật tư) sang stocks.json trước khi thao tác,
         để mọi hàm bên dưới chỉ phải biết một kiểu dữ liệu. */
      M.normalizeDraft(draft);
      const result = fn(draft);
      // Khôi phục có thể ghi đè bằng dữ liệu kiểu cũ → chuẩn hóa lại lần nữa.
      M.normalizeDraft(draft);
      // Dồn giao dịch ngày cũ vào file tháng: chỉ thực sự ghi một lần mỗi ngày.
      M.foldHotTx(draft);
      const changes = M.diffDocs(before, draft);
      if (!changes.length) return result;
      M.guardAgainstLoss(before, draft, opts);
      const status = classify(draft);

      const who = store.user ? `${store.user.name} (ID ${store.user.id})` : 'chưa đăng nhập';
      try {
        const { commitSha, treeSha } = await store.gh.commitFiles({
          parentSha: store.head,
          baseTreeSha: store.treeSha,
          files: changes,
          message: `${message}\n\nNgười thực hiện: ${who}`,
        });
        /* Tự lưu sẵn nội dung vừa ghi vào cache để lần đồng bộ sau khỏi tải lại,
           đồng thời cập nhật mốc sha rồi dọn những bản cũ vừa bị thay thế. */
        for (const c of changes) {
          if (c.delete) {
            docShas.delete(c.path);
            continue;
          }
          const sha = await gitBlobSha(c.content).catch(() => null);
          if (sha) {
            blobCache.set(sha, c.content);
            docShas.set(c.path, sha);
          } else {
            docShas.delete(c.path); // không tính được sha thì coi như chưa có bản nào
          }
        }
        pruneBlobCache();
        const prev = store.status;
        Object.assign(store, {
          head: commitSha,
          treeSha,
          docs: draft,
          view: status === 'ready' ? M.buildView(draft) : null,
          status,
          syncedAt: Date.now(),
          syncError: null,
        });
        headEtag = null;
        emit(prev !== status ? 'status' : 'data');
        return result;
      } catch (e) {
        if (e instanceof GitHubError && e.kind === 'conflict') {
          await sleep(300 * (attempt + 1) + Math.random() * 400);
          continue;
        }
        throw e;
      }
    }
    throw new M.UserError('Nhiều thiết bị đang lưu cùng lúc. Thử lại sau vài giây.');
  } finally {
    store.saving--;
    emit('saving');
  }
}

export function backupObject() {
  return {
    format: 'spare-part-github-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    source: store.conn ? `${store.conn.owner}/${store.conn.repo}@${store.conn.branch}` : null,
    commit: store.head,
    files: store.docs,
  };
}
