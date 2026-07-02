import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { MatchTeams, MatchPlayerData } from '@/components/match/MatchTeams';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const players: MatchPlayerData[] = [
  { userId: 'a', firstName: 'Marc', lastName: 'A', isOrganizer: true, team: 1 },
  { userId: 'b', firstName: 'Paul', lastName: 'B', team: 1 },
  { userId: 'c', firstName: 'Lea',  lastName: 'C', team: 2 },
];

describe('MatchTeams (mini-terrain)', () => {
  it('rend le terrain : deux équipes, VS, noms complets (large par défaut)', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.getByText('Équipe 1')).toBeInTheDocument();
    expect(screen.getByText('Équipe 2')).toBeInTheDocument();
    expect(screen.getByText('Marc A')).toBeInTheDocument();
    expect(screen.getByText('Lea C')).toBeInTheDocument();
  });

  it('lecture seule : « Place libre » sur les places vides, aucun bouton', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    expect(screen.getAllByText('Place libre')).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('affiche le repère G (1er) / D (2e) par équipe en double, places vides comprises', () => {
    wrap(<MatchTeams players={players} capacity={4} />);
    // team1: Marc=G, Paul=D ; team2: Lea=G + place vide D → 2×G, 2×D
    expect(screen.getAllByText('G')).toHaveLength(2);
    expect(screen.getAllByText('D')).toHaveLength(2);
  });

  it("editable : tap joueur → feuille → « Passer dans l'équipe 2 » émet la map", () => {
    const onSetTeams = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onSetTeams={onSetTeams} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Marc A' }));
    fireEvent.click(screen.getByRole('button', { name: /Passer dans l'équipe 2/ }));
    expect(onSetTeams).toHaveBeenCalledWith({ a: 2, b: 1, c: 2 });
    // La feuille se referme après l'action.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('editable : la feuille propose Remplacer / Retirer pour un non-organisateur', () => {
    const onReplace = jest.fn(), onRemove = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onReplace={onReplace} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Paul B' }));
    fireEvent.click(screen.getByRole('button', { name: /Remplacer par un autre joueur/ }));
    expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ userId: 'b' }));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Paul B' }));
    fireEvent.click(screen.getByRole('button', { name: /Retirer de la partie/ }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ userId: 'b' }));
  });

  it("editable : la feuille de l'organisateur n'a ni Retirer ni Remplacer (défauts)", () => {
    wrap(<MatchTeams players={players} capacity={4} editable onReplace={jest.fn()} onRemove={jest.fn()} onSetTeams={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Marc A' }));
    expect(screen.queryByRole('button', { name: /Retirer de la partie/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remplacer/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Passer dans l'équipe 2/ })).toBeInTheDocument();
  });

  it('editable : un « + » par place libre appelle onAddToTeam(côté, emplacement)', () => {
    const onAddToTeam = jest.fn();
    wrap(<MatchTeams players={players} capacity={4} editable onAddToTeam={onAddToTeam} />);
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un joueur à l'équipe 2/ }));
    expect(onAddToTeam).toHaveBeenCalledWith(2, 1);
  });

  it('retirer le joueur de gauche laisse le droit à droite (emplacements fixes)', () => {
    const A: MatchPlayerData = { userId: 'a', firstName: 'Marc', lastName: 'A', team: 1 };
    const B: MatchPlayerData = { userId: 'b', firstName: 'Paul', lastName: 'B', team: 1 };
    const View = ({ pl }: { pl: MatchPlayerData[] }) => (
      <ThemeProvider><MatchTeams players={pl} capacity={4} onSetTeams={jest.fn()} /></ThemeProvider>
    );
    const { rerender } = render(<View pl={[A, B]} />);
    expect(screen.getByText('Paul B').closest('[data-player-slot]')).toHaveAttribute('data-player-slot', 'D');
    rerender(<View pl={[B]} />);
    expect(screen.getByText('Paul B').closest('[data-player-slot]')).toHaveAttribute('data-player-slot', 'D');
    expect(screen.queryByText('Marc A')).not.toBeInTheDocument();
  });

  it('étroit (ResizeObserver) : noms « Prénom N. », nom complet en title', () => {
    type ROEntry = { contentRect: { width: number } };
    let cb: ((entries: ROEntry[]) => void) | null = null;
    class ROCapture {
      constructor(fn: (entries: ROEntry[]) => void) { cb = fn; }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    const prev = global.ResizeObserver;
    // @ts-expect-error stub de test piloté
    global.ResizeObserver = ROCapture;
    try {
      const pl: MatchPlayerData[] = [
        { userId: 'a', firstName: 'Adam', lastName: 'Bernard', team: 1 },
        { userId: 'b', firstName: 'Karim', lastName: 'Benali', team: 2 },
      ];
      wrap(<MatchTeams players={pl} capacity={4} />);
      expect(screen.getByText('Adam Bernard')).toBeInTheDocument();
      act(() => cb?.([{ contentRect: { width: 300 } }]));
      expect(screen.getByText('Adam B.')).toBeInTheDocument();
      expect(screen.getByText('Adam B.')).toHaveAttribute('title', 'Adam Bernard');
      // Repasse en large → noms complets.
      act(() => cb?.([{ contentRect: { width: 600 } }]));
      expect(screen.getByText('Adam Bernard')).toBeInTheDocument();
    } finally {
      global.ResizeObserver = prev;
    }
  });
});
