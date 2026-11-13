/* Painel, funil de vendas, tarefas, WhatsApp e relatórios */
Pages.dashboard = {
  components: { Bars },
  setup() {
    const d = ref(null);
    onMounted(async () => { d.value = await api.get('/api/dashboard'); });
    const concluir = (t) => run(async () => { await api.put('/api/tarefas/' + t.id, { concluida: true }); d.value.tarefasHoje = d.value.tarefasHoje.filter((x) => x.id !== t.id); }, 'Tarefa concluída');
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return { d, concluir, mesLbl: (x) => meses[Number(x.mes.slice(5)) - 1], diaLbl: (x) => x.data.slice(8), ...helpers };
  },
  template: `<div v-if="d"><div class="row" style="margin-bottom:14px"><h1 class="grow">Olá, {{store.user.nome.split(' ')[0]}} 👋</h1>
   <button class="btn p nogrow" v-if="can('pedidos.criar')" @click="go('/pedidos/novo')">+ Digitar pedido</button></div>
  <div class="grid g4" style="margin-bottom:16px">
   <div class="card kpi"><div class="l">Vendas no mês</div><div class="v">{{brl(d.vendasMes)}}</div><div class="sm mu">{{d.pedidosMes}} pedidos enviados ao Bling</div></div>
   <div class="card kpi"><div class="l">Ticket médio</div><div class="v">{{brl(d.ticketMedio)}}</div></div>
   <div class="card kpi"><div class="l">Funil em aberto</div><div class="v">{{brl(d.funilAberto)}}</div><div class="sm mu">{{d.oportunidadesAbertas}} oportunidades · conversão {{Math.round(d.taxaConversao*100)}}%</div></div>
   <div class="card kpi"><div class="l">Pendências</div><div class="v">{{d.rascunhos}} <span class="sm mu">rascunhos</span></div><div class="sm"><a href="#/pedidos" v-if="d.comErro" style="color:var(--err)">{{d.comErro}} com erro no Bling</a> <a href="#/whatsapp" v-if="d.naoLidas">· {{d.naoLidas}} msg WhatsApp não lidas</a></div></div></div>
  <div class="grid g2"><div class="card"><h2>Vendas – últimos 6 meses</h2><Bars :data="d.ultimosMeses" :lbl="mesLbl"/></div>
   <div class="card"><h2>Vendas por dia (mês atual)</h2><Bars v-if="d.vendasPorDia.length" :data="d.vendasPorDia" :lbl="diaLbl"/><p v-else class="empty">Sem vendas neste mês ainda.</p></div>
   <div class="card"><h2>Tarefas para hoje / atrasadas</h2><table><tr v-for="t in d.tarefasHoje"><td><span class="badge" :class="{err:t.data<new Date().toISOString().slice(0,10)}">{{dt(t.data)}}</span></td><td>{{t.titulo}}</td><td class="r"><button class="btn sm" @click="concluir(t)">✓ Concluir</button></td></tr></table><p v-if="!d.tarefasHoje.length" class="empty">Nada pendente 🎉</p></div>
   <div class="card"><h2>Top clientes do mês</h2><table><tr v-for="c in d.topClientes"><td>{{c.nome}}</td><td class="r b">{{brl(c.total)}}</td></tr></table><p v-if="!d.topClientes.length" class="empty">—</p></div></div></div>`,
};

