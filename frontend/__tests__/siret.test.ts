import { siretIsValidFormat } from '@/lib/siret';

describe('siretIsValidFormat (front)', () => {
  it('accepte un SIRET valide', () => { expect(siretIsValidFormat('44306184100047')).toBe(true); });
  it('rejette longueur/format', () => {
    expect(siretIsValidFormat('4430618410004')).toBe(false);
    expect(siretIsValidFormat('4430618410004A')).toBe(false);
  });
  it('rejette clé de Luhn invalide', () => { expect(siretIsValidFormat('44306184100048')).toBe(false); });
});
