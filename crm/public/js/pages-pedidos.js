/* Pedidos de venda: listagem, digitação com preço da lista do cliente e envio ao Bling / WhatsApp */
Pages.pedidos = {
  setup() {
    const rows = ref([]); const q = ref(''); const st = ref(''); const de = ref(''); const ate = ref(''); const loading = ref(true);
    const load = async () => { loading.value = true; try { rows.value = await api.get('/api/pedidos'); } finally { loading.value = false; } };
    onMounted(load);
    const lista = computed(() => rows.value.filter((p) => (!st.value || p.status === st.value) && (!de.value || p.data >= de.value) && (!ate.value || p.data <= ate.value) && (!q.value || match(q.value, p.numero, p.clienteNome, p.vendedorNome, p.blingNumero))));
    const total = computed(() => lista.value.reduce((s, p) => s + p.total, 0));
    const lbl = { rascunho: 'Rascunho', enviado: 'Enviado ao Bling', erro: 'Erro no envio' };
    return { rows, q, st, de, ate, lista, total, lbl, loading, ...helpers };
  },
  template: `<div><div class="row" style="margin-bottom:14px"><h1 class="grow">Pedidos de venda</h1><button class="btn p nogrow" v-if="can('pedidos.criar')" @click="go('/pedidos/novo')">+ Digitar pedido</button></div>
  <div class="card"><div class="row" style="margin-bottom:12px"><div class="grow"><input v-model="q" placeholder="Buscar nº, cliente, vendedor, nº Bling"></div>
   <div><select v-model="st"><option value="">Todos status</option><option value="rascunho">Rascunho</option><option value="enviado">Enviado ao Bling</option><option value="erro">Erro no envio</option></select></div>
   <div><input type="date" v-model="de"></div><div><input type="date" v-model="ate"></div></div>
  <div class="tw"><table><thead><tr><th>Nº CRM</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th class="r">Total</th><th>Status</th><th>Nº Bling</th></tr></thead><tbody>
  <tr v-for="p in lista" :key="p.id" class="click" @click="go('/pedidos/'+p.id)"><td>#{{p.numero}}</td><td>{{dt(p.data)}}</td><td>{{p.clienteNome}}</td><td>{{p.vendedorNome}}</td><td class="r nowrap">{{brl(p.total)}}</td>
  <td><span class="badge" :class="{ok:p.status==='enviado',err:p.status==='erro',warn:p.status==='rascunho'}">{{lbl[p.status]}}</span></td><td>{{p.blingNumero}}</td></tr>
  <tr v-if="!loading && !lista.length"><td colspan="7" class="empty">Nenhum pedido</td></tr></tbody>
  <tfoot v-if="lista.length"><tr><td colspan="4" class="b">{{lista.length}} pedido(s)</td><td class="r b">{{brl(total)}}</td><td colspan="2"></td></tr></tfoot></table></div></div></div>`,
};

