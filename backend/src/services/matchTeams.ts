import type { Prisma } from '@prisma/client';

// Attribue un côté d'équipe (1 = gauche, 2 = droite) à CHAQUE participant d'un match padel.
// `team` explicite (1/2) est honoré tant que le côté n'est pas plein (maxPlayers/2) ;
// les `null` (et tout surplus) sont répartis dans l'ordre d'entrée (joinedAt) : côté 1 tant
// qu'il reste de la place, sinon côté 2. Pur, déterministe, sans effet de bord.
export function effectiveTeams<T extends { team: number | null }>(
  participants: T[],
  maxPlayers: number,
): Array<T & { team: 1 | 2 }> {
  const half = Math.max(1, Math.floor(maxPlayers / 2));
  const count: Record<1 | 2, number> = { 1: 0, 2: 0 };
  const out: Array<1 | 2 | undefined> = new Array(participants.length);

  // Passe 1 : team explicite qui tient dans son côté.
  participants.forEach((p, i) => {
    if ((p.team === 1 || p.team === 2) && count[p.team] < half) {
      count[p.team]++;
      out[i] = p.team;
    }
  });
  // Passe 2 : remplissage des non-assignés, ordre d'entrée.
  participants.forEach((_p, i) => {
    if (out[i]) return;
    const side: 1 | 2 = count[1] < half ? 1 : 2;
    count[side]++;
    out[i] = side;
  });

  return participants.map((p, i) => ({ ...p, team: out[i]! }));
}

// Valide + persiste l'assignation complète d'équipes d'un match. `teamsByUserId` DOIT couvrir
// tous les participants ; chaque côté ≤ maxPlayers/2 ; valeurs ∈ {1,2}. Transactionnel (tx fourni).
export async function applyTeams(
  tx: Prisma.TransactionClient,
  reservationId: string,
  teamsByUserId: Record<string, number>,
  maxPlayers: number,
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
  for (const p of parts) {
    await tx.reservationParticipant.update({ where: { id: p.id }, data: { team: teamsByUserId[p.userId] } });
  }
}
