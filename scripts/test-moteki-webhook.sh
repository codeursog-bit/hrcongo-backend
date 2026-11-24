#!/bin/bash
# ============================================================================
# 🧪 TEST DU WEBHOOK MOTEKI — sans attendre un vrai paiement
# ============================================================================
# Simule un événement "subscription.payment.success" envoyé par Moteki,
# avec une vraie signature HMAC calculée comme le fera Moteki en prod.
# Sert à valider TOUT le pipeline (signature → _findPayment → activation)
# indépendamment de Moteki lui-même.
#
# Usage :
#   MOTEKI_WEBHOOK_SECRET=xxx ./test-moteki-webhook.sh <order_id> <order_number> <moteki_subscription_id> [url]
#
# Exemple :
#   MOTEKI_WEBHOOK_SECRET=whsec_test123 ./test-moteki-webhook.sh \
#     "ord-abc-123" "MOT-000042" "sub-xyz-789" \
#     http://localhost:3000/webhooks/moteki
#
# ⚠️ Pré-requis pour que ça matche un vrai Payment en base :
#   - <order_id> doit être EXACTEMENT le "id" renvoyé par
#     POST /storefront/digital-products/{uuid}/subscribe lors d'un appel
#     précédent à POST /subscriptions/upgrade/moteki (colonne motekiOrderId)
#   - à défaut, utilise <order_number> (motekiOrderNumber) ou l'email client
#     (motekiCustomerEmail) — voir _findPayment() dans
#     moteki-webhooks.controller.ts pour l'ordre de recherche exact.
# ============================================================================

set -e

if [ -z "$MOTEKI_WEBHOOK_SECRET" ]; then
  echo "❌ Variable MOTEKI_WEBHOOK_SECRET manquante."
  echo "   Usage: MOTEKI_WEBHOOK_SECRET=xxx $0 <order_id> <order_number> <moteki_subscription_id> [url]"
  exit 1
fi

ORDER_ID="${1:-ord-test-0001}"
ORDER_NUMBER="${2:-MOT-TEST-0001}"
SUBSCRIPTION_ID="${3:-sub-test-0001}"
URL="${4:-http://localhost:3000/webhooks/moteki}"

# ⚠️ Le payload ci-dessous inclut order_id/order_number à plusieurs endroits
# plausibles (au cas où le vrai payload Moteki les place différemment) —
# c'est volontaire pour ce script de test, PAS pour simuler fidèlement
# Moteki (dont on n'a pas le payload exact confirmé, voir la note dans
# moteki-webhooks.controller.ts).
PAYLOAD=$(cat <<EOF
{
  "event": "subscription.payment.success",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "data": {
    "order_id": "${ORDER_ID}",
    "order_number": "${ORDER_NUMBER}",
    "subscription": {
      "id": "${SUBSCRIPTION_ID}",
      "status": "active",
      "billing_cycle": "monthly",
      "amount": "5000.00",
      "currency": "XAF",
      "next_billing_date": "2026-10-07T10:00:00Z",
      "cancelled_at": null
    }
  }
}
EOF
)

SIGNATURE="sha256=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$MOTEKI_WEBHOOK_SECRET" | sed 's/^.* //')"

echo "📦 Payload envoyé :"
echo "$PAYLOAD"
echo ""
echo "🔐 Signature calculée : $SIGNATURE"
echo ""
echo "🚀 Envoi vers $URL ..."
echo ""

curl -i -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Moteki-Signature: $SIGNATURE" \
  -H "X-Moteki-Event: subscription.payment.success" \
  --data-raw "$PAYLOAD"

echo ""
echo ""
echo "👉 Vérifie les logs du backend NestJS : tu dois voir"
echo "   '🔔 Webhook Moteki reçu' → '✅ Signature vérifiée' → soit"
echo "   l'activation réussie, soit l'erreur explicite de _findPayment()"
echo "   si aucun Payment ne correspond (normal si tu n'as pas encore fait"
echo "   un vrai POST /subscriptions/upgrade/moteki avec ces identifiants)."