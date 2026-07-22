import { render, screen, fireEvent } from '@testing-library/react';
import { TournamentHero } from '../components/tournament/TournamentHero';
import { ThemeProvider } from '../lib/ThemeProvider';
import { TournamentDetail } from '../lib/api';

const NOW = new Date('2026-06-10T12:00:00Z');

const tournament = (over: Partial<TournamentDetail> = {}): TournamentDetail => ({
  id: 't1', clubId: 'c1', clubSportId: 'cs1', name: 'Grand Prix Messieurs', category: 'P500', gender: 'MEN', openToWomen: false,
  description: null, contactInfo: null, startTime: '2026-07-09T12:01:00Z', endTime: null,
  registrationDeadline: '2026-07-04T12:01:00Z', maxTeams: 12, entryFee: '40', status: 'PUBLISHED',
  confirmedCount: 7, waitlistCount: 0,
  club: { slug: 'demo', name: 'Toulouse Padel Indoor', timezone: 'Europe/Paris' },
  clubSport: { sport: { key: 'padel', name: 'Padel' } },
  ...over,
});

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('TournamentHero', () => {
  it('affiche titre, club, compteur et countdown explicite « Clôture J-x »', () => {
    wrap(<TournamentHero t={tournament()} now={NOW} />);
    expect(screen.getByText('Grand Prix Messieurs')).toBeInTheDocument();
    expect(screen.getByText('Toulouse Padel Indoor')).toBeInTheDocument();
    expect(screen.getByText('7/12 binômes')).toBeInTheDocument();
    expect(screen.getByText('Clôture J-24')).toBeInTheDocument();
    expect(screen.getByText('Plus que 5 places')).toBeInTheDocument();
  });

  it('now=null (avant mount) → pas de countdown, jauge à 0', () => {
    wrap(<TournamentHero t={tournament()} now={null} />);
    expect(screen.queryByText('Clôture J-24')).not.toBeInTheDocument();
    expect(screen.getByTestId('hero-fill').style.width).toBe('0px');
  });

  it('jauge remplie au prorata une fois monté', () => {
    wrap(<TournamentHero t={tournament()} now={NOW} />);
    expect(screen.getByTestId('hero-fill').style.width).toBe('58%');
  });

  it('urgence places restantes → badge « Plus que X places »', () => {
    wrap(<TournamentHero t={tournament({ confirmedCount: 10 })} now={NOW} />);
    expect(screen.getByText('Plus que 2 places')).toBeInTheDocument();
  });

  it('deadline < 48 h → countdown en heures « Clôture dans X h »', () => {
    wrap(<TournamentHero t={tournament({ registrationDeadline: '2026-06-10T18:00:00Z' })} now={NOW} />);
    expect(screen.getByText('Clôture dans 6 h')).toBeInTheDocument();
  });

  it('sans capacité → pas de jauge, compteur simple, pas de badge places', () => {
    wrap(<TournamentHero t={tournament({ maxTeams: null })} now={NOW} />);
    expect(screen.queryByTestId('hero-fill')).not.toBeInTheDocument();
    expect(screen.getByText('7 binômes')).toBeInTheDocument();
    expect(screen.queryByText('7 binômes inscrits')).not.toBeInTheDocument();
  });

  it('complet → badge court « Complet », compteur avec attente', () => {
    wrap(<TournamentHero t={tournament({ confirmedCount: 12, waitlistCount: 3 })} now={NOW} />);
    expect(screen.getByText('Complet')).toBeInTheDocument();
    expect(screen.queryByText(/liste d'attente/)).not.toBeInTheDocument();
    expect(screen.getByText('12/12 binômes · 3 en attente')).toBeInTheDocument();
  });

  it('Messieurs ouvert aux femmes → pill « Ouvert aux femmes »', () => {
    wrap(<TournamentHero t={tournament({ gender: 'MEN', openToWomen: true })} now={NOW} />);
    expect(screen.getByText('Messieurs')).toBeInTheDocument();
    expect(screen.getByText('Ouvert aux femmes')).toBeInTheDocument();
  });

  it('Messieurs NON ouvert aux femmes → pas de pill « Ouvert aux femmes »', () => {
    wrap(<TournamentHero t={tournament({ gender: 'MEN', openToWomen: false })} now={NOW} />);
    expect(screen.queryByText('Ouvert aux femmes')).not.toBeInTheDocument();
  });

  it('Mixte avec openToWomen=true → pas de pill « Ouvert aux femmes » (réservé à Messieurs)', () => {
    wrap(<TournamentHero t={tournament({ gender: 'MIXED', openToWomen: true })} now={NOW} />);
    expect(screen.queryByText('Ouvert aux femmes')).not.toBeInTheDocument();
  });
});

// La bande méta (horaire, clôture, prix, J/A) est désormais intégrée en pied de hero.
describe('TournamentHero — bande méta intégrée', () => {
  it('début, clôture (formats courts) et prix dans le fuseau du club', () => {
    wrap(<TournamentHero t={tournament()} now={NOW} />);
    expect(screen.getByText('jeu. 9 juil. · 14h01')).toBeInTheDocument();
    expect(screen.getByText('Clôture')).toBeInTheDocument();
    expect(screen.queryByText('Clôture des inscriptions')).not.toBeInTheDocument();
    expect(screen.getByText('sam. 4 juil. · 14h01')).toBeInTheDocument();
    expect(screen.getByText('40 € / binôme')).toBeInTheDocument();
  });

  it('avec heure de fin → plage compacte sur un jour', () => {
    wrap(<TournamentHero t={tournament({ endTime: '2026-07-09T16:00:00Z' })} now={NOW} />);
    expect(screen.getByText('jeu. 9 juil. · 14h01 → 18h00')).toBeInTheDocument();
  });

  it('pas d\'entrée prix sans entryFee', () => {
    wrap(<TournamentHero t={tournament({ entryFee: null })} now={NOW} />);
    expect(screen.queryByText(/€ \/ binôme/)).not.toBeInTheDocument();
  });

  // Le J/A est public : c'est lui qui répond du tournoi. Nom seul (spec §7) — le canal de
  // contact reste `contactInfo`, affiché ailleurs sur la fiche.
  it('J/A désigné → entrée « Juge-arbitre » avec son nom', () => {
    wrap(<TournamentHero t={tournament({ referee: { name: 'Julien Martin' } })} now={NOW} />);
    expect(screen.getByText('Juge-arbitre')).toBeInTheDocument();
    expect(screen.getByText('Julien Martin')).toBeInTheDocument();
  });

  it('aucun J/A désigné → pas d\'entrée « Juge-arbitre »', () => {
    wrap(<TournamentHero t={tournament({ referee: null })} now={NOW} />);
    expect(screen.queryByText('Juge-arbitre')).not.toBeInTheDocument();
  });

  it('champ referee absent du payload (listes) → pas d\'entrée', () => {
    wrap(<TournamentHero t={tournament()} now={NOW} />);
    expect(screen.queryByText('Juge-arbitre')).not.toBeInTheDocument();
  });
});

// Le bouton « Contacter » n'est qu'un relais : le GATING (contactable + inscrit) vit dans
// la page — le hero rend le bouton ssi la page lui passe onContactReferee.
describe('TournamentHero — contact du J/A', () => {
  it('onContactReferee fourni → bouton « Contacter » sur la carte J/A', () => {
    const onContact = jest.fn();
    wrap(<TournamentHero t={tournament({ referee: { name: 'Julien Martin', contactable: true } })} now={NOW} onContactReferee={onContact} />);
    fireEvent.click(screen.getByRole('button', { name: 'Contacter' }));
    expect(onContact).toHaveBeenCalled();
  });

  it('sans onContactReferee → nom seul, pas de bouton', () => {
    wrap(<TournamentHero t={tournament({ referee: { name: 'Julien Martin', contactable: true } })} now={NOW} />);
    expect(screen.getByText('Julien Martin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Contacter' })).not.toBeInTheDocument();
  });

  it('sans J/A → pas de bouton même avec le callback', () => {
    wrap(<TournamentHero t={tournament({ referee: null })} now={NOW} onContactReferee={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Contacter' })).not.toBeInTheDocument();
  });
});
