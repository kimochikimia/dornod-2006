const { pool } = require('./db');

const { REACTIONS } = require('./helpers'); // [түлхүүр, emoji, нэр]
const REACTION_KEYS = REACTIONS.map((r) => r[0]);
const TYPES = ['news', 'comment'];

const empty = () => ({ counts: [], mine: null, total: 0 });

// { [id]: { counts: [{ key, emoji, label, n, names }], mine, total } }
async function loadReactions(type, ids, userId) {
  const out = {};
  for (const id of ids) out[id] = empty();
  if (!ids.length) return out;
  const [rows] = await pool.query(
    `SELECT r.target_id, r.user_id, r.emoji, u.surname, u.name
     FROM reactions r JOIN users u ON u.id = r.user_id
     WHERE r.target_type = ? AND r.target_id IN (?) ORDER BY r.created_at`,
    [type, ids]
  );
  for (const r of rows) {
    const s = out[r.target_id] || (out[r.target_id] = empty());
    s.total += 1;
    if (userId && r.user_id === userId) s.mine = r.emoji;
    let c = s.counts.find((x) => x.key === r.emoji);
    if (!c) {
      const def = REACTIONS.find((x) => x[0] === r.emoji);
      if (!def) continue;
      c = { key: def[0], emoji: def[1], label: def[2], n: 0, names: [] };
      s.counts.push(c);
    }
    c.n += 1;
    c.names.push(`${r.surname ? r.surname.charAt(0) + '. ' : ''}${r.name}`);
  }
  for (const s of Object.values(out)) s.counts.sort((a, b) => b.n - a.n);
  return out;
}

async function loadOne(type, id, userId) {
  return (await loadReactions(type, [id], userId))[id];
}

async function targetExists(type, id) {
  const table = type === 'news' ? 'announcements' : 'news_comments';
  const [[row]] = await pool.query(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  return !!row;
}

// emoji хоосон бол reaction-ыг арилгана, үгүй бол нэмнэ/солино (нэг хүн нэг reaction).
async function setReaction(type, id, userId, emoji) {
  if (!emoji) {
    await pool.query('DELETE FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ?', [type, id, userId]);
  } else {
    await pool.query(
      `INSERT INTO reactions (target_type, target_id, user_id, emoji) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE emoji = VALUES(emoji), created_at = CURRENT_TIMESTAMP`,
      [type, id, userId, emoji]
    );
  }
}

async function deleteFor(type, ids) {
  if (ids.length) await pool.query('DELETE FROM reactions WHERE target_type = ? AND target_id IN (?)', [type, ids]);
}

module.exports = { REACTIONS, REACTION_KEYS, TYPES, loadReactions, loadOne, targetExists, setReaction, deleteFor };
