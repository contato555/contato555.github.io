// Catálogo de permissões por funcionalidade. Perfis agrupam permissões; usuário pertence a um perfil.
const PERMISSOES = [
  { grupo: 'Painel', itens: [['dashboard.ver', 'Ver painel e indicadores'], ['relatorios.ver', 'Ver relatórios de vendas']] },
  { grupo: 'Clientes', itens: [['clientes.ver', 'Ver clientes'], ['clientes.editar', 'Criar/editar clientes'], ['clientes.excluir', 'Excluir clientes'], ['clientes.ver_todos', 'Ver clientes de todos os vendedores']] },
  { grupo: 'Pedidos de venda', itens: [['pedidos.ver', 'Ver pedidos'], ['pedidos.criar', 'Digitar pedidos'], ['pedidos.editar', 'Editar/excluir pedidos não enviados'], ['pedidos.enviar_bling', 'Enviar pedidos ao Bling'], ['pedidos.ver_todos', 'Ver pedidos de todos os vendedores'], ['pedidos.alterar_preco', 'Alterar preço/desconto no pedido']] },
  { grupo: 'Produtos', itens: [['produtos.ver', 'Ver produtos'], ['produtos.sincronizar', 'Importar produtos do Bling']] },
  { grupo: 'Listas de preço', itens: [['listas.ver', 'Ver listas de preço'], ['listas.editar', 'Criar/editar listas de preço']] },
  { grupo: 'Vendedores', itens: [['vendedores.ver', 'Ver vendedores'], ['vendedores.sincronizar', 'Importar vendedores do Bling']] },
  { grupo: 'Funil de vendas', itens: [['funil.ver', 'Ver oportunidades'], ['funil.editar', 'Criar/mover oportunidades']] },
  { grupo: 'Tarefas', itens: [['tarefas.ver', 'Ver tarefas/agenda'], ['tarefas.editar', 'Criar/concluir tarefas']] },
  { grupo: 'WhatsApp', itens: [['whatsapp.ver', 'Ver conversas'], ['whatsapp.enviar', 'Enviar mensagens'], ['whatsapp.ver_todas', 'Ver conversas de todos']] },
  { grupo: 'Administração', itens: [['usuarios.gerenciar', 'Gerenciar usuários e perfis'], ['config.gerenciar', 'Configurar integrações (Bling/WhatsApp)'], ['auditoria.ver', 'Ver log de auditoria']] },
];
const TODAS = PERMISSOES.flatMap((g) => g.itens.map((i) => i[0]));

const PERFIS_PADRAO = [
  { id: 'admin', nome: 'Administrador', permissoes: TODAS, sistema: true },
  { id: 'gerente', nome: 'Gerente comercial', permissoes: TODAS.filter((p) => !['usuarios.gerenciar', 'config.gerenciar'].includes(p)) },
  { id: 'vendedor', nome: 'Vendedor', permissoes: ['dashboard.ver', 'clientes.ver', 'clientes.editar', 'pedidos.ver', 'pedidos.criar', 'pedidos.editar', 'pedidos.enviar_bling', 'produtos.ver', 'listas.ver', 'vendedores.ver', 'funil.ver', 'funil.editar', 'tarefas.ver', 'tarefas.editar', 'whatsapp.ver', 'whatsapp.enviar'] },
  { id: 'atendente', nome: 'Atendente WhatsApp', permissoes: ['clientes.ver', 'clientes.editar', 'clientes.ver_todos', 'whatsapp.ver', 'whatsapp.enviar', 'whatsapp.ver_todas', 'tarefas.ver', 'tarefas.editar', 'produtos.ver'] },
];

module.exports = { PERMISSOES, TODAS, PERFIS_PADRAO };
