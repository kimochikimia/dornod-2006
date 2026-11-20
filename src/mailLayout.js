// Бүх имэйлийн нийтлэг загвар. rows: [[шошго, утга, тод эсэх], ...]
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function rowsHtml(rows) {
  return rows.map(([k, v, strong]) => `<tr><td style="padding:7px 12px 7px 0;color:#667085;vertical-align:top;white-space:nowrap">${esc(k)}</td>` +
    `<td style="padding:7px 0;color:#101828;${strong ? 'font-weight:700' : ''}">${String(v).split('\n').map(esc).join('<br>')}</td></tr>`).join('');
}

// Сайтын өнгө: бараан дэвсгэр, цэнхэрээс ягаан руу шилжсэн өнгө
const DARK = '#0c0f22';
const BRAND = '#5b6cf9';
const GRAD = 'linear-gradient(135deg,#4f7cff 0%,#8b5cf6 100%)';

// Лого цагаан өнгөтэй тул бараан header дээр байрлана. Имэйлд хавсаргана (cid) — сайт зургаа гадагш хаадаг тул
// холбоосоор ачаалахад зарим программ дээр харагдахгүй. Хавсралтыг mailer.send автоматаар нэмнэ.
const LOGO_CID = 'site-logo';
function header() {
  const site = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  const img = `<img src="cid:${LOGO_CID}" width="154" height="48" alt="Дорнод 2006" style="display:block;border:0;color:#ffffff;font-size:18px;font-weight:700">`;
  const logo = site ? `<a href="${esc(site)}" style="text-decoration:none">${img}</a>` : img;
  return `<div style="background:${DARK};padding:18px 26px">
<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%"><tr>
<td style="vertical-align:middle">${logo}</td>
<td style="vertical-align:middle;text-align:right;color:#a3a9d1;font-size:12px;line-height:1.4">Дорнод аймгийн<br>2006 оны төгсөгчид</td>
</tr></table></div>
<div style="height:4px;background:${BRAND};background-image:${GRAD};line-height:4px;font-size:0">&nbsp;</div>`;
}

// footerHtml нь итгэмжлэгдсэн (кодоос үүссэн) HTML; бусад бүх утгыг escape хийнэ.
function html({ title, intro = '', rows = [], extra = '', link, linkText, contact, footerHtml = '' }) {
  const paras = String(intro).split(/\n{2,}/).filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;color:#344054">${p.split('\n').map(esc).join('<br>')}</p>`).join('');
  const table = rows.length ? `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin-top:4px">${rowsHtml(rows)}</table>` : '';
  const button = link ? `<p style="margin:22px 0 0"><a href="${esc(link)}" style="display:inline-block;background:${BRAND};background-image:${GRAD};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">${esc(linkText || 'Сайтаас харах')}</a></p>` : '';
  const contactP = contact ? `<p style="margin:18px 0 0;color:#667085;font-size:13px">Асуух зүйл байвал: ${esc(contact)}</p>` : '';
  return `<div style="background:#eef0f6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e7ec">
${header()}
<div style="padding:26px">
<h1 style="margin:0 0 10px;font-size:21px;line-height:1.3;color:#1d2152">${esc(title)}</h1>
${paras}${table}${extra}${button}${contactP}
</div></div>
<p style="max-width:560px;margin:14px auto 0;color:#98a2b3;font-size:12px;text-align:center">Дорнод аймгийн 2006 оны төгсөгчдийн сайт${footerHtml ? '<br>' + footerHtml : ''}</p>
</div>`;
}

function text({ title, intro = '', rows = [], link, contact, footerText = '' }) {
  return [title, '', intro, ...(rows.length ? [''] : []), ...rows.map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ', ')}`),
    ...(link ? ['', link] : []), ...(contact ? ['', `Асуух зүйл байвал: ${contact}`] : []), ...(footerText ? ['', '—', footerText] : [])].join('\n');
}

// Урт текстийг товчлох (мэдээ, тайлбар)
function excerpt(s, max = 400) {
  const t = String(s || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t;
}

module.exports = { esc, html, text, excerpt, LOGO_CID };
