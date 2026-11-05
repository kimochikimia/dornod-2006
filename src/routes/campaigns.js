// Аян хөтөлбөр: нийтэд нээлттэй жагсаалт, дэлгэрэнгүй; баталгаажсан төгсөгч дэмжлэгээ мэдэгдэнэ.
const express = require('express');
const { pool } = require('../db');
const { flash, wrap, requireMember } = require('../middleware');
const cmp = require('../campaigns');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  res.render('campaigns/list', { title: 'Аян хөтөлбөр', campaigns: await cmp.list(), cmp });
}));

router.get('/:id(\\d+)', wrap(async (req, res, next) => {
  const campaign = await cmp.get(req.params.id);
  if (!campaign) return next();
  const supporters = await cmp.contributions(campaign.id, ['confirmed']);
  const mine = req.user ? await cmp.mine(campaign.id, req.user.id) : [];
  res.render('campaigns/show', { title: campaign.title, campaign, supporters, mine, cmp, errors: [], form: {} });
}));

// Нүүр зураг: ?s=t бол жижиг хувилбар
router.get('/:id(\\d+)/cover', wrap(async (req, res, next) => {
  const col = req.query.s === 't' ? 'cover_thumb' : 'cover';
  const [[k]] = await pool.query(`SELECT ${col} AS img FROM campaigns WHERE id = ?`, [req.params.id]);
  if (!k || !k.img) return next();
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=2592000, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(k.img);
}));

// Дэмжлэг мэдэгдэх: удирдлага баталгаажуулсны дараа нийтэд харагдана
router.post('/:id(\\d+)/support', requireMember, wrap(async (req, res, next) => {
  const campaign = await cmp.get(req.params.id);
  if (!campaign) return next();
  const back = `/campaigns/${campaign.id}`;
  if (campaign.status !== 'active') {
    flash(req, 'error', 'Энэ аян хаагдсан байна.');
    return res.redirect(back);
  }
  const { errors, fields } = cmp.contributionFields(req.body);
  if (errors.length) {
    const supporters = await cmp.contributions(campaign.id, ['confirmed']);
    const mine = await cmp.mine(campaign.id, req.user.id);
    return res.status(400).render('campaigns/show', { title: campaign.title, campaign, supporters, mine, cmp, errors, form: req.body });
  }
  const [[{ n }]] = await pool.query(
    "SELECT COUNT(*) AS n FROM campaign_contributions WHERE campaign_id = ? AND user_id = ? AND status = 'pending'",
    [campaign.id, req.user.id]
  );
  if (n >= 5) {
    flash(req, 'error', 'Таны хянагдаж буй 5 мэдэгдэл байна. Удирдлага шалгасны дараа дахин мэдэгдэнэ үү.');
    return res.redirect(`${back}#support`);
  }
  await pool.query('INSERT INTO campaign_contributions SET ?', [{ ...fields, campaign_id: campaign.id, user_id: req.user.id }]);
  flash(req, 'success', 'Баярлалаа! Таны дэмжлэг бүртгэгдлээ. Удирдлага баталгаажуулсны дараа жагсаалтад харагдана.');
  res.redirect(`${back}#mine`);
}));

// Хянагдаж буй өөрийн мэдэгдлээ цуцлах
router.post('/:id(\\d+)/support/:cid(\\d+)/delete', requireMember, wrap(async (req, res) => {
  await pool.query(
    "DELETE FROM campaign_contributions WHERE id = ? AND campaign_id = ? AND user_id = ? AND status = 'pending'",
    [req.params.cid, req.params.id, req.user.id]
  );
  flash(req, 'success', 'Мэдэгдэл цуцлагдлаа.');
  res.redirect(`/campaigns/${Number(req.params.id)}#mine`);
}));

module.exports = router;
