import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MatchShareButton } from '../components/openmatch/MatchShareButton';
import { ThemeProvider } from '../lib/ThemeProvider';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('MatchShareButton', () => {
  afterEach(() => { delete (navigator as any).share; });

  it('appelle navigator.share quand disponible', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    (navigator as any).share = share;
    wrap(<MatchShareButton url="https://demo.palova.fr/parties/m1" title="Partie ouverte · Court 2" />);
    fireEvent.click(screen.getByRole('button', { name: /partager/i }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: 'Partie ouverte · Court 2', url: 'https://demo.palova.fr/parties/m1' }));
  });

  it('repli sur le presse-papier et affiche « Lien copié ! »', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    wrap(<MatchShareButton url="https://demo.palova.fr/parties/m1" title="X" />);
    fireEvent.click(screen.getByRole('button', { name: /partager/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://demo.palova.fr/parties/m1'));
    expect(await screen.findByText('Lien copié !')).toBeInTheDocument();
  });

  it('transmet le texte enrichi à navigator.share quand fourni', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    (navigator as any).share = share;
    wrap(<MatchShareButton url="https://demo.palova.fr/parties/m1?s=abc" title="T" text="sam. 4 juil. · 2 places" />);
    fireEvent.click(screen.getByRole('button', { name: /partager/i }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({
      title: 'T', text: 'sam. 4 juil. · 2 places', url: 'https://demo.palova.fr/parties/m1?s=abc',
    }));
  });

  it('compact : icône seule (nom accessible « Partager »), état copié porté par l\'aria-label', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    wrap(<MatchShareButton compact url="https://demo.palova.fr/parties/m1" title="X" />);
    const btn = screen.getByRole('button', { name: 'Partager' });
    expect(btn.textContent).toBe(''); // pas de libellé visible
    fireEvent.click(btn);
    expect(await screen.findByRole('button', { name: 'Lien copié !' })).toBeInTheDocument();
  });
});
