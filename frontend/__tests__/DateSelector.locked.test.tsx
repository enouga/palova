import { render, screen } from '@testing-library/react';
import DateSelector from '@/components/DateSelector';

jest.mock('@/lib/ThemeProvider', () => ({
  useTheme: () => ({ th: new Proxy({}, { get: (_t, p) => (typeof p === 'string' && p === 'neon' ? false : '#000') }) }),
}));

function keyPlus(days: number): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('DateSelector — jour verrouillé', () => {
  it('rend le jour verrouillé cliquable avec un cadenas, et remonte onSelectLocked', () => {
    const onLocked = jest.fn();
    render(<DateSelector value={keyPlus(0)} onChange={() => {}} maxKey={keyPlus(6)} lockedKey={keyPlus(7)} onSelectLocked={onLocked} />);

    const locked = screen.getByRole('button', { name: /ouvre bientôt/i });
    expect(locked).not.toBeDisabled();
    locked.click();
    expect(onLocked).toHaveBeenCalled();
  });

  it('sans lockedKey : comportement inchangé (les jours au-delà de maxKey sont désactivés)', () => {
    render(<DateSelector value={keyPlus(0)} onChange={() => {}} maxKey={keyPlus(6)} days={8} />);
    expect(screen.queryByRole('button', { name: /ouvre bientôt/i })).toBeNull();
  });
});
