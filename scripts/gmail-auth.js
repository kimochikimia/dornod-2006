#!/usr/bin/env node
// Gmail API-ийн GMAIL_REFRESH_TOKEN-ийг нэг удаа авах туслах.
// Ашиглах: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET-ээ .env-д бичээд `npm run mail:auth`,
// гарсан холбоосыг нээж dornod2006@gmail.com-оор нэвтэрнэ. Токен дэлгэцэд гарахгүй, шууд .env-д бичигдэнэ.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

function saveToken(token) {
  const file = path.resolve('.env');
  const line = `GMAIL_REFRESH_TOKEN=${token}`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const next = /^GMAIL_REFRESH_TOKEN=/m.test(current)
    ? current.replace(/^GMAIL_REFRESH_TOKEN=[^\r\n]*/m, () => line)
    : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`;
  fs.writeFileSync(file, next);
}

const { GMAIL_CLIENT_ID: clientId, GMAIL_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) {
  console.error('.env файлд GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET-ээ эхлээд бичнэ үү.');
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}/`;
const state = crypto.randomBytes(16).toString('hex');
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/gmail.send',
  access_type: 'offline',
  prompt: 'consent',
  state,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  if (url.pathname !== '/' || (!url.searchParams.has('code') && !url.searchParams.has('error'))) {
    res.writeHead(404).end();
    return;
  }
  const finish = (message, code) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(message);
    server.close();
    process.exitCode = code;
  };
  if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
    console.error('Зөвшөөрөл амжилтгүй боллоо.');
    return finish('Амжилтгүй. Терминалаа харна уу.', 1);
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.refresh_token) {
    console.error(`Токен авч чадсангүй (HTTP ${r.status}).`);
    return finish('Амжилтгүй. Терминалаа харна уу.', 1);
  }
  saveToken(data.refresh_token);
  console.log('\nGMAIL_REFRESH_TOKEN-ийг .env файлд хадгаллаа. Утгыг нь Railway-ийн Variables хэсэгт нэмнэ үү.');
  finish('Болсон. Энэ цонхыг хааж, терминал руугаа буцна уу.', 0);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Энэ холбоосыг хөтчөөр нээж dornod2006@gmail.com-оор нэвтэрнэ үү:\n');
  console.log(authUrl);
});
