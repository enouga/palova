import { PALOVA_BRAND } from '../templates/layout';
import { buildNewClubEmail, buildClubSetupReminderEmail, buildClubAutoSuspendedEmail } from '../templates/clubLifecycle';

describe('clubLifecycle emails', () => {
  it('buildNewClubEmail : sujet + nom club + badge vérifié + échappement', () => {
    const m = buildNewClubEmail({
      clubName: 'Padel <b>Arena</b>', clubUrl: 'https://arena.palova.fr', city: 'Paris',
      ownerName: 'Jean Test', ownerEmail: 'jean@ex.fr', ownerPhone: '0600000000',
      siret: '44306184100047', legalName: 'ARENA SARL', verified: true,
      url: 'https://palova.fr/superadmin/clubs', brand: PALOVA_BRAND,
    });
    expect(m.subject).toContain('Padel');
    expect(m.html).toContain('&lt;b&gt;Arena&lt;/b&gt;'); // échappé, pas injecté
    expect(m.html).toContain('44306184100047');
    expect(m.text).toContain('vérifié');
    expect(m.text).toContain('0600000000');
  });

  it('buildNewClubEmail : mention « non vérifié » quand verified=false', () => {
    const m = buildNewClubEmail({
      clubName: 'X', clubUrl: 'u', city: null, ownerName: 'O', ownerEmail: 'o@e.fr', ownerPhone: '06',
      siret: '44306184100047', legalName: null, verified: false, url: 'u', brand: PALOVA_BRAND,
    });
    expect(m.text.toLowerCase()).toContain('non vérifié');
  });

  it('buildClubSetupReminderEmail : ton accompagnement + lien admin', () => {
    const m = buildClubSetupReminderEmail({ clubName: 'Mon Club', adminUrl: 'https://c.palova.fr/admin', brand: PALOVA_BRAND });
    expect(m.subject).toContain('Mon Club');
    expect(m.html).toContain('https://c.palova.fr/admin');
  });

  it('buildClubAutoSuspendedEmail : explique la mise en veille', () => {
    const m = buildClubAutoSuspendedEmail({ clubName: 'Mon Club', adminUrl: 'https://c.palova.fr/admin', brand: PALOVA_BRAND });
    expect(m.subject.toLowerCase()).toContain('veille');
    expect(m.text).toContain('Mon Club');
  });
});
