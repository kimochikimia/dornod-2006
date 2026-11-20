// Тасалбарын захиалгын имэйл: төлбөрийн заавар, QR тасалбар, цуцлалтын мэдэгдэл.
// Илгээлт нь захиалгын үйлдлийг саатуулахгүй, амжилтгүй болсон ч захиалгад нөлөөлөхгүй.
const { ticketQrPng } = require('./qrImage');
const { pool } = require('./db');
const { fmtDate } = require('./helpers');
const tk = require('./tickets');
const mailer = require('./mailer');
const queue = require('./mailQueue');
const layout = require('./mailLayout');

// Имэйл дэх холбоосын суурь хаяг. SITE_URL тохируулсан бол Host толгойд найдахгүй.
function originOf(req) {
  return (process.env.SITE_URL || '').trim().replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
}

function seatLines(order) {
  if (!order.seatArr.length) return [`${order.quantity} тасалбар`];
  return order.seatArr.map((s) => (String(s.label).startsWith(s.group) ? s.label : `${s.group} · ${s.label}`));
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

const render = (c) => ({ html: layout.html(c), text: layout.text(c) });

function paymentMail(order, event, link) {
  const rows = [
    ...baseRows(order, event),
    ...(event.bank_name ? [['Банк', event.bank_name]] : []),
    ['Дансны дугаар', event.bank_account || '—', true],
    ...(event.bank_holder ? [['Хүлээн авагч', event.bank_holder]] : []),
    ['Гүйлгээний утга', order.code, true],
    ...(order.expires_at ? [['Төлөх хугацаа', `${fmtDate(order.expires_at)} хүртэл`, true]] : []),
  ];
  return {
    subject: `Төлбөрийн мэдээлэл: ${event.title}`,
    ...render({
      title: 'Захиалга үүслээ', rows, link, linkText: 'Захиалгаа харах', contact: event.contact,
      intro: 'Доорх данс руу төлбөрөө шилжүүлж, гүйлгээний утгад захиалгын кодоо заавал бичнэ үү. Төлбөр баталгаажмагц QR тасалбар тань имэйлээр ирнэ.',
    }),
  };
}

// Сайтын тасалбартай ижил бүтэц: дээр нь бараан хэсэгт том QR ба код, доор нь суудал, огноо
function ticketCard(order, event) {
  const e = layout.esc;
  const info = tk.ticketInfo(order, event);
  const one = info.seats.length === 1 ? info.seats[0] : null;
  const label = 'color:#667085;font-size:12px;display:block';
  const value = 'color:#101828;font-size:16px;font-weight:700';
  let seat;
  if (one) {
    seat = `<div style="color:#475467;font-size:14px;margin:0 0 14px">${one.parts.map(([k, v]) => `<b style="color:#101828">${e(k)}:</b> ${e(v)}`).join('&nbsp;&nbsp;&nbsp;')}</div>
<div style="text-align:center;color:#667085;font-size:14px;font-weight:700">Суудлын хаягжилт</div>
<div style="text-align:center;color:#101828;font-size:28px;font-weight:700;letter-spacing:1px">${e(one.short)}</div>`;
  } else if (info.seats.length) {
    seat = `<div style="text-align:center;color:#667085;font-size:14px;font-weight:700">${info.seats.length} суудал</div>
<div style="text-align:center;margin-top:8px">${info.seats.map((s) => `<span style="display:inline-block;margin:3px;padding:4px 10px;border-radius:8px;background:#eef0ff;color:#3538cd;font-weight:700;font-size:16px">${e(s.short)}</span>`).join('')}</div>
<div style="text-align:center;color:#98a2b3;font-size:12px;margin-top:6px">${e(info.seats[0].parts.map((p) => p[0]).join(' – '))}</div>`;
  } else {
    seat = `<div style="text-align:center;color:#667085;font-size:14px;font-weight:700">Тасалбар</div>
<div style="text-align:center;color:#101828;font-size:28px;font-weight:700">${order.quantity} хүн</div>`;
  }
  const cell = (k, v, right) => `<td style="padding:6px 0;vertical-align:top;${right ? 'text-align:right' : ''}"><span style="${label}">${e(k)}</span><span style="${value}">${e(v)}</span></td>`;
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:0;margin:16px 0 0;border:1px solid #e4e7ec;border-radius:16px;overflow:hidden">
<tr><td style="background:#0c0f22;background-image:linear-gradient(160deg,#18205a 0%,#0c0f22 55%,#241452 100%);padding:22px 16px;text-align:center">
<div style="display:inline-block;background:#ffffff;border-radius:14px;padding:12px 12px 8px">
<img src="cid:ticket-qr" width="240" height="240" alt="QR тасалбар" style="display:block;border:0;width:240px;height:240px">
<div style="font-family:Consolas,Menlo,monospace;font-weight:700;font-size:20px;letter-spacing:3px;color:#101828;margin-top:6px">${e(order.code)}</div>
</div></td></tr>
<tr><td style="background:#ffffff;padding:18px 20px 14px">
<div style="color:#101828;font-size:18px;font-weight:700;line-height:1.3;margin:0 0 8px">${e(event.title)}</div>
${seat}
</td></tr>
<tr><td style="background:#ffffff;padding:4px 20px"><div style="border-top:2px dashed #d0d5dd;height:1px;line-height:1px;font-size:0">&nbsp;</div></td></tr>
<tr><td style="background:#ffffff;padding:10px 20px 18px">
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">
<tr>${cell('Өдөр', info.date)}${cell('Эхлэх цаг', info.time, true)}</tr>
${event.venue ? `<tr><td colspan="2" style="padding:6px 0"><span style="${label}">Байршил</span><span style="${value}">${e(event.venue)}</span></td></tr>` : ''}
<tr>${cell('Эзэмшигч', order.buyer_name)}${cell('Дүн', tk.fmtMoney(order.amount), true)}</tr>
</table></td></tr></table>`;
}

async function ticketMail(order, event, link, origin) {
  const token = await tk.ensureToken(order);
  const png = ticketQrPng(tk.checkinUrlFor(origin, token));
  return {
    subject: `QR тасалбар: ${event.title}`,
    ...render({
      title: 'Таны тасалбар', link, linkText: 'Тасалбараа сайтаас нээх', contact: event.contact,
      intro: `Төлбөр баталгаажлаа. Орох хаалган дээр доорх QR-ийг уншуулна. Нэг QR-ээр ${order.quantity} хүн орно.`,
      extra: ticketCard(order, event),
    }),
    attachments: [{ filename: `tasalbar-${order.code}.png`, content: png, contentType: 'image/png', cid: 'ticket-qr' }],
  };
}

function cancelMail(order, event, link, origin) {
  if (order.cancel_reason === 'expired') {
    return {
      subject: `Төлөх хугацаа дууссан: ${event.title}`,
      ...render({
        title: 'Захиалга автоматаар цуцлагдлаа', rows: baseRows(order, event), contact: event.contact,
        link: `${origin}/tickets/${event.id}`, linkText: 'Дахин захиалах',
        intro: `Төлбөр ${order.expires_at ? fmtDate(order.expires_at) + '-аас өмнө ' : ''}орж ирээгүй тул таны захиалга автоматаар цуцлагдаж, суудал чөлөөлөгдлөө.\n\nХэрэв та аль хэдийн төлбөр шилжүүлсэн бол зохион байгуулагчид захиалгын кодоо хэлж хандана уу. Тасалбар үлдсэн бол дахин захиалж болно.`,
      }),
    };
  }
  return {
    subject: `Захиалга цуцлагдлаа: ${event.title}`,
    ...render({
      title: 'Захиалга цуцлагдлаа', rows: baseRows(order, event), link, linkText: 'Захиалгаа харах', contact: event.contact,
      intro: 'Таны захиалгыг удирдлага цуцаллаа. Энэ захиалгын QR хүчингүй болсон. Асуух зүйл байвал зохион байгуулагчид хандана уу.',
    }),
  };
}

async function deliver(code, origin) {
  if (!mailer.isConfigured()) return { skipped: true };
  const order = await tk.getOrder(code);
  if (!order || !order.user_id) return { skipped: true };
  // Зөвхөн баталгаажсан хаяг руу: QR буруу хүнд очихоос сэргийлнэ
  const [[user]] = await pool.query('SELECT email, email_verified_at FROM users WHERE id = ?', [order.user_id]);
  if (!user || !user.email || !user.email_verified_at) return { skipped: true };
  const event = await tk.get(order.event_id);
  const link = `${origin}/tickets/order/${order.code}`;
  const content = order.status === 'paid' ? await ticketMail(order, event, link, origin)
    : order.status === 'pending' ? paymentMail(order, event, link) : cancelMail(order, event, link, origin);
  await queue.enqueue([{ userId: order.user_id, to: user.email, kind: `ticket_${order.status}`, priority: 0, ...content }]);
  return { queued: true };
}

// Захиалгын одоогийн төлөвт тохирох имэйлийг ардаа илгээнэ. Хэзээ ч алдаа шидэхгүй.
function notify(code, origin) {
  deliver(code, origin).catch((err) => console.error(`[mail] захиалга ${code}: ${err.message}`));
}

// Хугацаа дуусч автоматаар цуцлагдсан захиалгууд. Хүсэлтгүй үед ажилладаг тул SITE_URL шаардана.
function notifyExpired(codes) {
  const origin = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (!origin) return;
  for (const code of codes) notify(code, origin);
}

module.exports = { notify, notifyExpired, originOf, deliver };
