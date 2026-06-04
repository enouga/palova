# Runbook — Déploiement de palova sur Render (gratuit, démo/test)

> Objectif : mettre l'app en ligne (frontend Next + backend Express + Postgres + Redis) sur Render, gratuitement, avec le domaine `palova.fr` (OVH).
> Effort estimé : **~1 h** la première fois (dont ~20 min d'attente DNS/build). Coût : **0 €**.
> Compromis gratuits : services qui **s'endorment après ~15 min** d'inactivité, **Postgres free supprimé après 90 jours**, SSE/cron en pause pendant le sommeil.

---

## Vue d'ensemble

```
palova.fr, padel-arena-paris.palova.fr  ──►  Frontend (Next)   [Render Web Service, free]
api.palova.fr                            ──►  Backend (Express) [Render Web Service, free]
                                                   │
                              Postgres (Render free)  +  Key Value/Redis (Render free)
```

5 ressources Render : **2 web services** (front, back) + **1 Postgres** + **1 Key Value (Redis)**. Tout dans la **même région** (ex. Frankfurt) pour que les URLs internes marchent.

---

## Pré-requis
- Compte **Render** (gratuit) connecté à ton **GitHub** (repo `enouga/palova`, branche `main`).
- Domaine **`palova.fr`** chez OVH (zone DNS accessible).
- Le repo est à jour sur `origin/main` (✅ déjà fait).

---

## Étape 0 — 1 changement de code + 1 fichier (avant tout déploiement)

Ces 2 points sont à committer sur `main` avant de déployer. *(Je peux les faire pour toi si tu choisis Render.)*

**0.a — `backend/src/redis/client.ts` : supporter une URL Redis (Render fournit une URL avec mot de passe/TLS).**
Remplacer la construction du client par :
```ts
export const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { retryStrategy: (t) => Math.min(t * 100, 3000), enableOfflineQueue: false, lazyConnect: true })
  : new Redis({ host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379', 10), retryStrategy: (t) => Math.min(t * 100, 3000), enableOfflineQueue: false, lazyConnect: true });
```
*(En local, pas de `REDIS_URL` → comportement inchangé.)*

**0.b — Gotcha devDependencies** : Render met `NODE_ENV=production`, ce qui fait que `npm install` **saute les devDependencies**. Or `typescript` (build backend) et les outils Next sont en devDeps. → On force leur installation dans les **Build Commands** ci-dessous avec `npm install --include=dev`. (Rien à coder, juste à savoir.)

**0.c — Accès privé (Basic Auth)** : pour que le site ne soit accessible que par toi, on ajoute en tête de `proxy()` dans `frontend/proxy.ts` un verrou Basic Auth, actif uniquement si les variables `SITE_USER`/`SITE_PASS` sont définies (donc inactif en local, et trivial à retirer plus tard) :
```ts
// Verrou d'accès privé — actif seulement si SITE_USER/SITE_PASS sont définis.
const U = process.env.SITE_USER, P = process.env.SITE_PASS;
if (U && P) {
  const [scheme, encoded] = (request.headers.get('authorization') || '').split(' ');
  let okAuth = false;
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = atob(encoded).split(':');
    okAuth = user === U && pass === P;
  }
  if (!okAuth) {
    return new NextResponse('Authentification requise', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="palova", charset="UTF-8"' },
    });
  }
}
```
À placer tout au début de `export function proxy(request)`, avant la résolution du slug. Le navigateur affiche une pop-up login ; une fois saisi, il garde les identifiants. *(Gate l'UI ; les assets statiques `_next/static/*` restent servis — sans incidence, aucune donnée sensible.)*

---

## Étape 1 — Base Postgres
1. Render → **New +** → **Postgres**. Name `palova-db`, région **Frankfurt** (ou EU proche), plan **Free**. Create.
2. Quand prête, copie l'**Internal Database URL** (pour le backend) et l'**External Database URL** (pour seeder depuis ta machine). Garde-les.

## Étape 2 — Redis (Key Value)
1. Render → **New +** → **Key Value** (Redis). Name `palova-redis`, même région, plan **Free**. Create.
2. Copie l'**Internal Key Value URL** (format `redis://…` ou `rediss://…`). C'est ton `REDIS_URL`.

## Étape 3 — Service Backend (Express)
1. Render → **New +** → **Web Service** → connecte le repo `enouga/palova`.
2. Réglages :
   - **Name** : `palova-api`
   - **Region** : même que la DB
   - **Branch** : `main`
   - **Root Directory** : `backend`
   - **Runtime** : Node
   - **Build Command** :
     ```
     npm install --include=dev && npx prisma generate && npx prisma migrate deploy && npm run build
     ```
   - **Start Command** : `npm run start`   *(= `node dist/app.js`)*
   - **Plan** : Free
3. **Environment** (onglet Environment) — ajoute :
   | Clé | Valeur |
   |---|---|
   | `DATABASE_URL` | *(Internal Database URL de l'étape 1)* |
   | `REDIS_URL` | *(Internal Key Value URL de l'étape 2)* |
   | `JWT_SECRET` | *(une longue chaîne aléatoire)* |
   | `FRONTEND_ROOT_DOMAIN` | `palova.fr` |
   | `FRONTEND_URL` | `https://palova.fr` |
   | `NODE_ENV` | `production` |
   *(Pas besoin de `PORT` : Render l'injecte, et `app.ts` lit `process.env.PORT`.)*
4. **Create Web Service**. Le build lance `prisma migrate deploy` → les tables sont créées automatiquement.
5. **Seed des données démo** (une fois) — depuis ta machine, en pointant la base externe :
   ```powershell
   cd backend
   $env:DATABASE_URL="<External Database URL>"; npm run db:seed
   ```
   *(ou via l'onglet **Shell** du service Render : `npm run db:seed`.)*
6. Vérifie : ouvre `https://palova-api.onrender.com/health` → `{"status":"ok"}`.

## Étape 4 — Service Frontend (Next.js)
1. Render → **New +** → **Web Service** → même repo.
2. Réglages :
   - **Name** : `palova-web`
   - **Root Directory** : `frontend`
   - **Build Command** : `npm install --include=dev && npm run build`
   - **Start Command** : `npx next start -p $PORT`
   - **Plan** : Free
3. **Environment** (⚠️ ces `NEXT_PUBLIC_*` sont **gelées au build** → bien les mettre AVANT le 1er build ; tout changement = re-déploiement) :
   | Clé | Valeur |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://api.palova.fr` |
   | `NEXT_PUBLIC_ROOT_DOMAIN` | `palova.fr` |
   | `NEXT_PUBLIC_COOKIE_DOMAIN` | `.palova.fr` |
   | `SITE_USER` | *(ton identifiant d'accès privé — PAS `NEXT_PUBLIC_`, reste secret côté serveur)* |
   | `SITE_PASS` | *(ton mot de passe d'accès privé)* |
   4. **Create Web Service**.

> 🔒 **Accès privé** : tant que `SITE_USER`/`SITE_PASS` sont posées, **toute visite** du site déclenche une pop-up login (cf. étape 0.c). Pour rouvrir au public : supprime ces 2 variables et redéploie. *(Ces variables ne sont PAS `NEXT_PUBLIC_` → elles ne sont jamais envoyées au navigateur.)*

> Astuce : si tu veux d'abord juste vérifier que ça boote **sans domaine**, mets temporairement `NEXT_PUBLIC_API_URL=https://palova-api.onrender.com` et ouvre `https://palova-web.onrender.com` (tu verras la **plateforme**, pas un club — le club a besoin d'un sous-domaine, cf. étape 5).

## Étape 5 — Domaines + DNS OVH
1. Sur **`palova-web`** → Settings → **Custom Domains** → ajoute :
   - `palova.fr` (apex, = plateforme)
   - `padel-arena-paris.palova.fr` (= club démo, slug seedé)
   Render affiche pour chacun **l'enregistrement DNS exact** (un **A** vers son IP pour l'apex, un **CNAME** vers `palova-web.onrender.com` pour le sous-domaine).
2. Sur **`palova-api`** → Custom Domains → ajoute `api.palova.fr` (CNAME vers `palova-api.onrender.com`).
3. Chez **OVH** (zone DNS de `palova.fr`) → crée exactement ce que Render affiche :
   | Type | Nom | Cible |
   |---|---|---|
   | A | `@` (apex) | *(IP fournie par Render)* |
   | CNAME | `api` | `palova-api.onrender.com.` |
   | CNAME | `padel-arena-paris` | `palova-web.onrender.com.` |
   | CNAME | `www` *(optionnel)* | `palova-web.onrender.com.` |
4. Attends la propagation (qq min à qq heures) + l'émission auto des certificats HTTPS par Render (statut « Issued » dans le dashboard).

## Étape 6 — Vérification finale
- `https://api.palova.fr/health` → `{"status":"ok"}`
- `https://palova.fr` → landing plateforme
- `https://padel-arena-paris.palova.fr` → **accueil du club**, avec le lien **« Tournois »** → liste avec les 2 tournois seedés
- Crée un compte / connecte-toi → la session vaut sur les deux (cookie `.palova.fr`)

---

## Annexe — Récap variables d'env
**Backend** : `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `FRONTEND_ROOT_DOMAIN=palova.fr`, `FRONTEND_URL=https://palova.fr`, `NODE_ENV=production`
**Frontend** : `NEXT_PUBLIC_API_URL=https://api.palova.fr`, `NEXT_PUBLIC_ROOT_DOMAIN=palova.fr`, `NEXT_PUBLIC_COOKIE_DOMAIN=.palova.fr`

## Annexe — Mises à jour futures
À chaque `git push` sur `main`, Render **redéploie automatiquement** les 2 services (et rejoue `prisma migrate deploy`). Rien à faire d'autre.

## Annexe — Limites & dépannage
- **Sommeil** : 1ʳᵉ visite après inactivité = ~30-60 s de réveil. Les tâches `node-cron` (libération des holds expirés) **ne tournent pas pendant le sommeil** ; elles reprennent au réveil. Sans incidence pour une démo.
- **Postgres free supprimé à 90 j** : Render prévient par email ; il faudra recréer une base (et re-seeder) ou passer en payant.
- **SSE temps réel** (mise à jour live des créneaux entre onglets) : à valider une fois en ligne. `EventSource` ne peut pas envoyer d'en-tête `Authorization` → si l'endpoint SSE l'exige en cross-origin, il faudra un petit ajustement (passer le token en query-param). **N'empêche pas** de réserver/annuler/s'inscrire ; seul l'update « live » est concerné.
- **Build qui casse sur `tsc`/`next`** : presque toujours l'oubli de `--include=dev` dans la Build Command (devDeps non installées).
- **`prisma migrate deploy` échoue** : vérifier que `DATABASE_URL` (interne) est bien posée sur le service backend.
- **Domaine « not verified »** : l'enregistrement OVH ne correspond pas exactement à ce que Render demande (souvent un point final manquant sur le CNAME, ou un A au lieu de CNAME).

## Annexe — Alternative « 1 clic » (optionnelle)
On peut remplacer les étapes 1-4 par un fichier **`render.yaml`** (Blueprint) à la racine du repo : Render lit ce fichier et crée les 2 services + la DB + le Redis d'un coup (« New + → Blueprint »). Plus rapide à rejouer, mais moins pédagogique pour une 1ʳᵉ fois. Je peux le générer si tu préfères cette voie.