Pages.funil = {
  components: { Modal, AutoComplete },
  setup() {
    const etapas = ref([]); const opps = ref([]); const edit = ref(null); const clientes = ref([]); const usuarios = ref([]); const over = ref(''); const q = ref('');
    const load = async () => { [etapas.value, opps.value] = await Promise.all([api.get('/api/funil/etapas'), api.get('/api/oportunidades')]); };
    onMounted(async () => { await load(); clientes.value = await api.get('/api/clientes').catch(() => []); usuarios.value = await api.get('/api/usuarios'); });
    const da = (e) => opps.value.filter((o) => o.etapa === e && (!q.value || match(q.value, o.titulo, o.clienteNome, o.responsavelNome)));
    const soma = (e) => da(e).reduce((s, o) => s + (o.valor || 0), 0);
    let arrastando = null;
    const drag = (o) => { arrastando = o; };
    const drop = async (e) => { over.value = ''; if (!arrastando || arrastando.etapa === e) return; const o = arrastando; o.etapa = e; await run(() => api.put('/api/oportunidades/' + o.id, { etapa: e })); };
    const salvar = () => run(async () => { const o = edit.value; o.id ? await api.put('/api/oportunidades/' + o.id, o) : await api.post('/api/oportunidades', o); edit.value = null; await load(); }, 'Oportunidade salva');
    const excluir = () => confirm('Excluir oportunidade?') && run(async () => { await api.del('/api/oportunidades/' + edit.value.id); edit.value = null; await load(); });
    const gerarPedido = () => go(`/pedidos/novo?cliente=${edit.value.clienteId}&oportunidade=${edit.value.id}`);
    return { etapas, opps, da, soma, drag, drop, edit, clientes, usuarios, salvar, excluir, over, q, gerarPedido, ...helpers };
  },
  template: `<div><div class="row" style="margin-bottom:14px"><h1 class="grow">Funil de vendas</h1><div class="nogrow" style="width:260px"><input v-model="q" placeholder="Filtrar..."></div><button class="btn p nogrow" v-if="can('funil.editar')" @click="edit={etapa:'novo',valor:0,responsavelId:store.user.id}">+ Oportunidade</button></div>
  <div class="kanban"><div v-for="e in etapas" class="col" :class="{over:over===e.id}" @dragover.prevent="over=e.id" @dragleave="over=''" @drop="drop(e.id)">
   <h3><span>{{e.nome}} <span class="mu">({{da(e.id).length}})</span></span><span class="sm mu">{{brl(soma(e.id))}}</span></h3>
   <div v-for="o in da(e.id)" :key="o.id" class="opp" :draggable="can('funil.editar')" @dragstart="drag(o)" @click="edit={...o}"><b>{{o.titulo}}</b><div class="sm mu">{{o.clienteNome}}</div><div class="row sm" style="margin-top:4px"><span class="b">{{brl(o.valor)}}</span><span class="mu r">{{o.responsavelNome}}</span></div><div class="sm" v-if="o.previsao" :style="{color:o.previsao<new Date().toISOString().slice(0,10)&&!['ganho','perdido'].includes(o.etapa)?'var(--err)':'var(--mu)'}">previsão {{dt(o.previsao)}}</div></div></div></div>
  <Modal v-if="edit" :title="edit.id?'Oportunidade':'Nova oportunidade'" @close="edit=null"><div class="grid" style="gap:10px">
   <div><label>Título *</label><input v-model="edit.titulo"></div>
   <div class="row"><div class="grow"><label>Cliente</label><AutoComplete :items="clientes" v-model="edit.clienteId" :label="c=>c.nome" placeholder="Buscar cliente"/></div><div><label>Ou nome do contato</label><input v-model="edit.contatoNome"></div><div><label>Telefone</label><input v-model="edit.telefone"></div></div>
   <div class="row"><div><label>Valor estimado</label><input type="number" step="0.01" v-model="edit.valor"></div><div><label>Etapa</label><select v-model="edit.etapa"><option v-for="e in etapas" :value="e.id">{{e.nome}}</option></select></div><div><label>Previsão fechamento</label><input type="date" v-model="edit.previsao"></div><div><label>Responsável</label><select v-model="edit.responsavelId"><option v-for="u in usuarios" :value="u.id">{{u.nome}}</option></select></div></div>
   <div v-if="edit.etapa==='perdido'"><label>Motivo da perda</label><select v-model="edit.motivoPerda"><option></option><option>Preço</option><option>Prazo</option><option>Concorrente</option><option>Sem resposta</option><option>Desistiu</option><option>Outro</option></select></div>
   <div><label>Notas</label><textarea v-model="edit.notas"></textarea></div>
   <div v-if="edit.historico" class="sm mu">Histórico: <span v-for="h in edit.historico">{{h.etapa}} ({{dth(h.em)}}, {{h.por}}) → </span></div></div>
   <template #ft><button class="btn d" v-if="edit.id" @click="excluir">Excluir</button><button class="btn" v-if="edit.id && edit.clienteId && can('pedidos.criar')" @click="gerarPedido">Gerar pedido</button><button class="btn" @click="edit=null">Cancelar</button><button class="btn p" v-if="can('funil.editar')" @click="salvar">Salvar</button></template></Modal></div>`,
};

