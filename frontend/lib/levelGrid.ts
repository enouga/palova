// Grille complète des 8 niveaux de padel 2026 (référentiel commun publié par Padel
// Magazine / Padel Speak / FFT). Deux volets par niveau : critères de jeu
// (technique/tactique) + équivalence compétition. Texte reformulé.

export interface LevelGridRow {
  level: number;   // 1–8
  name: string;
  play: string;    // critères de jeu (technique, vitres, déplacements, tactique)
  comp: string;    // équivalence compétition (classements, catégories, points) — '' si aucune
}

export const LEVEL_GRID: LevelGridRow[] = [
  {
    level: 1, name: 'Débutant',
    play: "Premiers pas : j'apprends les coups de base et je frappe surtout à plat, sans exploiter les vitres. Les échanges dépassent rarement 3 frappes, le service reste incertain et on joue surtout au fond du court.",
    comp: '',
  },
  {
    level: 2, name: 'Perfectionnement',
    play: "Maîtrise progressive des coups fondamentaux. Échanges lents et brefs, premières volées, je commence à me repérer et à me déplacer sur le court.",
    comp: '',
  },
  {
    level: 3, name: 'Élémentaire',
    play: "Pratique en loisir : service maîtrisé et échanges réguliers. Je commence à utiliser la vitre de fond pour défendre et garder la balle en jeu.",
    comp: '',
  },
  {
    level: 4, name: 'Intermédiaire',
    play: "Longs échanges et montées-descentes répétées au filet. Je monte au filet après le service ou un lob, je remonte en contre-attaque et je me place en coordination avec mon partenaire ; le lob défensif et la vitre latérale font partie de mon jeu.",
    comp: 'Premiers matches gagnés en P50 et P100 (classement en fin de tableau). Moyenne de 5 à 25 points par tournoi.',
  },
  {
    level: 5, name: 'Confirmé',
    play: "Service-volée, replis sur lob, remontées offensives et coups à effet. Finitions à la volée et au smash, utilisation des vitres en défense, jeu sur 360° et doubles vitres.",
    comp: 'Femmes top 1500 (jusqu’à ~900e), hommes top 10000 (jusqu’à ~6000e). P100 milieu de tableau (≥ 50 % de victoires), P250 fin de tableau. Moyenne 25 à 50 points/tournoi.',
  },
  {
    level: 6, name: 'Avancé',
    play: "Jeu rapide et effets maîtrisés, volées variées, défense des doubles vitres, parfaite maîtrise du 360° et contre-attaques sur les smashs adverses.",
    comp: 'Femmes top 900 (jusqu’à ~450e), hommes top 6000 (jusqu’à ~3000e). P100 tête de série, P250 milieu de tableau (~50 % de victoires), P500 fin de tableau. Moyenne 50+ points/tournoi.',
  },
  {
    level: 7, name: 'Expert',
    play: "Maîtrise complète du jeu et de la tactique. Effets appuyés (lift, slice, vibora) et domination des doubles vitres avec contre-attaques.",
    comp: 'Femmes top 450 (jusqu’à ~150e), hommes top 3000 (jusqu’à ~1000e). P250 première partie de tableau (parfois tête de série), P500 milieu/fin de tableau. Moyenne 100+ points/tournoi.',
  },
  {
    level: 8, name: 'Élite',
    play: "Expertise maximale dans tous les domaines du jeu.",
    comp: 'Femmes top 100, hommes top 1000. Habitué·e des P1000, P1500 et P2000.',
  },
];
