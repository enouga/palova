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

  it('en mode editable, tap joueur puis tap joueur adverse émet la nouvelle map d\'équipes', () => {
    const onSetTeams = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onSetTeams={onSetTeams} />);
    fireEvent.click(screen.getByText('Marc A'));   // pick Marc (team 1)
    fireEvent.click(screen.getByText('Lea C'));     // swap avec Lea (team 2)
    expect(onSetTeams).toHaveBeenCalledWith(
      expect.objectContaining({ a: 2, c: 1, b: 1 }),
    );
  });

  it('non editable : cliquer un joueur n\'émet rien', () => {
    const onSetTeams = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} onSetTeams={onSetTeams} />);
    fireEvent.click(screen.getByText('Marc A'));
    expect(onSetTeams).not.toHaveBeenCalled();
  });
});
