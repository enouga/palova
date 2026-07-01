import { effectiveTeams } from '../matchTeams';

const p = (team: number | null) => ({ team });

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
    expect(out).toEqual([{ team: 1, userId: 'a' }, { team: 1, userId: 'b' }]);
  });
});
