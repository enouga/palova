import { iconLogo, wideLogo, LOGO_WARNING_LABEL, clientRatioWarning } from '@/lib/clubLogos';

const c = (o: Partial<{ logoUrl: string | null; logoWideUrl: string | null; logoWideDarkUrl: string | null }>) =>
  ({ logoUrl: null, logoWideUrl: null, logoWideDarkUrl: null, ...o });

describe('clubLogos', () => {
  it('iconLogo lit logoUrl', () => {
    expect(iconLogo(c({ logoUrl: '/i.png', logoWideUrl: '/w.png' }))).toBe('/i.png');
  });
  it('wideLogo clair : wide ?? icon', () => {
    expect(wideLogo(c({ logoUrl: '/i.png' }), 'daylight')).toBe('/i.png');
    expect(wideLogo(c({ logoUrl: '/i.png', logoWideUrl: '/w.png' }), 'daylight')).toBe('/w.png');
  });
  it('wideLogo sombre : dark ?? wide ?? icon', () => {
    expect(wideLogo(c({ logoUrl: '/i.png', logoWideUrl: '/w.png', logoWideDarkUrl: '/d.png' }), 'floodlit')).toBe('/d.png');
    expect(wideLogo(c({ logoUrl: '/i.png', logoWideUrl: '/w.png' }), 'floodlit')).toBe('/w.png');
  });
  it('clientRatioWarning : icône non carrée / trop petite (seuil 512, miroir serveur)', () => {
    expect(clientRatioWarning(300, 100, 'icon')).toBe('NOT_SQUARE');
    expect(clientRatioWarning(300, 300, 'icon')).toBe('TOO_SMALL'); // carrée mais < 512
    expect(clientRatioWarning(600, 600, 'icon')).toBeNull();        // carrée ≥ 512
  });
  it('LOGO_WARNING_LABEL couvre les 3 codes', () => {
    expect(LOGO_WARNING_LABEL.NOT_SQUARE).toBeTruthy();
    expect(LOGO_WARNING_LABEL.TOO_SMALL).toBeTruthy();
    expect(LOGO_WARNING_LABEL.LOOKS_SQUARE).toBeTruthy();
  });
});
