/* Clientes, produtos, vendedores e listas de preço */
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

const ClienteForm = {
  components: { Modal },
  props: { cliente: Object }, emits: ['close', 'saved'],
  setup(props, { emit }) {
    const f = reactive({ tipoPessoa: 'J', situacao: 'ativo', ...props.cliente });
    const vendedores = ref([]); const listas = ref([]);
    onMounted(async () => { vendedores.value = await cached('vendedores', '/api/vendedores'); if (can('listas.ver') || can('clientes.ver')) listas.value = await api.get('/api/listas').catch(() => []); });
    const cep = async () => {
      const c = String(f.cep || '').replace(/\D/g, ''); if (c.length !== 8) return;
      try { const r = await fetch(`https://viacep.com.br/ws/${c}/json/`).then((x) => x.json()); if (!r.erro) Object.assign(f, { endereco: r.logradouro, bairro: r.bairro, cidade: r.localidade, uf: r.uf }); } catch {}
    };
    const salvar = () => run(async () => { const r = f.id ? await api.put('/api/clientes/' + f.id, f) : await api.post('/api/clientes', f); invalidate('clientes'); emit('saved', r); }, 'Cliente salvo');
    return { f, vendedores, listas, salvar, cep, UFS, can };
  },
  template: `<Modal :title="f.id ? 'Editar cliente' : 'Novo cliente'" @close="$emit('close')">
  <div class="grid" style="gap:10px">
   <div class="row"><div class="grow"><label>Nome / Razão social *</label><input v-model="f.nome"></div><div><label>Fantasia</label><input v-model="f.fantasia"></div></div>
   <div class="row"><div class="nogrow" style="width:110px"><label>Tipo</label><select v-model="f.tipoPessoa"><option value="J">Jurídica</option><option value="F">Física</option></select></div><div><label>CPF/CNPJ</label><input v-model="f.documento"></div><div><label>Inscrição estadual</label><input v-model="f.ie"></div></div>
   <div class="row"><div><label>E-mail</label><input v-model="f.email" type="email"></div><div><label>Telefone</label><input v-model="f.telefone"></div><div><label>Celular</label><input v-model="f.celular"></div><div><label>WhatsApp</label><input v-model="f.whatsapp" placeholder="(11) 99999-9999"></div></div>
   <div class="row"><div class="nogrow" style="width:120px"><label>CEP</label><input v-model="f.cep" @blur="cep"></div><div class="grow"><label>Endereço</label><input v-model="f.endereco"></div><div class="nogrow" style="width:90px"><label>Número</label><input v-model="f.numero"></div></div>
   <div class="row"><div><label>Complemento</label><input v-model="f.complemento"></div><div><label>Bairro</label><input v-model="f.bairro"></div><div><label>Cidade</label><input v-model="f.cidade"></div><div class="nogrow" style="width:80px"><label>UF</label><select v-model="f.uf"><option></option><option v-for="u in UFS">{{u}}</option></select></div></div>
   <div class="row"><div><label>Vendedor (Bling)</label><select v-model="f.vendedorId"><option value="">—</option><option v-for="v in vendedores" :value="v.id">{{v.nome}}</option></select></div>
     <div><label>Lista de preço</label><select v-model="f.listaPrecoId"><option value="">Preço padrão do Bling</option><option v-for="l in listas" :value="l.id">{{l.nome}}</option></select></div>
     <div><label>Origem</label><select v-model="f.origem"><option></option><option>indicação</option><option>whatsapp</option><option>site</option><option>prospecção</option><option>bling</option><option>outro</option></select></div>
     <div><label>Situação</label><select v-model="f.situacao"><option value="ativo">Ativo</option><option value="inativo">Inativo</option><option value="prospect">Prospect</option></select></div></div>
   <div><label>Etiquetas (separe por vírgula)</label><input v-model="f.tags" placeholder="VIP, atacado"></div>
   <div><label>Observações</label><textarea v-model="f.observacoes"></textarea></div>
  </div>
  <template #ft><button class="btn" @click="$emit('close')">Cancelar</button><button class="btn p" @click="salvar">Salvar</button></template></Modal>`,
};

