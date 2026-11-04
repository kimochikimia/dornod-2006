#!/usr/bin/env node
// Зааврын жишээ зургуудыг (public/img/guide/*.png) src/guides.js-ийн дагуу автоматаар үүсгэнэ.
//
// Ашиглах:
//   1) Сервер асаалттай байх: npm start  (эсвэл GUIDE_BASE=http://localhost:3006)
//   2) node scripts/guide-screenshots.js            — бүх зураг
//      node scripts/guide-screenshots.js board news — зөвхөн эдгээр зааврынх
//
// Орчны хувьсагч: GUIDE_BASE (анх http://localhost:$PORT), CHROME (Chrome/Edge-ийн зам).
// Нууцлал: зурагт гарах хүмүүсийн нэр, утас, имэйл, профайл зургийг жишээ утгаар солино.
// Түр админ хэрэглэгч үүсгээд, дуусахад устгана.

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { guides } = require('../src/guides');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'img', 'guide');
const BASE = process.env.GUIDE_BASE || `http://localhost:${process.env.PORT || 3000}`;
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => fs.existsSync(p));
const TMP_PHONE = '99990009';
const TMP_PASS = 'guide-' + Math.random().toString(36).slice(2, 10);

const DEMO_SURNAMES = ['Дорж', 'Бат', 'Ганбаатар', 'Сүхбаатар', 'Очир', 'Пүрэв', 'Цэрэн', 'Наран', 'Жамц', 'Лхагва'];
const DEMO_NAMES = ['Болд', 'Сарангэрэл', 'Энхжаргал', 'Тэмүүлэн', 'Номин', 'Ариунаа', 'Мөнх-Эрдэнэ', 'Оюунчимэг', 'Ганзориг', 'Уянга'];

function client() {
  let cookie = '';
  return async (p, o = {}) => {
    const r = await fetch(BASE + p, { ...o, redirect: 'manual', headers: { ...(o.headers || {}), cookie } });
    const sc = r.headers.getSetCookie();
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    return r;
  };
}
const csrfOf = (h) => (h.match(/name="_csrf" value="([^"]+)/) || [])[1];

async function placeholders() {
  const [[news]] = await pool.query('SELECT id FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT 1');
  const [[closed]] = await pool.query("SELECT id FROM elections WHERE phase = 'closed' ORDER BY voting_ended_at DESC LIMIT 1");
  const [[open]] = await pool.query("SELECT id FROM elections WHERE phase <> 'closed' ORDER BY created_at DESC LIMIT 1");
  return {
    news: news ? news.id : 0,
    closedElection: closed ? closed.id : (open ? open.id : 0),
    openElection: open ? open.id : (closed ? closed.id : 0),
  };
}

// Бодит нэр, утас, имэйл, зургийг жишээгээр солино
async function anonymizer() {
  const [users] = await pool.query('SELECT surname, name FROM users WHERE phone <> ?', [TMP_PHONE]);
  const pairs = [];
  users.forEach((u, i) => {
    if (u.surname) pairs.push([u.surname, DEMO_SURNAMES[i % DEMO_SURNAMES.length]]);
    if (u.name) pairs.push([u.name, DEMO_NAMES[i % DEMO_NAMES.length]]);
  });
  pairs.sort((a, b) => b[0].length - a[0].length);
  return (html) => {
    let s = html;
    for (const [from, to] of pairs) s = s.split(from).join(to);
    s = s.replace(/\b[5-9]\d{7}\b/g, '9911••••');
    s = s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'example@mail.mn');
    s = s.replace(/<img class="(avatar[^"]*)" src="\/photos\/[^"]*"[^>]*>/g, '<div class="$1">ЖН</div>');
    s = s.replace(/(<div class="avatar[^"]*">)[^<]{1,4}(<\/div>)/g, '$1ЖН$2');
    return s;
  };
}

function prepare(html, step) {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  const inject = `<script>
document.addEventListener('DOMContentLoaded', function () {
  var focus = ${JSON.stringify(step.focus || '')}, mark = ${JSON.stringify(step.mark || '')};
  if (focus) {
    var n = document.querySelector(focus);
    while (n && n !== document.body) {
      var p = n.parentElement; if (!p) break;
      Array.prototype.forEach.call(p.children, function (c) {
        if (c !== n && !c.matches('header, .site-header, script, style') && (c.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) c.style.display = 'none';
      });
      n = p;
    }
  }
  if (mark) {
    var m = document.querySelector(mark);
    if (m) { m.style.outline = '3px solid #fb923c'; m.style.outlineOffset = '4px'; m.style.borderRadius = m.style.borderRadius || '12px';
      m.style.boxShadow = '0 0 0 8px rgba(251,146,60,.18), 0 0 46px rgba(251,146,60,.45)'; m.style.position = m.style.position || 'relative'; m.style.zIndex = '5'; }
  }
});
</script>`;
  return html
    .replace(/<link[^>]+style\.css[^>]*>/, () => `<style>${css}</style>`)
    .replace(/<script[^>]+app\.js[^>]*><\/script>/, () => `<script>${js}</script>`)
    .replace('</head>', () => inject + '</head>');
}

function shoot(htmlFile, outFile) {
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=0.8',
    '--window-size=1280,800', '--virtual-time-budget=2500', `--screenshot=${outFile}`, 'file:///' + htmlFile.replace(/\\/g, '/'),
  ], { stdio: 'ignore' });
}

(async () => {
  if (!CHROME) throw new Error('Chrome олдсонгүй — CHROME орчны хувьсагчид замыг заана уу.');
  const only = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-'));
  await pool.query('DELETE FROM users WHERE phone = ?', [TMP_PHONE]);
  const [u] = await pool.query(
    "INSERT INTO users (surname, name, phone, password_hash, status, role) VALUES ('Жишээ', 'Админ', ?, ?, 'approved', 'admin')",
    [TMP_PHONE, await bcrypt.hash(TMP_PASS, 4)]
  );
  try {
    const admin = client();
    const lp = await (await admin('/login')).text();
    await admin('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrfOf(lp), phone: TMP_PHONE, password: TMP_PASS, next: '/' }) });
    const guest = client();
    const ph = await placeholders();
    const anon = await anonymizer();
    let n = 0;
    for (const g of guides) {
      if (only.length && !only.includes(g.key)) continue;
      for (const s of g.steps) {
        const url = s.url.replace(/\{(\w+)\}/g, (m, k) => ph[k]);
        const res = await (s.as === 'admin' ? admin : guest)(url);
        if (res.status !== 200) { console.warn(`! ${s.img}: ${url} → ${res.status}`); continue; }
        const file = path.join(tmpDir, `${s.img}.html`);
        fs.writeFileSync(file, prepare(anon(await res.text()), s));
        shoot(file, path.join(OUT, `${s.img}.png`));
        n++;
        console.log(`✓ ${s.img}  (${url})`);
      }
    }
    console.log(`\n${n} зураг → ${path.relative(ROOT, OUT)}`);
  } finally {
    await pool.query('DELETE FROM users WHERE id = ?', [u.insertId]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
