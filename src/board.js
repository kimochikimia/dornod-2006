// Удирдах зөвлөлийн албан тушаалууд. Зөвлөлийн анхны хурлын шийдвэрээр админ томилно.
const POSTS = [
  { key: 'chair', label: 'Зөвлөлийн дарга', desc: 'Ерөнхий зохицуулалт', single: true },
  { key: 'secretary', label: 'Нарийн бичгийн дарга', desc: 'Хурал, шийдвэр, тайлан', single: true },
  { key: 'finance', label: 'Санхүү хариуцсан гишүүн', desc: 'Төсөв, ил тод байдал', single: true },
  { key: 'member', label: 'Зөвлөлийн гишүүн', desc: 'Сургууль, үйл ажиллагааны төлөөлөл', single: false },
  { key: 'unassigned', label: 'Томилогдоогүй', desc: 'Зөвлөлийн хурлаар албан тушаалд томилогдоно', single: false },
];
const POST_KEYS = POSTS.map((p) => p.key);
const POST_BY_KEY = Object.fromEntries(POSTS.map((p) => [p.key, p]));
// SQL эрэмбэлэлт: дарга → нарийн бичиг → санхүү → гишүүд → томилогдоогүй
const POST_ORDER_SQL = `FIELD(b.post, ${POST_KEYS.map((k) => `'${k}'`).join(',')})`;

// Хуучин чөлөөт текстэн албан тушаалыг шинэ ангилалд буулгах
function guessPost(text) {
  const t = String(text || '').toLowerCase();
  if (/нарийн/.test(t)) return 'secretary';
  if (/санхүү|нягтлан/.test(t)) return 'finance';
  if (/^(тэргүүн|дарга|зөвлөлийн дарга)$/.test(t.trim())) return 'chair';
  // Хуучин хувилбар сонгуулийн дүнгээс нэмэхдээ "Гишүүн" гэж автоматаар бичдэг байсан —
  // энэ нь томилгоо биш тул "Томилогдоогүй" болгоно.
  if (t.trim() === 'гишүүн' || !t.trim()) return 'unassigned';
  return 'member';
}

module.exports = { POSTS, POST_KEYS, POST_BY_KEY, POST_ORDER_SQL, guessPost };
