/* Nén ảnh ngay trên máy trước khi tải lên — không có ảnh gốc rời rạc nào được lưu.
   Avatar dùng để nhận diện/định vị vật tư trong kho, không cần đọc chữ nhỏ,
   nên ưu tiên thu nhỏ kích thước trước, sau đó mới giảm chất lượng JPEG. */

const MAX_DIM = 640;
const TARGET_KB = 150;
const MIN_QUALITY = 0.35;

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* một số trình duyệt cũ không hỗ trợ tùy chọn xoay ảnh — thử cách khác */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('load-fail'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fitSize(w, h, maxDim) {
  if (w <= maxDim && h <= maxDim) return { w, h };
  const scale = maxDim / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode-fail'))), 'image/jpeg', quality);
  });
}

/* Trả về Blob JPEG đã nén, cỡ vài chục đến ~150KB, cạnh dài tối đa 640px. */
export async function compressAvatar(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Chỉ chọn được file ảnh (JPEG, PNG, HEIC…).');
  }
  const bitmap = await loadBitmap(file).catch(() => {
    throw new Error('Không đọc được ảnh này. Thử chụp lại hoặc chọn ảnh khác.');
  });
  const srcW = bitmap.width, srcH = bitmap.height;
  const { w, h } = fitSize(srcW, srcH, MAX_DIM);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // ảnh PNG trong suốt không bị đổi sang đen khi ép JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let quality = 0.85;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > TARGET_KB * 1024 && quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, quality - 0.12);
    blob = await canvasToBlob(canvas, quality);
  }
  return blob;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Không đọc được dữ liệu ảnh.'));
    r.readAsDataURL(blob);
  });
}
