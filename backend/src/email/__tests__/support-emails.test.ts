import { buildSupportAckEmail } from '../templates/support';
import { PALOVA_BRAND } from '../templates/layout';

describe('buildSupportAckEmail', () => {
  it('inclut le numéro de ticket dans le sujet et le corps', () => {
    const m = buildSupportAckEmail({
      number: 42,
      subject: 'Planning cassé',
      clubName: 'Padel Arena Paris',
      brand: PALOVA_BRAND,
    });
    expect(m.subject).toBe('Votre demande #42 a bien été reçue');
    expect(m.html).toContain('#42');
    expect(m.text).toContain('#42');
    expect(m.html).toContain('Planning cassé');
  });

  it('sans numéro (repli email) : sujet sans référence', () => {
    const m = buildSupportAckEmail({
      number: null,
      subject: 'Question tarifs',
      clubName: 'Padel Arena Paris',
      brand: PALOVA_BRAND,
    });
    expect(m.subject).toBe('Votre demande a bien été reçue');
    expect(m.html).not.toContain('<strong> #');
  });

  it('échappe le HTML du sujet saisi', () => {
    const m = buildSupportAckEmail({
      number: 1,
      subject: '<img src=x>',
      clubName: 'Club',
      brand: PALOVA_BRAND,
    });
    expect(m.html).not.toContain('<img src=x>');
    expect(m.html).toContain('&lt;img');
  });
});