Pages.clientes = {
  components: { ClienteForm },
  setup() {
    const rows = ref([]); const q = ref(''); const sit = ref(''); const edit = ref(null); const loading = ref(true); const vend = ref([]); const fv = ref('');
    const load = async () => { loading.value = true; try { rows.value = await api.get('/api/clientes'); vend.value = await cached('vendedores', '/api/vendedores'); } finally { loading.value = false; } };
    onMounted(load);
    const vm = computed(() => Object.fromEntries(vend.value.map((v) => [v.id, v.nome])));
    const lista = computed(() => rows.value.filter((c) => (!sit.value || c.situacao === sit.value) && (!fv.value || c.vendedorId === fv.value) && (!q.value || match(q.value, c.nome, c.fantasia, c.documento, c.cidade, c.celular, c.telefone, c.whatsapp, c.codigo, c.tags))));
    const sync = () => run(async () => { const r = await api.post('/api/bling/sync/clientes'); await load(); return r; }, 'Clientes importados do Bling');
    return { rows, q, sit, lista, edit, load, loading, sync, vm, vend, fv, ...helpers };
  },
  template: `<div>
  <div class="row" style="margin-bottom:14px"><h1 class="grow">Clientes <span class="mu sm">({{lista.length}})</span></h1>
   <button class="btn nogrow" v-if="can('clientes.editar')" @click="sync">⟳ Importar do Bling</button>
   <button class="btn p nogrow" v-if="can('clientes.editar')" @click="edit={}">+ Novo cliente</button></div>
  <div class="card"><div class="row" style="margin-bottom:12px"><div class="grow"><input v-model="q" placeholder="Buscar por nome, CNPJ, cidade, telefone, etiqueta..."></div>
   <div><select v-model="sit"><option value="">Todas situações</option><option value="ativo">Ativos</option><option value="prospect">Prospects</option><option value="inativo">Inativos</option></select></div>
   <div><select v-model="fv"><option value="">Todos vendedores</option><option v-for="v in vend" :value="v.id">{{v.nome}}</option></select></div></div>
   <div class="tw"><table><thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Cidade</th><th>Contato</th><th>Vendedor</th><th>Situação</th><th></th></tr></thead><tbody>
    <tr v-for="c in lista.slice(0,500)" :key="c.id" class="click" @click="go('/clientes/'+c.id)"><td><b>{{c.nome}}</b><div class="sm mu" v-if="c.fantasia">{{c.fantasia}}</div></td><td class="nowrap">{{c.documento}}</td><td>{{c.cidade}}<span v-if="c.uf">/{{c.uf}}</span></td>
    <td class="nowrap">{{c.whatsapp||c.celular||c.telefone}}</td><td>{{vm[c.vendedorId]||''}}</td><td><span class="badge" :class="{ok:c.situacao==='ativo',warn:c.situacao==='prospect'}">{{c.situacao}}</span> <span class="badge pri" v-if="c.blingId">Bling</span></td>
    <td class="r"><button class="btn sm" v-if="can('clientes.editar')" @click.stop="edit=c">Editar</button></td></tr>
    <tr v-if="!loading && !lista.length"><td colspan="7" class="empty">Nenhum cliente encontrado</td></tr></tbody></table></div>
   <div class="sm mu" v-if="lista.length>500" style="margin-top:6px">Mostrando 500 de {{lista.length}}. Refine a busca.</div></div>
  <ClienteForm v-if="edit" :cliente="edit" @close="edit=null" @saved="edit=null;load()"/></div>`,
};

