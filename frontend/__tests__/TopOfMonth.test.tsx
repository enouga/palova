import { render, screen } from '@testing-library/react';
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
});
