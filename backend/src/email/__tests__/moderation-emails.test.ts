import { buildClubMessageReportEmail, buildPlatformMessageReportEmail } from '../templates/moderation';
import { PALOVA_BRAND, Brand } from '../templates/layout';

describe('buildClubMessageReportEmail', () => {
  const brand: Brand = { ...PALOVA_BRAND, name: 'Padel Arena Paris' };

  it('inclut auteur, terrain, date, extrait et lien vers la modération', () => {
    const mail = buildClubMessageReportEmail({
      authorName: 'Marie D.', excerpt: 'propos déplacés', court: 'Court 2',
      when: 'samedi 12 juillet 2026 à 18h00', url: 'https://demo.palova.fr/admin/moderation', brand,
    });
    expect(mail.subject).toContain('Padel Arena Paris');
    expect(mail.html).toContain('Marie D.');
    expect(mail.html).toContain('Court 2');
    expect(mail.html).toContain('propos déplacés');
    expect(mail.html).toContain('https://demo.palova.fr/admin/moderation');
    expect(mail.text).toContain('propos déplacés');
  });

  it('échappe le contenu dynamique', () => {
    const mail = buildClubMessageReportEmail({
      authorName: '<script>alert(1)</script>', excerpt: '<b>x</b>', court: 'Court 1',
      when: 'demain', url: 'https://x/admin/moderation', brand,
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<b>x</b>');
  });
});

describe('buildPlatformMessageReportEmail', () => {
  it('signale la présence d une photo', () => {
    const mail = buildPlatformMessageReportEmail({
      authorName: 'Jean D.', excerpt: 'message signalé', hasImage: true,
      url: 'https://palova.fr/superadmin/moderation', brand: PALOVA_BRAND,
    });
    expect(mail.html).toContain('photo');
    expect(mail.text).toContain('photo');
  });

  it('sans photo, ne mentionne rien à ce sujet', () => {
    const mail = buildPlatformMessageReportEmail({
      authorName: 'Jean D.', excerpt: 'message signalé', hasImage: false,
      url: 'https://palova.fr/superadmin/moderation', brand: PALOVA_BRAND,
    });
    expect(mail.html).not.toContain('Il contient une photo');
  });
});
