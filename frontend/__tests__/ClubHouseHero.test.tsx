import { render, screen, fireEvent } from '@testing-library/react';
import { ClubHouseHero } from '../components/clubhouse/ClubHouseHero';
import { ThemeProvider } from '../lib/ThemeProvider';
import { Announcement } from '../lib/api';
import { PulseChip } from '../lib/clubhouse';

const ann = (over: Partial<Announcement>): Announcement => ({
  id: 'a1', title: 'Tournoi interne samedi', body: 'Lots à gagner !', linkUrl: null,
  imageUrl: null, kind: 'INFO', validUntil: null, isPublished: true, pinned: true, createdAt: '', updatedAt: '', ...over,
});
const wrap = (a: Announcement | null, pulse: PulseChip[] = []) =>
  render(<ThemeProvider><ClubHouseHero clubName="Padel Arena" announcement={a} pulse={pulse} /></ThemeProvider>);

describe('ClubHouseHero', () => {
  it('avec annonce : surtitre club, titre de l annonce, corps clampé', () => {
    wrap(ann({}));
    expect(screen.getByText('Padel Arena')).toBeInTheDocument();
    expect(screen.getByText('Tournoi interne samedi')).toBeInTheDocument();
    const body = screen.getByText('Lots à gagner !');
    expect(body.style.overflow).toBe('hidden'); // line-clamp dans le hero
  });

  it("sans annonce : accroche générique, pas de role=button ni de feuille", () => {
    wrap(null);
    expect(screen.getByText('Réservez, jouez, retrouvez-vous.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('clubhouse-hero'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('CTA « Réserver un terrain » toujours présent, vers /reserver, sans ouvrir la feuille', () => {
    wrap(ann({}));
    const cta = screen.getByText('Réserver un terrain');
    expect(cta).toHaveAttribute('href', '/reserver');
    fireEvent.click(cta);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('avec linkUrl → lien externe « En savoir plus » (stopPropagation)', () => {
    wrap(ann({ linkUrl: 'https://club.fr/tournoi' }));
    const link = screen.getByRole('link', { name: /En savoir plus sur/ });
    expect(link).toHaveAttribute('href', 'https://club.fr/tournoi');
    fireEvent.click(link);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clic sur le hero → feuille avec l annonce complète ; « Fermer » la referme', () => {
    wrap(ann({ body: 'Ligne 1\nLigne 2\nLigne 3\nLigne 4 bien cachée' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('clubhouse-hero'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Ligne 4 bien cachée');
    fireEvent.click(screen.getByText('Fermer'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('la feuille propose aussi le lien externe quand il existe', () => {
    wrap(ann({ linkUrl: 'https://club.fr/tournoi' }));
    fireEvent.click(screen.getByTestId('clubhouse-hero'));
    expect(screen.getAllByRole('link', { name: /En savoir plus/ })).toHaveLength(2);
  });

  it('clavier : Entrée sur le hero ouvre la feuille', () => {
    wrap(ann({}));
    fireEvent.keyDown(screen.getByTestId('clubhouse-hero'), { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('pouls : chips rendues, la chip parties est un bouton', () => {
    wrap(null, [
      { kind: 'slot', label: 'Prochain créneau dim. 20h00' },
      { kind: 'matches', label: '3 parties cherchent des joueurs' },
      { kind: 'event', label: 'Prochain event J-4' },
    ]);
    expect(screen.getByText('Prochain créneau dim. 20h00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3 parties cherchent des joueurs/ })).toBeInTheDocument();
    expect(screen.getByText('Prochain event J-4')).toBeInTheDocument();
  });

  it('utilise imageUrl en fond quand présent', () => {
    wrap(ann({ imageUrl: 'https://x/photo.jpg' }));
    const hero = screen.getByTestId('clubhouse-hero');
    expect(hero.outerHTML).toContain('photo.jpg');
    expect(hero.outerHTML).toContain('rgba(18,22,30');
  });

  it('neutralise une imageUrl hostile (quotes/parenthèses retirées du CSS)', () => {
    wrap(ann({ imageUrl: "https://x/a.jpg'),url('javascript:alert(1)" }));
    const hero = screen.getByTestId('clubhouse-hero');
    expect(hero.outerHTML).not.toContain('alert(1)');
    expect(hero.outerHTML).not.toContain("')");
  });
});
