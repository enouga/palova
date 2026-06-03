# Palova / Palova — Stack technique complet

Application de réservation de terrains de padel : **zéro double-réservation** + **temps réel**.
Architecture découplée : un frontend Next.js et une API Express, plus PostgreSQL et Redis.

```
┌──────────────────┐      HTTPS / SSE      ┌──────────────────┐
│   Frontend        │ ───────────────────▶ │   Backend API     │
│   Next.js 16      │                       │   Express 5       │
│   React 19        │ ◀─────────────────── │   TypeScript      │
│   (port 3000)     │     JSON / events     │   (port 3001)     │
└──────────────────┘                       └────────┬─────────┘
                                                     │
                                  ┌──────────────────┼──────────────────┐
                                  ▼                                      ▼
                         ┌────────────────┐                    ┌────────────────┐
                         │  PostgreSQL 16  │                    │   Redis 7       │
                         │  (port 5432)    │                    │   (port 6379)   │
                         │  données métier │                    │  verrous 10 min │
                         └────────────────┘                    └────────────────┘
```

---

## 1. Backend — API REST (`backend/`)

Serveur Node.js / Express en TypeScript. Port **3001**.

| Domaine | Technologie | Version | Rôle |
|---------|-------------|---------|------|
| Runtime | Node.js | 20+ | Exécution |
| Langage | TypeScript | ^6.0 | Typage statique |
| Framework HTTP | Express | ^5.2 | Routing, middlewares |
| ORM | Prisma | ^7.8 | Schéma, requêtes, migrations |
| Driver adapter | @prisma/adapter-pg | ^7.8 | **Obligatoire en Prisma 7** (PrismaPg) |
| Driver PostgreSQL | pg | ^8.21 | Connexion bas niveau |
| Cache / verrous | ioredis | ^5.11 | Verrou de réservation (SET NX EX) |
| Auth | jsonwebtoken | ^9.0 | Tokens JWT (7 j) |
| Hash mots de passe | bcrypt | ^6.0 | Stockage sécurisé |
| Tâches planifiées | node-cron | ^4.2 | Nettoyage des holds expirés (1×/min) |
| CORS | cors | ^2.8 | Autorisation du frontend |
| Config | dotenv | ^17.4 | Variables d'environnement |

**Tests** : Jest 30 + ts-jest + supertest (Prisma & Redis mockés).
**Dev** : nodemon + ts-node.

### Modèle de données (PostgreSQL via Prisma)
`Club` ─< `Court` ─< `Reservation` >─ `User`. Colonnes temporelles en `TIMESTAMPTZ`.
Enums : `Role` (CLIENT / CLUB_ADMIN), `ReservationStatus` (PENDING / CONFIRMED / CANCELLED).

### Logique critique
- **Anti double-réservation à 2 niveaux** : verrou Redis `SET NX` (10 min) au *hold*, puis transaction PostgreSQL **Serializable + SELECT FOR UPDATE** à la confirmation.
- **Temps réel** : Server-Sent Events (SSE) — `slot_held` / `slot_confirmed` / `slot_released`.
- **Job cron** in-process : annule les `PENDING` expirés chaque minute.

---

## 2. Frontend — Application web (`frontend/`)

App Next.js (App Router) en TypeScript. Port **3000**.

| Domaine | Technologie | Version | Rôle |
|---------|-------------|---------|------|
| Framework | Next.js | 16.2.6 | App Router, RSC, Turbopack |
| UI | React | 19.2.4 | Composants |
| Langage | TypeScript | ^5 | Typage |
| Styles | Tailwind CSS | ^4 | Utilitaires (+ inline styles thémés) |
| PostCSS | @tailwindcss/postcss | ^4 | Build CSS |
| Polices | next/font (Google) | — | Cormorant Garamond, Hanken Grotesk, JetBrains Mono |
| PWA | next-pwa | ^5.6 | **Installé mais désactivé** (incompatible Turbopack) |
| Temps réel | EventSource (SSE natif) | — | Flux de disponibilités |

**Tests** : Jest 30 + React Testing Library.
**Lint** : ESLint 9 + eslint-config-next.

### Design system « Palova » (`frontend/lib`, `frontend/components/ui`)
- **2 thèmes** : `floodlit` (sombre, défaut) et `daylight` (clair), bascule persistée (localStorage).
- Accent lime `#d6ff3f`. Système porté depuis la maquette `frontend/design/` (prototype React autonome, hors build).
- `lib/theme.ts`, `lib/ThemeProvider.tsx`, `components/ui/{Icon,atoms,Screen}.tsx`.

### Notes Next.js 16 (breaking changes)
- **Turbopack** = bundler par défaut.
- `params` des pages serveur = `Promise` → `await params`.
- `middleware.ts` renommé `proxy.ts`.
- `next lint` supprimé → ESLint direct.

