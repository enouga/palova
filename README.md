# PadelConnect / SlotPadel

Application de réservation de terrains de padel : **réservation sans double-booking** et **disponibilités en temps réel**.

Monorepo découplé : une **API Express** (`backend/`) et un **frontend Next.js** (`frontend/`), avec **PostgreSQL** et **Redis** via Docker.

> 📄 Stack technique détaillée → [`STACK.md`](./STACK.md) · API et endpoints → [`backend/README.md`](./backend/README.md)

---

## Prérequis

- **Node.js 20+**
- **Docker** (pour PostgreSQL + Redis)
  > ⚠️ Docker Desktop 20.10.23 n'a pas le plugin `compose`. Utiliser `docker-compose-v1.exe` (voir ci-dessous), jamais `docker compose`.

---

## Démarrage rapide

Trois terminaux (ou trois étapes successives).

### 1. Bases de données (PostgreSQL + Redis)

```bash
"C:\Program Files\Docker\Docker\resources\bin\docker-compose-v1.exe" up -d
```

Vérifier : `docker ps` → `padelconnect_postgres_1` et `padelconnect_redis_1` en `(healthy)`.

### 2. Backend (API — port 3001)

```bash
cd backend
npm install
npm run db:migrate     # crée les tables (première fois)
npm run db:seed        # données de démo (club, terrains, utilisateur)
npm run dev
```

### 3. Frontend (web — port 3000)

```bash
cd frontend
npm install
npm run dev
```

➡️ Ouvrir **http://localhost:3000**

---

## URLs & ports

| Service | URL / Port | Notes |
|---------|-----------|-------|
| Frontend | http://localhost:3000 | Next.js |
| API backend | http://localhost:3001 | Express — `GET /health` → `{"status":"ok"}` |
| PostgreSQL | `localhost:5432` | base `padelconnect` |
| Redis | `localhost:6379` | verrous de réservation |
| Prisma Studio | port affiché au lancement | `npx prisma studio` (depuis `backend/`) — ou `--port 5555` pour le fixer |

---

## Comptes de démo (après `npm run db:seed`)

Mot de passe commun : **`password123`**. Tous rattachés au club de démo *Padel Arena Paris*.

| Rôle | Email | Type |
|------|-------|------|
| **Owner** (propriétaire) | `owner@slotpadel.fr` | membre du club |
| **Admin** (gestionnaire) | `admin@slotpadel.fr` | membre du club |
| **Staff** (équipe) | `staff@slotpadel.fr` | membre du club |
| **Joueur** (client) | `joueur@slotpadel.fr` | compte simple, aucun club |
| Owner (compte historique) | `test@padelconnect.fr` | membre du club |

> Les rôles club sont portés par `ClubMember` (`OWNER` > `ADMIN` > `STAFF`). Un compte sans rattachement à un club est un **joueur**.

## Pages par rôle

| Page | URL | Visiteur | Joueur | Staff / Admin / Owner |
|------|-----|:--------:|:------:|:---------------------:|
| Accueil (landing) | `/` | ✅ | ✅ | ✅ |
| Connexion | `/login` | ✅ | ✅ | ✅ |
| Liste des terrains | `/courts` | ✅ (lecture) | ✅ | ✅ |
| Réserver un créneau | `/courts/[id]` | → login | ✅ (hold + confirmer) | ✅ |
| Back-office — tableau de bord | `/admin` | ❌ | ❌ → `/courts` | ✅ |
| Back-office — ressources/terrains | `/admin/courts` | ❌ | ❌ | ✅ |
| Back-office — planning & réservations | `/admin/reservations` | ❌ | ❌ | ✅ |

**Comportement** : à la connexion, un membre d'un club est redirigé vers `/admin` ; un joueur vers `/courts`. L'accès au back-office est protégé côté serveur (`requireClubMember`) et côté UX (garde de route dans `app/admin/layout.tsx`).

**Déconnexion** : bouton dédié dans l'en-tête du back-office (`/admin`) et sur la liste des terrains (`/courts`). Il efface la session locale (`token`, `clubId`) et renvoie vers `/login`.

> ℹ️ Lot 1 : tout membre du club (y compris **Staff**) a accès au back-office complet. Les **permissions fines par rôle** (ex. Staff en lecture seule sur le branding/les tarifs) arriveront au **Lot 2**.

---

## Accéder aux données

### PostgreSQL

| Paramètre | Valeur |
|-----------|--------|
| Hôte / Port | `localhost` / `5432` |
| Base | `padelconnect` |
| Utilisateur | `padeluser` |
| Mot de passe | `padelpass` |
| URL | `postgresql://padeluser:padelpass@localhost:5432/padelconnect` |

**Interface graphique (recommandé)** — depuis `backend/` :
```bash
npx prisma studio                 # le port est affiché au lancement (ex. http://localhost:51212)
npx prisma studio --port 5555     # pour fixer le port à 5555
```

**En ligne de commande** (psql est dans le conteneur Docker) :
```bash
docker exec -it padelconnect_postgres_1 psql -U padeluser -d padelconnect
# \dt  lister les tables · \d courts  décrire · \q  quitter
```

**Client graphique externe** : DBeaver / TablePlus / pgAdmin avec les paramètres ci-dessus.

### Redis

```bash
docker exec -it padelconnect_redis_1 redis-cli
# KEYS lock:*   voir les verrous de réservation actifs
```

---

## Commandes utiles

### Backend (`cd backend`)
```bash
npm run dev          # serveur de dev (nodemon)
npm run build        # compile TypeScript → dist/
npm start            # lance la version compilée (prod)
npm test             # tests Jest
npm run db:migrate   # migrations Prisma
npm run db:seed      # données de démo
npx prisma studio    # explorer la base
```

### Frontend (`cd frontend`)
```bash
npm run dev          # serveur de dev (port 3000)
npm run build        # build de production
npm start            # lance le build
npm test             # tests React Testing Library
npm run lint         # ESLint
```

---

## Structure du projet

```
padelconnect/
├── docker-compose.yml      PostgreSQL 16 + Redis 7
├── README.md               ce fichier
├── STACK.md                stack technique complète + hébergement
├── CLAUDE.md               instructions projet (assistant)
├── backend/                API Express 5 + Prisma 7 + Redis (port 3001)
│   ├── README.md           doc de l'API (endpoints, auth, logique métier)
│   ├── prisma/             schéma + seed
│   └── src/                routes, services, middlewares, jobs
└── frontend/               Next.js 16 + React 19 + Tailwind 4 (port 3000)
    ├── app/                pages (App Router)
    ├── components/ui/      design system SlotPadel
    ├── lib/                thème, API client, hooks
    └── design/             maquette source (prototype, hors build)
```

---

## Déploiement

Voir la section **Hébergement** de [`STACK.md`](./STACK.md). En résumé : un serveur Node **persistant** est requis (SSE temps réel + cron) — **Railway** ou **Render** pour tout, ou **Vercel** (frontend) + **Railway/Render** (backend + PostgreSQL + Redis).
