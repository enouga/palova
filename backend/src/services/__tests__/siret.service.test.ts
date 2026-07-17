import { siretIsValidFormat } from '../siret.service';

describe('siretIsValidFormat', () => {
  it('accepte un SIRET valide (14 chiffres + clé de Luhn)', () => {
    // SIRET de test valide au sens Luhn (Google France, établissement connu).
    expect(siretIsValidFormat('44306184100047')).toBe(true);
  });

  it('rejette une longueur incorrecte', () => {
    expect(siretIsValidFormat('4430618410004')).toBe(false);  // 13
    expect(siretIsValidFormat('443061841000470')).toBe(false); // 15
  });

  it('rejette les caractères non numériques', () => {
    expect(siretIsValidFormat('4430618410004A')).toBe(false);
    expect(siretIsValidFormat('443 061 841 00047')).toBe(false);
  });

  it('rejette une clé de Luhn invalide', () => {
    expect(siretIsValidFormat('44306184100048')).toBe(false);
  });

  it('rejette vide/espace', () => {
    expect(siretIsValidFormat('')).toBe(false);
    expect(siretIsValidFormat('   ')).toBe(false);
  });
});