Pages.cliente = {
  components: { ClienteForm, Modal },
  props: ['id'],
  setup(props) {
    const c = ref(null); const edit = ref(false); const nota = ref(''); const tab = ref('timeline'); const vend = ref([]); const listas = ref([]);
    const load = async () => { c.value = await api.get('/api/clientes/' + props.id); vend.value = await cached('vendedores', '/api/vendedores'); listas.value = await api.get('/api/listas').catch(() => []); };
    onMounted(load);
    const addNota = () => run(async () => { await api.post(`/api/clientes/${props.id}/notas`, { texto: nota.value }); nota.value = ''; await load(); });
    const timeline = computed(() => {
      if (!c.value) return [];
      return [...c.value.notas.map((n) => ({ em: n.criadoEm, t: '📝 ' + n.texto, por: n.usuarioNome })), ...c.value.pedidos.map((p) => ({ em: p.criadoEm, t: `🧾 Pedido #${p.numero} — ${brl(p.total)} (${p.status}${p.blingNumero ? ', Bling ' + p.blingNumero : ''})`, por: p.criadoPorNome, link: '/pedidos/' + p.id })), ...c.value.tarefas.map((t) => ({ em: t.criadoEm, t: `✅ Tarefa: ${t.titulo} (${t.concluida ? 'concluída' : 'pendente'})` }))].sort((a, b) => (b.em > a.em ? 1 : -1));
    });
    const totalComprado = computed(() => (c.value ? c.value.pedidos.filter((p) => p.status === 'enviado').reduce((s, p) => s + p.total, 0) : 0));
    const exclusiva = () => run(async () => { const l = await api.post(`/api/clientes/${props.id}/lista-exclusiva`); go('/listas/' + l.id); }, 'Lista criada e vinculada ao cliente');
    const atualizarBling = () => run(async () => { await api.post(`/api/clientes/${props.id}/atualizar-bling`); await load(); }, 'Dados atualizados do Bling');
    const excluir = () => confirm('Excluir este cliente?') && run(async () => { await api.del('/api/clientes/' + props.id); go('/clientes'); }, 'Cliente excluído');
    const fone = computed(() => c.value && (c.value.whatsapp || c.value.celular || c.value.telefone));
    const waAbrir = () => go('/whatsapp?tel=' + String(fone.value).replace(/\D/g, ''));
    const vnome = (id) => (vend.value.find((v) => v.id === id) || {}).nome;
    const lnome = (id) => (listas.value.find((v) => v.id === id) || {}).nome;
    return { c, edit, nota, addNota, timeline, tab, load, totalComprado, exclusiva, atualizarBling, excluir, fone, waAbrir, vnome, lnome, ...helpers };
  },
  template: `<div v-if="c">
  <div class="row" style="margin-bottom:14px"><div class="grow"><a href="#/clientes" class="sm">← Clientes</a><h1>{{c.nome}} <span class="badge pri" v-if="c.blingId">Bling #{{c.blingId}}</span></h1></div>
   <button class="btn wa nogrow" v-if="fone && can('whatsapp.ver')" @click="waAbrir">WhatsApp</button>
   <button class="btn p nogrow" v-if="can('pedidos.criar')" @click="go('/pedidos/novo?cliente='+c.id)">+ Pedido</button>
   <button class="btn nogrow" v-if="can('clientes.editar') && c.blingId" @click="atualizarBling">⟳ Atualizar do Bling</button>
   <button class="btn nogrow" v-if="can('clientes.editar')" @click="edit=true">Editar</button>
   <button class="btn d nogrow" v-if="can('clientes.excluir')" @click="excluir">Excluir</button></div>
  <div class="grid g4" style="margin-bottom:16px"><div class="card kpi"><div class="l">Total comprado</div><div class="v">{{brl(totalComprado)}}</div></div><div class="card kpi"><div class="l">Pedidos</div><div class="v">{{c.pedidos.length}}</div></div>
   <div class="card kpi"><div class="l">Lista de preço</div><div class="v" style="font-size:15px">{{lnome(c.listaPrecoId)||'Padrão Bling'}}</div><button v-if="can('listas.editar')" class="btn sm" style="margin-top:6px" @click="exclusiva">Criar lista exclusiva</button></div>
   <div class="card kpi"><div class="l">Vendedor</div><div class="v" style="font-size:15px">{{vnome(c.vendedorId)||'—'}}</div></div></div>
  <div class="grid g2"><div class="card"><h2>Dados</h2><table class="sm"><tbody>
   <tr><td class="mu">CPF/CNPJ</td><td>{{c.documento}}</td></tr><tr><td class="mu">IE</td><td>{{c.ie}}</td></tr><tr><td class="mu">E-mail</td><td>{{c.email}}</td></tr>
   <tr><td class="mu">Telefones</td><td>{{[c.telefone,c.celular,c.whatsapp].filter(Boolean).join(' · ')}}</td></tr><tr><td class="mu">Endereço</td><td>{{[c.endereco,c.numero,c.complemento,c.bairro].filter(Boolean).join(', ')}} {{c.cidade}}{{c.uf?'/'+c.uf:''}} {{c.cep}}</td></tr>
   <tr><td class="mu">Origem</td><td>{{c.origem}}</td></tr><tr><td class="mu">Etiquetas</td><td>{{c.tags}}</td></tr><tr><td class="mu">Observações</td><td style="white-space:pre-wrap">{{c.observacoes}}</td></tr></tbody></table></div>
  <div class="card"><div class="tabs"><a href="javascript:" :class="{on:tab==='timeline'}" @click="tab='timeline'">Histórico</a><a href="javascript:" :class="{on:tab==='pedidos'}" @click="tab='pedidos'">Pedidos</a><a href="javascript:" :class="{on:tab==='opps'}" @click="tab='opps'">Oportunidades</a></div>
   <div v-if="tab==='timeline'"><div class="row" v-if="can('clientes.editar')" style="margin-bottom:12px"><div class="grow"><input v-model="nota" placeholder="Registrar anotação / contato..." @keyup.enter="nota&&addNota()"></div><button class="btn p nogrow" :disabled="!nota" @click="addNota">Salvar</button></div>
    <div class="tl"><div v-for="t in timeline"><div>{{t.t}} <a v-if="t.link" :href="'#'+t.link" class="sm">abrir</a></div><div class="sm mu">{{dth(t.em)}} {{t.por? '· '+t.por:''}}</div></div><p v-if="!timeline.length" class="mu">Sem histórico ainda.</p></div></div>
   <table v-if="tab==='pedidos'"><tr v-for="p in c.pedidos" class="click" @click="go('/pedidos/'+p.id)"><td>#{{p.numero}}</td><td>{{dt(p.data)}}</td><td class="r">{{brl(p.total)}}</td><td><span class="badge" :class="{ok:p.status==='enviado',err:p.status==='erro'}">{{p.status}}</span></td></tr></table>
   <table v-if="tab==='opps'"><tr v-for="o in c.oportunidades"><td>{{o.titulo}}</td><td>{{o.etapa}}</td><td class="r">{{brl(o.valor)}}</td></tr></table></div></div>
  <ClienteForm v-if="edit" :cliente="c" @close="edit=false" @saved="edit=false;load()"/></div>`,
};

