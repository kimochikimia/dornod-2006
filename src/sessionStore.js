const session = require('express-session');

const DAY = 24 * 60 * 60 * 1000;

// express-session-д зориулсан энгийн MySQL store (mysql2/promise pool ашиглана).
class MySQLSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
    const timer = setInterval(() => {
      this.pool.query('DELETE FROM sessions WHERE expires < ?', [Date.now()]).catch(() => {});
    }, 15 * 60 * 1000);
    timer.unref();
  }

  expiry(sess) {
    const e = sess && sess.cookie && sess.cookie.expires;
    return e ? new Date(e).getTime() : Date.now() + DAY;
  }

  get(sid, cb) {
    this.pool
      .query('SELECT data FROM sessions WHERE sid = ? AND expires > ?', [sid, Date.now()])
      .then(([rows]) => cb(null, rows[0] ? JSON.parse(rows[0].data) : null))
      .catch(cb);
  }

  set(sid, sess, cb = () => {}) {
    this.pool
      .query('REPLACE INTO sessions (sid, expires, data) VALUES (?, ?, ?)', [sid, this.expiry(sess), JSON.stringify(sess)])
      .then(() => cb(null))
      .catch(cb);
  }

  touch(sid, sess, cb = () => {}) {
    this.pool
      .query('UPDATE sessions SET expires = ? WHERE sid = ?', [this.expiry(sess), sid])
      .then(() => cb(null))
      .catch(cb);
  }

  destroy(sid, cb = () => {}) {
    this.pool.query('DELETE FROM sessions WHERE sid = ?', [sid]).then(() => cb(null)).catch(cb);
  }
}

module.exports = MySQLSessionStore;
