import { buildVerificationEmail, buildPasswordResetEmail, buildBroadcastEmail } from '../templates/emails';
import { escapeHtml, readableTextOn, darken, PALOVA_BRAND } from '../templates/layout';
import { absoluteAsset, clubAppUrl, formatDateFr, formatDateRangeFr } from '../links';
import { Brand } from '../templates/layout';
import { brandFromClub } from '../registry';

describe('buildVerificationEmail', () => {
  const palova: Brand = { ...PALOVA_BRAND, logoUrl: 'https://palova.fr/icon-192.png' };

  it('met le code en avant dans le HTML, le sujet et le texte de repli', () => {
    const mail = buildVerificationEmail('493028', palova);
    expect(mail.subject).toContain('code de validation');
    expect(mail.html).toContain('493028');
    expect(mail.html).toContain('Votre code');
    expect(mail.html).toContain('15 minutes');
    expect(mail.text).toContain('493028'); // repli texte
  });

  it('intègre le logo Palova (URL absolue) dans l en-tête', () => {
    const mail = buildVerificationEmail('000000', palova);
    expect(mail.html).toContain('https://palova.fr/icon-192.png');
    expect(mail.html).toContain('Palova');
  });

  it('échappe un code potentiellement dangereux', () => {
    const mail = buildVerificationEmail('<x>', palova);
    expect(mail.html).not.toContain('<x>');
    expect(mail.html).toContain('&lt;x&gt;');
  });
});

describe('buildPasswordResetEmail', () => {
  const palova: Brand = { ...PALOVA_BRAND, logoUrl: 'https://palova.fr/icon-192.png' };

  it('met le code en avant dans le sujet, le HTML et le texte de repli', () => {
    const mail = buildPasswordResetEmail('724193', palova);
    expect(mail.subject).toContain('mot de passe');
    expect(mail.html).toContain('724193');
    expect(mail.html).toContain('15 minutes');
    expect(mail.text).toContain('724193');
  });

  it('intègre le logo Palova (URL absolue) dans l en-tête', () => {
    const mail = buildPasswordResetEmail('000000', palova);
    expect(mail.html).toContain('https://palova.fr/icon-192.png');
  });
});

describe('buildBroadcastEmail — corps HTML riche', () => {
  const brand: Brand = { name: 'Padel Arena', logoUrl: null, accentColor: '#5e93da' };

  it('rend le corps riche (gras, liste) et un sujet « titre — club »', () => {
    const mail = buildBroadcastEmail({
      title: 'News',
      bodyHtml: '<p>Bonjour <strong>tous</strong></p><ul><li>Point</li></ul>',
      url: null,
      brand,
    });
    expect(mail.subject).toBe('News — Padel Arena');
    expect(mail.html).toContain('<strong>tous</strong>');
    expect(mail.html).toContain('<li>Point</li>');
    expect(mail.text).toContain('Bonjour tous'); // repli texte dérivé du HTML
  });

  it('assainit : retire les balises interdites (script), garde les images /uploads', () => {
    const mail = buildBroadcastEmail({
      title: 'X',
      bodyHtml: '<p>ok</p><script>alert(1)</script><img src="/uploads/a.png">',
      url: null,
      brand,
    });
    expect(mail.html).not.toContain('<script');
    expect(mail.html).toContain('/uploads/a.png');
  });
});

describe('helpers HTML', () => {
  it('escapeHtml neutralise les balises', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });

  it('readableTextOn : texte foncé sur accent clair, clair sur fond foncé', () => {
    expect(readableTextOn('#d6ff3f')).toBe('#0b0b0c'); // lime clair → texte foncé
    expect(readableTextOn('#0b1f3a')).toBe('#ffffff'); // bleu nuit → texte clair
  });

  it('PALOVA_BRAND = bleu primaire du site', () => {
    expect(PALOVA_BRAND.accentColor).toBe('#5e93da');
  });

  it('darken assombrit une couleur (bleu Palova → ~navy)', () => {
    expect(darken('#5e93da', 0.5)).toBe('#2f4a6d');
    expect(darken('#ffffff', 0.5)).toBe('#808080');
    expect(darken('pas-une-couleur')).toBe('pas-une-couleur'); // repli inchangé
  });
});

describe('links', () => {
  it('clubAppUrl construit le sous-domaine du club', () => {
    // En test, FRONTEND_ROOT_DOMAIN n'est pas « palova.fr » → on vérifie juste le slug + chemin.
    const url = clubAppUrl('arena', '/tournois/t1');
    expect(url).toContain('arena');
    expect(url).toContain('/tournois/t1');
  });

  it('absoluteAsset laisse une URL http intacte et préfixe les chemins /uploads', () => {
    expect(absoluteAsset('https://cdn.x/logo.png')).toBe('https://cdn.x/logo.png');
    expect(absoluteAsset('/uploads/logo.png')).toContain('/uploads/logo.png');
    expect(absoluteAsset(null)).toBeNull();
  });

  it('formatDateFr rend une date lisible en français', () => {
    const out = formatDateFr(new Date('2026-07-12T07:00:00.000Z'), 'Europe/Paris');
    expect(out).toContain('juillet');
    expect(out).toContain('2026');
  });

  describe('formatDateRangeFr', () => {
    const start = new Date('2026-07-12T07:00:00.000Z'); // 09h00 Paris
    const tz = 'Europe/Paris';

    it('sans fin : début seul (identique à formatDateFr)', () => {
      expect(formatDateRangeFr(start, null, tz)).toBe(formatDateFr(start, tz));
    });

    it('fin le même jour : ajoute « → HHhmm »', () => {
      const end = new Date('2026-07-12T10:00:00.000Z'); // 12h00 Paris
      const out = formatDateRangeFr(start, end, tz);
      expect(out).toContain('09h00');
      expect(out).toContain('→ 12h00');
    });

    it('fin un autre jour : ajoute « → <date complète> »', () => {
      const end = new Date('2026-07-13T10:00:00.000Z'); // 13 juillet 12h00 Paris
      const out = formatDateRangeFr(start, end, tz);
      expect(out).toContain('→');
      expect(out).toContain('13 juillet');
      expect(out).toContain('12h00');
    });

    it('fin incohérente (≤ début) : ignorée', () => {
      const end = new Date('2026-07-12T06:00:00.000Z'); // avant le début
      expect(formatDateRangeFr(start, end, tz)).toBe(formatDateFr(start, tz));
    });
  });
});

describe('brandFromClub — logotype email', () => {
  const base = { name: 'Padel Arena', accentColor: '#5e93da', slug: 'padel-arena' };
  it('préfère logoWideUrl à logoUrl', () => {
    const b = brandFromClub({ ...base, logoUrl: '/uploads/logos/i.png', logoWideUrl: '/uploads/logos/w.png' } as any);
    expect(b.logoUrl).toContain('/uploads/logos/w.png');
  });
  it('repli sur logoUrl si pas de wide', () => {
    const b = brandFromClub({ ...base, logoUrl: '/uploads/logos/i.png', logoWideUrl: null } as any);
    expect(b.logoUrl).toContain('/uploads/logos/i.png');
  });
});
