# Déploiement de Palova en production

VM Hetzner `167.233.41.155`, dossier `~/palova`. Stack Docker Compose : Caddy (TLS + reverse proxy) + `frontend` (Next.js, port 3000) + `backend` (Express, port 3001) + `postgres` + `redis`. Domaines : `palova.fr` / `*.palova.fr` → frontend, `api.palova.fr` → backend.

## ⚠️ Règle d'or
**Toujours rebuild le frontend ET le backend depuis le MÊME commit, puis `up -d` SANS `--build`.**
Un déploiement partiel crée un décalage silencieux (ex. un backend qui ne renvoie pas un champ que le frontend attend → paiement Stripe cassé, incident 2026-06-17).
`docker compose up -d --build` **gèle** → ne JAMAIS l'utiliser ; toujours `build` séparé puis `up -d`.

## Variables d'environnement
Fichier `~/palova/.env.prod` (hors git, jamais commité). Particularités :
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` : lues au **runtime** par le backend.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` : **build-arg du frontend → gelée dans le bundle au build**. Tout changement ⇒ **rebuild du frontend obligatoire** (un `up -d` ne suffit pas).
- Les 3 clés Stripe doivent être du **même mode** (`test`/`live`) et du **même compte**.
- Doubler les `$` en `$$` (interpolation docker-compose).

## Procédure
```bash
cd ~/palova
DC="docker compose --env-file .env.prod -f docker-compose.prod.yml"
git pull                 # passe à la dernière version de origin/main
$DC build                # rebuild frontend + backend (même commit) ; JAMAIS --build dans up
$DC up -d                # recrée les conteneurs modifiés
```
Le backend applique les migrations Prisma au démarrage (`prisma migrate deploy`, dans le CMD du Dockerfile).

## Vérification
```bash
$DC ps                                                       # tout "Up" ; backend/frontend "Up X seconds" = bien recréés
curl -sS -o /dev/null -w "%{http_code}\n" https://api.palova.fr/health   # attendu 200
$DC logs --tail=20 backend                                   # "Backend démarré sur http://localhost:3001"
```
Front : tester en **navigation privée / appareil sans cache** (le bundle JS est mis en cache navigateur, et les `NEXT_PUBLIC_*` y sont gelées).

## Vérifs utiles (debug)
```bash
# le code compilé dans le conteneur est-il à jour ?
$DC exec -T backend grep -c <symbole_attendu> dist/routes/<fichier>.js
$DC exec -T frontend sh -c "grep -rl <symbole_attendu> .next/static | head"
# état d'un club côté Stripe Connect
$DC exec -T postgres psql -U palovauser -d palova -c "SELECT slug, stripe_account_id, stripe_account_status FROM clubs WHERE slug='<slug>';"
```

## Pièges connus
- `up -d --build` **gèle** → build séparé puis `up -d`.
- `NEXT_PUBLIC_*` **gelées au build** du frontend → rebuild front après tout changement de ces variables + tester sans cache.
- `.env.prod` : `$` → `$$`.
- `STRIPE_SECRET_KEY` **vide** faisait crasher le boot (502) ; corrigé (fallback placeholder même sur chaîne vide), mais garder une vraie clé en prod.
- **Stripe Connect** : les comptes connectés des clubs sont **par mode** (test/live). Passage en live = clés `live` (back + front), rebuild front, **ré-onboarding live de chaque club**, et test avec une **vraie carte** (les cartes de test ne marchent qu'en mode test).
