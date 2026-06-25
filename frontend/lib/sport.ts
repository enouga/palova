// Détection « le club propose-t-il le padel ? ». Les parties ouvertes (matchmaking)
// sont réservées au padel ; ce helper pilote l'onglet, la garde de page et la création.
export const PADEL_KEY = 'padel';

export const clubHasPadel = (club: { clubSports?: { sport: { key: string } }[] }): boolean =>
  club.clubSports?.some((cs) => cs.sport.key === PADEL_KEY) ?? false;
