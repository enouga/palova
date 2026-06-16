import { buildMatchConfirmEmail } from '../templates/emails';
import { PALOVA_BRAND } from '../templates/layout';

describe('buildMatchConfirmEmail', () => {
  it('produit subject/html/text mentionnant le score et un lien', () => {
    const out = buildMatchConfirmEmail({
      brand: PALOVA_BRAND, recipientFirstName: 'Eric',
      scoreLine: '6-4 / 6-3', matchUrl: 'https://x.palova.fr/me/matchs', authorName: 'Luc',
    });
    expect(out.subject).toMatch(/résultat|confirmer|confirme/i);
    expect(out.html).toContain('6-4 / 6-3');
    expect(out.html).toContain('https://x.palova.fr/me/matchs');
    expect(out.text).toContain('Eric');
  });
});