Pages.tarefas = {
  components: { Modal, AutoComplete },
  setup() {
    const rows = ref([]); const edit = ref(null); const filtro = ref('pendentes'); const clientes = ref([]); const usuarios = ref([]);
    const load = async () => { rows.value = await api.get('/api/tarefas'); };
    onMounted(async () => { await load(); clientes.value = await api.get('/api/clientes').catch(() => []); usuarios.value = await api.get('/api/usuarios'); });
    const h = hojeISO();
    const lista = computed(() => rows.value.filter((t) => filtro.value === 'todas' || (filtro.value === 'pendentes' ? !t.concluida : filtro.value === 'hoje' ? !t.concluida && t.data <= h : t.concluida)));
    const toggle = (t) => run(async () => { await api.put('/api/tarefas/' + t.id, { concluida: !t.concluida }); await load(); });
    const salvar = () => run(async () => { const t = edit.value; t.id ? await api.put('/api/tarefas/' + t.id, t) : await api.post('/api/tarefas', t); edit.value = null; await load(); }, 'Tarefa salva');
    const excluir = () => run(async () => { await api.del('/api/tarefas/' + edit.value.id); edit.value = null; await load(); });
    const icon = { ligacao: '📞', whatsapp: '💬', visita: '🚗', email: '✉️', reuniao: '👥', outro: '📌' };
    const unome = (id) => (usuarios.value.find((u) => u.id === id) || {}).nome;
    return { rows, lista, filtro, edit, toggle, salvar, excluir, clientes, usuarios, icon, h, unome, ...helpers };
  },
  template: `<div><div class="row" style="margin-bottom:14px"><h1 class="grow">Tarefas e agenda</h1><button class="btn p nogrow" v-if="can('tarefas.editar')" @click="edit={tipo:'ligacao',data:h,responsavelId:store.user.id}">+ Tarefa</button></div>
  <div class="card"><div class="tabs"><a v-for="f in ['pendentes','hoje','concluidas','todas']" href="javascript:" :class="{on:filtro===f}" @click="filtro=f">{{f}}</a></div>
  <table><tr v-for="t in lista" :key="t.id"><td style="width:30px"><input type="checkbox" :checked="t.concluida" @change="toggle(t)" :disabled="!can('tarefas.editar')"></td><td style="width:30px">{{icon[t.tipo]}}</td>
   <td class="click" @click="edit={...t}" :style="{textDecoration:t.concluida?'line-through':''}"><b>{{t.titulo}}</b><div class="sm mu">{{t.clienteNome}} {{t.descricao? '· '+t.descricao:''}}</div></td><td class="sm">{{unome(t.responsavelId)}}</td>
   <td class="r"><span class="badge" :class="{err:!t.concluida&&t.data<h,warn:!t.concluida&&t.data===h}">{{dt(t.data)}} {{t.hora}}</span></td></tr></table><p v-if="!lista.length" class="empty">Nenhuma tarefa</p></div>
  <Modal v-if="edit" title="Tarefa" @close="edit=null"><div class="grid" style="gap:10px"><div><label>Título *</label><input v-model="edit.titulo"></div>
   <div class="row"><div><label>Tipo</label><select v-model="edit.tipo"><option value="ligacao">Ligação</option><option value="whatsapp">WhatsApp</option><option value="visita">Visita</option><option value="email">E-mail</option><option value="reuniao">Reunião</option><option value="outro">Outro</option></select></div><div><label>Data</label><input type="date" v-model="edit.data"></div><div><label>Hora</label><input type="time" v-model="edit.hora"></div><div><label>Responsável</label><select v-model="edit.responsavelId"><option v-for="u in usuarios" :value="u.id">{{u.nome}}</option></select></div></div>
   <div><label>Cliente</label><AutoComplete :items="clientes" v-model="edit.clienteId" :label="c=>c.nome" placeholder="Buscar cliente"/></div><div><label>Descrição</label><textarea v-model="edit.descricao"></textarea></div></div>
   <template #ft><button class="btn d" v-if="edit.id" @click="excluir">Excluir</button><button class="btn" @click="edit=null">Cancelar</button><button class="btn p" @click="salvar">Salvar</button></template></Modal></div>`,
};

