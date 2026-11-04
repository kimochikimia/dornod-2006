// Фото альбом: альбом, зургийг өгөгдлийн санд хадгална.
// Нийтэд нээлттэй (is_public) альбомыг хэн ч, бусдыг нь зөвхөн баталгаажсан төгсөгч үзнэ.
const { pool } = require('./db');

const MAX_PHOTO = 4 * 1024 * 1024; // браузер дээр шахсан бүтэн зураг
const MAX_THUMB = 600 * 1024; // жижиг хувилбар

const seesPrivate = (user) => !!(user && user.status === 'approved');

// Харагдах альбомууд (зурагтай нь), шинэ нь эхэндээ
async function visibleAlbums(user, limit = 100) {
  const [rows] = await pool.query(
    `SELECT a.id, a.title, a.description, a.is_public,
            DATE_FORMAT(a.event_date, '%Y.%m.%d') AS event_date,
            (SELECT COUNT(*) FROM gallery_photos p WHERE p.album_id = a.id) AS photo_count,
            COALESCE(a.cover_photo_id,
              (SELECT p.id FROM gallery_photos p WHERE p.album_id = a.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1)) AS cover_id
     FROM gallery_albums a
     WHERE a.is_public = 1 OR ?
     HAVING photo_count > 0
     ORDER BY COALESCE(a.event_date, DATE(a.created_at)) DESC, a.id DESC
     LIMIT ?`,
    [seesPrivate(user), limit]
  );
  return rows;
}

// Харагдах альбомуудын сүүлийн зургууд (нүүр хуудасны коллаж)
async function latestPhotos(user, limit = 9) {
  const [rows] = await pool.query(
    `SELECT p.id, p.caption, p.width, p.height, p.album_id, a.title AS album_title
     FROM gallery_photos p JOIN gallery_albums a ON a.id = p.album_id
     WHERE a.is_public = 1 OR ?
     ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
    [seesPrivate(user), limit]
  );
  return rows;
}

async function albumPhotos(albumId) {
  const [rows] = await pool.query(
    `SELECT p.id, p.caption, p.width, p.height, DATE_FORMAT(p.created_at, '%Y.%m.%d') AS created
     FROM gallery_photos p WHERE p.album_id = ? ORDER BY p.created_at, p.id`,
    [albumId]
  );
  return rows;
}

async function getAlbum(id) {
  const [[a]] = await pool.query(
    `SELECT a.*, DATE_FORMAT(a.event_date, '%Y-%m-%d') AS event_date_input, DATE_FORMAT(a.event_date, '%Y.%m.%d') AS event_date_text
     FROM gallery_albums a WHERE a.id = ?`,
    [id]
  );
  return a || null;
}

const canView = (album, user) => !!album && (album.is_public === 1 || seesPrivate(user));

// data:image/jpeg;base64,... → Buffer (JPEG эсэх, хэмжээг шалгана). Буруу бол null.
function parseJpeg(dataUrl, max) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 100 || buf.length > max) return null;
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return null;
  return buf;
}

module.exports = { MAX_PHOTO, MAX_THUMB, seesPrivate, visibleAlbums, latestPhotos, albumPhotos, getAlbum, canView, parseJpeg };
