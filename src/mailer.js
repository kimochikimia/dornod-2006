// Имэйл илгээх: Gmail API (HTTPS). Railway-ийн Pro-оос доош багцад SMTP хаалттай тул SMTP ашиглахгүй.
// Тохиргоо: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN (scripts/gmail-auth.js-ээр авна), MAIL_FROM.
const fs = require('fs');
const path = require('path');
const MailComposer = require('nodemailer/lib/mail-composer');

// Имэйлийн header-ийн лого (mailLayout-ийн cid:site-logo). Нэг удаа уншиж санах ойд хадгална.
const LOGO_FILE = path.join(__dirname, '..', 'public', 'img', 'logo-header.png');
let logo = null;
function withLogo(message) {
  if (!message.html || !message.html.includes('cid:site-logo')) return message;
  if (!logo) logo = fs.readFileSync(LOGO_FILE);
  const attachments = [...(message.attachments || []), { filename: 'dornod-2006.png', content: logo, contentType: 'image/png', cid: 'site-logo', contentDisposition: 'inline' }];
  return { ...message, attachments };
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TIMEOUT_MS = 15000;

let accessToken = null;
let accessTokenExpires = 0;
let warned = false;

function isConfigured() {
  return !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
}

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpires) return accessToken;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Gmail токен авч чадсангүй (HTTP ${res.status})`);
  const data = await res.json();
  accessToken = data.access_token;
  accessTokenExpires = Date.now() + Math.max(0, (Number(data.expires_in) || 3600) - 60) * 1000;
  return accessToken;
}

// message: { to, subject, text, html, attachments }. Тохируулаагүй бол { skipped: true }.
async function send(message) {
  if (!isConfigured()) {
    if (!warned) console.warn('[mail] GMAIL_* тохируулаагүй тул имэйл илгээхгүй.');
    warned = true;
    return { skipped: true };
  }
  const address = process.env.MAIL_FROM || 'dornod2006@gmail.com';
  const mime = await new MailComposer({ from: { name: 'Дорнод 2006', address }, ...withLogo(message) }).compile().build();
  const raw = mime.toString('base64url');
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${await getAccessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { sent: true };
    if (res.status !== 401 || attempt) throw new Error(`Gmail имэйл хүлээж авсангүй (HTTP ${res.status})`);
    accessToken = null; // хугацаа нь дууссан токен — шинээр аваад нэг удаа дахин оролдоно
  }
  return { sent: false };
}

module.exports = { isConfigured, send };
