import { buildSocleFaq, SocleClubContext } from '../faqSocle';

const base: SocleClubContext = {
  name: 'Padel Arena',
  slug: 'arena',
  publicBookingDays: 7,
  memberBookingDays: 14,
  cancellationCutoffHours: 0,
  playerChangeCutoffHours: 0,
  refundOnCancelWithinCutoff: false,
  requireOnlinePayment: false,
  legalEmail: null,
  legalPhone: null,
};

const find = (items: ReturnType<typeof buildSocleFaq>, id: string) => {
  const it = items.find((x) => x.id === id);
  if (!it) throw new Error(`socle item introuvable: ${id}`);
  return it;
};

describe('buildSocleFaq', () => {
  it('renvoie une liste non vide avec id/catégorie/question/réponse', () => {
    const items = buildSocleFaq(base);
    expect(items.length).toBeGreaterThan(5);
    for (const it of items) {
      expect(typeof it.id).toBe('string');
      expect(it.id.length).toBeGreaterThan(0);
      expect(typeof it.category).toBe('string');
      expect(it.question.length).toBeGreaterThan(0);
      expect(it.answer.length).toBeGreaterThan(0);
    }
    // ids uniques
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('interpole le nom et le slug du club dans la réponse « réserver »', () => {
    const a = find(buildSocleFaq(base), 'reserver').answer;
    expect(a).toContain('Padel Arena');
    expect(a).toContain('arena');
  });

  it('interpole les fenêtres de réservation public/abonnés', () => {
    const a = find(buildSocleFaq({ ...base, publicBookingDays: 5, memberBookingDays: 21 }), 'fenetre').answer;
    expect(a).toContain('5');
    expect(a).toContain('21');
  });

  it('annulation : délai configuré → mentionne le nombre d\'heures', () => {
    const a = find(buildSocleFaq({ ...base, cancellationCutoffHours: 24 }), 'annuler').answer;
    expect(a).toContain('24');
  });

  it('annulation : 0h → mentionne « jusqu\'au début »', () => {
    const a = find(buildSocleFaq({ ...base, cancellationCutoffHours: 0 }), 'annuler').answer;
    expect(a.toLowerCase()).toContain('début');
  });

  it('remboursement automatique activé → réponse adaptée', () => {
    const a = find(buildSocleFaq({ ...base, refundOnCancelWithinCutoff: true }), 'remboursement').answer;
    expect(a.toLowerCase()).toContain('automati');
  });

  it('remboursement non automatique → renvoie vers la politique du club', () => {
    const a = find(buildSocleFaq({ ...base, refundOnCancelWithinCutoff: false }), 'remboursement').answer;
    expect(a.toLowerCase()).toContain('politique');
  });

  it('paiement en ligne requis → mentionne le paiement par carte en ligne', () => {
    const a = find(buildSocleFaq({ ...base, requireOnlinePayment: true }), 'paiement').answer;
    expect(a.toLowerCase()).toContain('en ligne');
  });

  it('paiement en ligne non requis → mentionne le paiement sur place', () => {
    const a = find(buildSocleFaq({ ...base, requireOnlinePayment: false }), 'paiement').answer;
    expect(a.toLowerCase()).toContain('sur place');
  });

  it('contact : email + téléphone présents → affichés ; sinon repli sans placeholder', () => {
    const withContact = find(buildSocleFaq({ ...base, legalEmail: 'contact@arena.fr', legalPhone: '01 23 45 67 89' }), 'contact').answer;
    expect(withContact).toContain('contact@arena.fr');
    expect(withContact).toContain('01 23 45 67 89');

    const without = find(buildSocleFaq(base), 'contact').answer;
    expect(without).not.toContain('{');
    expect(without).not.toContain('null');
  });
});
