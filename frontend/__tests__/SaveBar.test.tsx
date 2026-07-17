import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/ThemeProvider';
import { SaveBar } from '@/components/ui/SaveBar';

const base = { dirty: true, saving: false, error: null as string | null, saved: false, onSave: jest.fn(), onCancel: jest.fn() };
const wrap = (over: Partial<typeof base> = {}) =>
  render(<ThemeProvider><SaveBar {...base} {...over} /></ThemeProvider>);

describe('SaveBar', () => {
  it('is hidden when there is nothing to save and no error', () => {
    const { container } = wrap({ dirty: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the pending message and both actions when dirty', () => {
    wrap();
    expect(screen.getByText(/Modifications non enregistrées/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('wires the actions and disables buttons while saving', () => {
    const onSave = jest.fn(); const onCancel = jest.fn();
    wrap({ onSave, onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onSave).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    wrap({ saving: true });
    expect(screen.getByRole('button', { name: 'Enregistrement…' })).toBeDisabled();
  });

  it('shows an error and stays visible even if not dirty', () => {
    wrap({ dirty: false, error: 'Boom' });
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });

  it('shows the "Enregistré ✓" flash without action buttons when saved and clean', () => {
    wrap({ dirty: false, saved: true });
    expect(screen.getByText(/Enregistré/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Annuler' })).not.toBeInTheDocument();
  });
});
