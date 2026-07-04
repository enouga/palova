import { inboxPreview, dayKey, dayLabel, isReadByOther, applyReactionToggle } from '@/lib/messages';
import { ConversationSummary, DmMessage } from '@/lib/api';

const NOW = new Date('2026-07-04T15:00:00');

const conv = (over: Partial<ConversationSummary['lastMessage']> & { mine?: boolean } = {}): ConversationSummary => ({
  id: 'c1', other: { userId: 'u2', firstName: 'Marie', lastName: 'D', avatarUrl: null },
  clubId: null, lastMessageAt: '2026-07-04T10:00:00Z', unreadCount: 0,
  lastMessage: { body: 'salut', hasImage: false, mine: false, deleted: false, ...over },
});

describe('inboxPreview', () => {
  it('message de l\'autre → texte brut', () => expect(inboxPreview(conv())).toBe('salut'));
  it('mon message → préfixe « Vous : »', () => expect(inboxPreview(conv({ mine: true }))).toBe('Vous : salut'));
  it('photo → 📷 Photo', () => expect(inboxPreview(conv({ body: '', hasImage: true }))).toBe('📷 Photo'));
  it('supprimé → message supprimé', () => expect(inboxPreview(conv({ deleted: true }))).toBe('message supprimé'));
  it('sans dernier message → chaîne vide', () => expect(inboxPreview({ ...conv(), lastMessage: null })).toBe(''));
});

describe('dayKey / dayLabel', () => {
  it('clé locale stable YYYY-MM-DD', () => expect(dayKey('2026-07-04T10:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  it('aujourd\'hui / hier / date longue', () => {
    expect(dayLabel('2026-07-04T08:00:00', NOW)).toBe("aujourd'hui");
    expect(dayLabel('2026-07-03T23:00:00', NOW)).toBe('hier');
    expect(dayLabel('2026-07-01T10:00:00', NOW)).toMatch(/1 juillet/);
  });
});

describe('isReadByOther', () => {
  it('lu ssi otherLastReadAt >= createdAt', () => {
    expect(isReadByOther('2026-07-04T10:00:00Z', '2026-07-04T11:00:00Z')).toBe(true);
    expect(isReadByOther('2026-07-04T10:00:00Z', '2026-07-04T09:00:00Z')).toBe(false);
    expect(isReadByOther('2026-07-04T10:00:00Z', null)).toBe(false);
  });
});

describe('applyReactionToggle (patch local optimiste)', () => {
  const msg: DmMessage = { id: 'm1', author: { userId: 'u2', firstName: 'M', lastName: 'D', avatarUrl: null },
    body: 'x', imageUrl: null, createdAt: '2026-07-04T10:00:00Z', deleted: false,
    reactions: [{ emoji: '👍', userIds: ['u2'] }] };
  it('ajoute ma réaction', () => {
    const r = applyReactionToggle(msg.reactions, '👍', 'u1');
    expect(r).toEqual([{ emoji: '👍', userIds: ['u2', 'u1'] }]);
  });
  it('retire ma réaction existante (toggle) et purge l\'emoji vide', () => {
    const r = applyReactionToggle([{ emoji: '👍', userIds: ['u1'] }], '👍', 'u1');
    expect(r).toEqual([]);
  });
});
