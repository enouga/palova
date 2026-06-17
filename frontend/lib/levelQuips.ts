// Vannes par palier (1–8), clin d'œil humoristique à la grille de niveaux padel
// (esprit Padel Magazine). Plusieurs propositions par palier : on en tire une au
// hasard quand on déplace le curseur de fourchette d'une partie ouverte.
// L'ordre suit LEVEL_TIERS de lib/level.ts (index 0 = niveau 1 Débutant … index 7 = niveau 8 Élite).

export const LEVEL_QUIPS: string[][] = [
  [ // 1 · Débutant
    "Tu confonds encore la vitre et le grillage… et le grillage gagne toujours.",
    "Ta meilleure arme : l'enthousiasme. La deuxième : l'excuse.",
    "Tu tiens la raquette comme une poêle, mais tu y crois fort.",
    "Le filet est ton ami, le grillage ton pire ennemi.",
    "Tu cours partout, surtout dans le mauvais sens.",
    "Un service dans le carré = petite victoire intérieure.",
    "Tu apprends les coups de base… et un nouveau juron par match.",
  ],
  [ // 2 · Perfectionnement
    "Tu volleyes une fois sur trois, mais quelle fois !",
    "Tu commences à viser. Juste ? Pas toujours. Mais à viser.",
    "La vitre de fond te fait peur. C'est réciproque.",
    "Tu connais les règles. Les appliquer, c'est une autre aventure.",
    "Échange de 4 frappes : tu appelles déjà ça un marathon.",
    "Tu places la balle là où personne ne l'attendait. Toi non plus.",
  ],
  [ // 3 · Élémentaire
    "Tu gardes la balle en jeu : la patience devient une arme.",
    "La vitre de fond et toi : le début d'une belle amitié.",
    "Tu joues en loisir, mais tu parles déjà tactique au bar.",
    "Tu lobes… parfois jusqu'au court d'à côté.",
    "Tu sais où te placer. T'y placer à temps, on y travaille.",
    "Tu as compris que reculer, c'est parfois avancer.",
  ],
  [ // 4 · Intermédiaire
    "Longs échanges : tu transpires, mais avec style.",
    "Tu montes au filet sans te faire lober… enfin, presque.",
    "Tu défends après le lob comme un mur. Le bon mur, cette fois.",
    "Tu places ton partenaire. Ou tu le places en danger, ça dépend des jours.",
    "Tu commences à anticiper. Le smash adverse aussi.",
    "Tu négocies la vitre comme un agent immobilier aguerri.",
  ],
  [ // 5 · Confirmé
    "Service-volée enchaîné sans réfléchir. Ou presque.",
    "Tu mets des effets… et parfois ils partent dans le bon sens.",
    "Repli sur lob : tu recules avec l'élégance d'un crabe entraîné.",
    "Contre-attaque enclenchée : l'adversaire commence à transpirer.",
    "Tu lis le jeu de ton partenaire. Lui aussi essaie de te lire.",
    "Tu places la balle ET l'intention. Dangereux.",
  ],
  [ // 6 · Avancé
    "Double vitre maîtrisée : tu défies les lois de la physique.",
    "Tu contres les smashs comme une formalité administrative.",
    "Jeu rapide, effets vicieux : officiellement pénible à jouer.",
    "Tu transformes la défense en attaque en un clin d'œil.",
    "Les murs t'obéissent. Bientôt ce sera le tour de tes adversaires.",
    "Tu joues vite, tu réfléchis vite, tu chambres vite.",
  ],
  [ // 7 · Expert
    "Bandeja, vibora, chiquita : ton menu du jour.",
    "Tu contre-attaques les smashs en sifflotant.",
    "Ta tactique est si fine que tes adversaires se croient piégés. Ils le sont.",
    "Coups appuyés : tu signes des points comme des autographes.",
    "Tu lis le jeu deux coups à l'avance. Les échecs version padel.",
    "Tu sors des bandejas que Padel Magazine voudrait filmer.",
  ],
  [ // 8 · Élite
    "Niveau P1000/P2000 : on parle de toi dans les vestiaires.",
    "Tes viboras finissent en posters.",
    "Tu joues si bien que tes adversaires demandent un autographe après la correction.",
    "Compétition nationale : ton échauffement, c'est déjà notre plafond.",
    "Tu n'as plus d'adversaires, juste des victimes consentantes.",
    "Padel Magazine met à jour sa grille rien que pour toi.",
  ],
];

/**
 * Phrase pour un niveau 1–8, choisie via `rand` ∈ [0,1[ (pur → testable).
 * `exclude` : évite de retomber sur la même phrase (si le palier en a plusieurs).
 */
export function pickQuip(level: number, rand: number, exclude?: string): string {
  const idx = Math.max(1, Math.min(8, Math.round(level))) - 1;
  const pool = LEVEL_QUIPS[idx];
  const choices = exclude && pool.length > 1 ? pool.filter((q) => q !== exclude) : pool;
  return choices[Math.min(choices.length - 1, Math.floor(rand * choices.length))];
}

/** Tirage aléatoire (côté client). */
export function randomQuip(level: number, exclude?: string): string {
  return pickQuip(level, Math.random(), exclude);
}
