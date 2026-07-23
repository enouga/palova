import {
  broadcastHasContent, coupleChannels, hasAnyChannel,
  storePendingRecipients, readPendingRecipients, BROADCAST_RECIPIENTS_KEY,
} from '@/lib/broadcast';

describe('broadcastHasContent', () => {
  it('est faux pour un corps vide ou uniquement du markup blanc', () => {
    expect(broadcastHasContent('')).toBe(false);
    expect(broadcastHasContent('<p></p>')).toBe(false);
    expect(broadcastHasContent('<p>   </p>')).toBe(false);
    expect(broadcastHasContent('<p>&nbsp;</p>')).toBe(false);
  });

  it('est vrai dès qu il y a du texte réel', () => {
    expect(broadcastHasContent('<p>Bonjour</p>')).toBe(true);
    expect(broadcastHasContent('<ul><li>Point</li></ul>')).toBe(true);
  });

  it('est vrai pour une image même sans texte', () => {
    expect(broadcastHasContent('<p></p><img src="/uploads/a.png">')).toBe(true);
  });
});

describe('coupleChannels', () => {
  it('coupe le push si la cloche est off', () => {
    expect(coupleChannels({ email: true, inApp: false, push: true })).toEqual({ email: true, inApp: false, push: false });
  });
  it('laisse le push si la cloche est on', () => {
    expect(coupleChannels({ email: false, inApp: true, push: true })).toEqual({ email: false, inApp: true, push: true });
  });
});

describe('hasAnyChannel', () => {
  it('vrai si email OU cloche', () => {
    expect(hasAnyChannel({ email: true, inApp: false, push: false })).toBe(true);
    expect(hasAnyChannel({ email: false, inApp: true, push: false })).toBe(true);
  });
  it('faux si email et cloche off', () => {
    expect(hasAnyChannel({ email: false, inApp: false, push: false })).toBe(false);
  });
});

describe('destinataires en attente (sessionStorage)', () => {
  beforeEach(() => sessionStorage.clear());
  it('aller-retour + consommation (la lecture vide la clé)', () => {
    storePendingRecipients([{ userId: 'u1', name: 'Ines A.' }]);
    expect(readPendingRecipients()).toEqual([{ userId: 'u1', name: 'Ines A.' }]);
    expect(sessionStorage.getItem(BROADCAST_RECIPIENTS_KEY)).toBeNull();
  });
  it('clé absente ou corrompue → null', () => {
    expect(readPendingRecipients()).toBeNull();
    sessionStorage.setItem(BROADCAST_RECIPIENTS_KEY, '{oops');
    expect(readPendingRecipients()).toBeNull();
  });
});