Pages.produtos = {
  setup() {
    const rows = ref([]); const q = ref(''); const st = ref(null); const loading = ref(true); const inat = ref(false);
    const load = async (force) => { loading.value = true; try { rows.value = await api.get('/api/produtos?todos=1'); st.value = await api.get('/api/bling/status'); } finally { loading.value = false; } };
    onMounted(load);
    const lista = computed(() => rows.value.filter((p) => (inat.value || p.situacao !== 'I') && (!q.value || match(q.value, p.nome, p.codigo, p.gtin))));
    const sync = (t) => run(async () => { const r = await api.post('/api/bling/sync/' + t); invalidate('produtos', 'vendedores'); await load(); toast(`${r.qtd} registros sincronizados`, 'ok'); });
    return { rows, q, lista, sync, st, loading, inat, ...helpers };
  },
  template: `<div><div class="row" style="margin-bottom:14px"><h1 class="grow">Produtos <span class="mu sm">({{lista.length}})</span></h1>
   <span class="sm mu nogrow" v-if="st && st.ultimaSync.produtos">Última importação: {{dth(st.ultimaSync.produtos.em)}}</span>
   <button class="btn nogrow" v-if="can('produtos.sincronizar')" @click="sync('formas_pagamento')">⟳ Formas de pagamento</button>
   <button class="btn p nogrow" v-if="can('produtos.sincronizar')" @click="sync('produtos')">⟳ Importar produtos do Bling</button></div>
  <div class="card"><div class="row" style="margin-bottom:12px"><div class="grow"><input v-model="q" placeholder="Buscar por nome, código ou GTIN"></div><label class="nogrow" style="display:flex;gap:6px;align-items:center"><input type="checkbox" v-model="inat"> mostrar inativos</label></div>
  <div class="tw"><table><thead><tr><th>Código</th><th>Nome</th><th>Un</th><th class="r">Preço Bling</th><th class="r">Estoque</th><th>Situação</th></tr></thead><tbody>
  <tr v-for="p in lista.slice(0,500)" :key="p.id"><td class="nowrap">{{p.codigo}}</td><td>{{p.nome}}</td><td>{{p.unidade}}</td><td class="r nowrap">{{brl(p.preco)}}</td><td class="r">{{p.estoque ?? '—'}}</td><td><span class="badge" :class="{ok:p.situacao==='A'}">{{p.situacao==='A'?'Ativo':p.situacao==='I'?'Inativo':p.situacao}}</span></td></tr>
  <tr v-if="!loading && !lista.length"><td colspan="6" class="empty">Nenhum produto. Clique em "Importar produtos do Bling".</td></tr></tbody></table></div></div></div>`,
};