Pages.whatsapp = {
  components: { Modal, AutoComplete },
  setup() {
    const convs = ref([]); const atual = ref(null); const texto = ref(''); const q = ref(''); const msgsEl = ref(null); const novo = ref(null); const tpl = ref(null); const templates = ref([]); const respostas = ref([]); const clientes = ref([]); const usuarios = ref([]); const vincular = ref(false);
    let timer;
    const loadConvs = async () => { convs.value = await api.get('/api/whatsapp/conversas'); };
    const abrir = async (id, silencioso) => {
      const c = await api.get('/api/whatsapp/conversas/' + id);
      const mudou = !atual.value || atual.value.id !== id || atual.value.mensagens.length !== c.mensagens.length;
      atual.value = c; if (!silencioso) loadConvs();
      if (mudou) nextTick(() => { if (msgsEl.value) msgsEl.value.scrollTop = 1e9; });
    };
    onMounted(async () => {
      await loadConvs();
      respostas.value = await api.get('/api/respostas');
      clientes.value = await api.get('/api/clientes').catch(() => []);
      usuarios.value = await api.get('/api/usuarios');
      const tel = store.route.query.tel;
      if (tel) { const c = convs.value.find((x) => x.telefone.endsWith(tel.slice(-8))); if (c) abrir(c.id); else novo.value = { telefone: tel, texto: '' }; }
      timer = setInterval(async () => { await loadConvs(); if (atual.value) abrir(atual.value.id, true); }, 8000);
      if (can('whatsapp.enviar')) templates.value = await api.get('/api/whatsapp/templates').catch(() => []);
    });
    onUnmounted(() => clearInterval(timer));
    const lista = computed(() => convs.value.filter((c) => !q.value || match(q.value, c.nome, c.nomePerfil, c.clienteNome, c.telefone, c.ultimaMensagem)));
    const enviar = () => run(async () => { if (!texto.value.trim()) return; await api.post('/api/whatsapp/enviar', { telefone: atual.value.telefone, texto: texto.value }); texto.value = ''; await abrir(atual.value.id); });
    const enviarNovo = () => run(async () => { const n = novo.value; await api.post('/api/whatsapp/enviar', n.template ? { telefone: n.telefone, template: n.template, idioma: n.idioma, parametros: (n.parametros || '').split('|').map((s) => s.trim()).filter(Boolean) } : { telefone: n.telefone, texto: n.texto }); novo.value = null; await loadConvs(); }, 'Mensagem enviada');
    const enviarTpl = () => run(async () => { const t = tpl.value; await api.post('/api/whatsapp/enviar', { telefone: atual.value.telefone, template: t.nome, idioma: t.idioma, parametros: (t.parametros || '').split('|').map((s) => s.trim()).filter(Boolean) }); tpl.value = null; await abrir(atual.value.id); }, 'Template enviado');
    const usaResposta = (r) => { texto.value = r.texto.replace('{nome}', (atual.value.clienteNome || atual.value.nomePerfil || '').split(' ')[0]); };
    const salvaResposta = () => { const t = prompt('Texto da resposta rápida (use {nome} para o primeiro nome):', texto.value); if (t) run(async () => { await api.post('/api/respostas', { atalho: t.slice(0, 30), texto: t }); respostas.value = await api.get('/api/respostas'); }, 'Resposta rápida salva'); };
    const vincularCliente = (c) => run(async () => { await api.put('/api/whatsapp/conversas/' + atual.value.id, { clienteId: c.id, nome: c.nome }); vincular.value = false; await abrir(atual.value.id); }, 'Conversa vinculada ao cliente');
    const criarCliente = () => run(async () => { const c = await api.post(`/api/whatsapp/conversas/${atual.value.id}/criar-cliente`, { nome: prompt('Nome do cliente:', atual.value.nomePerfil || '') || undefined }); await abrir(atual.value.id); go('/clientes/' + c.id); }, 'Cliente criado');
    const atribuir = (uid) => run(async () => { await api.put('/api/whatsapp/conversas/' + atual.value.id, { responsavelId: uid }); await abrir(atual.value.id); }, 'Responsável atualizado');
    const tarefa = () => run(async () => { await api.post('/api/tarefas', { titulo: 'Retornar WhatsApp: ' + (atual.value.clienteNome || atual.value.nomePerfil || atual.value.telefone), tipo: 'whatsapp', data: hojeISO(), clienteId: atual.value.clienteId || '' }); }, 'Tarefa criada');
    const fone = (t) => String(t || '').replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
    return { convs, lista, atual, abrir, texto, enviar, q, msgsEl, novo, enviarNovo, tpl, enviarTpl, templates, respostas, usaResposta, salvaResposta, clientes, vincular, vincularCliente, criarCliente, usuarios, atribuir, tarefa, fone, ...helpers };
  },
  template: `<div><div class="row" style="margin-bottom:10px"><h1 class="grow">WhatsApp Business</h1><button class="btn wa nogrow" v-if="can('whatsapp.enviar')" @click="novo={telefone:'',texto:''}">+ Nova conversa</button></div>
  <div class="wachat" :class="{sel:atual}"><div class="lst"><div style="padding:10px"><input v-model="q" placeholder="Buscar conversa..."></div>
   <div v-for="c in lista" :key="c.id" class="it" :class="{on:atual&&atual.id===c.id}" @click="abrir(c.id)"><div class="row"><b class="grow">{{c.clienteNome||c.nome||c.nomePerfil||fone(c.telefone)}}</b><span class="badge n nogrow" v-if="c.naoLidas">{{c.naoLidas}}</span></div>
    <div class="sm mu" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{c.ultimaMensagem}}</div><div class="sm mu">{{dth(c.ultimaData)}}</div></div>
   <p v-if="!lista.length" class="empty">Nenhuma conversa. Configure o webhook do WhatsApp em Configurações.</p></div>
  <div class="chat" v-if="atual"><div class="hd"><button class="btn sm burger" style="display:inline-block" @click="atual=null">←</button><div class="grow"><b>{{atual.clienteNome||atual.nome||atual.nomePerfil||fone(atual.telefone)}}</b><div class="sm mu">{{fone(atual.telefone)}} <span v-if="!atual.dentroJanela" class="badge warn">fora da janela 24h – use template</span></div></div>
    <a v-if="atual.clienteId" class="btn sm nogrow" :href="'#/clientes/'+atual.clienteId">Ver cliente</a>
    <button v-if="atual.clienteId && can('pedidos.criar')" class="btn sm p nogrow" @click="go('/pedidos/novo?cliente='+atual.clienteId)">+ Pedido</button>
    <button v-if="!atual.clienteId && can('clientes.editar')" class="btn sm nogrow" @click="vincular=true">Vincular cliente</button>
    <button v-if="!atual.clienteId && can('clientes.editar')" class="btn sm nogrow" @click="criarCliente">Criar cliente</button>
    <button v-if="can('tarefas.editar')" class="btn sm nogrow" @click="tarefa">+ Tarefa</button>
    <select class="nogrow" style="width:150px" :value="atual.responsavelId||''" @change="atribuir($event.target.value)" v-if="can('whatsapp.enviar')"><option value="">Sem responsável</option><option v-for="u in usuarios" :value="u.id">{{u.nome}}</option></select></div>
   <div class="msgs" ref="msgsEl"><div v-for="m in atual.mensagens" :key="m.id" class="msg" :class="m.direcao"><div>{{m.texto}}</div><div class="t">{{m.usuarioNome? m.usuarioNome+' · ':''}}{{dth(m.criadoEm)}} <span v-if="m.direcao==='out'">{{m.status==='read'?'✓✓ lida':m.status==='delivered'?'✓✓':m.status==='failed'?'⚠ falhou':'✓'}}</span></div><div v-if="m.erro" class="sm" style="color:var(--err)">{{m.erro}}</div></div></div>
   <div v-if="respostas.length && can('whatsapp.enviar')" style="padding:6px 10px;display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--bd)"><button v-for="r in respostas" class="btn sm" @click="usaResposta(r)" :title="r.texto">{{r.atalho}}</button></div>
   <div class="send" v-if="can('whatsapp.enviar')"><textarea v-model="texto" rows="2" placeholder="Digite a mensagem (Enter envia, Shift+Enter quebra linha)" @keydown.enter.exact.prevent="enviar" style="min-height:42px"></textarea>
    <div style="display:flex;flex-direction:column;gap:4px"><button class="btn wa" @click="enviar">Enviar</button><button class="btn sm" @click="tpl={nome:'',idioma:'pt_BR',parametros:''}" v-if="templates.length">Template</button><button class="btn sm" @click="salvaResposta">★ Salvar resposta</button></div></div></div>
  <div class="chat" v-else><div class="empty" style="margin:auto">Selecione uma conversa</div></div></div>
  <Modal v-if="vincular" title="Vincular a cliente" @close="vincular=false"><AutoComplete :items="clientes" :label="c=>c.nome" :sub="c=>[c.documento,c.cidade].filter(Boolean).join(' · ')" placeholder="Buscar cliente" @pick="vincularCliente"/></Modal>
  <Modal v-if="tpl" title="Enviar template aprovado" @close="tpl=null"><label>Template</label><select v-model="tpl.nome" @change="tpl.idioma=(templates.find(t=>t.nome===tpl.nome)||{}).idioma"><option v-for="t in templates" :value="t.nome">{{t.nome}} ({{t.idioma}})</option></select>
   <p class="sm mu" style="white-space:pre-wrap">{{(templates.find(t=>t.nome===tpl.nome)||{}).corpo}}</p><label>Parâmetros (variáveis 1, 2, … do template) separados por |</label><input v-model="tpl.parametros" placeholder="João | 1234">
   <template #ft><button class="btn" @click="tpl=null">Cancelar</button><button class="btn wa" @click="enviarTpl">Enviar</button></template></Modal>
  <Modal v-if="novo" title="Nova conversa" @close="novo=null"><div class="grid" style="gap:10px"><div><label>Telefone com DDD</label><input v-model="novo.telefone" placeholder="11999999999"></div>
   <div v-if="templates.length"><label>Template (obrigatório para iniciar conversa)</label><select v-model="novo.template" @change="novo.idioma=(templates.find(t=>t.nome===novo.template)||{}).idioma"><option value="">— mensagem de texto livre —</option><option v-for="t in templates" :value="t.nome">{{t.nome}}</option></select></div>
   <div v-if="novo.template"><p class="sm mu" style="white-space:pre-wrap">{{(templates.find(t=>t.nome===novo.template)||{}).corpo}}</p><label>Parâmetros separados por |</label><input v-model="novo.parametros"></div>
   <div v-else><label>Mensagem</label><textarea v-model="novo.texto"></textarea><p class="sm mu">Texto livre só é entregue se o cliente falou com você nas últimas 24h.</p></div></div>
   <template #ft><button class="btn" @click="novo=null">Cancelar</button><button class="btn wa" @click="enviarNovo">Enviar</button></template></Modal></div>`,
};

