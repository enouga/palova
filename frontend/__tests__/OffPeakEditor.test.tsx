import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { OffPeakEditor } from '@/components/admin/settings/OffPeakEditor';
import type { OffPeakHours } from '@/lib/api';

function Harness({ initial }: { initial: OffPeakHours | null }) {
  const [value, setValue] = useState<OffPeakHours | null>(initial);
  return (
    <ThemeProvider>
      <OffPeakEditor value={value} onChange={setValue} />
    </ThemeProvider>
  );
}

describe('OffPeakEditor', () => {
  it('shows existing ranges as chips per day', () => {
    render(<Harness initial={{ 1: [{ start: 9, end: 12 }] }} />);
    expect(screen.getByText('9h00 → 12h00')).toBeInTheDocument();
  });

  it('removes a range when its × is clicked', () => {
    render(<Harness initial={{ 1: [{ start: 9, end: 12 }] }} />);
    fireEvent.click(screen.getByRole('button', { name: /Supprimer la plage/ }));
    expect(screen.queryByText('9h00 → 12h00')).not.toBeInTheDocument();
  });

  it('opens the sheet on "+ plage" and adds a range on validation', () => {
    render(<Harness initial={null} />);
    // Ouvre la feuille pour lundi (1er bouton « + plage »).
    fireEvent.click(screen.getAllByRole('button', { name: '+ plage' })[0]);
    expect(screen.getByRole('dialog', { name: /plage/i })).toBeInTheDocument();
    // La feuille propose un défaut 9h00 → 12h00 ; on valide.
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(screen.getByText('9h00 → 12h00')).toBeInTheDocument();
  });
});