Pages.vendedores = {
  setup() {
    const rows = ref([]); const usuarios = ref([]);
    const load = async () => { rows.value = await cached('vendedores', '/api/vendedores', true); usuarios.value = can('usuarios.gerenciar') ? await api.get('/api/usuarios') : []; };
    onMounted(load);
    const sync = () => run(async () => { const r = await api.post('/api/bling/sync/vendedores'); await load(); toast(r.qtd + ' vendedores importados', 'ok'); });
    const usuarioDe = (id) => usuarios.value.filter((u) => u.vendedorId === id).map((u) => u.nome).join(', ');
    return { rows, sync, usuarioDe, ...helpers };
  },
  template: `<div><div class="row" style="margin-bottom:14px"><h1 class="grow">Vendedores (Bling)</h1><button class="btn p nogrow" v-if="can('vendedores.sincronizar')" @click="sync">⟳ Importar vendedores do Bling</button></div>
  <div class="card"><p class="sm mu">Vincule cada usuário do CRM a um vendedor em <a href="#/usuarios">Usuários</a>. Os pedidos digitados por ele seguem ao Bling com esse vendedor.</p>
  <table><thead><tr><th>ID Bling</th><th>Nome</th><th class="r">Limite desconto</th><th>Usuário CRM vinculado</th></tr></thead><tbody>
  <tr v-for="v in rows"><td>{{v.id}}</td><td>{{v.nome}}</td><td class="r">{{v.descontoLimite}}%</td><td>{{usuarioDe(v.id)}}</td></tr>
  <tr v-if="!rows.length"><td colspan="4" class="empty">Nenhum vendedor importado.</td></tr></tbody></table></div></div>`,
};

