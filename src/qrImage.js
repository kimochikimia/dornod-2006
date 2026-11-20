// Тасалбарын QR: хамгийн өндөр алдаа засах түвшинтэй (H, ~30%) тул голд нь сайтын лого суулгахад уншигдсаар байна.
// Сайт болон имэйлд ижил PNG ашиглана.
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { PNG } = require('pngjs');

const MARK_FILE = path.join(__dirname, '..', 'public', 'img', 'logo-mark.png');
const INK = [11, 16, 32]; // #0b1020
const BADGE = [12, 15, 34]; // #0c0f22 — сайтын бараан өнгө
let mark = null;

function put(png, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (y * png.width + x) * 4;
  const k = a / 255;
  png.data[i] = Math.round(r * k + png.data[i] * (1 - k));
  png.data[i + 1] = Math.round(g * k + png.data[i + 1] * (1 - k));
  png.data[i + 2] = Math.round(b * k + png.data[i + 2] * (1 - k));
  png.data[i + 3] = 255;
}

// Булан нь бөөрөнхий дөрвөлжин (булангийн ирмэгийг зөөлрүүлнэ)
function roundRect(png, x0, y0, w, h, r, color) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.max(r - x - 0.5, x + 0.5 - (w - r), 0);
      const dy = Math.max(r - y - 0.5, y + 0.5 - (h - r), 0);
      const cover = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(dx, dy)));
      if (cover > 0) put(png, x0 + x, y0 + y, color, Math.round(cover * 255));
    }
  }
}

// Логог хэмжээг нь багасган (хэсгийн дунджаар) голд нь буулгана
function drawMark(png, cx, cy, maxW, maxH) {
  if (!mark) mark = PNG.sync.read(fs.readFileSync(MARK_FILE));
  const s = Math.min(maxW / mark.width, maxH / mark.height);
  const w = Math.max(1, Math.round(mark.width * s));
  const h = Math.max(1, Math.round(mark.height * s));
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - h / 2);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const sx0 = Math.floor(tx / s); const sx1 = Math.max(sx0 + 1, Math.floor((tx + 1) / s));
      const sy0 = Math.floor(ty / s); const sy1 = Math.max(sy0 + 1, Math.floor((ty + 1) / s));
      let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
      for (let sy = sy0; sy < Math.min(sy1, mark.height); sy++) {
        for (let sx = sx0; sx < Math.min(sx1, mark.width); sx++) {
          const i = (sy * mark.width + sx) * 4;
          const al = mark.data[i + 3];
          r += mark.data[i] * al; g += mark.data[i + 1] * al; b += mark.data[i + 2] * al; a += al; n++;
        }
      }
      if (!a) continue;
      put(png, x0 + tx, y0 + ty, [r / a, g / a, b / a], Math.round(a / n));
    }
  }
}

// text → PNG Buffer. scale — нэг модулийн пиксел, margin — модулиар
function ticketQrPng(text, { scale = 10, margin = 2 } = {}) {
  const qr = QRCode.create(String(text), { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const size = (n + margin * 2) * scale;
  const png = new PNG({ width: size, height: size });
  png.data.fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) put(png, (c + margin) * scale + x, (r + margin) * scale + y, INK);
    }
  }
  // Голын тэмдэг: QR-ийн өргөний ~22% (талбайн ~5%), H түвшин 30% хүртэл гэмтлийг нөхнө
  const qrPx = n * scale;
  const badge = Math.round(qrPx * 0.22);
  const ring = Math.round(scale * 0.8);
  const c = size / 2;
  roundRect(png, Math.round(c - badge / 2 - ring), Math.round(c - badge / 2 - ring), badge + ring * 2, badge + ring * 2, Math.round(badge * 0.24), [255, 255, 255]);
  roundRect(png, Math.round(c - badge / 2), Math.round(c - badge / 2), badge, badge, Math.round(badge * 0.2), BADGE);
  drawMark(png, c, c, badge * 0.8, badge * 0.8);
  return PNG.sync.write(png);
}

const ticketQrDataUri = (text) => `data:image/png;base64,${ticketQrPng(text).toString('base64')}`;

module.exports = { ticketQrPng, ticketQrDataUri };
