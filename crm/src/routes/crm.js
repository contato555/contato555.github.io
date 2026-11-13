// Funil de vendas (oportunidades), tarefas/agenda, painel e relatórios.
const { need } = require('../auth');

const ETAPAS = [
  { id: 'novo', nome: 'Novo lead' }, { id: 'qualificacao', nome: 'Qualificação' }, { id: 'proposta', nome: 'Proposta enviada' },
  { id: 'negociacao', nome: 'Negociação' }, { id: 'ganho', nome: 'Ganho' }, { id: 'perdido', nome: 'Perdido' },
];

module.exports = function crm(app, ctx) {
  const { db, audit } = ctx;
  const meu = (req, perm, row, campo = 'responsavelId') => req.can(perm) || !row[campo] || row[campo] === req.user.id;

  // ---------- Funil ----------
  app.get('/api/funil/etapas', async (req, res) => { const c = await db.get('config', 'funil'); res.json((c && c.etapas) || ETAPAS); });
  app.put('/api/funil/etapas', need('config.gerenciar'), async (req, res) => { await db.put('config', 'funil', { etapas: req.body.etapas }); res.json({ ok: true }); });
  app.get('/api/oportunidades', need('funil.ver'), async (req, res) => {
    const [os, cs, us] = await Promise.all([db.list('oportunidades', (o) => meu(req, 'pedidos.ver_todos', o)), db.list('clientes'), db.list('usuarios')]);
    const cm = Object.fromEntries(cs.map((c) => [c.id, c.nome])), um = Object.fromEntries(us.map((u) => [u.id, u.nome]));
    res.json(os.map((o) => ({ ...o, clienteNome: cm[o.clienteId] || o.contatoNome || '', responsavelNome: um[o.responsavelId] || '' })));
  });
  const campos = ['titulo', 'clienteId', 'contatoNome', 'telefone', 'valor', 'etapa', 'responsavelId', 'previsao', 'origem', 'notas', 'motivoPerda', 'probabilidade'];
  const pick = (b) => Object.fromEntries(campos.filter((k) => b[k] !== undefined).map((k) => [k, k === 'valor' || k === 'probabilidade' ? Number(b[k] || 0) : b[k]]));
  app.post('/api/oportunidades', need('funil.editar'), async (req, res) => {
    const o = await db.insert('oportunidades', { etapa: 'novo', responsavelId: req.user.id, ...pick(req.body), historico: [{ etapa: req.body.etapa || 'novo', em: new Date().toISOString(), por: req.user.nome }] });
    await audit(req, 'criar', 'oportunidades', o.id, o.titulo);
    res.json(o);
  });
  app.put('/api/oportunidades/:id', need('funil.editar'), async (req, res) => {
    const cur = await db.get('oportunidades', req.params.id);
    if (!cur) return res.status(404).json({ erro: 'Oportunidade não encontrada' });
    const p = pick(req.body);
    if (p.etapa && p.etapa !== cur.etapa) {
      p.historico = [...(cur.historico || []), { etapa: p.etapa, em: new Date().toISOString(), por: req.user.nome }];
      if (['ganho', 'perdido'].includes(p.etapa)) p.fechadoEm = new Date().toISOString();
    }
    res.json(await db.update('oportunidades', cur.id, p));
  });
  app.delete('/api/oportunidades/:id', need('funil.editar'), async (req, res) => { await db.remove('oportunidades', req.params.id); await audit(req, 'excluir', 'oportunidades', req.params.id); res.json({ ok: true }); });

  // ---------- Tarefas ----------
  app.get('/api/tarefas', need('tarefas.ver'), async (req, res) => {
    const [ts, cs] = await Promise.all([db.list('tarefas', (t) => meu(req, 'pedidos.ver_todos', t) || t.criadoPor === req.user.id), db.list('clientes')]);
    const cm = Object.fromEntries(cs.map((c) => [c.id, c.nome]));
    res.json(ts.map((t) => ({ ...t, clienteNome: cm[t.clienteId] || '' })).sort((a, b) => String(a.data).localeCompare(String(b.data))));
  });
  const tcampos = ['titulo', 'tipo', 'data', 'hora', 'clienteId', 'oportunidadeId', 'responsavelId', 'descricao', 'concluida'];
  const tpick = (b) => Object.fromEntries(tcampos.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  app.post('/api/tarefas', need('tarefas.editar'), async (req, res) => res.json(await db.insert('tarefas', { tipo: 'ligacao', concluida: false, responsavelId: req.user.id, ...tpick(req.body), criadoPor: req.user.id })));
  app.put('/api/tarefas/:id', need('tarefas.editar'), async (req, res) => {
    const p = tpick(req.body);
    if (p.concluida === true) p.concluidaEm = new Date().toISOString();
    res.json(await db.update('tarefas', req.params.id, p));
  });
  app.delete('/api/tarefas/:id', need('tarefas.editar'), async (req, res) => { await db.remove('tarefas', req.params.id); res.json({ ok: true }); });

  // ---------- Painel ----------
  app.get('/api/dashboard', need('dashboard.ver'), async (req, res) => {
    const todos = req.can('pedidos.ver_todos');
    const filtro = (p) => todos || p.criadoPor === req.user.id || (req.user.vendedorId && p.vendedorId === req.user.vendedorId);
    const [ps, os, ts, convs] = await Promise.all([db.list('pedidos', filtro), db.list('oportunidades', (o) => todos || o.responsavelId === req.user.id), db.list('tarefas', (t) => !t.concluida && (t.responsavelId === req.user.id || todos)), req.can('whatsapp.ver') ? db.list('wa_conversas') : []]);
    const mes = new Date().toISOString().slice(0, 7);
    const hoje = new Date().toISOString().slice(0, 10);
    const enviados = ps.filter((p) => p.status === 'enviado');
    const doMes = enviados.filter((p) => String(p.data).startsWith(mes));
    const porDia = {};
    for (const p of doMes) porDia[p.data] = (porDia[p.data] || 0) + p.total;
    const porCliente = {};
    for (const p of doMes) porCliente[p.clienteNome] = (porCliente[p.clienteNome] || 0) + p.total;
    const meses = [];
    for (let k = 5; k >= 0; k--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); const m = d.toISOString().slice(0, 7); meses.push({ mes: m, total: enviados.filter((p) => String(p.data).startsWith(m)).reduce((s, p) => s + p.total, 0) }); }
    res.json({
      vendasMes: doMes.reduce((s, p) => s + p.total, 0), pedidosMes: doMes.length, ticketMedio: doMes.length ? doMes.reduce((s, p) => s + p.total, 0) / doMes.length : 0,
      rascunhos: ps.filter((p) => p.status === 'rascunho').length, comErro: ps.filter((p) => p.status === 'erro').length,
      funilAberto: os.filter((o) => !['ganho', 'perdido'].includes(o.etapa)).reduce((s, o) => s + (o.valor || 0), 0),
      oportunidadesAbertas: os.filter((o) => !['ganho', 'perdido'].includes(o.etapa)).length,
      taxaConversao: (() => { const f = os.filter((o) => ['ganho', 'perdido'].includes(o.etapa)); return f.length ? f.filter((o) => o.etapa === 'ganho').length / f.length : 0; })(),
      tarefasHoje: ts.filter((t) => t.data && t.data <= hoje).sort((a, b) => String(a.data).localeCompare(b.data)).slice(0, 10),
      naoLidas: convs.reduce((s, c) => s + (c.naoLidas || 0), 0),
      vendasPorDia: Object.entries(porDia).sort().map(([data, total]) => ({ data, total })),
      topClientes: Object.entries(porCliente).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nome, total]) => ({ nome, total })),
      ultimosMeses: meses,
    });
  });

  // ---------- Relatórios ----------
  app.get('/api/relatorios/vendas', need('relatorios.ver'), async (req, res) => {
    const de = req.query.de || '0000', ate = req.query.ate || '9999';
    const [ps, vs, prods] = await Promise.all([db.list('pedidos', (p) => p.status === 'enviado' && p.data >= de && p.data <= ate), db.list('vendedores'), db.list('produtos')]);
    const vm = Object.fromEntries(vs.map((v) => [v.id, v.nome]));
    const agrupa = (fn) => { const m = {}; for (const p of ps) for (const [k, v, q] of fn(p)) { m[k] = m[k] || { nome: k, total: 0, qtd: 0 }; m[k].total += v; m[k].qtd += q; } return Object.values(m).sort((a, b) => b.total - a.total); };
    res.json({
      total: ps.reduce((s, p) => s + p.total, 0), pedidos: ps.length,
      porVendedor: agrupa((p) => [[vm[p.vendedorId] || 'Sem vendedor', p.total, 1]]),
      porCliente: agrupa((p) => [[p.clienteNome, p.total, 1]]).slice(0, 50),
      porProduto: agrupa((p) => p.itens.map((i) => [`${i.codigo ? i.codigo + ' - ' : ''}${i.descricao}`, i.total, i.quantidade])).slice(0, 50),
      produtosCadastrados: prods.length,
    });
  });
};