Pages.listas = {
  setup() {
    const rows = ref([]);
    onMounted(async () => { rows.value = await api.get('/api/listas'); });
    return { rows, ...helpers };
  },
  template: `<div><div class="row" style="margin-bottom:14px"><h1 class="grow">Listas de preço</h1><button class="btn p nogrow" v-if="can('listas.editar')" @click="go('/listas/nova')">+ Nova lista</button></div>
  <div class="card"><p class="sm mu">Cada cliente pode ter uma lista. Itens sem preço definido usam o preço do Bling com o ajuste percentual da lista. No pedido, o preço sai automaticamente da lista do cliente.</p>
  <table><thead><tr><th>Nome</th><th class="r">Ajuste geral</th><th class="r">Itens com preço</th><th>Clientes</th><th></th></tr></thead><tbody>
  <tr v-for="l in rows" class="click" @click="go('/listas/'+l.id)"><td><b>{{l.nome}}</b> <span class="badge" v-if="l.ativa===false">inativa</span><div class="sm mu">{{l.descricao}}</div></td><td class="r">{{l.ajustePercentual>0?'+':''}}{{l.ajustePercentual||0}}%</td><td class="r">{{l.qtdItens}}</td>
  <td class="sm">{{l.clientes.slice(0,3).map(c=>c.nome).join(', ')}}<span v-if="l.clientes.length>3"> +{{l.clientes.length-3}}</span></td><td class="r"><button class="btn sm">Abrir</button></td></tr>
  <tr v-if="!rows.length"><td colspan="5" class="empty">Nenhuma lista criada.</td></tr></tbody></table></div></div>`,
};

