import { renderLayout, Brand } from '../templates/layout';

const clubBrand: Brand = {
  name: 'Padel Arena Paris',
  logoUrl: 'http://localhost:3001/uploads/logos/x.png',
  accentColor: '#5e93da',
  address: '12 rue du Padel, Paris',
  phone: '01 23 45 67 89',
  email: 'contact@arena.fr',
  manageUrl: 'https://padel-arena-paris.palova.fr/me/profile',
};

const base = { heading: 'Titre', introHtml: '<p>Corps</p>' };

describe('renderLayout — gabarit « Éditorial épuré »', () => {
  it('liseré en tête à la couleur du club', () => {
    const html = renderLayout({ brand: clubBrand, ...base });
    expect(html).toContain('background:#5e93da');
    expect(html).toContain('height:5px');
  });

  it('en-tête centré : logo + nom en petites capitales', () => {
    const html = renderLayout({ brand: clubBrand, ...base });
    expect(html).toContain('src="http://localhost:3001/uploads/logos/x.png"');
    expect(html).toContain('text-transform:uppercase');
    expect(html).toContain('Padel Arena Paris');
  });

  it('sans logo : tuile encre avec l\'initiale', () => {
    const html = renderLayout({ brand: { ...clubBrand, logoUrl: null }, ...base });
    expect(html).toContain('>P</td>');
    expect(html).toContain('background:#181d26');
  });

  it('titre en serif centré', () => {
    const html = renderLayout({ brand: clubBrand, ...base });
    expect(html).toMatch(/<h1[^>]*Georgia[^>]*>/);
    expect(html).toMatch(/<h1[^>]*text-align:center[^>]*>/);
  });

  it('CTA = pill sombre', () => {
    const html = renderLayout({ brand: clubBrand, ...base, ctaLabel: 'Voir', ctaUrl: 'https://x.fr' });
    expect(html).toContain('border-radius:999px');
    expect(html).toContain('href="https://x.fr"');
    expect(html).toMatch(/bgcolor="#181d26"/);
  });

  it('pied de page : coordonnées du club + « Gérer mes notifications » + Palova', () => {
    const html = renderLayout({ brand: clubBrand, ...base });
    expect(html).toContain('12 rue du Padel, Paris');
    expect(html).toContain('01 23 45 67 89');
    expect(html).toContain('contact@arena.fr');
    expect(html).toContain('href="https://padel-arena-paris.palova.fr/me/profile"');
    expect(html).toContain('Gérer mes notifications');
    expect(html).toContain('Envoyé avec Palova');
  });

  it('coordonnées absentes : lignes omises proprement', () => {
    const html = renderLayout({ brand: { name: 'Palova', logoUrl: null, accentColor: '#5e93da' }, ...base });
    expect(html).not.toContain('Gérer mes notifications');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
    expect(html).toContain('Envoyé avec Palova');
  });

  it('codeBlock (emails plateforme) toujours rendu', () => {
    const html = renderLayout({ brand: clubBrand, ...base, codeBlock: { code: '123456' } });
    expect(html).toContain('123456');
    expect(html).toContain('Courier');
  });

  it('infoRows entre filets fins, valeur à droite', () => {
    const html = renderLayout({ brand: clubBrand, ...base, infoRows: [{ label: 'Date', value: 'demain' }] });
    expect(html).toContain('border-top:1px solid #e8eaee');
    expect(html).toContain('demain');
  });
});
