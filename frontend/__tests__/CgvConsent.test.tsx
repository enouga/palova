import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { CgvConsent } from '../components/CgvConsent';

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('CgvConsent — carte d\'acceptation', () => {
  it('rend une vraie checkbox avec le nom accessible historique', () => {
    wrap(<CgvConsent accepted={false} onChange={jest.fn()} />);
    expect(screen.getByRole('checkbox', { name: /conditions générales de vente/i })).toBeInTheDocument();
  });

  it('cliquer n\'importe où sur la carte coche la case (onChange true)', () => {
    const onChange = jest.fn();
    wrap(<CgvConsent accepted={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /conditions générales/i }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('cochée → re-clic décoche (onChange false)', () => {
    const onChange = jest.fn();
    wrap(<CgvConsent accepted onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /conditions générales/i }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('liens CGV et confidentialité présents', () => {
    wrap(<CgvConsent accepted={false} onChange={jest.fn()} />);
    expect(screen.getByRole('link', { name: /conditions générales de vente/i })).toHaveAttribute('href', '/cgv');
    expect(screen.getByRole('link', { name: /politique de confidentialité/i })).toHaveAttribute('href', '/confidentialite');
  });

  it('fallbackNote → mention « conditions générales de la plateforme »', () => {
    wrap(<CgvConsent accepted={false} onChange={jest.fn()} fallbackNote />);
    expect(screen.getByText(/conditions générales de la plateforme/i)).toBeInTheDocument();
  });

  it('alreadyAccepted → rappel « déjà accepté », plus de checkbox', () => {
    wrap(<CgvConsent accepted alreadyAccepted onChange={jest.fn()} />);
    expect(screen.getByText(/déjà accepté/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    // Les liens restent consultables depuis le rappel.
    expect(screen.getByRole('link', { name: /conditions générales de vente/i })).toHaveAttribute('href', '/cgv');
  });
});
