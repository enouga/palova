import { sanitizeExternalLinkUrl } from '../url';

describe('sanitizeExternalLinkUrl', () => {
  it('laisse passer http/https', () => {
    expect(sanitizeExternalLinkUrl('https://example.com/promo')).toBe('https://example.com/promo');
    expect(sanitizeExternalLinkUrl('http://example.com')).toBe('http://example.com');
  });

  it('rejette javascript:/data: (XSS stocké)', () => {
    expect(sanitizeExternalLinkUrl("javascript:fetch('https://evil.example')")).toBeNull();
    expect(sanitizeExternalLinkUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeExternalLinkUrl('vbscript:msgbox(1)')).toBeNull();
  });

  it('vide/absent/URL malformée → null', () => {
    expect(sanitizeExternalLinkUrl(undefined)).toBeNull();
    expect(sanitizeExternalLinkUrl(null)).toBeNull();
    expect(sanitizeExternalLinkUrl('  ')).toBeNull();
    expect(sanitizeExternalLinkUrl('pas une url')).toBeNull();
  });

  it('trim préservé sur une URL valide', () => {
    expect(sanitizeExternalLinkUrl('  https://example.com  ')).toBe('https://example.com');
  });
});
