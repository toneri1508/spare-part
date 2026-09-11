import { html, mount } from '../html.js';
import { confirmDialog, errorText } from '../ui.js';
import { GitHubRepo, GitHubError, parseRepoInput } from '../github.js';

export function renderSetup(el, { onConnected, prefill = null }) {
  mount(el, html`<div class="gate"><div class="gate-card gate-wide">
    <p class="gate-brand">Kho spare part</p>
    <h1 class="gate-title">Kết nối kho dữ liệu</h1>
    <p>Dữ liệu được lưu trong một kho GitHub riêng tư. Mỗi thiết bị chỉ cần kết nối một lần.</p>
    <p class="notice">Nếu quản trị viên đã gửi link hoặc mã QR kết nối, chỉ cần mở link đó là xong.</p>

    <form class="form" data-connect novalidate>
      <label class="field"><span class="label">Kho dữ liệu GitHub</span>
        <input name="repo" placeholder="ten-tai-khoan/spare-part-data" value="${prefill ? `${prefill.owner}/${prefill.repo}` : ''}" autocapitalize="none" autocorrect="off" spellcheck="false">
        <span class="hint">Gõ tên-tài-khoản/tên-kho, hoặc dán link của kho.</span></label>
      <div class="row2">
        <label class="field"><span class="label">Nhánh</span><input name="branch" value="${prefill?.branch || 'main'}" autocapitalize="none" spellcheck="false"></label>
        <label class="field"><span class="label">Khóa truy cập</span><input name="token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
      </div>
      <p class="form-error" data-err hidden></p>
      <button type="submit" class="btn btn-primary btn-block btn-lg">Kết nối</button>
    </form>

    <details class="guide">
      <summary>Cách tạo kho dữ liệu và khóa truy cập</summary>
      <ol>
        <li>Trên github.com, bấm <b>New repository</b>. Đặt tên, ví dụ <code>spare-part-data</code>, chọn <b>Private</b>, đánh dấu <b>Add a README file</b>, rồi bấm <b>Create repository</b>.</li>
        <li>Bấm ảnh đại diện, vào <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
        <li>Ở <b>Repository access</b>, chọn <b>Only select repositories</b> và chọn đúng kho dữ liệu vừa tạo.</li>
        <li>Ở <b>Permissions</b>, tìm <b>Contents</b> và chọn <b>Read and write</b>. Chọn thời hạn dài nhất được phép và ghi lại ngày hết hạn.</li>
        <li>Bấm <b>Generate token</b>, sao chép khóa bắt đầu bằng <code>github_pat_</code> và dán vào ô phía trên.</li>
      </ol>
    </details>
  </div></div>`);

  const form = el.querySelector('[data-connect]');
  const err = el.querySelector('[data-err]');
  const fail = (msg) => { err.textContent = msg; err.hidden = false; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const parsed = parseRepoInput(form.repo.value);
    const token = form.token.value.trim();
    const branch = form.branch.value.trim() || 'main';
    if (!parsed) return fail('Tên kho chưa đúng dạng tên-tài-khoản/tên-kho.');
    if (!token) return fail('Dán khóa truy cập GitHub vào ô Khóa truy cập.');

    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Đang kiểm tra…';
    try {
      const gh = new GitHubRepo({ ...parsed, branch, token });
      const repo = await gh.getRepo();
      try {
        await gh.getHead();
      } catch (x) {
        if (!(x instanceof GitHubError && x.kind === 'empty')) {
          if (x instanceof GitHubError && x.kind === 'notfound') {
            throw new Error(`Kho không có nhánh "${branch}". Nhánh mặc định của kho là "${repo.default_branch}".`);
          }
          throw x;
        }
      }
      if (!repo.private) {
        const r = await confirmDialog({
          title: 'Kho đang công khai',
          message: 'Ai có link cũng xem được toàn bộ dữ liệu kho spare part. Nên đổi kho sang Private trong phần Settings của kho trên GitHub.',
          confirmText: 'Vẫn kết nối',
          danger: true,
        });
        if (!r.ok) return;
      }
      onConnected({ owner: parsed.owner, repo: parsed.repo, branch, token });
    } catch (x) {
      fail(errorText(x));
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = 'Kết nối';
      }
    }
  });
}
