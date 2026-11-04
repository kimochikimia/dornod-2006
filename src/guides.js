// Системийн заавар: цэс бүрийн алхам алхмаар тайлбар, жишээ зурагтай.
// Зургийг `node scripts/guide-screenshots.js` автоматаар (public/img/guide/) үүсгэнэ:
//   url   — зураг авах хуудас ({news}, {closedElection}, {openElection} нь бодит id-гаар солигдоно)
//   as    — 'guest' (нэвтрээгүй) эсвэл 'admin' (түр админ хэрэглэгчээр)
//   focus — энэ хэсгийг дэлгэцийн дээд хэсэгт гаргана (бусад хэсгийг нууна)
//   mark  — улбар шар хүрээгээр тодруулах хэсэг
// show(ctx) — хэнд харагдах (ctx: { me, can })

const guides = [
  // ---------------- Ерөнхий ----------------
  {
    key: 'account', group: 'general', icon: '👤', title: 'Бүртгүүлэх, нэвтрэх', match: ['/login', '/register'],
    show: () => true,
    steps: [
      { img: 'account-1', url: '/', as: 'guest', mark: '.nav-actions',
        title: 'Бүртгүүлэх товч', text: 'Толгойн баруун дээд талын «Бүртгүүлэх» товч дээр дарна. Бүртгэлтэй бол «Нэвтрэх».' },
      { img: 'account-2', url: '/register', as: 'guest', mark: '.auth-card form',
        title: 'Мэдээллээ бөглөх', text: 'Овог, нэр, утас, төгссөн сургууль, ажил эрхлэлт, албан тушаал, мэргэжил, нууц үгээ оруулна. Олон мэргэжилтэй бол «＋ Мэргэжил нэмэх».' },
      { img: 'account-3', url: '/login', as: 'guest', mark: '.auth-card form',
        title: 'Нэвтрэх', text: 'Утасны дугаар, нууц үгээрээ нэвтэрнэ. Бүртгэлийг админ баталгаажуулсны дараа бүх боломж нээгдэнэ.' },
    ],
  },
  {
    key: 'home', group: 'general', icon: '🏠', title: 'Нүүр', match: ['/'],
    show: () => true,
    steps: [
      { img: 'home-1', url: '/', as: 'guest', mark: '.nav-links',
        title: 'Үндсэн цэс', text: 'Дээд цэсээр Мэдээ, Төлөвлөгөө, Удирдах зөвлөл (нэвтэрсэн бол Төгсөгчид) хэсэг рүү орно.' },
    ],
  },
  {
    key: 'news', group: 'general', icon: '📣', title: 'Мэдээ', match: ['/news'],
    show: () => true,
    steps: [
      { img: 'news-1', url: '/news', as: 'guest', mark: '.news-item',
        title: 'Мэдээний жагсаалт', text: 'Мэдээ дээр дарж бүтнээр уншина. 👍 болон 💬 нь reaction, сэтгэгдлийн тоо.' },
      { img: 'news-2', url: '/news/{news}', as: 'admin', mark: '.news-react',
        title: 'Reaction өгөх', text: '«👍 Таалагдлаа» дарах, эсвэл «😊+» дээр дарж ❤️ 😂 😮 😢 👏-оос сонгоно. Дахин дарвал буцаана.' },
      { img: 'news-3', url: '/news/{news}', as: 'admin', focus: '#comments', mark: '#comments',
        title: 'Сэтгэгдэл бичих', text: 'Нэвтэрсэн бол мэдээний доор сэтгэгдлээ бичээд «Илгээх». Өөрийн сэтгэгдлийг «Устгах»-аар устгана.' },
    ],
  },
  {
    key: 'plan', group: 'general', icon: '🗓️', title: 'Төлөвлөгөө', match: ['/plan'],
    show: () => true,
    steps: [
      { img: 'plan-1', url: '/plan?view=timeline', as: 'guest', mark: '.tl-card',
        title: 'Цагийн шугам', text: 'Ажлуудыг хугацааны шугам дээр, чухал үеүдийг ◆ тэмдгээр харуулна.' },
      { img: 'plan-2', url: '/plan?view=monthly', as: 'guest', mark: '.gantt-scroll',
        title: 'Сарын хуваарь', text: '«Сарын хуваарь» таб: жилийн сар бүрээр. «← / →» товчоор жил солино.' },
      { img: 'plan-3', url: '/plan', as: 'guest', focus: '.table-wrap', mark: '.table-wrap',
        title: 'Ажлын жагсаалт', text: 'Хугацаа, хариуцагч, хаана болох, 📍 «Газрын зураг» холбоос, төлөв.' },
    ],
  },
  {
    key: 'board', group: 'general', icon: '🏛️', title: 'Удирдах зөвлөл', match: ['/board'],
    show: () => true,
    steps: [
      { img: 'board-1', url: '/board', as: 'guest', focus: '#members', mark: '#members',
        title: 'Бүрэлдэхүүн', text: 'Хүчинтэй сонгуулиар сонгогдсон гишүүд, албан тушаалтай нь. Гишүүн дээр дарж дэлгэрэнгүйг үзнэ.' },
      { img: 'board-2', url: '/board', as: 'guest', focus: '#structure', mark: '#structure',
        title: 'Бүтэц', text: 'Албан тушаалуудын модон схем, хэн аль албан тушаалд томилогдсон нь.' },
      { img: 'board-3', url: '/board', as: 'guest', focus: '.docs-section', mark: '.docs-section',
        title: 'Баримт бичиг', text: 'Дүрэм, журам. Батлагдаагүй баримтын төслийг баталгаажсан төгсөгч «📄 Төсөл татах»-аар татна.' },
      { img: 'board-4', url: '/board', as: 'guest', focus: '#elections', mark: '#elections',
        title: 'Сонгуулийн түүх', text: 'Өмнөх сонгуулиуд. Дээр нь дарж үр дүн, статистикийг үзнэ.' },
    ],
  },
  {
    key: 'elections', group: 'general', icon: '🗳️', title: 'Сонгууль', match: ['/elections'],
    show: () => true,
    steps: [
      { img: 'elections-1', url: '/board', as: 'guest', mark: '.live-election',
        title: 'Явагдаж буй сонгууль', text: 'Удирдах зөвлөл хуудасны дээд хэсэгт улбар шар баннер гарна. «Оролцох →» дарна.' },
      { img: 'elections-2', url: '/elections/{openElection}', as: 'admin', mark: '.steps, .phase-steps, .stepper',
        title: 'Шатууд', text: 'Нэр дэвшүүлэх → Зөвшөөрөл авах → Санал хураалт → Дүн. Одоогийн шат тодорч харагдана.' },
      { img: 'elections-3', url: '/elections/{openElection}', as: 'admin', mark: '.cand, main .btn-lg, main .btn-primary',
        title: 'Нэр дэвшүүлэх, зөвшөөрөх', text: '«＋ Нэр дэвшүүлэх»-ээр өөрийгөө эсвэл бусдыг дэвшүүлнэ. Нэр дэвшүүлэгдсэн хүн зөвшөөрөх / татгалзана — зөвхөн зөвшөөрсөн нь саналын хуудсанд орно.' },
      { img: 'elections-4', url: '/elections/{closedElection}', as: 'guest', focus: '#live', mark: '#live',
        title: 'Санал хураалт, дүн', text: 'Нууц санал, нэг удаа. Хамгийн их санал авсан суудлын тооны хүн сонгогдоно. Ирц доод хувьд хүрэхгүй бол хүчингүй; сүүлийн суудалд тэнцвэл тухайн саналд түрүүлж хүрсэн нь сонгогдоно.' },
    ],
  },
  {
    key: 'members', group: 'general', icon: '👥', title: 'Төгсөгчид', match: ['/members'],
    show: () => true,
    steps: [
      { img: 'members-1', url: '/members', as: 'admin', mark: 'main form.card',
        title: 'Хайх, шүүх', text: 'Нэр, мэргэжил, байгууллага, хотоор хайж; сургууль, ажил эрхлэлтээр шүүнэ.' },
      { img: 'members-2', url: '/members', as: 'admin', mark: '.member-card',
        title: 'Профайл', text: 'Төгсөгчийн карт дээр дарж дэлгэрэнгүй мэдээлэл, холбоо барих хаягийг үзнэ.' },
    ],
  },
  {
    key: 'me', group: 'general', icon: '🙍', title: 'Миний хуудас', match: ['/me'],
    show: (c) => !!c.me,
    steps: [
      { img: 'me-1', url: '/me', as: 'admin', mark: '.nav-user',
        title: 'Миний хуудас руу орох', text: 'Толгойн баруун дээд талд нэр дээрээ дарна.' },
      { img: 'me-2', url: '/me', as: 'admin', mark: 'main .grid-2',
        title: 'Мэдээлэл, нууц үг', text: 'Өөрийн мэдээллээ харж, нууц үгээ сольно.' },
      { img: 'me-3', url: '/me', as: 'admin', focus: 'main .grid-2 + .card', mark: 'main .grid-2 + .card',
        title: 'Засварын хүсэлт', text: 'Мэдээллээ засуулах бол «Админд засварын хүсэлт илгээх» — бүртгэлийн мэдээллийг админ засна.' },
    ],
  },

  // ---------------- Удирдлага ----------------
  {
    key: 'admin-users', group: 'admin', icon: '✅', title: 'Төгсөгчид (бүртгэл)', match: ['/admin/users', '/admin$'],
    show: (c) => c.can('approve_users') || c.can('edit_users'),
    steps: [
      { img: 'admin-users-1', url: '/admin', as: 'admin', mark: '.admin-nav',
        title: 'Удирдлагын цэс', text: 'Толгойн «Админ» цэсээр орно. Хэсэг бүр дээд мөрөнд.' },
      { img: 'admin-users-2', url: '/admin/users', as: 'admin', mark: 'main .table-wrap',
        title: 'Бүртгэл батлах', text: '«Төгсөгчид» хэсэгт бүртгэлийг батлах / татгалзах, мэдээлэл, зураг, нууц үг засна.' },
    ],
  },
  {
    key: 'admin-roles', group: 'admin', icon: '🔐', title: 'Эрх, төлөв', match: ['/admin/roles'],
    show: (c) => c.can('manage_roles'),
    steps: [
      { img: 'admin-roles-1', url: '/admin/roles', as: 'admin', mark: 'form[action="/admin/roles"]',
        title: 'Төлөв бүрийн эрх', text: 'Гишүүн, модератор, дэд админ, админ тус бүрт ямар эрх байхыг чагтлаад хадгална.' },
    ],
  },
  {
    key: 'admin-board', group: 'admin', icon: '🏛️', title: 'Удирдах зөвлөл (сонгууль бүрээр)', match: ['/admin/elections'],
    show: (c) => c.can('manage_elections') || c.can('manage_board'),
    steps: [
      { img: 'admin-board-1', url: '/admin/elections', as: 'admin', mark: 'main .table-wrap',
        title: 'Сонгуулиуд', text: '«Удирдах зөвлөл» цэсэнд сонгуулиуд дугаартай жагсана. Хамгийн сүүлд дууссан, ирц хүрсэн нь «Хүчинтэй». «＋ Шинэ сонгууль», «Нээх», ✕ устгах.' },
      { img: 'admin-board-2', url: '/admin/elections/{closedElection}', as: 'admin', mark: '.admin-subnav',
        title: 'Сонгуулийн ажлын хэсэг', text: 'Сонгуулийг нээхэд дэд цэс гарна — ажлын дарааллаар: Сонгууль → Албан тушаал → Томилгоо → Бүтэц → Баримт бичиг.' },
      { img: 'admin-board-3', url: '/admin/elections/{closedElection}', as: 'admin', mark: '.card.glow',
        title: '1. Сонгууль', text: 'Шат, хуваарь, нэр дэвшигч / зөвшөөрсөн тоо. Тохиргоонд суудал, доод ирц, автомат хуваарь. Доор нь нэр дэвшигчид, үр дүн.' },
      { img: 'admin-board-4', url: '/admin/elections/{closedElection}/posts', as: 'admin', mark: 'main .table-wrap',
        title: '2. Албан тушаал', text: 'Нэр, төрөл (Дарга / Удирдлага / Гишүүн), орон тоо. Нийт орон тоо = суудлын тоо. «Засах»-аар өөрчилнө.' },
      { img: 'admin-board-5', url: '/admin/elections/{closedElection}/board', as: 'admin', mark: 'main .table-wrap',
        title: '3. Томилгоо', text: '«Сонгогдсон гишүүдийг нэмэх», дараа нь «＋ Томилох»-оор албан тушаалд томилно. Нэг хүн олон албан тушаал хашиж болно.' },
      { img: 'admin-board-6', url: '/admin/elections/{closedElection}/structure', as: 'admin', mark: '.unit-row',
        title: '4. Бүтэц', text: 'Албан тушаал бүрийг аль албан тушаалын доор байхыг сонгож схем зурна. Хүмүүс томилгооноос автоматаар харагдана.' },
      { img: 'admin-board-7', url: '/admin/elections/{closedElection}/documents', as: 'admin', mark: 'main .table-wrap',
        title: '5. Баримт бичиг', text: '«📄 Төсөл» оруулж хэлэлцүүлнэ, «Засах»-аар батлагдсан эцсийн хувилбар (агуулга / файл) нийтэлнэ.' },
    ],
  },
  {
    key: 'admin-plans', group: 'admin', icon: '🗓️', title: 'Төлөвлөгөө оруулах', match: ['/admin/plans'],
    show: (c) => c.can('manage_plans'),
    steps: [
      { img: 'admin-plans-1', url: '/admin/plans', as: 'admin', mark: 'main .row.between .row',
        title: 'Ажил нэмэх', text: '«＋ Ажил» (хугацаатай) эсвэл «＋ Чухал үе» (нэг өдөр).' },
      { img: 'admin-plans-2', url: '/admin/plans/new', as: 'admin', mark: 'main form',
        title: 'Мэдээлэл оруулах', text: 'Нэр, огноо, хариуцагч, хаана болох, Google Maps линк, өнгө, тайлбар.' },
    ],
  },
  {
    key: 'admin-news', group: 'admin', icon: '📣', title: 'Мэдээ оруулах', match: ['/admin/news'],
    show: (c) => c.can('manage_news'),
    steps: [
      { img: 'admin-news-1', url: '/admin/news/new', as: 'admin', mark: 'main form',
        title: 'Мэдээ нийтлэх', text: 'Гарчиг, агуулга бичнэ. «Онцлох» гэвэл жагсаалтын эхэнд гарна. Мэдээний сэтгэгдлийг устгах эрхтэй.' },
    ],
  },
  {
    key: 'admin-requests', group: 'admin', icon: '📨', title: 'Хүсэлтүүд', match: ['/admin/requests'],
    show: (c) => c.can('manage_requests'),
    steps: [
      { img: 'admin-requests-1', url: '/admin/requests', as: 'admin', mark: 'main .card',
        title: 'Засварын хүсэлт', text: 'Хүсэлтийг уншаад мэдээллийг «Төгсөгчид» хэсэгт засна, дараа нь хүсэлтийг «Шийдсэн» болгож тайлбар бичнэ.' },
    ],
  },
  {
    key: 'admin-schools', group: 'admin', icon: '🏫', title: 'Сургуулиуд', match: ['/admin/schools'],
    show: (c) => c.can('manage_schools'),
    steps: [
      { img: 'admin-schools-1', url: '/admin/schools', as: 'admin', mark: 'main .table-wrap',
        title: 'Сургуулийн жагсаалт', text: 'Бүртгэлд сонгогдох сургуулиуд, ангилал, дарааллыг засна.' },
    ],
  },
];

// Тухайн хуудасны (path) заавар
function guideFor(path) {
  for (const g of guides) {
    for (const m of g.match || []) {
      if (m.endsWith('$') ? path === m.slice(0, -1) : (m === '/' ? path === '/' : path.indexOf(m) === 0)) return g.key;
    }
  }
  return '';
}

module.exports = { guides, guideFor };
