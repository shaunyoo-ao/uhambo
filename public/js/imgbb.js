const IMGBB_API_KEY = '516189048fe779f2a6bed2047eedb392';

export async function resizeImageToBlob(file, maxW = 1600, maxH = 900, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      const ratio = Math.min(maxW / w, maxH / h, 1);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = url;
  });
}

export async function uploadToImgBB(blob) {
  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  const fd = new FormData();
  fd.append('key', IMGBB_API_KEY);
  fd.append('image', b64);
  const resp = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: fd });
  if (!resp.ok) throw new Error(`Upload failed (${resp.status})`);
  const json = await resp.json();
  if (!json.success) throw new Error(json.error?.message || 'ImgBB upload failed');
  return json.data.url;
}
