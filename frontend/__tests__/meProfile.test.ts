import { PROFILE_TABS, parseProfileTab, buildProfileBody, isDirty, licenceDirty, memberSinceYear } from '../lib/meProfile';
import type { MyProfile } from '../lib/api';

const base: MyProfile = {
  id: 'u1', email: 'eric@palova.fr', firstName: 'Eric', lastName: 'Nougayrede',
  phone: '0609032635', sex: 'MALE', birthDate: '1973-07-08T00:00:00.000Z',
  avatarUrl: null, locale: 'fr', isSuperAdmin: false,
  showInLeaderboard: false, autoMatchProposals: false,
  acceptsFriendRequests: true, acceptsDirectMessages: true,
  preferredSport: { id: 'sport-padel', key: 'padel', name: 'Padel' },
};

describe('meProfile helpers', () => {
  it('expose 5 onglets dans l’ordre', () => {
    expect(PROFILE_TABS.map((t) => t.key)).toEqual(['identite', 'niveau', 'preferences', 'portefeuille', 'securite']);
  });

  it('expose les libellés des onglets (accents compris)', () => {
    expect(PROFILE_TABS.map((t) => t.label)).toEqual(['Identité', 'Niveau', 'Préférences', 'Portefeuille', 'Sécurité']);
  });

  it('parseProfileTab lit ?tab= et retombe sur identite', () => {
    expect(parseProfileTab('?tab=preferences')).toBe('preferences');
    expect(parseProfileTab('?tab=securite')).toBe('securite');
    expect(parseProfileTab('')).toBe('identite');
    expect(parseProfileTab('?tab=nimportequoi')).toBe('identite');
  });

  it('buildProfileBody expose les 9 champs enregistrés', () => {
    expect(Object.keys(buildProfileBody(base)).sort()).toEqual([
      'acceptsDirectMessages', 'acceptsFriendRequests', 'autoMatchProposals',
      'birthDate', 'locale', 'phone', 'preferredSportId', 'sex', 'showInLeaderboard',
    ]);
  });

  it('buildProfileBody dérive preferredSportId de l’objet preferredSport', () => {
    expect(buildProfileBody(base).preferredSportId).toBe('sport-padel');
    expect(buildProfileBody({ ...base, preferredSport: null }).preferredSportId).toBeNull();
  });

  it('buildProfileBody normalise birthDate ISO en YYYY-MM-DD et vide → null', () => {
    expect(buildProfileBody(base).birthDate).toBe('1973-07-08');
    expect(buildProfileBody({ ...base, birthDate: null }).birthDate).toBeNull();
  });

  it('buildProfileBody trim le téléphone, vide → null', () => {
    expect(buildProfileBody({ ...base, phone: '  06 09  ' }).phone).toBe('06 09');
    expect(buildProfileBody({ ...base, phone: '   ' }).phone).toBeNull();
  });

  it('buildProfileBody normalise une locale absente en « fr » (miroir du <select>)', () => {
    // Le sélecteur de langue affiche `locale ?? 'fr'`. On normalise donc les DEUX côtés
    // vers ce que l'écran montre : sinon un joueur à locale null qui choisit « Français »
    // rendrait la page dirty alors que rien n'a visuellement changé.
    expect(buildProfileBody({ ...base, locale: null }).locale).toBe('fr');
    expect(isDirty({ ...base, locale: null }, { ...base, locale: 'fr' })).toBe(false);
    expect(isDirty({ ...base, locale: null }, { ...base, locale: 'es' })).toBe(true);
  });

  it('isDirty est faux à l’identique et vrai après chaque champ enregistré', () => {
    expect(isDirty(base, { ...base })).toBe(false);
    expect(isDirty(base, { ...base, phone: '0700000000' })).toBe(true);
    expect(isDirty(base, { ...base, sex: 'FEMALE' })).toBe(true);
    expect(isDirty(base, { ...base, locale: 'es' })).toBe(true);
    expect(isDirty(base, { ...base, showInLeaderboard: true })).toBe(true);
    expect(isDirty(base, { ...base, autoMatchProposals: true })).toBe(true);
    expect(isDirty(base, { ...base, acceptsFriendRequests: false })).toBe(true);
    expect(isDirty(base, { ...base, acceptsDirectMessages: false })).toBe(true);
    expect(isDirty(base, { ...base, preferredSport: null })).toBe(true);
    expect(isDirty(base, { ...base, birthDate: '1980-01-01' })).toBe(true);
  });

  it('isDirty ignore les champs NON enregistrés (avatar)', () => {
    expect(isDirty(base, { ...base, avatarUrl: '/uploads/avatars/u1-2.png' })).toBe(false);
  });

  it('isDirty est insensible à un retour serveur en ISO complet (régression normalisation)', () => {
    // Le serveur renvoie l'ISO complet, le formulaire manipule YYYY-MM-DD :
    // sans normalisation dans buildProfileBody, la page serait dirty au chargement.
    expect(isDirty(base, { ...base, birthDate: '1973-07-08' })).toBe(false);
  });

  it('licenceDirty compare en ignorant les espaces de bord', () => {
    expect(licenceDirty('LIC42', 'LIC42')).toBe(false);
    expect(licenceDirty('LIC42', '  LIC42  ')).toBe(false);
    expect(licenceDirty('LIC42', 'LIC99')).toBe(true);
    expect(licenceDirty('', 'LIC1')).toBe(true);
  });
});

describe('memberSinceYear', () => {
  it(`extrait l'année d'un ISO`, () => {
    expect(memberSinceYear('2024-03-01T10:00:00.000Z')).toBe(2024);
  });

  it('renvoie null sans date', () => {
    expect(memberSinceYear(null)).toBeNull();
    expect(memberSinceYear(undefined)).toBeNull();
    expect(memberSinceYear('')).toBeNull();
  });

  it(`renvoie null sur une date illisible`, () => {
    expect(memberSinceYear('bientôt')).toBeNull();
    // Année parseable mais implausible : c'est `> 1900` qui l'attrape, pas `Number.isInteger`.
    expect(memberSinceYear('0024-03-01T10:00:00.000Z')).toBeNull();
  });
});
