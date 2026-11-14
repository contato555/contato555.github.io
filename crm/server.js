// CRM integrado ao Bling (API v3) e WhatsApp Business (Cloud API). Pronto para Google Cloud Run + Firestore.
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const { createDb } = require('./src/db');
const { createBling } = require('./src/bling');
const { createWhatsApp } = require('./src/whatsapp');
const { authMiddleware, authRoutes, hash } = require('./src/auth');
const { PERFIS_PADRAO } = require('./src/permissions');

async function createApp(opts = {}) {
  const db = opts.db || createDb();
  const bling = createBling(db);
  const wa = createWhatsApp(db);
  const audit = (req, acao, entidade, entidadeId, detalhe) =>
    db.insert('auditoria', { usuarioId: req.user && req.user.id, usuarioNome: req.user && req.user.nome, acao, entidade, entidadeId: entidadeId || '', detalhe: detalhe || '' }).catch(() => {});
  const ctx = { db, bling, wa, audit };

  await seed(db);

  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    next();
  });

  app.get('/healthz', (req, res) => res.json({ ok: true, db: db.driverName }));
  app.use('/vendor/vue.js', express.static(path.join(path.dirname(require.resolve('vue/package.json')), 'dist', 'vue.global.prod.js')));
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '1h' }));

  // rotas públicas (login, callbacks e webhooks)
  const pub = express.Router();
  authRoutes(pub, db, audit);
  // rotas autenticadas
  const priv = express.Router();
  priv.use(authMiddleware(db));
  require('./src/routes/integracoes')(priv, ctx, pub);
  require('./src/routes/admin')(priv, ctx);
  require('./src/routes/comercial')(priv, ctx);
  require('./src/routes/crm')(priv, ctx);

  app.use(pub);
  app.use('/api', (req, res, next) => { req.url = '/api' + req.url; priv(req, res, next); });
  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (!err.status || err.status >= 500) console.error(err);
    res.status(err.status && err.status < 600 ? err.status : 500).json({ erro: err.message || 'Erro interno' });
  });
  app.locals.ctx = ctx;
  return app;
}

async function seed(db) {
  for (const p of PERFIS_PADRAO) {
    const cur = await db.get('perfis', p.id);
    if (!cur) await db.insert('perfis', p);
    else if (p.id === 'admin') await db.put('perfis', 'admin', { ...cur, permissoes: p.permissoes });
  }
  if (!(await db.list('usuarios')).length) {
    const email = (process.env.ADMIN_EMAIL || 'admin@crm.local').toLowerCase();
    const senha = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
    await db.insert('usuarios', { nome: 'Administrador', email, perfilId: 'admin', ativo: true, trocarSenha: true, senhaHash: await hash(senha) });
    console.log(`\n=== Usuário administrador criado ===\nE-mail: ${email}\nSenha: ${process.env.ADMIN_PASSWORD ? '(definida em ADMIN_PASSWORD)' : senha}\nTroque a senha no primeiro acesso.\n`);
  }
}

if (require.main === module) {
  createApp().then((app) => {
    const port = process.env.PORT || 8080;
    app.listen(port, () => console.log(`CRM rodando em http://localhost:${port}`));
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { createApp };
