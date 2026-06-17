# Tester Stripe sur Palova

Guide pratique pour tester le paiement en ligne (Stripe Connect, *direct charges*).
Voir aussi [`DEPLOY.md`](./DEPLOY.md) pour la mise en prod.

## Mode TEST vs LIVE
Stripe a **deux univers étanches** : `test` et `live`. **Rien n'est partagé** — clés, webhooks et **comptes connectés des clubs** sont distincts. La prod tourne actuellement en **mode TEST** (clés `sk_test_…` / `pk_test_…`), donc tout est gratuit et sans risque.

- Inspecter dans le **Dashboard Stripe** avec l'interrupteur **Test/Live** (en haut) sur **Test** : Payments, Refunds, Connect → Accounts, Webhooks.
- Les 3 variables sont dans `~/palova/.env.prod` : `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (runtime backend), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (build-arg frontend, **gelée au build**). Les 3 doivent être du **même mode** et du **même compte**.

## Où tester
- **Sur la prod** (`*.palova.fr`) — elle est en mode test, avec les cartes ci-dessous ; OU
- **En local** (`localhost:3000` / `:3001`) avec les mêmes clés test — pratique pour itérer vite et lire les logs backend.

## Cartes de test
Toujours : **date d'expiration future** (ex. `12/34`), **CVC** au hasard (3 chiffres), code postal au hasard.

| Carte | Résultat |
|---|---|
| `4242 4242 4242 4242` | ✅ paiement réussi |
| `4000 0000 0000 0002` | ❌ carte refusée (`card_declined`) |
| `4000 0025 0000 3155` | 🔐 demande une authentification 3D Secure |
| `4000 0000 0000 9995` | ❌ fonds insuffisants |
| `4000 0000 0000 0341` | ❌ échoue à l'enregistrement de la carte (utile pour tester l'empreinte qui rate) |

Liste complète : Dashboard → **Developers → Test cards**, ou <https://stripe.com/docs/testing>.

## Les fonctionnalités Stripe de Palova à tester

| Fonctionnalité | Déclenchement | Test |
|---|---|---|
| **Onboarding Connect** (un club connecte Stripe) | `/admin` du club → « Connecter Stripe » | En mode test, le formulaire Stripe a un bouton **« Skip » / remplir avec des données de test** → le compte passe `charges_enabled` → webhook `account.updated` → statut `ACTIVE` en base |
| **Paiement à la réservation** (carte, *direct charge*) | Réserver → payer | Carte `4242…` = succès ; `4000…0002` = refus ; `4000 0025 0000 3155` = 3DS |
| **Empreinte carte** (`setup`, enregistrer la carte) | Club avec empreinte requise → réserver | La carte est enregistrée (SetupIntent) ; `4000…0341` pour tester un échec |
| **Débit no-show** (hors-session, sur carte enregistrée) | `/admin` → débiter un no-show | Nécessite une carte déjà enregistrée (empreinte) ; vérifier le PaymentIntent dans le Dashboard |
| **Remboursement** (à l'annulation) | Annuler une résa payée (dans la fenêtre si le club a activé le remboursement auto) | Vérifier le refund dans le Dashboard |
| **Webhooks** | événements `account.updated`, `payment_intent.succeeded`, `setup_intent.succeeded` | Voir section suivante |

## Tester les webhooks (essentiel — ils pilotent les statuts)
Les webhooks confirment les réservations et mettent à jour le statut des comptes connectés.

1. **Dashboard** : Developers → **Webhooks** → l'endpoint `api.palova.fr/api/stripe/webhooks` → on voit chaque livraison + le **code de réponse** (200 = le backend a bien traité ; un 4xx/5xx ici = le traitement échoue).
2. **Stripe CLI** (le plus puissant, surtout en local) :
   ```bash
   stripe login
   stripe listen --forward-to https://api.palova.fr/api/stripe/webhooks   # ou http://localhost:3001/api/stripe/webhooks en local
   stripe trigger payment_intent.succeeded     # simule un événement
   stripe trigger account.updated
   ```
   En local, `stripe listen` affiche un `whsec_…` temporaire à mettre dans le `.env` du backend pour valider la signature.

## Vérifs utiles en base (mode test)
```bash
# état Stripe Connect d'un club
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  psql -U palovauser -d palova -c \
  "SELECT slug, stripe_account_id, stripe_account_status FROM clubs WHERE slug='<slug>';"
```

## Passer en LIVE (rappel)
Quand tu voudras encaisser pour de vrai (détaillé dans [`DEPLOY.md`](./DEPLOY.md)) :
1. Activer le compte plateforme en live (infos société + compte bancaire).
2. Mettre les 3 clés **`live`** dans `.env.prod` (back + front), recréer le **webhook en mode live** (nouveau `whsec_`).
3. **Rebuild front ET back**, `up -d`.
4. **Ré-onboarder chaque club en live** (`/admin` → Connecter Stripe) — les comptes connectés de test n'existent pas en live.
5. Tester avec une **vraie carte** (les cartes de test sont refusées en live).
