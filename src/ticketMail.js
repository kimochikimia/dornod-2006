// Тасалбарын захиалгын имэйл: төлбөрийн заавар, QR тасалбар, цуцлалтын мэдэгдэл.
// Илгээлт нь захиалгын үйлдлийг саатуулахгүй, амжилтгүй болсон ч захиалгад нөлөөлөхгүй.
const QRCode = require('qrcode');
const { pool } = require('./db');
const { fmtDate } = require('./helpers');
const tk = require('./tickets');
const mailer = require('./mailer');

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Имэйл дэх холбоосын суурь хаяг. SITE_URL тохируулсан бол Host толгойд найдахгүй.
function originOf(req) {
  return (process.env.SITE_URL || '').trim().replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
}

function seatLines(order) {
  if (!order.seatArr.length) return [`${order.quantity} тасалбар`];
  return order.seatArr.map((s) => (String(s.label).startsWith(s.group) ? s.label : `${s.group} · ${s.label}`));
}

function rowsHtml(rows) {
  return rows.map(([k, v, strong]) => `<tr><td style="padding:7px 12px 7px 0;color:#667085;vertical-align:top;white-space:nowrap">${esc(k)}</td>` +
    `<td style="padding:7px 0;color:#101828;${strong ? 'font-weight:700' : ''}">${String(v).split('\n').map(esc).join('<br>')}</td></tr>`).join('');
}

function layout({ title, intro, rows, extra = '', link, linkText, event }) {
  const contact = event.contact ? `<p style="margin:18px 0 0;color:#667085;font-size:13px">Асуух зүйл байвал: ${esc(event.contact)}</p>` : '';
  return `<div style="background:#f2f4f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:26px">
<h1 style="margin:0 0 8px;font-size:21px;line-height:1.3;color:#12305c">${esc(title)}</h1>
<p style="margin:0 0 16px;color:#344054">${esc(intro)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">${rowsHtml(rows)}</table>
${extra}
<p style="margin:22px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#12305c;color:#ffffff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:7px">${esc(linkText)}</a></p>
${contact}
</div></div>`;
}

function textOf({ title, intro, rows, link, event }) {
  return [title, '', intro, '', ...rows.map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ', ')}`), '', link,
    ...(event.contact ? ['', `Асуух зүйл байвал: ${event.contact}`] : [])].join('\n');
}

function baseRows(order, event) {
  return [
    ['Арга хэмжээ', event.title, true],
    ['Хэзээ', event.eventText],
    ...(event.venue ? [['Хаана', event.venue]] : []),
    [order.seatArr.length ? 'Суудал' : 'Тасалбар', seatLines(order).join('\n')],
    ['Дүн', tk.fmtMoney(order.amount)],
    ['Захиалгын код', order.code, true],
  ];
}

function paymentMail(order, event, link) {
  const rows = [
    ...baseRows(order, event),
    ...(event.bank_name ? [['Банк', event.bank_name]] : []),
    ['Дансны дугаар', event.bank_account || '—', true],
    ...(event.bank_holder ? [['Хүлээн авагч', event.bank_holder]] : []),
    ['Гүйлгээний утга', order.code, true],
    ...(order.expires_at ? [['Төлөх хугацаа', `${fmtDate(order.expires_at)} хүртэл`, true]] : []),
  ];
  const c = {
    title: 'Захиалга үүслээ', event, rows, link, linkText: 'Захиалгаа харах',
    intro: 'Доорх данс руу төлбөрөө шилжүүлж, гүйлгээний утгад захиалгын кодоо заавал бичнэ үү. Төлбөр баталгаажмагц QR тасалбар тань имэйлээр ирнэ.',
  };
  return { subject: `Төлбөрийн мэдээлэл: ${event.title}`, html: layout(c), text: textOf(c) };
}

async function ticketMail(order, event, link, origin) {
  const token = await tk.ensureToken(order);
  const png = await QRCode.toBuffer(tk.checkinUrlFor(origin, token), { type: 'png', width: 360, margin: 2, errorCorrectionLevel: 'M' });
  const c = {
    title: 'Таны QR тасалбар', event, rows: baseRows(order, event), link, linkText: 'Тасалбараа сайтаас нээх',
    intro: `Төлбөр баталгаажлаа. Орох хаалган дээр энэ QR-ийг уншуулна. Нэг QR-ээр ${order.quantity} хүн орно.`,
    extra: '<div style="text-align:center;margin:20px 0 0"><img src="cid:ticket-qr" width="240" height="240" alt="QR тасалбар" style="display:inline-block;border:0"></div>',
  };
  return {
    subject: `QR тасалбар: ${event.title}`, html: layout(c), text: textOf(c),
    attachments: [{ filename: `tasalbar-${order.code}.png`, content: png, contentType: 'image/png', cid: 'ticket-qr' }],
  };
}

function cancelMail(order, event, link) {
  const c = {
    title: 'Захиалга цуцлагдлаа', event, rows: baseRows(order, event), link, linkText: 'Захиалгаа харах',
    intro: 'Таны захиалгыг удирдлага цуцаллаа. Энэ захиалгын QR хүчингүй болсон. Асуух зүйл байвал зохион байгуулагчид хандана уу.',
  };
  return { subject: `Захиалга цуцлагдлаа: ${event.title}`, html: layout(c), text: textOf(c) };
}

async function deliver(code, origin) {
  if (!mailer.isConfigured()) return mailer.send({});
  const order = await tk.getOrder(code);
  if (!order || !order.user_id) return { skipped: true };
  // Зөвхөн баталгаажсан хаяг руу: QR буруу хүнд очихоос сэргийлнэ
  const [[user]] = await pool.query('SELECT email, email_verified_at FROM users WHERE id = ?', [order.user_id]);
  if (!user || !user.email || !user.email_verified_at) return { skipped: true };
  const event = await tk.get(order.event_id);
  const link = `${origin}/tickets/order/${order.code}`;
  const content = order.status === 'paid' ? await ticketMail(order, event, link, origin)
    : order.status === 'pending' ? paymentMail(order, event, link) : cancelMail(order, event, link);
  return mailer.send({ to: user.email, ...content });
}

// Захиалгын одоогийн төлөвт тохирох имэйлийг ардаа илгээнэ. Хэзээ ч алдаа шидэхгүй.
function notify(code, origin) {
  deliver(code, origin).catch((err) => console.error(`[mail] захиалга ${code}: ${err.message}`));
}

module.exports = { notify, originOf, deliver };
