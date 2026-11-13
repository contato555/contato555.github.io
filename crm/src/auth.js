const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { TODAS } = require('./permissions');

const COOKIE = 'crm_sess';

function secret() {
  if (!process.env.SESSION_SECRET) {
    if (process.env.NODE_ENV === 'production') throw new Error('Defina SESSION_SECRET em produção');
    process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  }
  return process.env.SESSION_SECRET;
}

async function loadUser(db, id) {
  const u = await db.get('usuarios', id);
  if (!u || !u.ativo) return null;
  const perfil = await db.get('perfis', u.perfilId);
  const perms = new Set(u.perfilId === 'admin' ? TODAS : (perfil && perfil.permissoes) || []);
  return { id: u.id, nome: u.nome, email: u.email, perfilId: u.perfilId, perfilNome: perfil ? perfil.nome : '', vendedorId: u.vendedorId || null, trocarSenha: !!u.trocarSenha, permissoes: [...perms] };
}

function authMiddleware(db) {
  return async (req, res, next) => {
    const tok = req.cookies[COOKIE] || (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!tok) return res.status(401).json({ erro: 'Não autenticado' });
    try {
      const p = jwt.verify(tok, secret());
      const u = await loadUser(db, p.sub);
      if (!u) return res.status(401).json({ erro: 'Usuário inativo' });
      req.user = u;
      const livre = ['/api/me', '/api/me/senha', '/api/auth/logout', '/api/permissoes'];
      if (u.trocarSenha && !livre.includes(req.originalUrl.split('?')[0])) return res.status(403).json({ erro: 'Troque sua senha para continuar', trocarSenha: true });
      req.can = (perm) => u.permissoes.includes(perm);
      next();
    } catch { return res.status(401).json({ erro: 'Sessão expirada' }); }
  };
}

const need = (...perms) => (req, res, next) => (perms.some((p) => req.can(p)) ? next() : res.status(403).json({ erro: 'Sem permissão: ' + perms.join(' ou ') }));

// Limite simples de tentativas de login por IP/email
const tentativas = new Map();
function loginBloqueado(key) {
  const t = tentativas.get(key);
  return t && t.n >= 8 && Date.now() - t.t < 15 * 60 * 1000;
}
function registraFalha(key) { const t = tentativas.get(key) || { n: 0, t: Date.now() }; t.n++; t.t = Date.now(); tentativas.set(key, t); }

function authRoutes(app, db, audit) {
  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const key = req.ip + '|' + email;
    if (loginBloqueado(key)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos.' });
    const u = (await db.list('usuarios', (x) => x.email === email))[0];
    if (!u || !u.ativo || !(await bcrypt.compare(String(req.body.senha || ''), u.senhaHash))) {
      registraFalha(key);
      return res.status(401).json({ erro: 'E-mail ou senha inválidos' });
    }
    tentativas.delete(key);
    const token = jwt.sign({ sub: u.id }, secret(), { expiresIn: '12h' });
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 3600 * 1000 });
    await db.update('usuarios', u.id, { ultimoAcesso: new Date().toISOString() });
    await audit({ user: { id: u.id, nome: u.nome } }, 'login', 'usuarios', u.id);
    res.json({ ok: true, user: await loadUser(db, u.id) });
  });
  app.post('/api/auth/logout', (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });
}

const hash = (s) => bcrypt.hash(String(s), 10);

module.exports = { authMiddleware, authRoutes, need, hash, loadUser, bcrypt };
