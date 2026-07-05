import { render, screen, within } from '@testing-library/react';
import { TopOfMonth } from '@/components/clubhouse/TopOfMonth';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { TopMonthEntry } from '@/lib/api';

const wrap = (entries: TopMonthEntry[]) =>
  render(<ThemeProvider><TopOfMonth entries={entries} /></ThemeProvider>);

describe('TopOfMonth', () => {
  const top = [
    { userId: 'u1', firstName: 'Bob', lastName: 'K', avatarUrl: null, wins: 5 },
    { userId: 'u2', firstName: 'Ana', lastName: 'L', avatarUrl: null, wins: 3 },
    { userId: 'u3', firstName: 'Cléo', lastName: 'M', avatarUrl: null, wins: 1 },
  ];

  it('podium 3 joueurs avec victoires (1er au centre visuellement, ordre DOM 1-2-3)', () => {
    wrap(top);
    expect(screen.getByText('Bob K')).toBeInTheDocument();
    expect(screen.getByLabelText('5 victoires')).toBeInTheDocument();
    expect(screen.getByLabelText('1 victoire')).toBeInTheDocument();
  });

  it('rien si moins de 3 entrées', () => {
    const { container } = wrap(top.slice(0, 2));
    expect(container.firstChild).toBeNull();
  });

  it('classement 4e et suivants affiché en lignes sous le podium', () => {
    const extended = [
      ...top,
      { userId: 'u4', firstName: 'Dan', lastName: 'N', avatarUrl: null, wins: 9 },
      { userId: 'u5', firstName: 'Eve', lastName: 'O', avatarUrl: null, wins: 7 },
    ];
    wrap(extended);
    const danRow = screen.getByText('Dan N').parentElement as HTMLElement;
    expect(within(danRow).getByText('4')).toBeInTheDocument();
    expect(within(danRow).getByLabelText('9 victoires')).toBeInTheDocument();
    const eveRow = screen.getByText('Eve O').parentElement as HTMLElement;
    expect(within(eveRow).getByText('5')).toBeInTheDocument();
    expect(within(eveRow).getByLabelText('7 victoires')).toBeInTheDocument();
  });

  it("pas de liste supplémentaire s'il n'y a que 3 entrées", () => {
    wrap(top);
    expect(screen.queryByText('4')).not.toBeInTheDocument();
  });
});
