import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MatchTeams, MatchPlayerData } from '@/components/match/MatchTeams';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const players: MatchPlayerData[] = [
  { userId: 'a', firstName: 'Marc', lastName: 'A', isOrganizer: true, team: 1 },
  { userId: 'b', firstName: 'Paul', lastName: 'B', team: 1 },
  { userId: 'c', firstName: 'Lea',  lastName: 'C', team: 2 },
];

describe('MatchTeams', () => {
  it('rend deux colonnes d\'équipe avec un séparateur VS', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.getByText('Marc A')).toBeInTheDocument();
    expect(screen.getByText('Lea C')).toBeInTheDocument();
  });

  it('affiche une « Place libre » pour chaque slot vide (côté 2 incomplet)', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    // 3 joueurs, capacité 4 → 1 place libre côté 2
    expect(screen.getAllByText('Place libre')).toHaveLength(1);
  });

  it('affiche le repère G (1er) / D (2e) par équipe en double', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    // team1: Marc=G, Paul=D ; team2: Lea=G → 2×G, 1×D
    expect(screen.getAllByText('G')).toHaveLength(2);
    expect(screen.getAllByText('D')).toHaveLength(1);
  });

  it('lecture seule : aucun bouton d\'action', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    expect(screen.queryByRole('button', { name: /Passer dans l'autre équipe/ })).not.toBeInTheDocument();
  });

  it('editable : « → » déplace le joueur dans l\'autre équipe (émet la map)', () => {
    const onSetTeams = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onSetTeams={onSetTeams} />);
    // 1er bouton « Passer… » = celui de Marc (team 1) → part côté 2 (place libre côté 2)
    fireEvent.click(screen.getAllByRole('button', { name: /Passer dans l'autre équipe/ })[0]);
    expect(onSetTeams).toHaveBeenCalledWith({ a: 2, b: 1, c: 2 });
  });

  it('editable : un « + » par emplacement libre appelle onAddToTeam(côté)', () => {
    const onAddToTeam = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onAddToTeam={onAddToTeam} />);
    // team2 a 1 place libre → un seul « + » (côté 2)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un joueur à l'équipe 2/ }));
    expect(onAddToTeam).toHaveBeenCalledWith(2);
  });

  it('editable : le bouton « Remplacer » appelle onReplace', () => {
    const onReplace = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onReplace={onReplace} />);
    fireEvent.click(screen.getByRole('button', { name: /Remplacer Paul B/ }));
    expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ userId: 'b' }));
  });

  it('editable : le bouton « Retirer » appelle onRemove', () => {
    const onRemove = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /Retirer Paul B/ }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ userId: 'b' }));
  });
});
