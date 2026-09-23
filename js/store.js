import { GitHubRepo, GitHubError, gitBlobSha } from './github.js';
import * as M from './model.js';
import { blobToBase64 } from './photo.js';

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

export const isAdmin = () => store.user?.role === 'admin';
export const canEditItems = () => isAdmin() || !!store.view?.meta.settings.staffCanEditItems;

/* ---------- đọc dữ liệu ---------- */

const blobCache = new Map(); // sha -> text; blob theo sha không bao giờ đổi nên cache an toàn
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
/* opts.extraFiles: [{ path, sha }] hoặc [{ path, delete: true }] — file nhị phân (ảnh) đã có sẵn sha,
   được đưa vào CÙNG một commit với thay đổi JSON, để không bao giờ có ảnh mà thiếu tham chiếu hoặc ngược lại. */
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
      const result = fn(draft);
      const changes = M.diffDocs(before, draft);
      if (opts.extraFiles?.length) changes.push(...opts.extraFiles);
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
        for (const c of changes) {
          if (c.delete || !('content' in c)) continue; // file nhị phân (ảnh) đã cache riêng lúc tải lên
          const sha = await gitBlobSha(c.content).catch(() => null);
          if (sha) blobCache.set(sha, c.content);
        }
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

/* ---------- ảnh đại diện vật tư ---------- */
/* Ảnh KHÔNG nằm trong docs (data/*.json) — không tải toàn bộ ảnh mỗi lần đồng bộ,
   chỉ tải đúng ảnh đang cần xem, và giữ lại trong bộ nhớ theo sha (sha đổi khi ảnh đổi). */

const photoCache = new Map(); // sha -> object URL
export const photoPath = (itemId) => `data/photos/${itemId}.jpg`;

export async function getPhotoUrl(sha) {
  if (!sha) return null;
  if (photoCache.has(sha)) return photoCache.get(sha);
  if (!store.gh) return null;
  const base64 = await store.gh.getBlobBase64(sha);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
  photoCache.set(sha, url);
  return url;
}

/* Chỉ tải ảnh lên thành một blob Git rời, CHƯA gắn vào vật tư nào — dùng khi tạo
   vật tư mới, lúc đó chưa có itemId để gọi setItemPhoto() ngay. Nơi gọi tự gộp
   { path, sha } vào extraFiles của mutate() lúc tạo vật tư, để ảnh và vật tư mới
   vào chung một commit (không bao giờ có ảnh mồ côi hoặc vật tư thiếu ảnh). */
export async function uploadPhotoBlob(blob) {
  if (!store.gh) throw new M.UserError('Chưa kết nối kho dữ liệu.');
  const base64 = await blobToBase64(blob);
  const sha = await store.gh.createBlob(base64);
  photoCache.set(sha, URL.createObjectURL(blob));
  return sha;
}

export async function setItemPhoto(itemId, blob) {
  const base64 = await blobToBase64(blob);
  const sha = await store.gh.createBlob(base64);
  photoCache.set(sha, URL.createObjectURL(blob)); // xem trước ngay, khỏi tải lại từ GitHub
  const label = store.view?.itemById.get(itemId)?.code || itemId;
  await mutate(`Cập nhật ảnh ${label}`, (d) => {
    const it = M.requireItem(d, itemId);
    it.photo = { sha, updatedAt: Date.now() };
  }, { extraFiles: [{ path: photoPath(itemId), sha }] });
  return sha;
}

export async function removeItemPhoto(itemId) {
  const label = store.view?.itemById.get(itemId)?.code || itemId;
  await mutate(`Xóa ảnh ${label}`, (d) => {
    const it = M.requireItem(d, itemId);
    delete it.photo;
  }, { extraFiles: [{ path: photoPath(itemId), delete: true }] });
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
