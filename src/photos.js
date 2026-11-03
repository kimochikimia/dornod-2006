const { pool } = require('./db');
const { escapeHtml, initials } = require('./helpers');

async function savePhoto(userId, photo, conn = pool) {
  await conn.query(
    'REPLACE INTO user_photos (user_id, mime, data) VALUES (?, ?, ?)',
    [userId, photo.mime, photo.buf]
  );
  // photo_v нь кэш шинэчлэх тоо (зураг солигдох бүрд өөрчлөгдөнө)
  await conn.query('UPDATE users SET photo_v = ? WHERE id = ?', [Math.floor(Date.now() / 1000) % 2000000000, userId]);
}

async function deletePhoto(userId) {
  await pool.query('DELETE FROM user_photos WHERE user_id = ?', [userId]);
  await pool.query('UPDATE users SET photo_v = NULL WHERE id = ?', [userId]);
}

// Аватар: зурагтай бөгөөд үзэгч нэвтэрсэн бол зураг, үгүй бол нэрийн эхний үсэг.
function avatarHtml(viewer, user, id, cls = '') {
  const c = `avatar ${cls}`.trim();
  if (viewer && user && user.photo_v && id) {
    return `<img class="${c}" src="/photos/${Number(id)}?v=${Number(user.photo_v)}" alt="${escapeHtml(`${user.surname || ''} ${user.name || ''}`.trim())}" loading="lazy">`;
  }
  return `<div class="${c}">${escapeHtml(initials(user))}</div>`;
}

module.exports = { savePhoto, deletePhoto, avatarHtml };
