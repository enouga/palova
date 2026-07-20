import { unsubscribeToken, verifyUnsubscribeToken } from '../unsubscribeToken';

describe('unsubscribeToken', () => {
  it('aller-retour : le token signé rend le userId', () => {
    const t = unsubscribeToken('user-123');
    expect(verifyUnsubscribeToken(t)).toBe('user-123');
  });
  it('signature altérée → null', () => {
    const t = unsubscribeToken('user-123');
    expect(verifyUnsubscribeToken(t.slice(0, -2) + 'aa')).toBeNull();
    expect(verifyUnsubscribeToken('nimporte')).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
  });
});
