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

/** Résout des clés sport en noms affichables via les sports actifs du club — repli sur la clé
 *  brute si introuvable (sport désactivé entre-temps, catalogue non chargé, etc.). */
export function sportNames(
  club: { clubSports?: { sport: { key: string; name: string } }[] } | null | undefined,
  keys: string[],
): string[] {
  return keys.map((k) => club?.clubSports?.find((cs) => cs.sport.key === k)?.sport.name ?? k);
}

/** Tag sport à afficher pour un élément (offre/solde), ou `null` si non pertinent
 *  (club mono-sport, ou élément non tagué). Centralise le garde `clubIsMultiSport` +
 *  la résolution des noms, répété dans ProfileMenu/WalletSection/OffersShowcase. */
export function sportTag(
  club: { clubSports?: { id: string; sport: { key: string; name: string } }[] } | null | undefined,
  keys: string[],
): string | null {
  if (!clubIsMultiSport(club) || keys.length === 0) return null;
  return sportNames(club, keys).join(', ');
}
