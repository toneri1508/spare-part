/* Kết nối GitHub REST API.
   Mỗi lần lưu là MỘT commit chứa mọi file thay đổi (ghi nguyên khối, không ghi nửa chừng).
   Commit luôn nối tiếp đúng phiên bản vừa đọc; nếu người khác đã lưu trước,
   GitHub từ chối (không fast-forward) và app đọc lại rồi làm lại thao tác. */

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, kind, message) {
    super(message);
    this.status = status;
    this.kind = kind; // network | auth | forbidden | ratelimit | notfound | empty | conflict | invalid | server
  }
}

export function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function base64ToText(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* SHA của blob theo cách Git tính — dùng để nhận ra file chưa đổi, khỏi tải lại. */
export async function gitBlobSha(text) {
  if (!globalThis.crypto?.subtle) return null;
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head, 0);
  all.set(body, head.length);
  const hash = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseRepoInput(input) {
  const s = String(input || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = s.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i) || s.match(/^([^/\s]+)\/([^/\s]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export class GitHubRepo {
  constructor({ owner, repo, branch, token }) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || 'main';
    this.token = token;
  }

  get base() {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
  }

  get webUrl() {
    return `https://github.com/${this.owner}/${this.repo}`;
  }

  get commitsUrl() {
    return `${this.webUrl}/commits/${encodeURIComponent(this.branch)}`;
  }

  async request(method, path, { body, etag } = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body) headers['Content-Type'] = 'application/json';
    if (etag) headers['If-None-Match'] = etag;

    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      throw new GitHubError(0, 'network', 'Không kết nối được GitHub. Kiểm tra mạng rồi thử lại.');
    }

    if (res.status === 304) return { status: 304, notModified: true };

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!res.ok) throw this.toError(res, data);
    return { status: res.status, data, etag: res.headers.get('ETag') };
  }

  toError(res, data) {
    const msg = (data && data.message) || '';
    const s = res.status;
    if (s === 401) return new GitHubError(s, 'auth', 'Khóa truy cập GitHub không hợp lệ hoặc đã hết hạn. Quản trị viên cần tạo khóa mới rồi kết nối lại.');
    if (s === 403 || s === 429) {
      if (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(msg)) {
        return new GitHubError(s, 'ratelimit', 'GitHub tạm giới hạn số lần truy cập. Đợi vài phút rồi thử lại.');
      }
      return new GitHubError(s, 'forbidden', 'Khóa truy cập không có quyền ghi vào kho dữ liệu. Kiểm tra quyền "Contents: Read and write" của khóa.');
    }
    if (s === 404) return new GitHubError(s, 'notfound', `Không tìm thấy kho "${this.owner}/${this.repo}" hoặc nhánh "${this.branch}". Kiểm tra tên kho, nhánh và quyền của khóa truy cập.`);
    if (s === 409 && /empty/i.test(msg)) return new GitHubError(s, 'empty', 'Kho dữ liệu GitHub đang trống.');
    if (s === 422 && /fast.?forward/i.test(msg)) return new GitHubError(s, 'conflict', 'Dữ liệu vừa được thiết bị khác cập nhật.');
    if (s === 409 || s === 422) return new GitHubError(s, 'invalid', `GitHub từ chối yêu cầu: ${msg || s}`);
    return new GitHubError(s, 'server', `GitHub đang gặp sự cố (${s}). Thử lại sau ít phút.`);
  }

  async getRepo() {
    const { data } = await this.request('GET', this.base);
    return data;
  }

  /* Trả về { sha, etag } hoặc { notModified: true } nếu nhánh chưa đổi (không tốn lượt truy cập). */
  async getHead(etag) {
    const r = await this.request('GET', `${this.base}/git/ref/heads/${encodeURIComponent(this.branch)}`, { etag });
    if (r.notModified) return r;
    return { sha: r.data.object.sha, etag: r.etag };
  }

  async getCommit(sha) {
    const { data } = await this.request('GET', `${this.base}/git/commits/${sha}`);
    return { sha: data.sha, treeSha: data.tree.sha, message: data.message };
  }

  async listTree(treeSha) {
    const { data } = await this.request('GET', `${this.base}/git/trees/${treeSha}?recursive=1`);
    if (data.truncated) throw new GitHubError(200, 'invalid', 'Kho dữ liệu có quá nhiều file.');
    return data.tree.filter((e) => e.type === 'blob');
  }

  async getBlobText(sha) {
    const { data } = await this.request('GET', `${this.base}/git/blobs/${sha}`);
    return base64ToText(data.content);
  }

  /* files: [{ path, content }] hoặc [{ path, delete: true }] — tất cả nằm trong một commit. */
  async commitFiles({ parentSha, baseTreeSha, files, message }) {
    const tree = files.map((f) =>
      f.delete
        ? { path: f.path, mode: '100644', type: 'blob', sha: null }
        : { path: f.path, mode: '100644', type: 'blob', content: f.content }
    );
    const t = await this.request('POST', `${this.base}/git/trees`, { body: { base_tree: baseTreeSha, tree } });
    const c = await this.request('POST', `${this.base}/git/commits`, {
      body: { message, tree: t.data.sha, parents: [parentSha] },
    });
    await this.request('PATCH', `${this.base}/git/refs/heads/${encodeURIComponent(this.branch)}`, {
      body: { sha: c.data.sha, force: false },
    });
    return { commitSha: c.data.sha, treeSha: t.data.sha };
  }

  /* Kho mới tạo chưa có commit nào thì Git API không ghi được — tạo README trước. */
  async initEmptyRepo() {
    const content = textToBase64(
      '# Dữ liệu kho spare part\n\nThư mục `data/` do web quản lý kho tự ghi. Mỗi thay đổi là một commit — xem tab Commits để khôi phục phiên bản cũ.\n'
    );
    await this.request('PUT', `${this.base}/contents/README.md`, {
      body: { message: 'Khởi tạo kho dữ liệu', content, branch: this.branch },
    });
  }
}
