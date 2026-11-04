require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const { pool, init } = require('./src/db');
const MySQLSessionStore = require('./src/sessionStore');
const { loadUser, locals, csrfCheck } = require('./src/middleware');

const isProd = process.env.NODE_ENV === 'production';
const app = express();

app.set('trust proxy', 1); // Railway proxy-ийн ард ажиллана
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'https:'],
        'upgrade-insecure-requests': isProd ? [] : null,
      },
    },
  })
);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));
// Баримт бичгийн файл (base64) илгээх хэсэгт илүү том хязгаар; бусад хүсэлтэд 1mb.
app.use('/admin/documents', express.urlencoded({ extended: true, limit: '16mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' })); // зураг (base64) багтаахаар

if (isProd && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET тохируулаагүй байна! Railway дээр Variables хэсэгт SESSION_SECRET нэмнэ үү.');
  process.exit(1);
}

app.use(
  session({
    name: 'd2006.sid',
    store: new MySQLSessionStore(pool),
    secret: process.env.SESSION_SECRET || 'dev-only-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 30 * 24 * 60 * 60 * 1000 },
  })
);

// Redirect хийхээс өмнө session-ийг (flash, нэвтрэлт) хадгалж дуусгана — эс бөгөөс дараагийн хүсэлт хуучин session уншина.
app.use((req, res, next) => {
  const redirect = res.redirect.bind(res);
  res.redirect = (...args) => {
    if (!req.session) return redirect(...args);
    req.session.save(() => redirect(...args));
  };
  next();
});

app.use(loadUser);
app.use(locals);
app.use(csrfCheck);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use(require('./src/routes/auth'));
app.use(require('./src/routes/main'));
app.use('/board', require('./src/routes/board'));
app.use('/elections', require('./src/routes/elections'));
app.use('/admin', require('./src/routes/admin'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Хуудас олдсонгүй', message: 'Таны хайсан хуудас байхгүй байна.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  // locals middleware-ээс өмнө алдаа гарсан тохиолдолд шаблонд хэрэгтэй утгуудыг бөглөнө.
  Object.assign(res.locals, {
    me: res.locals.me || null,
    can: res.locals.can || (() => false),
    canManage: !!res.locals.canManage,
    isApproved: !!res.locals.isApproved,
    ROLE_LABELS: res.locals.ROLE_LABELS || {},
    flash: res.locals.flash || [],
    path: res.locals.path || req.path,
    csrf: res.locals.csrf || '',
    avatar: res.locals.avatar || (() => ''),
  });
  res.status(500).render('error', { title: 'Алдаа гарлаа', message: 'Серверт алдаа гарлаа. Дахин оролдоно уу.' });
});

const PORT = process.env.PORT || 3000;

init()
  .then(() => require('./src/permissions').seedPermissions())
  .then(() => {
    app.listen(PORT, () => console.log(`Сайт ажиллаж байна: http://localhost:${PORT}`));
    // Хуваарьтай сонгуулийн шатыг хэн ч сайтад ороогүй үед ч цагт нь шилжүүлнэ.
    const { syncAll } = require('./src/electionSchedule');
    setInterval(() => syncAll().catch((err) => console.error('[schedule]', err.message)), 30 * 1000).unref();
  })
  .catch((err) => {
    console.error('Өгөгдлийн сантай холбогдож чадсангүй:', err.message);
    process.exit(1);
  });
