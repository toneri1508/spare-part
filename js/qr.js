import qrcode from './vendor/qrcode.mjs';

/* Tạo mã QR ngay trên máy, không gửi mã vật tư ra dịch vụ bên ngoài. */
qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));

export function qrSvg(text, { level = 'M', margin = 2 } = {}) {
  const qr = qrcode(0, level);
  qr.addData(String(text));
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin, scalable: true });
}
