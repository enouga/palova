import {
  substituteText,
  substituteHtml,
  sanitizeBodyHtml,
  collectPlaceholders,
} from '../registry';
import { EMAIL_DEFS, sampleVars } from '../registry';

describe('substituteText', () => {
  it('remplace les variables connues par leur valeur brute', () => {
    expect(substituteText('Bonjour {{prenom}} !', { prenom: 'Léa & Co' }))
      .toBe('Bonjour Léa & Co !');
  });
  it('retire les placeholders inconnus', () => {
    expect(substituteText('A {{x}} B', {})).toBe('A  B');
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