---

## 3. Infrastructure locale

| Service | Image | Port | Données |
|---------|-------|------|---------|
| PostgreSQL | `postgres:16` | 5432 | palova / palovauser / palovapass |
| Redis | `redis:7` | 6379 | verrous éphémères |

Orchestration : `docker-compose.yml`.
> ⚠ Docker Desktop 20.10.23 n'a pas le plugin `compose` → utiliser `docker-compose-v1.exe`.

---

## 4. Variables d'environnement

**Backend** (`backend/.env`)
| Variable | Rôle |
|----------|------|
| `DATABASE_URL` | Connexion PostgreSQL |
| `REDIS_HOST` / `REDIS_PORT` | Connexion Redis |
| `JWT_SECRET` | Signature des tokens (**obligatoire**) |
| `PORT` | Port API (défaut 3001) |
| `FRONTEND_URL` | Origine autorisée CORS |
| `NODE_ENV` | `development` / `production` |

**Frontend** (`frontend/.env.local`)
| Variable | Rôle |
|----------|------|
| `NEXT_PUBLIC_API_URL` | URL publique de l'API backend |

---

## 5. Contrôle de version
- Git, branche `main`, remote GitHub : `https://github.com/enouga/padelslot`
- `.env` et secrets ignorés (`.gitignore`).

---

## 6. Hébergement — recommandations

### Contraintes à respecter (elles orientent le choix)
1. **SSE (temps réel)** = connexions HTTP longue durée → il faut un **serveur Node persistant**, pas du serverless pur (les fonctions serverless coupent les connexions / bufferisent). ❌ API backend sur Vercel/Lambda.
2. **Redis** indispensable (verrous de réservation) → Redis managé requis.
3. **Cron in-process** (`node-cron`) → le backend ne doit **pas** scale-to-zero, sinon le nettoyage ne tourne pas. (Alternative : déporter le cron sur un scheduler de la plateforme.)
4. **PostgreSQL** managé → n'importe lequel (Prisma 7 + adapter-pg compatible).

### Option recommandée — Split « best-of-breed »
| Composant | Plateforme | Pourquoi |
|-----------|-----------|----------|
| Frontend Next.js | **Vercel** | Hébergeur de référence pour Next.js (build, CDN, preview). Le frontend n'a pas de SSE serveur, donc serverless OK. |
| Backend Express + cron | **Railway** ou **Render** (Web Service persistant) | Serveur Node always-on : SSE + cron OK. |
| PostgreSQL | **Neon** ou la base managée de Railway/Render | Postgres managé, branches, backups. |
| Redis | **Upstash** ou le Redis de Railway/Render | Redis managé (ioredis compatible, TLS). |

### Option la plus simple — Tout chez un seul PaaS
- **Railway** : un seul projet = frontend + backend + PostgreSQL + Redis. Excellente DX, services persistants (SSE + cron OK), variables partagées. **Le plus rapide pour démarrer.**
- **Render** : équivalent (Web Services + Managed Postgres + Key Value/Redis + Background Workers). Bon plan gratuit pour tester.

### Option « conteneurs / contrôle » (tu as déjà un Docker)
- **Fly.io** : déploie tes conteneurs près des utilisateurs, Postgres + Redis dispo. Plus de contrôle, un peu plus d'ops.
- **VPS** (Hetzner, DigitalOcean, Scaleway) : `docker-compose up` sur une machine. Le moins cher à l'échelle, mais tu gères tout (TLS, reverse-proxy, mises à jour, sauvegardes).

### Recommandation finale
- **Pour aller vite / projet en cours** : **Railway** pour les 4 composants (ou Render). Zéro friction.
- **Pour la prod sérieuse** : **Vercel (front) + Railway/Render (back + Postgres + Redis)**, ou **Fly.io** si tu veux maîtriser les conteneurs.

### Checklist avant de déployer
- [ ] Générer un vrai `JWT_SECRET` (long, aléatoire) en prod.
- [ ] `FRONTEND_URL` = domaine du frontend déployé (CORS).
- [ ] `NEXT_PUBLIC_API_URL` = URL publique de l'API.
- [ ] Lancer les migrations Prisma au déploiement (`prisma migrate deploy`).
- [ ] Build backend : `npm run build` puis `npm start` (pas `ts-node` en prod).
- [ ] Redis en TLS si Upstash (adapter l'URL/options ioredis).
- [ ] Vérifier que le service backend **ne scale pas à zéro** (pour le cron) — sinon déporter le nettoyage.
- [ ] Remplacer le `UTC_OFFSET=2` codé en dur par `club.timezone` avant d'ouvrir à d'autres fuseaux.
```
