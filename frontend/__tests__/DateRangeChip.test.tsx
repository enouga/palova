import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { DateRangeChip } from '@/components/calendar/DateRangeChip';

function Harness({ onChange, initial = { from: null as string | null, to: null as string | null } }: {
  onChange: jest.Mock; initial?: { from: string | null; to: string | null };
}) {
  const [r, setR] = useState(initial);
  return (
    <ThemeProvider>
      <DateRangeChip from={r.from} to={r.to}
        onChange={(from, to) => { setR({ from, to }); onChange(from, to); }} />
    </ThemeProvider>
  );
}

describe('DateRangeChip', () => {
  it('chip neutre « Dates » → ouvre le calendrier', () => {
    render(<Harness onChange={jest.fn()} />);
    const chip = screen.getByRole('button', { name: 'Dates' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.getByRole('dialog', { name: 'Choisir des dates' })).toBeInTheDocument();
  });

  it('2ᵉ tap postérieur → pose la fin et ferme', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} initial={{ from: '2026-07-20', to: null }} />);
    fireEvent.click(screen.getByRole('button', { name: /Du 20 juil/ }));
    fireEvent.click(screen.getByRole('button', { name: '24/07/2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-07-20', '2026-07-24');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('2ᵉ tap antérieur → bornes échangées', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} initial={{ from: '2026-07-20', to: null }} />);
    fireEvent.click(screen.getByRole('button', { name: /Du 20 juil/ }));
    fireEvent.click(screen.getByRole('button', { name: '10/07/2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-07-10', '2026-07-20');
  });

  it('plage complète : tap → repart sur un nouveau début (popup reste ouverte)', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} initial={{ from: '2026-07-10', to: '2026-07-15' }} />);
    fireEvent.click(screen.getByRole('button', { name: /10 juil\. → 15 juil\./ }));
    fireEvent.click(screen.getByRole('button', { name: '22/07/2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-07-22', null);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('✕ efface la plage sans ouvrir le calendrier', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} initial={{ from: '2026-07-10', to: '2026-07-15' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Effacer les dates' }));
    expect(onChange).toHaveBeenLastCalledWith(null, null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('« Effacer » du pied vide la plage et ferme', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} initial={{ from: '2026-07-10', to: '2026-07-15' }} />);
    fireEvent.click(screen.getByRole('button', { name: /10 juil\. → 15 juil\./ }));
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect(onChange).toHaveBeenLastCalledWith(null, null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
