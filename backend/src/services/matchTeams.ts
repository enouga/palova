import type { Prisma } from '@prisma/client';

// Attribue un côté d'équipe (1 = gauche, 2 = droite) ET une place au sein de l'équipe
// (0 = G, 1 = D…) à CHAQUE participant d'un match padel.
// `team` explicite (1/2) est honoré tant que le côté n'est pas plein (maxPlayers/2) ;
// les `null` (et tout surplus) sont répartis dans l'ordre d'entrée (joinedAt) : côté 1 tant
// qu'il reste de la place, sinon côté 2. Une fois le côté résolu, `slot` explicite
// (0 ≤ slot < half) est honoré s'il est libre dans son équipe (premier arrivé — ordre du
// tableau — gagne en cas de collision) ; les non-assignés/invalides remplissent les places
// libres restantes dans l'ordre croissant, ordre d'entrée. Pur, déterministe, sans effet de bord.
export function effectiveTeams<T extends { team: number | null; slot?: number | null }>(
  participants: T[],
  maxPlayers: number,
): Array<T & { team: 1 | 2; slot: number }> {
  const half = Math.max(1, Math.floor(maxPlayers / 2));
  const count: Record<1 | 2, number> = { 1: 0, 2: 0 };
  const teamOut: Array<1 | 2 | undefined> = new Array(participants.length);

  // Passe 1 : team explicite qui tient dans son côté.
  participants.forEach((p, i) => {
    if ((p.team === 1 || p.team === 2) && count[p.team] < half) {
      count[p.team]++;
      teamOut[i] = p.team;
    }
  });
  // Passe 2 : remplissage des non-assignés, ordre d'entrée.
  participants.forEach((_p, i) => {
    if (teamOut[i]) return;
    const side: 1 | 2 = count[1] < half ? 1 : 2;
    count[side]++;
    teamOut[i] = side;
  });

  // Résolution des slots par équipe.
  const takenSlots: Record<1 | 2, Set<number>> = { 1: new Set(), 2: new Set() };
  const slotOut: Array<number | undefined> = new Array(participants.length);

  // Passe 1 : slot explicite valide et libre (premier arrivé — ordre du tableau — gagne).
  participants.forEach((p, i) => {
    const team = teamOut[i]!;
    const s = p.slot;
    if (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < half && !takenSlots[team].has(s)) {
      takenSlots[team].add(s);
      slotOut[i] = s;
    }
  });
  // Passe 2 : remplissage ascendant des non-assignés/invalides/en collision.
  participants.forEach((_p, i) => {
    if (slotOut[i] !== undefined) return;
    const team = teamOut[i]!;
    let s = 0;
    while (takenSlots[team].has(s)) s++;
    takenSlots[team].add(s);
    slotOut[i] = s;
  });

  return participants.map((p, i) => ({ ...p, team: teamOut[i]!, slot: slotOut[i]! }));
}

// Valide + persiste l'assignation complète d'équipes (et, optionnellement, de places G/D)
// d'un match. `teamsByUserId` DOIT couvrir tous les participants ; chaque côté ≤ maxPlayers/2 ;
// valeurs ∈ {1,2}. `slotsByUserId`, si fourni, DOIT lui aussi couvrir tous les participants,
// valeurs entières ∈ [0, half[ ; deux joueurs sur la même paire (équipe, slot) → TEAM_SLOT_TAKEN.
// Sans `slotsByUserId`, le slot existant n'est jamais touché (comportement inchangé).
// Transactionnel (tx fourni).
export async function applyTeams(
  tx: Prisma.TransactionClient,
  reservationId: string,
  teamsByUserId: Record<string, number>,
  maxPlayers: number,
  slotsByUserId?: Record<string, number>,
): Promise<void> {
  const parts = await tx.reservationParticipant.findMany({
    where: { reservationId },
    select: { id: true, userId: true },
  });
  const half = Math.max(1, Math.floor(maxPlayers / 2));
  const count: Record<number, number> = { 1: 0, 2: 0 };
  for (const p of parts) {
    const t = teamsByUserId[p.userId];
    if (t !== 1 && t !== 2) throw new Error('TEAM_INVALID');
    count[t]++;
    if (count[t] > half) throw new Error('TEAM_SIDE_FULL');
  }
  if (slotsByUserId) {
    const seenPairs = new Set<string>();
    for (const p of parts) {
      const s = slotsByUserId[p.userId];
      if (!Number.isInteger(s) || s < 0 || s >= half) throw new Error('TEAM_INVALID');
      const key = `${teamsByUserId[p.userId]}:${s}`;
      if (seenPairs.has(key)) throw new Error('TEAM_SLOT_TAKEN');
      seenPairs.add(key);
    }
  }
  for (const p of parts) {
    const data: { team: number; slot?: number } = { team: teamsByUserId[p.userId] };
    if (slotsByUserId) data.slot = slotsByUserId[p.userId];
    await tx.reservationParticipant.update({ where: { id: p.id }, data });
  }
}

export type OpenMatchGenderValue = 'WOMEN' | 'MIXED';
type Sx = 'MALE' | 'FEMALE' | null | undefined;

// Validation d'UN joueur qui rejoint une partie ouverte genrée.
// `sameSexOnTargetTeam` = nb de joueurs déjà présents du MÊME sexe, sur l'équipe visée
// (mixte seulement ; passer 0 pour WOMEN). Pur.
export function assertOpenMatchGender(
  matchGender: OpenMatchGenderValue | null,
  newSex: Sx,
  sameSexOnTargetTeam: number,
): void {
  if (matchGender == null) return;
  if (!newSex) throw new Error('SEX_REQUIRED');
  if (matchGender === 'WOMEN') {
    if (newSex !== 'FEMALE') throw new Error('GENDER_NOT_FEMALE');
    return;
  }
  // MIXED : au plus 1 joueur de chaque sexe par équipe.
  if (sameSexOnTargetTeam >= 1) throw new Error('GENDER_TEAM_FULL');
}

// Validation d'un ENSEMBLE de participants (avec leur équipe effective) contre un genre —
// à la création (applyHoldSetup) et à l'ouverture (setReservationVisibility). Toute
// violation (sexe manquant, sexe interdit, 2 mêmes sexes sur une équipe mixte) →
// GENDER_PARTICIPANTS_CONFLICT. Pur.
export function assertRosterGender(
  matchGender: OpenMatchGenderValue | null,
  roster: Array<{ sex: Sx; team: 1 | 2 }>,
): void {
  if (matchGender == null) return;
  for (const p of roster) {
    if (!p.sex) throw new Error('GENDER_PARTICIPANTS_CONFLICT');
    if (matchGender === 'WOMEN' && p.sex !== 'FEMALE') throw new Error('GENDER_PARTICIPANTS_CONFLICT');
  }
  if (matchGender === 'MIXED') {
    for (const team of [1, 2] as const) {
      const side = roster.filter((p) => p.team === team);
      const males = side.filter((p) => p.sex === 'MALE').length;
      const females = side.filter((p) => p.sex === 'FEMALE').length;
      if (males > 1 || females > 1) throw new Error('GENDER_PARTICIPANTS_CONFLICT');
    }
  }
}