Pages.relatorios = {
  setup() {
    const d0 = new Date(); d0.setDate(1);
    const de = ref(d0.toISOString().slice(0, 10)); const ate = ref(hojeISO()); const r = ref(null);
    const load = async () => { r.value = await api.get(`/api/relatorios/vendas?de=${de.value}&ate=${ate.value}`); };
    onMounted(load);
    const csv = (rows, nome) => { const s = 'Nome;Quantidade;Total\n' + rows.map((x) => `"${x.nome}";${String(x.qtd).replace('.', ',')};${x.total.toFixed(2).replace('.', ',')}`).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + s], { type: 'text/csv' })); a.download = nome + '.csv'; a.click(); };
    return { de, ate, r, load, csv, ...helpers };
  },
  template: `<div><div class="row" style="margin-bottom:14px"><h1 class="grow">Relatórios de vendas</h1><div class="nogrow"><input type="date" v-model="de"></div><div class="nogrow"><input type="date" v-model="ate"></div><button class="btn p nogrow" @click="load">Gerar</button></div>
  <div v-if="r"><div class="grid g4" style="margin-bottom:16px"><div class="card kpi"><div class="l">Total vendido</div><div class="v">{{brl(r.total)}}</div></div><div class="card kpi"><div class="l">Pedidos</div><div class="v">{{r.pedidos}}</div></div><div class="card kpi"><div class="l">Ticket médio</div><div class="v">{{brl(r.pedidos? r.total/r.pedidos:0)}}</div></div></div>
  <div class="grid g2"><div class="card" v-for="(t,k) in {porVendedor:'Por vendedor',porCliente:'Por cliente (top 50)',porProduto:'Por produto (top 50)'}"><div class="row"><h2 class="grow">{{t}}</h2><button class="btn sm nogrow" @click="csv(r[k],k)">CSV</button></div>
   <div class="tw" style="max-height:400px"><table><thead><tr><th>Nome</th><th class="r">Qtd</th><th class="r">Total</th></tr></thead><tr v-for="x in r[k]"><td>{{x.nome}}</td><td class="r">{{n2(x.qtd)}}</td><td class="r nowrap">{{brl(x.total)}}</td></tr></table></div></div></div></div></div>`,
};
