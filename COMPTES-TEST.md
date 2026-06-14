# Comptes de test — Palova (données de démo)

> Générés par `backend/prisma/seed-demo.ts`. Pour (re)créer/rafraîchir ces données :
> ```bash
> # 1. Docker (PostgreSQL + Redis) doit tourner
> "C:\Program Files\Docker\Docker\resources\bin\docker-compose-v1.exe" up -d
> # 2. depuis backend/
> npm run db:seed:demo
> ```
> Le seed est **idempotent** (upsert) : il n'efface rien, il ajoute/met à jour.

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

### Joueurs multi-clubs

Email : `<prenom>.<nom>@multi.demo.fr`

| Joueur | Clubs |
|---|---|
| `karim.benali@multi.demo.fr` | Paris, Lyon, Marseille |
| `sofia.rossi@multi.demo.fr` | Paris, Bordeaux |
| `yanis.lopez@multi.demo.fr` | Lyon, Marseille, Toulouse |
| `camille.faure@multi.demo.fr` | Paris, Marseille, Toulouse |
| `hugo.marchand@multi.demo.fr` | Bordeaux, Toulouse |
