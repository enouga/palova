# Photos de couverture par défaut

Banque de photos utilisées comme couverture par défaut d'un club (cartes de l'annuaire
`/clubs`) tant qu'il n'a pas importé sa propre photo. Une photo est attribuée de façon
déterministe à chaque club (hash du slug) — voir `frontend/lib/clubCover.ts` (`coverPhoto`).

**Source :** [Pexels](https://www.pexels.com) — **Licence Pexels** : usage libre, y compris
commercial, **sans attribution requise** ni inscription. <https://www.pexels.com/license/>

| Fichier | ID Pexels | Page |
|---------|-----------|------|
| court-1.jpg | 38155778 | https://www.pexels.com/photo/38155778/ |
| court-2.jpg | 32474981 | https://www.pexels.com/photo/32474981/ |
| court-3.jpg | 6010282  | https://www.pexels.com/photo/6010282/ |
| court-4.jpg | 6010279  | https://www.pexels.com/photo/6010279/ |
| court-5.jpg | 30894524 | https://www.pexels.com/photo/30894524/ |
| court-6.jpg | 30617588 | https://www.pexels.com/photo/30617588/ |
| court-7.jpg | 27151849 | https://www.pexels.com/photo/27151849/ |
| court-8.jpg | 12029162 | https://www.pexels.com/photo/12029162/ |

Pour remplacer/ajouter des photos : déposer des JPEG ~1200×600 ici et mettre à jour la
liste `COVER_PHOTOS` dans `frontend/lib/clubCover.ts`.
