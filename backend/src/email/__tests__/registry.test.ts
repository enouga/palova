import {
  substituteText,
  substituteHtml,
  sanitizeBodyHtml,
  collectPlaceholders,
} from '../registry';
import { EMAIL_DEFS, sampleVars } from '../registry';
import { renderClubEmail, brandFromClub } from '../registry';

const brand = brandFromClub({ name: 'Padel Arena', logoUrl: null, accentColor: '#1a2b3c' });

describe('substituteText', () => {
  it('remplace les variables connues par leur valeur brute', () => {
    expect(substituteText('Bonjour {{prenom}} !', { prenom: 'Léa & Co' }))
      .toBe('Bonjour Léa & Co !');
  });
  it('retire les placeholders inconnus', () => {
    expect(substituteText('A {{x}} B', {})).toBe('A  B');
  });
  it('retire les clés héritées du prototype (toString, constructor)', () => {
    expect(substituteText('a {{toString}} z', {})).toBe('a  z');
  });
  it('tolère les espaces autour du nom de variable', () => {
    expect(substituteText('a {{ prenom }} z', { prenom: 'X' })).toBe('a X z');
  });
});

describe('substituteHtml', () => {
  it('échappe la valeur insérée dans le HTML', () => {
    expect(substituteHtml('<p>{{nom}}</p>', { nom: '<b>x</b>' }))
      .toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
  });
  it('retire les placeholders inconnus', () => {
    expect(substituteHtml('<p>{{y}}</p>', {})).toBe('<p></p>');
  });
});

describe('sanitizeBodyHtml', () => {
  it('garde les balises autorisées', () => {
    const out = sanitizeBodyHtml('<p>Salut <strong>toi</strong> <a href="https://x.fr">ici</a></p>');
    expect(out).toContain('<strong>toi</strong>');
    expect(out).toContain('href="https://x.fr"');
  });
  it('supprime script et attributs on*', () => {
    const out = sanitizeBodyHtml('<p onclick="evil()">hi</p><script>alert(1)</script>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
  });
  it('supprime les schémas de lien dangereux', () => {
    const out = sanitizeBodyHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });
});

describe('collectPlaceholders', () => {
  it('liste les clés uniques utilisées', () => {
    expect(collectPlaceholders('{{a}} {{b}} {{a}}').sort()).toEqual(['a', 'b']);
  });
});

describe('EMAIL_DEFS', () => {
  const entries = Object.entries(EMAIL_DEFS);

  it('contient 17 définitions et la clé == type', () => {
    expect(entries).toHaveLength(17);
    for (const [key, def] of entries) expect(def.type).toBe(key);
  });

  it('chaque défaut ne référence que des variables déclarées', () => {
    for (const [, def] of entries) {
      const declared = new Set(def.vars.map((v) => v.key));
      const used = new Set<string>([
        ...collectPlaceholders(def.defaults.subject),
        ...collectPlaceholders(def.defaults.heading),
        ...collectPlaceholders(def.defaults.bodyHtml),
        ...collectPlaceholders(def.defaults.ctaLabel ?? ''),
        ...collectPlaceholders(def.defaults.footerNote ?? ''),
      ]);
      for (const k of used) expect(declared.has(k)).toBe(true);
    }
  });

  it('champs requis non vides', () => {
    for (const [, def] of entries) {
      expect(def.defaults.subject.trim()).not.toBe('');
      expect(def.defaults.heading.trim()).not.toBe('');
      expect(def.defaults.bodyHtml.trim()).not.toBe('');
      expect(def.title.trim()).not.toBe('');
    }
  });

  it('sampleVars renvoie une valeur par variable déclarée', () => {
    const def = EMAIL_DEFS['registration.confirmed'];
    const s = sampleVars(def);
    for (const v of def.vars) expect(s[v.key]).toBe(v.sample);
  });
});

describe('renderClubEmail', () => {
  const vars = {
    prenom: 'Marie', activite: 'Tournoi P100', ref_activite: 'le tournoi',
    club: 'Padel Arena', date: 'dim. 6 juil. 14h00', coequipier: '', phrase_coequipier: '',
    lien: 'https://x.fr/t/1',
  };

  it('utilise les défauts quand pas de surcharge', () => {
    const mail = renderClubEmail('registration.confirmed', vars, brand, null);
    expect(mail.subject).toBe('Inscription confirmée — Tournoi P100');
    expect(mail.html).toContain('Inscription confirmée ✅');
    expect(mail.html).toContain('<strong>Tournoi P100</strong>');
    expect(mail.html).toContain('href="https://x.fr/t/1"');
    expect(mail.text).toContain('Marie');
    expect(mail.text).toContain('Club : Padel Arena');
  });

  it('applique la surcharge club', () => {
    const mail = renderClubEmail('registration.confirmed', vars, brand, {
      subject: 'Bienvenue {{prenom}} !', heading: 'Yes', bodyHtml: '<p>OK {{activite}}</p>',
      ctaLabel: null, footerNote: null,
    } as any);
    expect(mail.subject).toBe('Bienvenue Marie !');
    expect(mail.html).toContain('OK Tournoi P100');
  });

  it('échappe les valeurs et retire les placeholders inconnus dans le corps', () => {
    const mail = renderClubEmail('registration.confirmed', { ...vars, activite: '<b>x</b>' }, brand, {
      subject: 's', heading: 'h', bodyHtml: '<p>{{activite}} {{inconnu}}</p>', ctaLabel: null, footerNote: null,
    } as any);
    expect(mail.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(mail.html).not.toContain('{{inconnu}}');
  });

  it('assainit le corps personnalisé', () => {
    const mail = renderClubEmail('registration.confirmed', vars, brand, {
      subject: 's', heading: 'h', bodyHtml: '<p>hi<script>alert(1)</script></p>', ctaLabel: null, footerNote: null,
    } as any);
    expect(mail.html).not.toContain('<script');
  });

  it('lève EMAIL_TYPE_UNKNOWN pour un type inconnu', () => {
    expect(() => renderClubEmail('nope', {}, brand, null)).toThrow('EMAIL_TYPE_UNKNOWN');
  });

  it('produit un texte brut lisible (valeurs brutes, paragraphes séparés)', () => {
    const mail = renderClubEmail('registration.confirmed', {
      prenom: 'Léa', activite: 'Tennis & Padel', ref_activite: 'le tournoi',
      club: 'Smith & Co', date: 'dim. 6 juil. 14h00', coequipier: '', phrase_coequipier: '',
      lien: 'https://x.fr/t/1',
    }, brand, null);
    expect(mail.text).toContain('Bonjour Léa,');
    expect(mail.text).toContain('Tennis & Padel');
    expect(mail.text).toContain('Club : Smith & Co');
    expect(mail.text).not.toContain('&amp;');
    expect(mail.text).not.toContain('&lt;');
    expect(mail.text).not.toContain('Léa,Votre');
  });

  it('ne nettoie PAS le corps par défaut (styles inline préservés)', () => {
    const mail = renderClubEmail('match.disputed', {
      prenom: 'Marie', auteur: 'Éric', score: '6-4 / 6-3', extrait: 'Litige',
      lien: 'https://x.fr/m/1',
    }, brand, null);
    expect(mail.html).toContain('background:#f4f4f5');
  });
});
