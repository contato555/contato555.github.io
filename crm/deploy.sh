#!/usr/bin/env bash
# Publica o CRM no Google Cloud Run + Firestore com um único comando.
# Uso (no Google Cloud Shell, dentro da pasta crm):  bash deploy.sh
set -euo pipefail
REGION="${REGION:-southamerica-east1}"
SERVICE="${SERVICE:-crm-bling}"

echo "== CRM Bling + WhatsApp: publicação no Google Cloud =="
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "Projetos disponíveis:"; gcloud projects list --format="value(projectId)" || true
  read -rp "ID do projeto Google Cloud a usar: " PROJECT
fi
gcloud config set project "$PROJECT" >/dev/null
echo "Projeto: $PROJECT | Região: $REGION"

if [ -z "${ADMIN_EMAIL:-}" ]; then read -rp "E-mail do administrador do CRM: " ADMIN_EMAIL; fi
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | head -c 12)}"

echo "-> Ativando APIs (pode levar 1-2 min)..."
gcloud services enable run.googleapis.com firestore.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

echo "-> Banco Firestore..."
if ! gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  gcloud firestore databases create --location="$REGION" --type=firestore-native
else echo "   já existe"; fi

echo "-> Segredo de sessão (Secret Manager)..."
if ! gcloud secrets describe crm-session-secret >/dev/null 2>&1; then
  openssl rand -hex 32 | gcloud secrets create crm-session-secret --data-file=- --replication-policy=automatic
fi
PNUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="${PNUM}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding crm-session-secret --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role=roles/datastore.user --condition=None >/dev/null

echo "-> Publicando no Cloud Run (3-5 min na primeira vez)..."
gcloud run deploy "$SERVICE" --source . --region "$REGION" --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,ADMIN_EMAIL=${ADMIN_EMAIL},ADMIN_PASSWORD=${ADMIN_PASSWORD}" \
  --set-secrets "SESSION_SECRET=crm-session-secret:latest" \
  --min-instances 0 --max-instances 3 --memory 512Mi --quiet

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "BLING_REDIRECT_URI=${URL}/api/bling/callback" --quiet >/dev/null

cat <<MSG

==========================================================
 CRM publicado!
 Endereço:  $URL
 Login:     $ADMIN_EMAIL
 Senha:     $ADMIN_PASSWORD   (troque no primeiro acesso)

 Callback do Bling:   $URL/api/bling/callback
 Webhook WhatsApp:    $URL/api/whatsapp/webhook
==========================================================
Obs.: a senha inicial só vale enquanto não existir nenhum usuário;
se você já publicou antes, use a senha que definiu na época.
MSG
