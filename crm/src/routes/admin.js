// Usuários, perfis de permissão e auditoria.
const { need, hash, loadUser, bcrypt } = require('../auth');
const { PERMISSOES } = require('../permissions');

module.exports = function admin(app, ctx) {
  const { db, audit } = ctx;
  const semSenha = ({ senhaHash, ...u }) => u;

  app.get('/api/me', (req, res) => res.json(req.user));
  app.post('/api/me/senha', async (req, res) => {
    const u = await db.get('usuarios', req.user.id);
    if (!(await bcrypt.compare(String(req.body.atual || ''), u.senhaHash))) return res.status(400).json({ erro: 'Senha atual incorreta' });
    if (String(req.body.nova || '').length < 8) return res.status(400).json({ erro: 'A nova senha deve ter ao menos 8 caracteres' });
    await db.update('usuarios', u.id, { senhaHash: await hash(req.body.nova), trocarSenha: false });
    await audit(req, 'trocar_senha', 'usuarios', u.id);
    res.json({ ok: true });
  });

  app.get('/api/permissoes', (req, res) => res.json(PERMISSOES));
  app.get('/api/usuarios', async (req, res) => {
    const us = await db.list('usuarios');
    // lista resumida para seleção de responsável; completa apenas para administradores
    if (!req.can('usuarios.gerenciar')) return res.json(us.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome })));
    res.json(us.map(semSenha).sort((a, b) => a.nome.localeCompare(b.nome)));
  });
  app.post('/api/usuarios', need('usuarios.gerenciar'), async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!req.body.nome || !email || String(req.body.senha || '').length < 8) return res.status(400).json({ erro: 'Nome, e-mail e senha (mín. 8 caracteres) são obrigatórios' });
    if ((await db.list('usuarios', (u) => u.email === email)).length) return res.status(409).json({ erro: 'E-mail já cadastrado' });
    const u = await db.insert('usuarios', { nome: req.body.nome, email, perfilId: req.body.perfilId || 'vendedor', vendedorId: req.body.vendedorId || '', telefone: req.body.telefone || '', ativo: req.body.ativo !== false, trocarSenha: req.body.trocarSenha !== false, senhaHash: await hash(req.body.senha) });
    await audit(req, 'criar', 'usuarios', u.id, u.email);
    res.json(semSenha(u));
  });
  app.put('/api/usuarios/:id', need('usuarios.gerenciar'), async (req, res) => {
    const patch = {};
    for (const k of ['nome', 'perfilId', 'vendedorId', 'telefone', 'ativo', 'trocarSenha']) if (req.body[k] !== undefined) patch[k] = req.body[k];
    if (req.body.email) patch.email = String(req.body.email).trim().toLowerCase();
    if (req.body.senha) { if (String(req.body.senha).length < 8) return res.status(400).json({ erro: 'Senha mínima de 8 caracteres' }); patch.senhaHash = await hash(req.body.senha); }
    if (req.params.id === req.user.id && (patch.ativo === false || (patch.perfilId && patch.perfilId !== req.user.perfilId))) return res.status(400).json({ erro: 'Você não pode desativar ou trocar o próprio perfil' });
    const u = await db.update('usuarios', req.params.id, patch);
    await audit(req, 'editar', 'usuarios', req.params.id, Object.keys(patch).filter((k) => k !== 'senhaHash').join(',') + (patch.senhaHash ? ',senha' : ''));
    res.json(semSenha(u));
  });

  app.get('/api/perfis', async (req, res) => res.json(await db.list('perfis')));
  app.post('/api/perfis', need('usuarios.gerenciar'), async (req, res) => res.json(await db.insert('perfis', { nome: req.body.nome, permissoes: req.body.permissoes || [] })));
  app.put('/api/perfis/:id', need('usuarios.gerenciar'), async (req, res) => {
    if (req.params.id === 'admin') return res.status(400).json({ erro: 'O perfil Administrador sempre tem todas as permissões' });
    const p = await db.update('perfis', req.params.id, { nome: req.body.nome, permissoes: req.body.permissoes || [] });
    await audit(req, 'editar', 'perfis', req.params.id, p.nome);
    res.json(p);
  });
  app.delete('/api/perfis/:id', need('usuarios.gerenciar'), async (req, res) => {
    if ((await db.list('usuarios', (u) => u.perfilId === req.params.id)).length) return res.status(409).json({ erro: 'Há usuários neste perfil' });
    if (['admin'].includes(req.params.id)) return res.status(400).json({ erro: 'Perfil do sistema' });
    await db.remove('perfis', req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/auditoria', need('auditoria.ver'), async (req, res) => {
    const rows = await db.list('auditoria');
    res.json(rows.sort((a, b) => (b.criadoEm > a.criadoEm ? 1 : -1)).slice(0, 500));
  });
  ctx.loadUser = loadUser;
};
