// Clientes, produtos, vendedores, listas de preço e pedidos de venda (com envio ao Bling).
const { need } = require('../auth');
const { normalizaFone } = require('../whatsapp');

const num = (v, d = 0) => { if (v === undefined || v === null || v === '') return d; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : d; };
const r2 = (n) => Math.round(n * 100) / 100;
const hoje = () => new Date().toISOString().slice(0, 10);

function precoDaLista(produto, lista) {
  if (!produto) return 0;
  const base = num(produto.preco);
  if (!lista || lista.ativa === false) return base;
  const it = (lista.itens || []).find((i) => String(i.produtoId) === String(produto.id));
  if (it && it.preco !== '' && it.preco !== null && it.preco !== undefined) return r2(num(it.preco));
  return r2(base * (1 + num(lista.ajustePercentual) / 100));
}

function totais(p) {
  const itens = (p.itens || []).map((i) => {
    const bruto = num(i.quantidade) * num(i.valor);
    return { ...i, quantidade: num(i.quantidade), valor: r2(num(i.valor)), desconto: num(i.desconto), total: r2(bruto * (1 - num(i.desconto) / 100)) };
  });
  const subtotal = r2(itens.reduce((s, i) => s + i.total, 0));
  const total = r2(subtotal - num(p.desconto) + num(p.frete));
  return { itens, subtotal, total };
}

