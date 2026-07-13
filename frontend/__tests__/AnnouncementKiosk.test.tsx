import { render, screen, fireEvent, act } from '@testing-library/react';
import { AnnouncementKiosk } from '@/components/clubhouse/AnnouncementKiosk';
import { ThemeProvider } from '@/lib/ThemeProvider';
import type { Announcement } from '@/lib/api';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), assetUrl: (p: string | null) => p }));

const ann = (over: Partial<Announcement>): Announcement => ({
  id: 'a1', title: 'Tournoi P100', body: 'Corps ici', linkUrl: null, imageUrl: null,
  kind: 'INFO', validUntil: null, isPublished: true, pinned: false, createdAt: '', updatedAt: '', ...over,
});
const wrap = (slides: Announcement[], now: Date | null = null) =>
  render(<ThemeProvider><AnnouncementKiosk clubName="Padel Arena" slides={slides} now={now} /></ThemeProvider>);

describe('AnnouncementKiosk', () => {
  it('aucune diapo → accroche générique + nom du club, pas de flèches', () => {
    wrap([]);
    expect(screen.getByText('Padel Arena')).toBeInTheDocument();
    expect(screen.getByText('Réservez, jouez, retrouvez-vous.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Annonce précédente/ })).not.toBeInTheDocument();
  });

  it('une annonce → titre + corps ; pas de segments ni flèches (diapo unique)', () => {
    wrap([ann({ title: 'Créneaux du matin', body: 'Dès 8h' })]);
    expect(screen.getByText('Créneaux du matin')).toBeInTheDocument();
    expect(screen.getByText('Dès 8h')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Annonce suivante/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Annonce 1 sur/ })).not.toBeInTheDocument();
  });

  it('chip du type (TOURNAMENT → Tournoi) ; INFO → aucune chip de type', () => {
    const { unmount } = wrap([ann({ kind: 'TOURNAMENT' })]);
    expect(screen.getByText('Tournoi')).toBeInTheDocument();
    unmount();
    wrap([ann({ kind: 'INFO' })]);
    expect(screen.queryByText('Tournoi')).not.toBeInTheDocument();
  });

  it('diapo avec affiche → image entière sur le lavis teinté par l\'accent du club (pas de voile sombre)', () => {
    wrap([ann({ imageUrl: '/uploads/announcements/x.jpg' })]);
    const kiosk = screen.getByTestId('clubhouse-kiosk');
    expect(kiosk.querySelector('img')).toBeTruthy();
    expect(kiosk.innerHTML).toContain('x.jpg');
    expect(kiosk.innerHTML).toContain('color-mix(in srgb, #5e93da'); // lavis clubPanelWash (accent défaut)
    expect(kiosk.innerHTML).not.toContain('rgba(16,14,10'); // plus de voile sombre
  });

  it('diapo sans affiche partage le même lavis que la diapo avec affiche', () => {
    wrap([ann({ imageUrl: null })]);
    const kiosk = screen.getByTestId('clubhouse-kiosk');
    expect(kiosk.innerHTML).toContain('color-mix(in srgb, #5e93da');
  });

  it('validUntil proche + now fourni → chip compte à rebours ; now null → pas de countdown', () => {
    const soon = new Date(Date.now() + 24 * 3600e3).toISOString();
    const { unmount } = wrap([ann({ validUntil: soon })], new Date());
    expect(screen.getByText(/Plus que/)).toBeInTheDocument();
    unmount();
    wrap([ann({ validUntil: soon })], null);
    expect(screen.queryByText(/Plus que/)).not.toBeInTheDocument();
  });

  it('plusieurs diapos → segments + flèches ; flèche/segment changent la diapo (avec bouclage)', () => {
    wrap([ann({ id: 'a1', title: 'Un' }), ann({ id: 'a2', title: 'Deux' }), ann({ id: 'a3', title: 'Trois' })]);
    expect(screen.getByText('Un')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Annonce \d sur 3/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Annonce suivante' }));
    expect(screen.getByText('Deux')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Annonce 3 sur 3' }));
    expect(screen.getByText('Trois')).toBeInTheDocument();
    // bouclage : « précédente » depuis la 1re revient à la dernière
    fireEvent.click(screen.getByRole('button', { name: 'Annonce 1 sur 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annonce précédente' }));
    expect(screen.getByText('Trois')).toBeInTheDocument();
  });

  it('clic sur une diapo texte → feuille (dialog) avec le corps complet', () => {
    wrap([ann({ body: 'Ligne 1\nLigne 2 bien cachée' })]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir l'annonce/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Ligne 2 bien cachée');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clic sur une diapo image → lightbox (dialog) avec l image entière', () => {
    wrap([ann({ imageUrl: '/uploads/announcements/x.jpg' })]);
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir l'annonce/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('img')).toBeTruthy();
  });

  it('linkUrl → « En savoir plus » qui n ouvre pas le détail (stopPropagation)', () => {
    wrap([ann({ linkUrl: 'https://club.fr/x' })]);
    const link = screen.getByRole('link', { name: /En savoir plus sur/ });
    expect(link).toHaveAttribute('href', 'https://club.fr/x');
    fireEvent.click(link);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('auto-défilement : la diapo avance après intervalSeconds', () => {
    jest.useFakeTimers();
    try {
      render(<ThemeProvider><AnnouncementKiosk clubName="X" now={null} intervalSeconds={4}
        slides={[ann({ id: 'a1', title: 'Un' }), ann({ id: 'a2', title: 'Deux' })]} /></ThemeProvider>);
      expect(screen.getByText('Un')).toBeInTheDocument();
      act(() => { jest.advanceTimersByTime(4000); });
      expect(screen.getByText('Deux')).toBeInTheDocument();
    } finally { jest.useRealTimers(); }
  });

  it('intervalSeconds = 0 (manuel) → aucun défilement automatique', () => {
    jest.useFakeTimers();
    try {
      render(<ThemeProvider><AnnouncementKiosk clubName="X" now={null} intervalSeconds={0}
        slides={[ann({ id: 'a1', title: 'Un' }), ann({ id: 'a2', title: 'Deux' })]} /></ThemeProvider>);
      act(() => { jest.advanceTimersByTime(30000); });
      expect(screen.getByText('Un')).toBeInTheDocument();
      expect(screen.queryByText('Deux')).not.toBeInTheDocument();
    } finally { jest.useRealTimers(); }
  });

  it('neutralise une imageUrl hostile (quotes/parenthèses retirées du CSS)', () => {
    wrap([ann({ imageUrl: "https://x/a.jpg'),url('javascript:alert(1)" })]);
    const kiosk = screen.getByTestId('clubhouse-kiosk');
    expect(kiosk.innerHTML).not.toContain('alert(1)');
    expect(kiosk.innerHTML).not.toContain("')");
  });
});
