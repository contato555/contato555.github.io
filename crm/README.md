# CRM integrado ao Bling + WhatsApp Business

CRM web com usuários, senhas e permissões por funcionalidade, conectado ao **Bling (API v3)** e ao **WhatsApp Business (Cloud API da Meta)**. Pronto para hospedar no **Google Cloud Run** com banco **Firestore**.

## Funcionalidades

| Módulo | O que faz |
|---|---|
| **Pedidos de venda** | Digitação rápida (busca por código/nome, Enter para adicionar), preço automático pela lista do cliente, desconto, frete, parcelas por forma de pagamento do Bling, rascunho, duplicar, imprimir. **Botão "Enviar ao Bling"** cria o pedido no Bling (e o contato, se ainda não existir) e grava o nº do Bling. Envio do resumo do pedido no **WhatsApp** do cliente. |
| **Listas de preço** | Lista por cliente (ou compartilhada entre vários), preço fixo por produto + ajuste % geral sobre o preço do Bling, importação em lote "código;preço" (colar do Excel), botão "Criar lista exclusiva" no cliente. |
| **Produtos / Vendedores / Formas de pagamento** | Importados do Bling (nome, código, preço, estoque). Cada usuário do CRM pode ser vinculado a um vendedor do Bling. |
| **Clientes** | Cadastro completo (busca CEP), importação de contatos do Bling, histórico (anotações, pedidos, tarefas), total comprado. |
| **Funil de vendas** | Kanban com arrastar e soltar, valor por etapa, motivo de perda, gerar pedido a partir da oportunidade (vira "ganho" ao enviar ao Bling). Etapas configuráveis. |
| **Tarefas / agenda** | Ligações, visitas, retornos de WhatsApp, atrasadas em destaque no painel. |
| **WhatsApp** | Caixa de entrada compartilhada (webhook), responder, templates aprovados (fora da janela de 24h), respostas rápidas, atribuir responsável, vincular/criar cliente pela conversa, contador de não lidas. |
| **Painel e relatórios** | Vendas do mês, ticket médio, funil, conversão, gráficos, vendas por vendedor/cliente/produto com exportação CSV. |
| **Segurança** | Login com senha (bcrypt), sessão JWT em cookie httpOnly, troca de senha obrigatória no 1º acesso, bloqueio após tentativas, **perfis com permissões por funcionalidade** (Administrador, Gerente, Vendedor, Atendente + personalizados), vendedor só vê os próprios pedidos/clientes, preço só alterável com permissão (validado no servidor), log de auditoria. |

## Rodar localmente

```bash
cd crm
npm install
cp .env.example .env   # ajuste ADMIN_EMAIL / ADMIN_PASSWORD / SESSION_SECRET
npm run dev            # http://localhost:8080  (dados em crm/data/db.json)
npm test               # teste ponta a ponta com Bling e WhatsApp simulados
```

Sem `ADMIN_PASSWORD`, uma senha aleatória do administrador é exibida no log na primeira execução.

## Hospedar no Google Cloud (Cloud Run + Firestore)

1. Crie um projeto no [console.cloud.google.com](https://console.cloud.google.com) e instale o `gcloud`.
2. Ative as APIs e crie o banco Firestore (modo nativo, região São Paulo):
   ```bash
   gcloud config set project SEU_PROJETO
   gcloud services enable run.googleapis.com firestore.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
   gcloud firestore databases create --location=southamerica-east1
   ```
3. Publique (dentro da pasta `crm`):
   ```bash
   gcloud run deploy crm-bling \
     --source . --region southamerica-east1 --allow-unauthenticated \
     --set-env-vars NODE_ENV=production,SESSION_SECRET=$(openssl rand -hex 32),ADMIN_EMAIL=voce@empresa.com.br,ADMIN_PASSWORD='SenhaInicialForte' \
     --min-instances 0 --max-instances 3
   ```
   O Cloud Run usa o Firestore automaticamente (a conta de serviço padrão já tem acesso ao Firestore do mesmo projeto).
4. Acesse a URL `https://crm-bling-xxxxx.run.app`, entre com o administrador e troque a senha. Opcional: mapeie um domínio próprio em Cloud Run → Gerenciar domínios personalizados.

> Para proteger os segredos, prefira o Secret Manager: `--set-secrets SESSION_SECRET=crm-session:latest`.

### Sincronização automática (opcional)
Defina `CRON_KEY` no serviço e crie um job no Cloud Scheduler:
```bash
gcloud scheduler jobs create http crm-sync --schedule="0 */3 * * *" --location=southamerica-east1 \
  --uri="https://SEU-SERVICO.run.app/api/cron/sync?tipos=produtos,vendedores" --http-method=POST --headers="X-Cron-Key=SUA_CHAVE"
```

## Conectar o Bling

1. Bling → **Central de Extensões → Área do Integrador → Criar aplicativo**.
2. Link de redirecionamento: `https://SEU-SERVICO.run.app/api/bling/callback` (aparece pronto para copiar em **Configurações** no CRM).
3. Escopos: Produtos, Contatos, Vendedores, Pedidos de Venda, Formas de Pagamento, Situações (leitura e escrita onde aplicável).
4. No CRM → **Configurações**: cole Client ID e Client Secret → **Conectar ao Bling** → autorize.
5. Clique em importar **vendedores**, **produtos**, **formas de pagamento** e (opcional) **clientes**.
6. Em **Usuários**, vincule cada vendedor do CRM ao vendedor do Bling.

O token é renovado automaticamente (refresh token). As chamadas respeitam o limite de 3 requisições/segundo do Bling.

## Conectar o WhatsApp Business (Cloud API)

1. [developers.facebook.com](https://developers.facebook.com) → crie um app do tipo **Business** → adicione o produto **WhatsApp**.
2. Cadastre/migre o número da empresa. Copie **Phone number ID** e **WhatsApp Business Account ID**.
3. Gere um **token permanente** (Configurações do negócio → Usuários do sistema → gerar token com `whatsapp_business_messaging` e `whatsapp_business_management`).
4. No CRM → **Configurações → WhatsApp**: preencha os campos e salve (o token de verificação é gerado automaticamente). Informe também o **App Secret** para validar a assinatura do webhook.
5. No app da Meta → WhatsApp → **Configuração → Webhook**: URL `https://SEU-SERVICO.run.app/api/whatsapp/webhook`, token de verificação igual ao do CRM, assine o campo **messages**.
6. Para iniciar conversas ou responder após 24h, crie templates em Gerenciador do WhatsApp; eles aparecem automaticamente no CRM.

## Estrutura

```
crm/
  server.js                 # Express: rotas, sessão, arquivos estáticos
  src/db.js                 # Firestore (produção) / JSON (local) com cache
  src/auth.js               # login, JWT, middleware de permissão
  src/permissions.js        # catálogo de permissões e perfis padrão
  src/bling.js              # cliente Bling v3 (OAuth2, refresh, rate limit, paginação)
  src/whatsapp.js           # Cloud API: envio, templates, webhook
  src/routes/*.js           # comercial (clientes, listas, pedidos), integrações, CRM, admin
  public/                   # interface (Vue 3 sem build)
  test/e2e.test.js          # teste ponta a ponta com mocks
```