module.exports = function comercial(app, ctx) {
  const { db, bling, audit, wa } = ctx;

  const podeVerCliente = (req, c) => req.can('clientes.ver_todos') || !req.user.vendedorId || !c.vendedorId || String(c.vendedorId) === String(req.user.vendedorId);
  const podeVerPedido = (req, p) => req.can('pedidos.ver_todos') || p.criadoPor === req.user.id || (req.user.vendedorId && String(p.vendedorId) === String(req.user.vendedorId));

  // ---------- Clientes ----------
  app.get('/api/clientes', need('clientes.ver', 'pedidos.criar'), async (req, res) => {
    const rows = await db.list('clientes', (c) => podeVerCliente(req, c));
    rows.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    res.json(rows);
  });
  app.get('/api/clientes/:id', need('clientes.ver'), async (req, res) => {
    const c = await db.get('clientes', req.params.id);
    if (!c || !podeVerCliente(req, c)) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const [pedidos, notas, tarefas, oportunidades] = await Promise.all([
      db.list('pedidos', (p) => p.clienteId === c.id),
      db.list('notas', (n) => n.clienteId === c.id),
      db.list('tarefas', (t) => t.clienteId === c.id),
      db.list('oportunidades', (o) => o.clienteId === c.id),
    ]);
    res.json({ ...c, pedidos: pedidos.sort((a, b) => (b.criadoEm > a.criadoEm ? 1 : -1)), notas: notas.sort((a, b) => (b.criadoEm > a.criadoEm ? 1 : -1)), tarefas, oportunidades });
  });
  const camposCliente = ['nome', 'fantasia', 'tipoPessoa', 'documento', 'ie', 'email', 'telefone', 'celular', 'whatsapp', 'cep', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'vendedorId', 'listaPrecoId', 'tags', 'origem', 'observacoes', 'situacao'];
  const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  app.post('/api/clientes', need('clientes.editar'), async (req, res) => {
    if (!req.body.nome) return res.status(400).json({ erro: 'Nome obrigatório' });
    const c = await db.insert('clientes', { situacao: 'ativo', vendedorId: req.user.vendedorId || '', ...pick(req.body, camposCliente), criadoPor: req.user.id });
    await audit(req, 'criar', 'clientes', c.id, c.nome);
    res.json(c);
  });
  app.put('/api/clientes/:id', need('clientes.editar'), async (req, res) => {
    const cur = await db.get('clientes', req.params.id);
    if (!cur || !podeVerCliente(req, cur)) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const c = await db.update('clientes', req.params.id, pick(req.body, camposCliente));
    await audit(req, 'editar', 'clientes', c.id, c.nome);
    res.json(c);
  });
  app.delete('/api/clientes/:id', need('clientes.excluir'), async (req, res) => {
    await db.remove('clientes', req.params.id);
    await audit(req, 'excluir', 'clientes', req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/clientes/:id/notas', need('clientes.editar'), async (req, res) => {
    const n = await db.insert('notas', { clienteId: req.params.id, texto: String(req.body.texto || ''), tipo: req.body.tipo || 'nota', usuarioId: req.user.id, usuarioNome: req.user.nome });
    res.json(n);
  });
  // lista de preço exclusiva para o cliente (cria e já vincula)
  app.post('/api/clientes/:id/lista-exclusiva', need('listas.editar'), async (req, res) => {
    const c = await db.get('clientes', req.params.id);
    if (!c) return res.status(404).json({ erro: 'Cliente não encontrado' });
    let base = c.listaPrecoId ? await db.get('listas', c.listaPrecoId) : null;
    const l = await db.insert('listas', { nome: `Lista exclusiva - ${c.nome}`, descricao: 'Criada a partir do cliente', ajustePercentual: base ? base.ajustePercentual || 0 : 0, itens: base ? base.itens || [] : [], ativa: true, clienteExclusivoId: c.id });
    await db.update('clientes', c.id, { listaPrecoId: l.id });
    await audit(req, 'criar', 'listas', l.id, l.nome);
    res.json(l);
  });

  // ---------- Produtos / vendedores / formas de pagamento (cache local do Bling) ----------
  app.get('/api/produtos', need('produtos.ver', 'pedidos.criar', 'listas.ver'), async (req, res) => {
    const rows = await db.list('produtos', (p) => req.query.todos ? true : p.situacao !== 'I');
    rows.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    res.json(rows);
  });
  app.get('/api/vendedores', async (req, res) => {
    const rows = await db.list('vendedores');
    rows.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    res.json(rows);
  });
  app.get('/api/formas-pagamento', async (req, res) => res.json(await db.list('formas_pagamento', (f) => f.situacao !== 0)));

  // ---------- Listas de preço ----------
  app.get('/api/listas', need('listas.ver', 'pedidos.criar', 'clientes.ver'), async (req, res) => {
    const [ls, cs] = await Promise.all([db.list('listas'), db.list('clientes')]);
    res.json(ls.map((l) => ({ ...l, qtdItens: (l.itens || []).length, clientes: cs.filter((c) => c.listaPrecoId === l.id).map((c) => ({ id: c.id, nome: c.nome })) })).sort((a, b) => a.nome.localeCompare(b.nome)));
  });
  app.get('/api/listas/:id', need('listas.ver'), async (req, res) => {
    const l = await db.get('listas', req.params.id);
    l ? res.json(l) : res.status(404).json({ erro: 'Lista não encontrada' });
  });
  const limpaLista = (b) => ({
    nome: String(b.nome || '').trim(), descricao: b.descricao || '', ajustePercentual: num(b.ajustePercentual), ativa: b.ativa !== false,
    itens: (b.itens || []).filter((i) => i.produtoId && i.preco !== '' && i.preco !== null).map((i) => ({ produtoId: String(i.produtoId), preco: r2(num(i.preco)) })),
  });
  app.post('/api/listas', need('listas.editar'), async (req, res) => {
    const d = limpaLista(req.body);
    if (!d.nome) return res.status(400).json({ erro: 'Nome obrigatório' });
    const l = await db.insert('listas', d);
    await setClientesDaLista(l.id, req.body.clienteIds);
    await audit(req, 'criar', 'listas', l.id, l.nome);
    res.json(l);
  });
  app.put('/api/listas/:id', need('listas.editar'), async (req, res) => {
    const l = await db.update('listas', req.params.id, limpaLista(req.body));
    if (!l) return res.status(404).json({ erro: 'Lista não encontrada' });
    await setClientesDaLista(l.id, req.body.clienteIds);
    await audit(req, 'editar', 'listas', l.id, l.nome);
    res.json(l);
  });
  app.delete('/api/listas/:id', need('listas.editar'), async (req, res) => {
    await db.remove('listas', req.params.id);
    for (const c of await db.list('clientes', (c) => c.listaPrecoId === req.params.id)) await db.update('clientes', c.id, { listaPrecoId: '' });
    await audit(req, 'excluir', 'listas', req.params.id);
    res.json({ ok: true });
  });
  async function setClientesDaLista(listaId, ids) {
    if (!Array.isArray(ids)) return;
    const set = new Set(ids.map(String));
    for (const c of await db.list('clientes')) {
      if (set.has(c.id) && c.listaPrecoId !== listaId) await db.update('clientes', c.id, { listaPrecoId: listaId });
      else if (!set.has(c.id) && c.listaPrecoId === listaId) await db.update('clientes', c.id, { listaPrecoId: '' });
    }
  }
  // preços efetivos para um cliente (lista do cliente aplicada sobre o preço do Bling)
  app.get('/api/precos', async (req, res) => {
    const c = req.query.clienteId ? await db.get('clientes', req.query.clienteId) : null;
    const lista = c && c.listaPrecoId ? await db.get('listas', c.listaPrecoId) : null;
    const prods = await db.list('produtos');
    res.json({ lista: lista ? { id: lista.id, nome: lista.nome } : null, precos: Object.fromEntries(prods.map((p) => [p.id, precoDaLista(p, lista)])) });
  });

  // ---------- Pedidos ----------
  app.get('/api/pedidos', need('pedidos.ver'), async (req, res) => {
    const [ps, cs, vs] = await Promise.all([db.list('pedidos', (p) => podeVerPedido(req, p)), db.list('clientes'), db.list('vendedores')]);
    const cm = Object.fromEntries(cs.map((c) => [c.id, c.nome])), vm = Object.fromEntries(vs.map((v) => [v.id, v.nome]));
    res.json(ps.map((p) => ({ ...p, clienteNome: cm[p.clienteId] || p.clienteNome || '', vendedorNome: vm[p.vendedorId] || '' })).sort((a, b) => b.numero - a.numero));
  });
  app.get('/api/pedidos/:id', need('pedidos.ver'), async (req, res) => {
    const p = await db.get('pedidos', req.params.id);
    if (!p || !podeVerPedido(req, p)) return res.status(404).json({ erro: 'Pedido não encontrado' });
    res.json(p);
  });

  async function montaPedido(req, body, atual) {
    const cliente = await db.get('clientes', body.clienteId);
    if (!cliente) throw Object.assign(new Error('Selecione o cliente'), { status: 400 });
    const lista = cliente.listaPrecoId ? await db.get('listas', cliente.listaPrecoId) : null;
    const podePreco = req.can('pedidos.alterar_preco');
    const itens = [];
    for (const i of body.itens || []) {
      if (!num(i.quantidade)) continue;
      const prod = i.produtoId ? await db.get('produtos', i.produtoId) : null;
      const precoTabela = prod ? precoDaLista(prod, lista) : num(i.valor);
      itens.push({
        produtoId: prod ? prod.id : '', codigo: prod ? prod.codigo : i.codigo || '', descricao: prod ? prod.nome : i.descricao || '', unidade: (prod && prod.unidade) || i.unidade || 'UN',
        quantidade: num(i.quantidade), precoTabela, valor: podePreco ? num(i.valor, precoTabela) : precoTabela, desconto: podePreco ? num(i.desconto) : 0,
      });
    }
    if (!itens.length) throw Object.assign(new Error('Inclua ao menos um item'), { status: 400 });
    const vendedorId = req.can('pedidos.ver_todos') || !req.user.vendedorId ? body.vendedorId || cliente.vendedorId || req.user.vendedorId || '' : req.user.vendedorId;
    const base = {
      clienteId: cliente.id, clienteNome: cliente.nome, vendedorId: String(vendedorId || ''), listaPrecoId: lista ? lista.id : '', listaPrecoNome: lista ? lista.nome : '',
      data: body.data || hoje(), dataPrevista: body.dataPrevista || '', numeroPedidoCompra: body.numeroPedidoCompra || '',
      desconto: podePreco ? num(body.desconto) : 0, frete: num(body.frete), formaPagamentoId: body.formaPagamentoId || '', parcelas: Math.max(1, num(body.parcelas, 1)), intervaloDias: num(body.intervaloDias, 30),
      observacoes: body.observacoes || '', observacoesInternas: body.observacoesInternas || '', oportunidadeId: body.oportunidadeId || (atual && atual.oportunidadeId) || '',
      itens,
    };
    return { ...base, ...totais(base) };
  }

  app.post('/api/pedidos', need('pedidos.criar'), async (req, res, next) => {
    try {
      const d = await montaPedido(req, req.body);
      const p = await db.insert('pedidos', { ...d, numero: await db.nextSeq('pedidos'), status: 'rascunho', criadoPor: req.user.id, criadoPorNome: req.user.nome });
      await audit(req, 'criar', 'pedidos', p.id, `#${p.numero} ${p.clienteNome} R$ ${p.total}`);
      res.json(p);
    } catch (e) { next(e); }
  });
  app.put('/api/pedidos/:id', need('pedidos.editar'), async (req, res, next) => {
    try {
      const cur = await db.get('pedidos', req.params.id);
      if (!cur || !podeVerPedido(req, cur)) return res.status(404).json({ erro: 'Pedido não encontrado' });
      if (cur.blingId) return res.status(409).json({ erro: 'Pedido já enviado ao Bling não pode ser alterado no CRM' });
      const p = await db.update('pedidos', cur.id, { ...(await montaPedido(req, req.body, cur)), status: 'rascunho', erroBling: '' });
      await audit(req, 'editar', 'pedidos', p.id, `#${p.numero}`);
      res.json(p);
    } catch (e) { next(e); }
  });
  app.delete('/api/pedidos/:id', need('pedidos.editar'), async (req, res) => {
    const cur = await db.get('pedidos', req.params.id);
    if (!cur || !podeVerPedido(req, cur)) return res.status(404).json({ erro: 'Pedido não encontrado' });
    if (cur.blingId) return res.status(409).json({ erro: 'Pedido já enviado ao Bling' });
    await db.remove('pedidos', cur.id);
    await audit(req, 'excluir', 'pedidos', cur.id, `#${cur.numero}`);
    res.json({ ok: true });
  });

  async function garanteContatoBling(cliente) {
    if (cliente.blingId) return cliente.blingId;
    const doc = String(cliente.documento || '').replace(/\D/g, '');
    if (doc) {
      const achou = await bling.get(`/contatos?numeroDocumento=${doc}&limite=1`).catch(() => null);
      if (achou && achou.data && achou.data[0]) { await db.update('clientes', cliente.id, { blingId: String(achou.data[0].id) }); return String(achou.data[0].id); }
    }
    const body = {
      nome: cliente.nome, fantasia: cliente.fantasia || undefined, situacao: 'A', tipo: cliente.tipoPessoa === 'F' || doc.length === 11 ? 'F' : 'J',
      numeroDocumento: doc || undefined, ie: cliente.ie || undefined, email: cliente.email || undefined, telefone: cliente.telefone || undefined, celular: cliente.celular || cliente.whatsapp || undefined,
      endereco: { geral: { endereco: cliente.endereco || '', numero: cliente.numero || '', complemento: cliente.complemento || '', bairro: cliente.bairro || '', cep: cliente.cep || '', municipio: cliente.cidade || '', uf: cliente.uf || '' } },
      ...(cliente.vendedorId ? { vendedor: { id: Number(cliente.vendedorId) } } : {}),
    };
    const r = await bling.post('/contatos', body);
    const id = String(r.data.id);
    await db.update('clientes', cliente.id, { blingId: id });
    return id;
  }

  function payloadBling(p, contatoId) {
    const parcelas = [];
    if (p.formaPagamentoId) {
      const n = Math.max(1, p.parcelas || 1);
      let resto = p.total;
      for (let k = 1; k <= n; k++) {
        const valor = k === n ? r2(resto) : r2(p.total / n);
        resto -= valor;
        const dt = new Date((p.data || hoje()) + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() + (p.intervaloDias || 0) * k);
        parcelas.push({ dataVencimento: dt.toISOString().slice(0, 10), valor, formaPagamento: { id: Number(p.formaPagamentoId) } });
      }
    }
    return {
      contato: { id: Number(contatoId) },
      data: p.data, dataSaida: p.data, ...(p.dataPrevista ? { dataPrevista: p.dataPrevista } : {}),
      ...(p.numeroPedidoCompra ? { numeroPedidoCompra: p.numeroPedidoCompra } : {}),
      ...(p.vendedorId ? { vendedor: { id: Number(p.vendedorId) } } : {}),
      itens: p.itens.map((i) => ({ ...(i.produtoId ? { produto: { id: Number(i.produtoId) } } : {}), codigo: i.codigo, descricao: i.descricao, unidade: i.unidade || 'UN', quantidade: i.quantidade, valor: i.valor, desconto: i.desconto || 0 })),
      ...(p.desconto ? { desconto: { valor: p.desconto, unidade: 'REAL' } } : {}),
      ...(p.frete ? { transporte: { fretePorConta: 0, frete: p.frete } } : {}),
      ...(parcelas.length ? { parcelas } : {}),
      observacoes: p.observacoes || '',
      observacoesInternas: [`Pedido CRM #${p.numero}`, p.observacoesInternas].filter(Boolean).join(' - '),
    };
  }

  app.post('/api/pedidos/:id/enviar-bling', need('pedidos.enviar_bling'), async (req, res) => {
    const p = await db.get('pedidos', req.params.id);
    if (!p || !podeVerPedido(req, p)) return res.status(404).json({ erro: 'Pedido não encontrado' });
    if (p.blingId) return res.status(409).json({ erro: `Pedido já enviado (Bling nº ${p.blingNumero || p.blingId})` });
    try {
      const cliente = await db.get('clientes', p.clienteId);
      const contatoId = await garanteContatoBling(cliente);
      const r = await bling.post('/pedidos/vendas', payloadBling(p, contatoId));
      const blingId = String(r.data.id);
      let blingNumero = '';
      try { const d = await bling.get(`/pedidos/vendas/${blingId}`); blingNumero = String((d.data && d.data.numero) || ''); } catch {}
      const up = await db.update('pedidos', p.id, { status: 'enviado', blingId, blingNumero, enviadoEm: new Date().toISOString(), enviadoPor: req.user.nome, erroBling: '' });
      if (p.oportunidadeId) await db.update('oportunidades', p.oportunidadeId, { etapa: 'ganho', valor: p.total }).catch(() => {});
      await audit(req, 'enviar_bling', 'pedidos', p.id, `#${p.numero} → Bling ${blingNumero || blingId}`);
      res.json(up);
    } catch (e) {
      await db.update('pedidos', p.id, { status: 'erro', erroBling: e.message });
      await audit(req, 'erro_bling', 'pedidos', p.id, e.message);
      res.status(502).json({ erro: 'Bling recusou o pedido: ' + e.message });
    }
  });

  // atualiza a situação do pedido a partir do Bling
  app.post('/api/pedidos/:id/atualizar-bling', need('pedidos.ver'), async (req, res, next) => {
    try {
      const p = await db.get('pedidos', req.params.id);
      if (!p || !p.blingId) return res.status(400).json({ erro: 'Pedido não enviado' });
      const d = (await bling.get(`/pedidos/vendas/${p.blingId}`)).data || {};
      let situacaoNome = '';
      if (d.situacao && d.situacao.id) { const s = await bling.get(`/situacoes/${d.situacao.id}`).catch(() => null); situacaoNome = (s && s.data && s.data.nome) || ''; }
      res.json(await db.update('pedidos', p.id, { blingNumero: String(d.numero || p.blingNumero || ''), blingSituacao: situacaoNome || String((d.situacao && d.situacao.id) || ''), blingTotal: d.total }));
    } catch (e) { next(e); }
  });

  app.post('/api/pedidos/:id/whatsapp', need('whatsapp.enviar'), async (req, res, next) => {
    try {
      const p = await db.get('pedidos', req.params.id);
      if (!p || !podeVerPedido(req, p)) return res.status(404).json({ erro: 'Pedido não encontrado' });
      const c = await db.get('clientes', p.clienteId);
      const fone = normalizaFone(req.body.telefone || c.whatsapp || c.celular || c.telefone);
      if (!fone) return res.status(400).json({ erro: 'Cliente sem WhatsApp/celular cadastrado' });
      const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const linhas = p.itens.map((i) => `• ${i.quantidade} ${i.unidade} ${i.descricao}${i.codigo ? ` (${i.codigo})` : ''} — ${brl(i.total)}`);
      const texto = [`Olá ${c.nome}! Segue o resumo do seu pedido nº ${p.blingNumero || p.numero}:`, '', ...linhas, '', p.desconto ? `Desconto: ${brl(p.desconto)}` : '', p.frete ? `Frete: ${brl(p.frete)}` : '', `*Total: ${brl(p.total)}*`, p.observacoes ? `\nObs.: ${p.observacoes}` : '', '', 'Qualquer dúvida, é só responder esta mensagem.'].filter((l, ix, a) => l !== '' || a[ix - 1] !== '').join('\n');
      const m = await wa.enviarTexto(fone, texto, req.user);
      await db.update('pedidos', p.id, { whatsappEnviadoEm: new Date().toISOString() });
      res.json(m);
    } catch (e) { next(e); }
  });

  ctx.precoDaLista = precoDaLista;
};
module.exports.precoDaLista = precoDaLista;
module.exports.totais = totais;
