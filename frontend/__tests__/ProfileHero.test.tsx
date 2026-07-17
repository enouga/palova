import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../lib/ThemeProvider';
import { ProfileHero } from '../components/profile/ProfileHero';
import type { MyProfile } from '../lib/api';

const profile = {
  id: 'u1', email: 'eric@palova.fr', firstName: 'Eric', lastName: 'Nougayrede', phone: null, sex: null,
  birthDate: null, avatarUrl: null, locale: 'fr', isSuperAdmin: false, showInLeaderboard: false,
  autoMatchProposals: false, acceptsFriendRequests: false, acceptsDirectMessages: true, preferredSport: null,
} as MyProfile;

const TABS = [
  { key: 'identite' as const, label: 'Identité' },
  { key: 'preferences' as const, label: 'Préférences' },
];

const base = {
  profile, avatarSrc: null as string | null, initials: 'EN', uploading: false,
  fileRef: createRef<HTMLInputElement>(), onPickAvatar: jest.fn(),
  kicker: 'Padel Arena Paris', level: null as number | null, isSubscriber: false,
  memberSince: null as string | null,
  tabs: TABS, activeTab: 'identite' as const, onTab: jest.fn(), compact: false,
};

const wrap = (props: Partial<typeof base> = {}) =>
  render(<ThemeProvider><ProfileHero {...base} {...props} /></ThemeProvider>);

describe('ProfileHero', () => {
  it('affiche le kicker, le nom, l’email et les initiales', () => {
    wrap();
    expect(screen.getByText('Padel Arena Paris')).toBeInTheDocument();
    expect(screen.getByText('Eric Nougayrede')).toBeInTheDocument();
    expect(screen.getByText('eric@palova.fr')).toBeInTheDocument();
    expect(screen.getByText('EN')).toBeInTheDocument();
  });

  it('affiche la photo quand elle existe, à la place des initiales', () => {
    wrap({ avatarSrc: 'http://x/a.png' });
    expect(screen.getByAltText('Photo de profil')).toHaveAttribute('src', 'http://x/a.png');
    expect(screen.queryByText('EN')).not.toBeInTheDocument();
  });

  it('affiche le badge de niveau quand il est fourni', () => {
    wrap({ level: 6.2 });
    expect(screen.getByText('6.2')).toBeInTheDocument();
  });

  it('pas de badge de niveau sans niveau', () => {
    wrap({ level: null });
    expect(screen.queryByLabelText(/Niveau/)).not.toBeInTheDocument();
  });

  it('affiche les chips Abonné et Membre depuis', () => {
    wrap({ isSubscriber: true, memberSince: '2024-03-01T00:00:00.000Z' });
    expect(screen.getByText(/Abonné/)).toBeInTheDocument();
    expect(screen.getByText('Membre depuis 2024')).toBeInTheDocument();
  });

  it('pas de chips pour un non-membre', () => {
    wrap({ isSubscriber: false, memberSince: null });
    expect(screen.queryByText(/Abonné/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Membre depuis/)).not.toBeInTheDocument();
  });

  it('la pastille photo déclenche le sélecteur de fichier', () => {
    const fileRef = createRef<HTMLInputElement>();
    wrap({ fileRef });
    const click = jest.fn();
    Object.defineProperty(fileRef.current!, 'click', { value: click });
    fireEvent.click(screen.getByRole('button', { name: 'Changer la photo' }));
    expect(click).toHaveBeenCalled();
  });

  it('rend un onglet par entrée et remonte le clic', () => {
    const onTab = jest.fn();
    wrap({ onTab });
    fireEvent.click(screen.getByRole('button', { name: 'Préférences' }));
    expect(onTab).toHaveBeenCalledWith('preferences');
  });

  it('variante compacte : ni email, ni chips, ni pastille photo — mais les onglets restent', () => {
    wrap({ compact: true, isSubscriber: true, memberSince: '2024-03-01T00:00:00.000Z' });
    expect(screen.getByText('Eric Nougayrede')).toBeInTheDocument();
    expect(screen.queryByText('eric@palova.fr')).not.toBeInTheDocument();
    expect(screen.queryByText(/Membre depuis/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Changer la photo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Préférences' })).toBeInTheDocument();
  });
});
