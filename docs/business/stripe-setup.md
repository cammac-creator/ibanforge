# Stripe setup guide — IBANforge

**Date :** 2026-05-12
**Statut :** Sprint Stripe livré côté code. Cette doc explique ce qu'Alain doit faire côté Stripe dashboard pour activer le flow.

---

## Vue d'ensemble

Le sprint Stripe ajoute un 3e rail de paiement à IBANforge (en plus de la clé API gratuite et du x402 USDC) :

```
User clique "Buy credits" sur la landing
   ↓
Redirige vers Payment Link Stripe ($5 / $20 / $80)
   ↓
Paye par carte
   ↓
Stripe envoie webhook checkout.session.completed → /v1/stripe/webhook
   ↓
Le backend mint une clé API et stocke la raw key dans une colonne one-time-view
   ↓
Stripe redirige le user vers ibanforge.com/success?session_id=cs_test_XXX
   ↓
La page success appelle GET /v1/stripe/key/:session_id, affiche la clé une seule fois
```

Les bundles sont alignés sur ceux de x402 : **1k credits = $5**, **5k = $20**, **25k = $80**.

---

## Étapes à effectuer côté Stripe (Alain)

### 1. Récupérer les clés API Stripe

Dashboard Stripe → **Developers → API keys** :
- **Publishable key** (`pk_test_...` ou `pk_live_...`) — pas utilisée côté serveur, sert au frontend si on ajoute du JS Stripe.js plus tard. Pas critique pour ce sprint.
- **Secret key** (`sk_test_...` ou `sk_live_...`) — à mettre dans `STRIPE_SECRET_KEY`.

### 2. Créer le webhook endpoint

Dashboard Stripe → **Developers → Webhooks → Add endpoint** :

- **Endpoint URL** : `https://api.ibanforge.com/v1/stripe/webhook`
- **Events to send** : seulement `checkout.session.completed` (sélectif, évite la pollution)
- Après création, Stripe affiche un **Signing secret** (`whsec_...`) → à mettre dans `STRIPE_WEBHOOK_SECRET`.

### 3. Créer 3 Payment Links

Dashboard Stripe → **Product catalog → Add product** :

Crée 3 produits :

| Produit | Prix | Métadonnée bundle |
|---------|------|--------------------|
| IBANforge — 1 000 credits | $5 USD one-time | `bundle: 1k` |
| IBANforge — 5 000 credits | $20 USD one-time | `bundle: 5k` |
| IBANforge — 25 000 credits | $80 USD one-time | `bundle: 25k` |

Pour chaque produit → **Create a payment link** :

- Type : One-off purchase
- Quantity : non modifiable (1)
- **Collect customer email** : ON (essentiel — c'est l'email associé à la clé)
- **Success page** : "Don't show confirmation page → Use a custom URL"
  - URL : `https://ibanforge.com/stripe/success?session_id={CHECKOUT_SESSION_ID}`
- **Add metadata** : `bundle = 1k` (ou `5k` / `25k` selon le produit)

Copie les 3 URLs Payment Link (de la forme `https://buy.stripe.com/XXXXXX`).

### 4. Mettre les URLs dans la landing

Modifier `src/routes/landing.ts` à la fin du sprint pour remplacer les placeholders `STRIPE_PAYMENT_LINK_1K` etc. par les URLs réelles. Le sprint actuel laisse des placeholders.

### 5. Variables d'environnement Railway

Dans **Railway → Variables** :

```bash
STRIPE_SECRET_KEY=sk_test_xxxxx           # test pour démarrer, sk_live_... ensuite
STRIPE_WEBHOOK_SECRET=whsec_xxxxx          # depuis le dashboard webhook
```

(Pas besoin de `STRIPE_PUBLISHABLE_KEY` côté backend pour ce sprint.)

### 6. Tester en local avec Stripe CLI

```bash
# Install Stripe CLI : https://stripe.com/docs/stripe-cli
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/v1/stripe/webhook

# Stripe CLI affiche un webhook secret de test : whsec_xxxxx
# Mets-le dans .env pour le dev local

# Dans un autre terminal, déclenche un event de test
stripe trigger checkout.session.completed
```

### 7. Mode test → mode live

Quand le KYC Stripe est validé (Suisse = 1-3 jours typiquement) :

1. Bascule en mode **Live** dans le dashboard
2. Re-crée les 3 Payment Links **en mode Live** (les Payment Links créés en mode test ne marchent pas en live)
3. Re-crée le webhook endpoint en mode Live (signing secret différent)
4. Update les vars Railway : `sk_live_...` + nouveau `whsec_...`
5. Update les URLs Payment Link dans landing.ts

---

## Points de sécurité critiques

1. **Vérification signature webhook** : implémentée via `Stripe.webhooks.constructEvent()`. Sans ça, n'importe qui peut POST sur `/v1/stripe/webhook` et minter des clés gratuites. Ne JAMAIS désactiver.

2. **Idempotency** : Stripe retry agressivement les webhooks (jusqu'à 3 jours). La table `processed_webhooks` empêche les doubles mint. Vérifié dans `processStripeEvent()`.

3. **Raw body pour la signature** : `c.req.text()` (pas `c.req.json()`) — Hono ne parse pas avant qu'on demande.

4. **One-time-view de la clé** : la raw key n'est stockée que dans `raw_key_one_time_view` et nullée dès la première lecture via `consumeOneTimeKey()`. Le hash reste pour l'auth.

5. **Frais Stripe** : 2.9% + $0.30 par tx. Sur $5 = $0.45 (9%). Sur $80 = $2.62 (3.3%). Marge brute reste >85% sur les gros packs.

---

## Endpoints ajoutés par le sprint

| Méthode | Chemin | Auth | Description |
|---------|--------|------|-------------|
| POST | `/v1/stripe/webhook` | Signature Stripe | Réception des events Stripe |
| GET | `/v1/stripe/key/:session_id` | Session id | Récupération one-time de la clé après paiement |

---

## Tests

`src/routes/stripe-webhook.test.ts` couvre :
- Idempotency (même event_id deux fois → pas de double mint)
- Event type non géré (ne mint pas, n'erreur pas)
- Bundle inconnu (ne mint pas)
- Mint normal → clé valide créée
- Consume one-time key → 2e appel retourne null

Lancer : `npm run test -- stripe-webhook`

---

## Prochaines évolutions (hors scope sprint actuel)

- Page `ibanforge.com/pricing` dédiée Stripe avec les 3 packs (frontend Next.js)
- Webhook handler pour `charge.refunded` → invalider la clé
- Email transactionnel custom (au lieu du reçu Stripe générique)
- Dashboard client pour voir les crédits restants
- Recharge automatique quand credits < threshold
