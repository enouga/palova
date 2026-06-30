// Décide de l'affichage du badge sport selon le périmètre de la vue.
// - Surfaces mono-club : on compare au nombre de sports actifs du club.
// - Surfaces cross-club : on compare au nombre de sports distincts de l'ensemble affiché.

export function clubIsMultiSport(club: { clubSports?: { id: string }[] } | null | undefined): boolean {
  return (club?.clubSports?.length ?? 0) > 1;
}

export function setSpansMultipleSports(sportKeys: (string | null | undefined)[]): boolean {
  const distinct = new Set(sportKeys.filter((k): k is string => !!k));
  return distinct.size > 1;
}
