import { randomFileName, isLegacyAvatarUrl } from '../uploads';

describe('randomFileName', () => {
  it('produit un jeton opaque de 32 hex + extension', () => {
    expect(randomFileName('png')).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(randomFileName('webp')).toMatch(/^[0-9a-f]{32}\.webp$/);
  });

  it('ne répète jamais le même nom', () => {
    const names = new Set(Array.from({ length: 200 }, () => randomFileName('jpg')));
    expect(names.size).toBe(200);
  });
});

describe('isLegacyAvatarUrl', () => {
  it('reconnaît l’ancien motif <userId>-<timestamp>.<ext>', () => {
    expect(isLegacyAvatarUrl('/uploads/avatars/cmqfcjs0w000fokkk3iujuzlj-1781673806077.jpg')).toBe(true);
    expect(isLegacyAvatarUrl('/uploads/avatars/u1-1000.png')).toBe(true);
    expect(isLegacyAvatarUrl('/uploads/avatars/u1-1000.webp')).toBe(true);
  });

  it('ignore le nouveau motif opaque (idempotence de la migration)', () => {
    expect(isLegacyAvatarUrl(`/uploads/avatars/${randomFileName('jpg')}`)).toBe(false);
    expect(isLegacyAvatarUrl('/uploads/avatars/0123456789abcdef0123456789abcdef.png')).toBe(false);
  });
});
