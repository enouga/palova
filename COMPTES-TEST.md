# Comptes de test — Palova (données de démo)

> Générés par les seeds `backend/prisma/seed-*.ts`. Pour (re)créer/rafraîchir **tout** le jeu de démo :
> ```bash
> # 1. Docker (PostgreSQL + Redis) doit tourner
> "C:\Program Files\Docker\Docker\resources\bin\docker-compose-v1.exe" up -d
> # 2. depuis backend/, dans l'ordre :
> npm run db:seed:demo          # clubs + membres + tournois
> npm run db:seed:events        # events / animations
> npm run db:seed:open-matches  # parties ouvertes (résas PUBLIC rejoignables)
> ```
> Seeds **rejouables** : clubs/membres en upsert (rien d'effacé), tandis que tournois,
> events et parties ouvertes sont supprimés-recréés par club à chaque exécution (les parties
> ouvertes via le marqueur `notes='seed:open-match'`, donc les tiennes faites à la main sont préservées).

**Mot de passe commun à tous les comptes : `password123`**

---

## Comptes « profils » à connaître (club Padel Arena Paris)

Accès club : `padel-arena-paris.localhost:3000` (sauf le super-admin, sur l'hôte plateforme).

| Profil | Email | Pour tester |
|---|---|---|
| Super-admin plateforme | `super@palova.fr` | hôte plateforme → `/superadmin` (stats, gestion des clubs) |
| Gérant (OWNER) | `owner@padel-arena-paris.fr` | back-office `/admin`, tous les droits |
| Admin club (ADMIN) | `admin@padel-arena-paris.fr` | back-office `/admin` |
| Staff club (STAFF) | `staff@padel-arena-paris.fr` | back-office `/admin`, droits réduits |
| Membre **abonné** (ACTIVE) | `abonne@padel-arena-paris.fr` | fenêtre de réservation élargie (n° licence PAR2001) |
| Membre standard (ACTIVE) | `membre@padel-arena-paris.fr` | joueur non abonné (PAR2002) |
| Membre **bloqué** (BLOCKED) | `bloque@padel-arena-paris.fr` | réservation / inscriptions refusées (PAR2003) |
| Joueur multi-clubs | `karim.benali@multi.demo.fr` | membre de 3 clubs à la fois |

---

## Membres générés en masse

**100 membres par club** (50 hommes + 50 femmes), adhésion ACTIVE, téléphone + n° de licence, ~1/3 abonnés.

- Email : `<prenom>.<nom>.<index>@<ville>.demo.fr`
  - ex. `lucas.martin.0@paris.demo.fr`, `emma.bernard.0@paris.demo.fr`
- N° de licence : `<VILLE>10xx` (ex. `PAR1000` → `PAR1049`)
- Index de 0 à 49 par genre.

### Les 5 clubs

| Club | Sous-domaine (dev) | Gérant |
|---|---|---|
| Padel Arena Paris | `padel-arena-paris.localhost:3000` | `owner@padel-arena-paris.fr` |
| Lyon Padel Club | `lyon-padel-club.localhost:3000` | `owner@lyon-padel-club.fr` |
| Marseille Padel | `marseille-padel.localhost:3000` | `owner@marseille-padel.fr` |
| Bordeaux Pala | `bordeaux-pala.localhost:3000` | `owner@bordeaux-pala.fr` |
| Toulouse Padel Indoor | `toulouse-padel-indoor.localhost:3000` | `owner@toulouse-padel-indoor.fr` |

> Le préfixe de la ville dans les emails membres : `paris`, `lyon`, `marseille`, `bordeaux`, `toulouse`.
> Préfixe licence (3 lettres) : `PAR`, `LYO`, `MAR`, `BOR`, `TOU`.

### Contenu de démo (par club)

Chaque club est rempli pour exercer toutes les surfaces de l'app :

| Contenu | Par club | Variété couverte |
|---|---|---|
| **Tournois** | 6 | Messieurs / Dames / Mixte, complets + liste d'attente, partiels, **passé**, **brouillon** |
| **Events / animations** | 8 | Mêlée, stage, soirée, initiation ; complet + attente, ouvert aux non-membres, sans capacité, **passé**, **brouillon**, **annulé** |
| **Parties ouvertes** | 6 | Terrain double (3 / 2 / 1 place libre + **complète**) et single (1 place), **avec et sans fourchette de niveau** cible |

> Les parties ouvertes sont visibles sur `/parties` (connecté comme **membre** du club). Pour en
> rejoindre une, prends un membre qui n'y est pas encore — ex. `abonne@padel-arena-paris.fr` sur Paris.

### Joueurs multi-clubs

Email : `<prenom>.<nom>@multi.demo.fr`

| Joueur | Clubs |
|---|---|
| `karim.benali@multi.demo.fr` | Paris, Lyon, Marseille |
| `sofia.rossi@multi.demo.fr` | Paris, Bordeaux |
| `yanis.lopez@multi.demo.fr` | Lyon, Marseille, Toulouse |
| `camille.faure@multi.demo.fr` | Paris, Marseille, Toulouse |
| `hugo.marchand@multi.demo.fr` | Bordeaux, Toulouse |



Pour le contrôle visuel (1 min, si tu veux)

  Comptes (mot de passe password123), URLs *.localhost:3000 :
  - Réglage : connecte owner@bordeaux-pala.fr → bordeaux-pala.localhost:3000/admin/settings → carte « Page Mes réservations » (case décochée par défaut).
  - Effet joueur : avec un compte membre de 2 clubs, fais une réservation dans chacun, puis ouvre Mes réservations sur un sous-domaine club → par défaut tu ne vois
  que ce club ; coche la case côté admin → l'autre club apparaît, et cliquer dessus ouvre son app.

  Problème : quand j'ai renommé la migration 20260615120000_add_club_show_other_clubs_reservations → 20260615140000_…, la base de dev avait déjà l'ancienne référence
  enregistrée dans _prisma_migrations. Résultat : divergence → les nouvelles migrations (reçus, remboursement auto) ne peuvent pas s'appliquer → le planning plante  car le backend cherche la colonne receipt_no qui n'existe pas encore.
  Action : npx prisma migrate reset --force sur la base de dev locale (localhost:5432, conteneur Docker). Ça va :
  1. Supprimer toutes les données de la base locale (irréversible)
  2. Réappliquer toutes les migrations dans l'ordre
  3. La base sera vide — il faudra relancer npm run db:seed



  Il reste 2 choses avant un éventuel déploiement (rien d'urgent) :
  1. Pousser : git push origin main (quand tu valides)  2. Variables d'env Stripe à poser en prod : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY