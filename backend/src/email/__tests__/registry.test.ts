import {
  substituteText,
  substituteHtml,
  sanitizeBodyHtml,
  collectPlaceholders,
} from '../registry';

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
