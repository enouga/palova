import { effectiveTeams, applyTeams } from '../matchTeams';

const p = (team: number | null, slot: number | null = null) => ({ team, slot });

describe('effectiveTeams', () => {
  it('remplit les null côté 1 puis côté 2 dans l\'ordre (double, 4 joueurs)', () => {
    const out = effectiveTeams([p(null), p(null), p(null), p(null)], 4);
    expect(out.map((x) => x.team)).toEqual([1, 1, 2, 2]);
  });

  it('honore les team explicites et complète les null (double)', () => {
    // A=2 explicite, B=null, C=null, D=null → A:2 ; puis remplissage 1,1,2
    const out = effectiveTeams([p(2), p(null), p(null), p(null)], 4);
    expect(out.map((x) => x.team)).toEqual([2, 1, 1, 2]);
  });

  it('clampe un côté sur-rempli et bascule le surplus (double)', () => {
    // trois joueurs demandent le côté 1 : le 3e est repoussé côté 2
    const out = effectiveTeams([p(1), p(1), p(1), p(2)], 4);
    expect(out.map((x) => x.team)).toEqual([1, 1, 2, 2]);
  });

  it('gère le single (2 joueurs, un par côté)', () => {
    const out = effectiveTeams([p(null), p(null)], 2);
    expect(out.map((x) => x.team)).toEqual([1, 2]);
  });

  it('préserve l\'ordre d\'entrée et propage les autres champs', () => {
    const out = effectiveTeams([{ team: null, userId: 'a' }, { team: null, userId: 'b' }], 4);
    expect(out).toEqual([
      { team: 1, slot: 0, userId: 'a' },
      { team: 1, slot: 1, userId: 'b' },
    ]);
  });

  describe('slot (place G/D au sein de l\'équipe)', () => {
    it('honore les slots explicites valides (double, 2 par côté)', () => {
      // Côté 1 : a slot 1 (D), b slot 0 (G) — ordre inverse de joinedAt.
      const out = effectiveTeams([
        { team: 1, slot: 1, userId: 'a' },
        { team: 1, slot: 0, userId: 'b' },
      ], 4);
      expect(out).toEqual([
        { team: 1, slot: 1, userId: 'a' },
        { team: 1, slot: 0, userId: 'b' },
      ]);
    });

    it('ignore un slot hors plage et le fait combler par le remplissage ascendant', () => {
      // half=2 (double) : slot 5 est invalide → traité comme non assigné.
      const out = effectiveTeams([
        { team: 1, slot: 5, userId: 'a' },
        { team: 1, slot: 0, userId: 'b' },
      ], 4);
      // b a pris slot 0 explicitement ; a (invalide) se rabat sur le slot libre restant (1).
      expect(out).toEqual([
        { team: 1, slot: 1, userId: 'a' },
        { team: 1, slot: 0, userId: 'b' },
      ]);
    });

    it('collision de slot : le premier arrivé (ordre du tableau) gagne, le second est replacé', () => {
      const out = effectiveTeams([
        { team: 1, slot: 0, userId: 'a' },
        { team: 1, slot: 0, userId: 'b' },
      ], 4);
      expect(out[0]).toEqual({ team: 1, slot: 0, userId: 'a' });
      expect(out[1]).toEqual({ team: 1, slot: 1, userId: 'b' }); // rabattu sur le slot libre restant
    });

    it('slots null : remplissage ascendant dans l\'ordre d\'entrée, par équipe', () => {
      const out = effectiveTeams([
        { team: null, slot: null, userId: 'a' },
        { team: null, slot: null, userId: 'b' },
        { team: null, slot: null, userId: 'c' },
        { team: null, slot: null, userId: 'd' },
      ], 4);
      // team : 1,1,2,2 (remplissage habituel) ; slot : 0,1 par équipe dans l'ordre d'entrée.
      expect(out).toEqual([
        { team: 1, slot: 0, userId: 'a' },
        { team: 1, slot: 1, userId: 'b' },
        { team: 2, slot: 0, userId: 'c' },
        { team: 2, slot: 1, userId: 'd' },
      ]);
    });

    it('régression : un joueur seul avec team:1, slot:1 reste en D (slot:1)', () => {
      const out = effectiveTeams([{ team: 1, slot: 1, userId: 'a' }], 4);
      expect(out).toEqual([{ team: 1, slot: 1, userId: 'a' }]);
    });
  });
});

describe('applyTeams', () => {
  // Fake tx minimal : applyTeams n'appelle que findMany + update sur reservationParticipant.
  const fakeTx = (parts: Array<{ id: string; userId: string }>) => ({
    reservationParticipant: {
      findMany: jest.fn().mockResolvedValue(parts),
      update: jest.fn().mockResolvedValue({}),
    },
  });

  const parts = [
    { id: 'p1', userId: 'user-1' },
    { id: 'p2', userId: 'user-2' },
  ];

  it('persiste team seul quand slotsByUserId est omis (comportement inchangé)', async () => {
    const tx = fakeTx(parts);
    await applyTeams(tx as any, 'res-1', { 'user-1': 1, 'user-2': 2 }, 4);

    expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { team: 1 } });
    expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p2' }, data: { team: 2 } });
  });

  it('persiste team + slot quand slotsByUserId est fourni', async () => {
    const tx = fakeTx(parts);
    await applyTeams(tx as any, 'res-1', { 'user-1': 1, 'user-2': 1 }, 4, { 'user-1': 1, 'user-2': 0 });

    expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { team: 1, slot: 1 } });
    expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p2' }, data: { team: 1, slot: 0 } });
  });

  it('TEAM_INVALID si un slot est manquant', async () => {
    const tx = fakeTx(parts);
    await expect(
      applyTeams(tx as any, 'res-1', { 'user-1': 1, 'user-2': 1 }, 4, { 'user-1': 0 }),
    ).rejects.toThrow('TEAM_INVALID');
  });

  it('TEAM_INVALID si un slot est hors plage', async () => {
    const tx = fakeTx(parts);
    await expect(
      applyTeams(tx as any, 'res-1', { 'user-1': 1, 'user-2': 1 }, 4, { 'user-1': 0, 'user-2': 5 }),
    ).rejects.toThrow('TEAM_INVALID');
  });

  it('TEAM_SLOT_TAKEN si deux joueurs de la même équipe demandent le même slot', async () => {
    const tx = fakeTx(parts);
    await expect(
      applyTeams(tx as any, 'res-1', { 'user-1': 1, 'user-2': 1 }, 4, { 'user-1': 0, 'user-2': 0 }),
    ).rejects.toThrow('TEAM_SLOT_TAKEN');
  });

  it('même slot mais équipes différentes : autorisé (pas de collision)', async () => {
    const tx = fakeTx(parts);
    await applyTeams(tx as any, 'res-1', { 'user-1': 1, 'user-2': 2 }, 4, { 'user-1': 0, 'user-2': 0 });

    expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { team: 1, slot: 0 } });
    expect(tx.reservationParticipant.update).toHaveBeenCalledWith({ where: { id: 'p2' }, data: { team: 2, slot: 0 } });
  });
});