Pages.pedido = {
  components: { AutoComplete, Modal },
  props: ['id'],
  setup(props) {
    const novo = props.id === 'novo';
    const p = reactive({ clienteId: store.route.query.cliente || '', vendedorId: store.user.vendedorId || '', data: hojeISO(), dataPrevista: '', numeroPedidoCompra: '', desconto: 0, frete: 0, formaPagamentoId: '', parcelas: 1, intervaloDias: 30, observacoes: '', observacoesInternas: '', itens: [], status: 'rascunho', oportunidadeId: store.route.query.oportunidade || '' });
    const clientes = ref([]); const produtos = ref([]); const vendedores = ref([]); const formas = ref([]); const precos = ref({}); const listaNome = ref(''); const busy = ref(false);
    const novoItem = reactive({ produtoId: '', quantidade: 1 }); const qtdRef = ref(null); const prodAc = ref(null);
    const bloqueado = computed(() => !!p.blingId || (!novo && !can('pedidos.editar')));
    const podePreco = can('pedidos.alterar_preco');

    async function carregaPrecos() {
      if (!p.clienteId) { precos.value = {}; listaNome.value = ''; return; }
      const r = await api.get('/api/precos?clienteId=' + p.clienteId); precos.value = r.precos; listaNome.value = r.lista ? r.lista.nome : '';
    }
    onMounted(async () => {
      [clientes.value, produtos.value, vendedores.value, formas.value] = await Promise.all([api.get('/api/clientes'), cached('produtos', '/api/produtos'), cached('vendedores', '/api/vendedores'), api.get('/api/formas-pagamento')]);
      if (!novo) Object.assign(p, await api.get('/api/pedidos/' + props.id));
      else if (store.route.query.dup) { const o = await api.get('/api/pedidos/' + store.route.query.dup); Object.assign(p, { clienteId: o.clienteId, vendedorId: o.vendedorId, itens: o.itens, observacoes: o.observacoes, formaPagamentoId: o.formaPagamentoId, parcelas: o.parcelas, intervaloDias: o.intervaloDias, frete: o.frete, desconto: o.desconto }); }
      await carregaPrecos();
      if (novo && store.route.query.dup) reprecifica();
    });
    const cliente = computed(() => clientes.value.find((c) => c.id === p.clienteId));
    const prodMap = computed(() => Object.fromEntries(produtos.value.map((x) => [x.id, x])));
    const onCliente = async (c) => { if (c.vendedorId && !store.user.vendedorId) p.vendedorId = c.vendedorId; await carregaPrecos(); reprecifica(); };
    function reprecifica() { for (const i of p.itens) if (i.produtoId && precos.value[i.produtoId] !== undefined) { i.precoTabela = precos.value[i.produtoId]; if (!podePreco || !i.valor) i.valor = i.precoTabela; } }
    const preco = (id) => precos.value[id] ?? (prodMap.value[id] || {}).preco ?? 0;
    function addItem() {
      const pr = prodMap.value[novoItem.produtoId]; if (!pr) return toast('Selecione um produto', 'err');
      const ja = p.itens.find((i) => i.produtoId === pr.id);
      if (ja) ja.quantidade = Number(ja.quantidade) + Number(novoItem.quantidade || 1);
      else p.itens.push({ produtoId: pr.id, codigo: pr.codigo, descricao: pr.nome, unidade: pr.unidade || 'UN', quantidade: Number(novoItem.quantidade || 1), precoTabela: preco(pr.id), valor: preco(pr.id), desconto: 0 });
      novoItem.produtoId = ''; novoItem.quantidade = 1;
      nextTick(() => { const el = prodAc.value && prodAc.value.$el.querySelector('input'); el && el.focus(); });
    }
    const tItem = (i) => Math.round(Number(i.quantidade || 0) * Number(i.valor || 0) * (1 - Number(i.desconto || 0) / 100) * 100) / 100;
    const subtotal = computed(() => p.itens.reduce((s, i) => s + tItem(i), 0));
    const total = computed(() => subtotal.value - Number(p.desconto || 0) + Number(p.frete || 0));

    async function salvar(silencioso) {
      if (!p.clienteId) { toast('Selecione o cliente', 'err'); throw new Error('cliente'); }
      busy.value = true;
      try {
        const r = novo && !p.id ? await api.post('/api/pedidos', p) : await api.put('/api/pedidos/' + p.id, p);
        Object.assign(p, r); if (!silencioso) toast('Pedido #' + r.numero + ' salvo', 'ok');
        if (novo) history.replaceState(null, '', '#/pedidos/' + r.id);
        return r;
      } catch (e) { toast(e.message, 'err'); throw e; } finally { busy.value = false; }
    }
    async function enviarBling() {
      if (!confirm('Enviar este pedido ao Bling? Depois de enviado ele não poderá ser alterado no CRM.')) return;
      try { if (!p.id || can('pedidos.editar')) await salvar(true); } catch { return; }
      busy.value = true;
      try { Object.assign(p, await api.post(`/api/pedidos/${p.id}/enviar-bling`)); toast('Pedido enviado ao Bling! Nº ' + (p.blingNumero || p.blingId), 'ok'); }
      catch (e) { toast(e.message, 'err'); p.status = 'erro'; p.erroBling = e.message; } finally { busy.value = false; }
    }
    const enviarWa = () => run(async () => { if (!p.id) await salvar(true); await api.post(`/api/pedidos/${p.id}/whatsapp`); }, 'Resumo enviado no WhatsApp do cliente');
    const atualizar = () => run(async () => Object.assign(p, await api.post(`/api/pedidos/${p.id}/atualizar-bling`)), 'Situação atualizada');
    const excluir = () => confirm('Excluir pedido?') && run(async () => { await api.del('/api/pedidos/' + p.id); go('/pedidos'); }, 'Pedido excluído');
    const imprimir = () => window.print();
    const lblC = (c) => c.nome + (c.fantasia ? ` (${c.fantasia})` : '');
    const subC = (c) => [c.documento, c.cidade && c.cidade + '/' + (c.uf || ''), c.blingId ? 'Bling' : 'não está no Bling'].filter(Boolean).join(' · ');
    const lblP = (x) => `${x.codigo ? x.codigo + ' - ' : ''}${x.nome}`;
    const subP = (x) => `${brl(preco(x.id))}${precos.value[x.id] !== undefined && precos.value[x.id] !== x.preco ? ' (Bling ' + brl(x.preco) + ')' : ''}${x.estoque !== null && x.estoque !== undefined ? ' · estoque ' + x.estoque : ''}`;
    return { p, novo, clientes, produtos, vendedores, formas, listaNome, novoItem, addItem, tItem, subtotal, total, salvar, enviarBling, enviarWa, atualizar, excluir, imprimir, bloqueado, podePreco, onCliente, cliente, busy, lblC, subC, lblP, subP, qtdRef, prodAc, ...helpers };
  },
  template: `<div><div class="row" style="margin-bottom:14px"><div class="grow"><a href="#/pedidos" class="sm">← Pedidos</a><h1>{{p.numero ? 'Pedido #'+p.numero : 'Novo pedido de venda'}}
    <span class="badge" :class="{ok:p.status==='enviado',err:p.status==='erro',warn:p.status==='rascunho'}">{{p.status}}</span> <span class="badge pri" v-if="p.blingNumero">Bling nº {{p.blingNumero}}</span></h1></div>
   <button class="btn nogrow" v-if="p.id" @click="go('/pedidos/novo?dup='+p.id)">Duplicar</button>
   <button class="btn nogrow" v-if="p.id" @click="imprimir">Imprimir</button>
   <button class="btn d nogrow" v-if="p.id && !p.blingId && can('pedidos.editar')" @click="excluir">Excluir</button></div>
  <div v-if="p.erroBling" class="err-box"><b>Erro ao enviar ao Bling:</b> {{p.erroBling}}</div>
  <div v-if="p.blingId" class="ok-box">Enviado ao Bling em {{dth(p.enviadoEm)}} por {{p.enviadoPor}}. ID {{p.blingId}}{{p.blingSituacao? ' · Situação: '+p.blingSituacao : ''}} <button class="btn sm" @click="atualizar">⟳ Atualizar situação</button></div>
  <div class="card"><div class="row">
   <div class="grow"><label>Cliente *</label><AutoComplete v-if="!bloqueado" :items="clientes" v-model="p.clienteId" :label="lblC" :sub="subC" :keys="c=>[c.nome,c.fantasia,c.documento,c.cidade,c.codigo].join(' ')" placeholder="Digite nome, CNPJ ou cidade" @pick="onCliente"/><input v-else :value="p.clienteNome" disabled>
    <div class="sm mu" style="margin-top:3px">Lista de preço: <b>{{listaNome || 'Preço padrão do Bling'}}</b></div></div>
   <div><label>Vendedor</label><select v-model="p.vendedorId" :disabled="bloqueado || (!!store.user.vendedorId && !can('pedidos.ver_todos'))"><option value="">—</option><option v-for="v in vendedores" :value="v.id">{{v.nome}}</option></select></div>
   <div class="nogrow" style="width:150px"><label>Data</label><input type="date" v-model="p.data" :disabled="bloqueado"></div>
   <div class="nogrow" style="width:150px"><label>Previsão entrega</label><input type="date" v-model="p.dataPrevista" :disabled="bloqueado"></div>
   <div class="nogrow" style="width:150px"><label>Nº pedido do cliente</label><input v-model="p.numeroPedidoCompra" :disabled="bloqueado"></div></div></div>
  <div class="card"><h2>Itens</h2>
   <div class="row" v-if="!bloqueado" style="margin-bottom:12px"><div class="grow"><label>Produto (código ou nome)</label><AutoComplete ref="prodAc" :items="produtos" v-model="novoItem.produtoId" :label="lblP" :sub="subP" :keys="x=>x.codigo+' '+x.nome+' '+(x.gtin||'')" placeholder="Digite código ou nome do produto" @pick="$refs.qtd.focus();$refs.qtd.select()"/></div>
    <div class="nogrow" style="width:110px"><label>Quantidade</label><input ref="qtd" type="number" min="0" step="any" v-model="novoItem.quantidade" @keydown.enter.prevent="addItem"></div><button class="btn p nogrow" @click="addItem">Adicionar</button></div>
   <div class="tw"><table><thead><tr><th>Código</th><th>Descrição</th><th>Un</th><th class="r" style="width:100px">Qtd</th><th class="r" style="width:130px">Preço unit.</th><th class="r" style="width:90px">Desc. %</th><th class="r">Total</th><th></th></tr></thead><tbody>
    <tr v-for="(i,ix) in p.itens" :key="ix"><td class="nowrap">{{i.codigo}}</td><td>{{i.descricao}}<div class="sm mu" v-if="i.precoTabela!==undefined && Number(i.valor)!==Number(i.precoTabela)">tabela: {{brl(i.precoTabela)}}</div></td><td>{{i.unidade}}</td>
    <td><input type="number" step="any" v-model="i.quantidade" :disabled="bloqueado" style="text-align:right"></td>
    <td><input type="number" step="0.01" v-model="i.valor" :disabled="bloqueado || !podePreco" style="text-align:right"></td>
    <td><input type="number" step="0.01" v-model="i.desconto" :disabled="bloqueado || !podePreco" style="text-align:right"></td>
    <td class="r nowrap b">{{brl(tItem(i))}}</td><td><button class="btn sm d" v-if="!bloqueado" @click="p.itens.splice(ix,1)">✕</button></td></tr>
    <tr v-if="!p.itens.length"><td colspan="8" class="empty">Nenhum item. Busque o produto acima.</td></tr></tbody></table></div></div>
  <div class="grid g2"><div class="card"><h2>Pagamento e observações</h2>
   <div class="row"><div><label>Forma de pagamento (Bling)</label><select v-model="p.formaPagamentoId" :disabled="bloqueado"><option value="">— não gerar parcelas —</option><option v-for="f in formas" :value="f.id">{{f.descricao}}</option></select></div>
    <div class="nogrow" style="width:90px"><label>Parcelas</label><input type="number" min="1" v-model="p.parcelas" :disabled="bloqueado"></div><div class="nogrow" style="width:110px"><label>Intervalo (dias)</label><input type="number" min="0" v-model="p.intervaloDias" :disabled="bloqueado"></div></div>
   <div style="margin-top:10px"><label>Observações (saem no pedido)</label><textarea v-model="p.observacoes" :disabled="bloqueado"></textarea></div>
   <div style="margin-top:10px"><label>Observações internas</label><textarea v-model="p.observacoesInternas" :disabled="bloqueado"></textarea></div></div>
  <div class="card"><h2>Totais</h2><div class="tot"><div>Subtotal: <b>{{brl(subtotal)}}</b></div>
   <div class="row" style="justify-content:flex-end"><div class="nogrow" style="width:140px"><label>Desconto (R$)</label><input type="number" step="0.01" v-model="p.desconto" :disabled="bloqueado || !podePreco"></div><div class="nogrow" style="width:140px"><label>Frete (R$)</label><input type="number" step="0.01" v-model="p.frete" :disabled="bloqueado"></div></div>
   <div class="big">Total: {{brl(total)}}</div></div>
   <div class="row" style="justify-content:flex-end;margin-top:20px">
    <button class="btn nogrow" v-if="!bloqueado && (novo ? can('pedidos.criar') : can('pedidos.editar'))" :disabled="busy" @click="salvar()">💾 Salvar rascunho</button>
    <button class="btn wa nogrow" v-if="can('whatsapp.enviar') && p.itens.length" :disabled="busy" @click="enviarWa">Enviar no WhatsApp</button>
    <button class="btn ok nogrow" v-if="!p.blingId && can('pedidos.enviar_bling')" :disabled="busy || !p.itens.length" @click="enviarBling">⇪ Enviar ao Bling</button></div></div></div></div>`,
};