Pages.lista = {
  props: ['id'],
  setup(props) {
    const novo = props.id === 'nova';
    const f = reactive({ nome: '', descricao: '', ajustePercentual: 0, ativa: true, itens: [] });
    const precos = reactive({}); const prods = ref([]); const clientes = ref([]); const sel = ref([]); const q = ref(''); const so = ref(false); const lote = ref(''); const pct = ref(0); const qc = ref('');
    onMounted(async () => {
      prods.value = await cached('produtos', '/api/produtos');
      clientes.value = await api.get('/api/clientes');
      if (!novo) { const l = await api.get('/api/listas/' + props.id); Object.assign(f, l); for (const i of l.itens || []) precos[i.produtoId] = i.preco; sel.value = clientes.value.filter((c) => c.listaPrecoId === l.id).map((c) => c.id); }
    });
    const efetivo = (p) => (precos[p.id] !== undefined && precos[p.id] !== '' ? Number(precos[p.id]) : Math.round(p.preco * (1 + Number(f.ajustePercentual || 0) / 100) * 100) / 100);
    const lista = computed(() => prods.value.filter((p) => (!so.value || (precos[p.id] !== undefined && precos[p.id] !== '')) && (!q.value || match(q.value, p.nome, p.codigo))));
    const aplicaPct = () => { for (const p of lista.value) precos[p.id] = Math.round(p.preco * (1 + Number(pct.value) / 100) * 100) / 100; toast(`Preço definido para ${lista.value.length} produtos filtrados`); };
    const limpar = () => { for (const p of lista.value) delete precos[p.id]; };
    const importar = () => {
      const porCod = Object.fromEntries(prods.value.map((p) => [String(p.codigo).trim().toLowerCase(), p])); let ok = 0; const falhas = [];
      for (const linha of lote.value.split(/\r?\n/)) { const [cod, pr] = linha.split(/[;\t]/).map((s) => (s || '').trim()); if (!cod) continue; const p = porCod[cod.toLowerCase()]; const v = Number(String(pr).replace(/\./g, '').replace(',', '.')); if (p && Number.isFinite(v)) { precos[p.id] = v; ok++; } else falhas.push(cod); }
      toast(`${ok} preços importados${falhas.length ? '. Não encontrados: ' + falhas.slice(0, 10).join(', ') : ''}`, falhas.length ? 'err' : 'ok'); lote.value = '';
    };
    const salvar = () => run(async () => {
      const body = { ...f, itens: Object.entries(precos).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([produtoId, preco]) => ({ produtoId, preco })), clienteIds: sel.value };
      const r = novo ? await api.post('/api/listas', body) : await api.put('/api/listas/' + props.id, body);
      if (novo) go('/listas/' + r.id);
    }, 'Lista salva');
    const excluir = () => confirm('Excluir a lista? Os clientes voltarão ao preço padrão.') && run(async () => { await api.del('/api/listas/' + props.id); go('/listas'); }, 'Lista excluída');
    const clientesF = computed(() => clientes.value.filter((c) => sel.value.includes(c.id) || (qc.value && match(qc.value, c.nome, c.documento))).slice(0, 50));
    return { f, precos, prods, lista, efetivo, clientes, sel, q, so, salvar, excluir, novo, lote, importar, pct, aplicaPct, limpar, qc, clientesF, ...helpers };
  },
  template: `<div><div class="row" style="margin-bottom:14px"><div class="grow"><a href="#/listas" class="sm">← Listas</a><h1>{{novo?'Nova lista de preço':f.nome}}</h1></div>
   <button class="btn d nogrow" v-if="!novo && can('listas.editar')" @click="excluir">Excluir</button><button class="btn p nogrow" v-if="can('listas.editar')" @click="salvar">Salvar lista</button></div>
  <div class="card"><div class="row"><div class="grow"><label>Nome *</label><input v-model="f.nome"></div><div><label>Ajuste geral sobre preço Bling (%)</label><input type="number" step="0.01" v-model="f.ajustePercentual"><div class="sm mu">ex.: -10 = 10% de desconto</div></div>
   <div class="nogrow"><label>Ativa</label><input type="checkbox" v-model="f.ativa"></div></div><div style="margin-top:10px"><label>Descrição</label><input v-model="f.descricao"></div></div>
  <div class="grid g2" style="grid-template-columns:2fr 1fr">
  <div class="card"><h2>Preços por produto</h2>
   <div class="row" style="margin-bottom:10px"><div class="grow"><input v-model="q" placeholder="Filtrar produtos..."></div><label class="nogrow" style="display:flex;gap:6px;align-items:center"><input type="checkbox" v-model="so"> só com preço definido</label></div>
   <div class="row" style="margin-bottom:10px" v-if="can('listas.editar')"><div class="nogrow" style="width:120px"><label>% sobre Bling</label><input type="number" v-model="pct"></div><button class="btn nogrow" @click="aplicaPct">Aplicar aos filtrados</button><button class="btn nogrow" @click="limpar">Limpar filtrados</button></div>
   <div class="tw"><table><thead><tr><th>Código</th><th>Produto</th><th class="r">Bling</th><th class="r" style="width:130px">Preço da lista</th><th class="r">Efetivo</th></tr></thead><tbody>
   <tr v-for="p in lista.slice(0,300)" :key="p.id"><td class="nowrap">{{p.codigo}}</td><td>{{p.nome}}</td><td class="r nowrap">{{brl(p.preco)}}</td>
   <td><input type="number" step="0.01" v-model="precos[p.id]" :placeholder="n2(efetivo(p))" :disabled="!can('listas.editar')" style="text-align:right"></td><td class="r nowrap" :class="{b:precos[p.id]!==undefined&&precos[p.id]!==''}">{{brl(efetivo(p))}}</td></tr></tbody></table></div>
   <div class="sm mu" v-if="lista.length>300">Mostrando 300 de {{lista.length}} — use o filtro.</div></div>
  <div><div class="card"><h2>Clientes desta lista</h2><input v-model="qc" placeholder="Buscar cliente para adicionar..." style="margin-bottom:8px">
   <div v-for="c in clientesF" :key="c.id"><label style="display:flex;gap:6px;color:var(--tx);font-size:13px"><input type="checkbox" :value="c.id" v-model="sel" :disabled="!can('listas.editar')">{{c.nome}}</label></div>
   <p class="sm mu">{{sel.length}} cliente(s) selecionado(s)</p></div>
   <div class="card" v-if="can('listas.editar')"><h2>Importar em lote</h2><p class="sm mu">Cole linhas "código;preço" (ou copie 2 colunas do Excel).</p><textarea v-model="lote" rows="6" placeholder="ABC123;19,90"></textarea><button class="btn" style="margin-top:8px" @click="importar">Importar preços</button></div></div></div></div>`,
};
