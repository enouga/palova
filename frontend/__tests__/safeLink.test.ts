import { isSafeHttpUrl } from '@/lib/safeLink';

describe('isSafeHttpUrl', () => {
  it('accepte http/https', () => {
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
    expect(isSafeHttpUrl('http://example.com/x?y=1')).toBe(true);
  });

  it('rejette javascript:/data:/vbscript:', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('null/vide/malformée → false', () => {
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
  });
});
