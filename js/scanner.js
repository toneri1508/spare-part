import { UserError } from './model.js';

const active = new Set();

export const scannerActive = () => active.size > 0;

export function stopAllScanners() {
  [...active].forEach((h) => h.stop());
}

/* container chứa sẵn một <video>. Trả về { stop }. Tự tắt camera khi đọc được mã. */
export async function startScanner(container, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new UserError('Trình duyệt này không mở được camera. Hãy dùng Chrome hoặc Safari bản mới, qua đường dẫn https.');
  }
  stopAllScanners();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    throw new UserError(denied ? 'Chưa được cấp quyền camera. Cho phép camera trong cài đặt trình duyệt rồi thử lại.' : 'Không mở được camera.');
  }

  const video = container.querySelector('video');
  video.srcObject = stream;
  container.hidden = false;
  try { await video.play(); } catch { /* một số máy tự phát */ }

  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch { detector = null; }
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let stopped = false;
  const handle = {
    stop() {
      if (stopped) return;
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      container.hidden = true;
      active.delete(handle);
      container.dispatchEvent(new CustomEvent('scanner-stop'));
    },
  };
  active.add(handle);

  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        let text = null;
        if (detector) {
          const found = await detector.detect(video);
          if (found[0]) text = found[0].rawValue;
        } else if (window.jsQR) {
          const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (r) text = r.data;
        }
        if (text && text.trim() && !stopped) {
          handle.stop();
          if (navigator.vibrate) navigator.vibrate(60);
          onCode(text.trim());
          return;
        }
      }
    } catch { /* bỏ qua khung hình lỗi */ }
    setTimeout(tick, 150);
  };
  tick();
  return handle;
}
