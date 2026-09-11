import { html, raw } from './html.js';
import { icon } from './ui.js';
import { getPhotoUrl } from './store.js';

/* Đưa ảnh vào HTML: chỉ đặt data-avatar-sha, chưa tải gì cả.
   bindAvatars() sau đó gắn IntersectionObserver — ảnh chỉ thật sự tải khi cuộn tới,
   nên danh sách 300 vật tư không tải 300 ảnh cùng lúc. */
export function avatarSpan(item, size = 'md') {
  const sha = item.photo?.sha || '';
  return html`<span class="avatar avatar-${size}" data-avatar-sha="${sha}" aria-hidden="true">${!sha && icon('box', 'avatar-ico')}</span>`;
}

let observer = null;
const bound = new WeakSet();
const loading = new WeakSet();

function ensureObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      bound.delete(e.target);
      load(e.target);
    }
  }, { rootMargin: '240px 0px' });
  return observer;
}

async function load(el) {
  const sha = el.dataset.avatarSha;
  if (!sha || loading.has(el)) return;
  loading.add(el);
  try {
    const url = await getPhotoUrl(sha);
    if (url && el.isConnected && el.dataset.avatarSha === sha) {
      el.style.backgroundImage = `url("${url}")`;
      el.classList.add('has-photo');
    }
  } catch {
    /* giữ khung trống, không chặn phần còn lại của danh sách */
  } finally {
    loading.delete(el);
  }
}

/* Gọi sau mỗi lần mount danh sách có avatarSpan bên trong. */
export function bindAvatars(root) {
  const io = ensureObserver();
  root.querySelectorAll('[data-avatar-sha]:not([data-avatar-sha=""])').forEach((el) => {
    if (bound.has(el)) return;
    bound.add(el);
    io.observe(el);
  });
}

/* Tải ngay, không chờ cuộn tới — dùng cho ảnh lớn trong bảng chi tiết/sửa vật tư. */
export async function loadAvatarNow(el) {
  bound.add(el);
  observer?.unobserve(el);
  await load(el);
}
