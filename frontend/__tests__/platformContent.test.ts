import { PLATFORM_MENTIONS, PLATFORM_CGU, PLATFORM_CGV, PLATFORM_CONFIDENTIALITE } from '../lib/platformContent';

describe('documents légaux plateforme', () => {
  it('sont édités par Tolaris Studio et datés', () => {
    for (const doc of [PLATFORM_MENTIONS, PLATFORM_CGU, PLATFORM_CGV, PLATFORM_CONFIDENTIALITE]) {
      expect(doc).toContain('Version du 18 juillet 2026');
    }
    expect(PLATFORM_MENTIONS).toContain('Tolaris Studio');
    expect(PLATFORM_MENTIONS).toContain("cours d'immatriculation");
  });

  it('CGU : âge minimum et modération présents', () => {
    expect(PLATFORM_CGU).toContain('15 ans');
    expect(PLATFORM_CGU).toContain('Signal');
  });

  it('CGV SaaS : annexe de sous-traitance (DPA) présente', () => {
    expect(PLATFORM_CGV).toContain('Annexe');
    expect(PLATFORM_CGV).toContain('sous-traitance');
    expect(PLATFORM_CGV).toContain('article 28');
  });

  it('confidentialité : cookies documentés sans bandeau', () => {
    expect(PLATFORM_CONFIDENTIALITE).toContain('token');
    expect(PLATFORM_CONFIDENTIALITE).toContain('aucun bandeau');
  });
});
