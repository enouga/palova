import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CollectPanel } from '../components/admin/CollectPanel';
import { ThemeProvider } from '../lib/ThemeProvider';
import { api, ClubReservation } from '../lib/api';

jest.mock('../lib/api', () => ({
  api: {
    adminAddPayment: jest.fn().mockResolvedValue({ id: 'p1' }),
    adminGetMemberPackages: jest.fn().mockResolvedValue([]),
    adminGetMembers: jest.fn().mockResolvedValue([]),
    adminAssignReservationMember: jest.fn(),
    adminAddReservationParticipant: jest.fn(),
    adminRemoveReservationParticipant: jest.fn(),
    adminChangeReservationParticipant: jest.fn(),
    refundPayment: jest.fn(),
    adminCreateMember: jest.fn(),
  },
  assetUrl: (u: string | null) => u,
}));

const RV = (over: Partial<ClubReservation> = {}): ClubReservation => ({
  id: 'rv-1', resourceId: 'court-1',
  startTime: '2026-06-22T14:00:00.000Z', endTime: '2026-06-22T15:00:00.000Z',
  status: 'CONFIRMED', type: 'COURT', title: null,
  totalPrice: '52.00', paidAmount: '0.00', dueAmount: '52.00',
  resource: { id: 'court-1', name: 'Court 1' },
  user: null, payments: [], participants: [], ...over,
});

function renderPanel(over: Partial<ClubReservation> = {}, props: Record<string, unknown> = {}) {
  const onChanged = jest.fn(); const onPaid = jest.fn(); const onError = jest.fn();
  render(
    <ThemeProvider>
      <CollectPanel reservation={RV(over)} due={5200} players={4} members={[]}
        clubId="club-1" token="tok" onChanged={onChanged} onPaid={onPaid} onError={onError} {...props} />
    </ThemeProvider>,
  );
  return { onChanged, onPaid, onError };
}

describe('CollectPanel', () => {
  it('préremplit le montant avec le reste dû et encaisse en 1 clic (Carte)', async () => {
    const { onChanged, onPaid } = renderPanel();
    expect((screen.getByLabelText(/Encaisser/i) as HTMLInputElement).value).toBe('52');
    fireEvent.click(screen.getByRole('button', { name: 'Carte' }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ amount: 52, method: 'CARD' }), 'tok',
    ));
    expect(onChanged).toHaveBeenCalled();
    expect(onPaid).toHaveBeenCalled();
  });

  it('met en avant les moyens rapides du club (comme la page) tout en gardant tous les moyens', () => {
    renderPanel({}, { quickMethods: ['TRANSFER', 'MEMBER'] });
    const labels = ['Carte', 'Espèces', 'Virement', 'Ticket CE', 'Abo / Membre', 'Autre'];
    // tous les moyens manuels restent disponibles
    labels.forEach((l) => expect(screen.getByRole('button', { name: l })).toBeInTheDocument());
    // les moyens rapides configurés par le club passent en tête (Virement avant Carte)
    const order = screen.getAllByRole('button').map((b) => b.textContent?.trim()).filter((t): t is string => !!t && labels.includes(t));
    expect(order[0]).toBe('Virement');
    expect(order.indexOf('Virement')).toBeLessThan(order.indexOf('Carte'));
  });

  it('désactive les moyens au-delà du plafond', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/Encaisser/i), { target: { value: '80' } });
    expect(screen.getByRole('button', { name: 'Espèces' })).toBeDisabled();
  });

  it('« Régler » un joueur cible son participantId dans l\'encaissement', async () => {
    const part = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '0.00', outstanding: '13.00' };
    renderPanel({ participants: [part] });
    fireEvent.click(screen.getByRole('button', { name: 'Régler' }));
    expect((screen.getByLabelText(/Encaisser/i) as HTMLInputElement).value).toBe('13');
    fireEvent.click(screen.getByRole('button', { name: 'Espèces' }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ amount: 13, method: 'CASH', participantId: 'pt-1' }), 'tok',
    ));
  });

  it('paiement par carnet → adminAddPayment en PACK_CREDIT avec sourcePackageId', async () => {
    const carnet = { id: 'pk-1', kind: 'ENTRIES', creditsTotal: 10, creditsRemaining: 5, amountTotal: null, amountRemaining: null, purchasedAt: '', expiresAt: null };
    renderPanel(
      { user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' } },
      { packagesByUser: { u1: [carnet] } },
    );
    const btn = await screen.findByRole('button', { name: /Carnet/ });
    fireEvent.click(btn);
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ method: 'PACK_CREDIT', sourcePackageId: 'pk-1', amount: 52 }), 'tok',
    ));
  });

  it('porte-monnaie : encaisse le montant affiché (« / joueur »), pas le total', async () => {
    const wallet = { id: 'pk-w', kind: 'WALLET', creditsTotal: null, creditsRemaining: null, amountTotal: '130.00', amountRemaining: '130.00', purchasedAt: '', expiresAt: null };
    renderPanel(
      { user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' } },
      { packagesByUser: { u1: [wallet] } },
    );
    fireEvent.click(screen.getByRole('button', { name: '/ joueur 13 €' }));
    fireEvent.click(screen.getByRole('button', { name: /Porte-monnaie/ }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ method: 'WALLET', sourcePackageId: 'pk-w', amount: 13 }), 'tok',
    ));
  });

  it('« Changer » remplace un joueur via le sélecteur (adminChangeReservationParticipant)', async () => {
    (api.adminChangeReservationParticipant as jest.Mock).mockResolvedValue({ id: 'rv-1' });
    const orga = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Adam', lastName: 'Bernard', share: '13.00', paid: '0.00', outstanding: '13.00' };
    const ines = { id: 'pt-2', userId: 'u2', isOrganizer: false, firstName: 'Ines', lastName: 'Andre', share: '13.00', paid: '0.00', outstanding: '13.00' };
    const members = [{ userId: 'u9', firstName: 'Marie', lastName: 'Curie', email: 'marie@x.fr' }];
    renderPanel({ participants: [orga, ines] }, { members });
    // seule la ligne non-organisateur (Ines) propose « Changer »
    fireEvent.click(screen.getByRole('button', { name: 'Changer' }));
    const input = screen.getByPlaceholderText('Rechercher un membre…');
    fireEvent.focus(input);
    fireEvent.click(screen.getByText(/Marie Curie/));
    await waitFor(() => expect(api.adminChangeReservationParticipant).toHaveBeenCalledWith('club-1', 'rv-1', 'pt-2', 'u9', 'tok'));
  });

  it('affiche le moyen de règlement à côté de « réglé »', () => {
    const part = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '13.00', outstanding: '0.00' };
    const payment = { id: 'pay-1', amount: '13.00', method: 'CARD' as const, participantId: 'pt-1', payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-06-22T13:46:00.000Z', refundedAmount: '0.00', receiptNo: null };
    // due = paid → réservation soldée : le bloc d'encaissement est masqué, « Carte » ne vient donc QUE du badge.
    renderPanel({ participants: [part], payments: [payment], paidAmount: '13.00' }, { due: 1300 });
    expect(screen.getByText(/réglé/)).toBeInTheDocument();
    expect(screen.getByText(/Carte/)).toBeInTheDocument();
  });

  it('affiche les places libres par défaut jusqu\'à la capacité (comme la page)', () => {
    const part = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Dupont', share: '13.00', paid: '0.00', outstanding: '13.00' };
    renderPanel({ participants: [part] }); // 1 joueur, capacité 4 → places 2, 3, 4 libres
    expect(screen.getByText('Joueur 2')).toBeInTheDocument();
    expect(screen.getByText('Joueur 3')).toBeInTheDocument();
    expect(screen.getByText('Joueur 4')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Associer un membre/ })).toHaveLength(3);
  });

  it('« associer » une place libre ajoute un participant', async () => {
    (api.adminAddReservationParticipant as jest.Mock).mockResolvedValue({ id: 'rv-1' });
    const part = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Dupont', share: '13.00', paid: '0.00', outstanding: '13.00' };
    const members = [{ userId: 'u9', firstName: 'Marie', lastName: 'Curie', email: 'marie@x.fr' }];
    renderPanel({ participants: [part] }, { members });
    fireEvent.click(screen.getAllByRole('button', { name: /Associer un membre/ })[0]);
    fireEvent.focus(screen.getByPlaceholderText('Rechercher un membre…'));
    fireEvent.click(screen.getByText(/Marie Curie/));
    await waitFor(() => expect(api.adminAddReservationParticipant).toHaveBeenCalledWith('club-1', 'rv-1', 'u9', 'tok'));
  });

  it('collectEmptyPlaces : une place sans joueur est sélectionnable (« Régler ») et encaisse une part anonyme', async () => {
    const orga = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '0.00', outstanding: '13.00' };
    renderPanel({ participants: [orga] }, { collectEmptyPlaces: true });   // capacité 4 → 3 places vides
    const reglers = screen.getAllByRole('button', { name: 'Régler' });
    expect(reglers).toHaveLength(4);           // pt-1 + 3 places vides
    fireEvent.click(reglers[1]);               // 1re place vide
    fireEvent.click(screen.getByRole('button', { name: 'Carte' }));
    await waitFor(() => {
      const call = (api.adminAddPayment as jest.Mock).mock.calls.at(-1)!;
      expect(call[2]).toMatchObject({ amount: 13, method: 'CARD' });   // une part (52/4)
      expect(call[2].participantId).toBeUndefined();                    // paiement anonyme
    });
  });

  it('sans collectEmptyPlaces (défaut) : les places vides ne proposent pas « Régler »', () => {
    const orga = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '0.00', outstanding: '13.00' };
    renderPanel({ participants: [orga] });
    expect(screen.getAllByRole('button', { name: 'Régler' })).toHaveLength(1);   // seul pt-1
  });

  it('collectEmptyPlaces : une place vide couverte par un paiement anonyme affiche « réglé »', () => {
    const orga = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '13.00', outstanding: '0.00' };
    const anon = { id: 'pay-a', amount: '13.00', method: 'CASH' as const, participantId: null, payerName: null, note: null, voucherRef: null, voucherIssuer: null, voucherStatus: null, createdAt: '2026-06-22T13:46:00.000Z', refundedAmount: '0.00', receiptNo: null };
    renderPanel({ participants: [orga], payments: [anon], paidAmount: '26.00' }, { collectEmptyPlaces: true });
    expect(screen.getAllByText(/réglé/)).toHaveLength(2);   // organisateur + 1 place vide couverte
  });

  it('« Autre » ouvre un champ « comment » et enregistre le paiement avec la note', async () => {
    renderPanel();   // dû 52 €, aucun joueur ciblé
    (api.adminAddPayment as jest.Mock).mockClear();   // ce fichier n'a pas de beforeEach → on ignore les appels des tests précédents
    fireEvent.click(screen.getByRole('button', { name: 'Autre' }));       // ouvre le champ (ne paie PAS encore)
    expect(api.adminAddPayment).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText(/coffre-fort/i), { target: { value: 'Abonnement Jean' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ method: 'OTHER', amount: 52, note: 'Abonnement Jean' }), 'tok',
    ));
  });

  const holder = { user: { id: 'u1', firstName: 'Jean', lastName: 'Test', email: 'j@x.fr' } };
  const PRESETS = [{ label: 'Coffre', note: 'Coffre' }, { label: 'Offres', note: 'Offres' }, { label: 'Abonnement', note: 'Abonnement' }];
  const withSub = { settlementPresets: PRESETS, subscribedUserIds: new Set(['u1']) };   // titulaire u1 a un abonnement actif
  const wallet = { id: 'pk-w', kind: 'WALLET', creditsTotal: null, creditsRemaining: null, amountTotal: '130.00', amountRemaining: '130.00', purchasedAt: '', expiresAt: null };

  it('règlements « sans encaissement » (Coffre/Offres/Abonnement) → MEMBER + note, hors argent réel', async () => {
    renderPanel(holder, withSub);
    (api.adminAddPayment as jest.Mock).mockClear();
    ['Coffre', 'Offres', 'Abonnement'].forEach((l) => expect(screen.getByRole('button', { name: l })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Coffre' }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ method: 'MEMBER', amount: 52, note: 'Coffre' }), 'tok',   // MEMBER = hors MONEY_METHODS
    ));
  });

  it('affichés aussi si le joueur a un carnet/porte-monnaie (sans abonnement)', () => {
    renderPanel(holder, { settlementPresets: PRESETS, packagesByUser: { u1: [wallet] } });
    expect(screen.getByRole('button', { name: 'Coffre' })).toBeInTheDocument();
  });

  it("ne s'affichent QUE si le joueur a souscrit à des offres (ni abonnement ni carnet → masqués)", () => {
    renderPanel(holder, { settlementPresets: PRESETS });   // aucune offre pour u1
    expect(screen.queryByRole('button', { name: 'Coffre' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abonnement' })).toBeNull();
  });

  it('avec settlementPresets (joueur avec offre) : le bouton générique « Abo / Membre » est retiré (doublon avec Abonnement)', () => {
    renderPanel(holder, withSub);
    expect(screen.queryByRole('button', { name: 'Abo / Membre' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Abonnement' })).toBeInTheDocument();
  });

  it('le montant se recalcule quand le payé change (panneau resté ouvert)', () => {
    const onChanged = jest.fn();
    const { rerender } = render(
      <ThemeProvider><CollectPanel reservation={RV()} due={5200} players={4} members={[]} clubId="club-1" token="tok" onChanged={onChanged} /></ThemeProvider>,
    );
    expect((screen.getByLabelText(/Encaisser/i) as HTMLInputElement).value).toBe('52');
    rerender(
      <ThemeProvider><CollectPanel reservation={RV({ paidAmount: '20.00' })} due={5200} players={4} members={[]} clubId="club-1" token="tok" onChanged={onChanged} /></ThemeProvider>,
    );
    expect((screen.getByLabelText(/Encaisser/i) as HTMLInputElement).value).toBe('32');
  });

  const findGrid = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('div')).find((d) => d.style.display === 'grid');

  it('columns : Joueurs et Encaisser côte à côte dans une grille 2 colonnes (desktop)', () => {
    const { container } = render(
      <ThemeProvider>
        <CollectPanel reservation={RV()} due={5200} players={4} members={[]} clubId="club-1" token="tok" onChanged={jest.fn()} columns />
      </ThemeProvider>,
    );
    expect(findGrid(container)).toBeTruthy();
    // les deux sections restent présentes (l'action d'encaissement n'est plus reléguée sous Joueurs)
    expect(screen.getByText('Joueurs')).toBeInTheDocument();
    expect(screen.getByText('Montant à encaisser')).toBeInTheDocument();
  });

  it('columns : pas de grille quand la résa est soldée (Encaisser masqué → une seule colonne)', () => {
    const part = { id: 'pt-1', userId: 'u1', isOrganizer: true, firstName: 'Jean', lastName: 'Test', share: '13.00', paid: '13.00', outstanding: '0.00' };
    const { container } = render(
      <ThemeProvider>
        <CollectPanel reservation={RV({ participants: [part], paidAmount: '13.00' })} due={1300} players={4} members={[]} clubId="club-1" token="tok" onChanged={jest.fn()} columns />
      </ThemeProvider>,
    );
    expect(findGrid(container)).toBeUndefined();
    expect(screen.queryByText('Montant à encaisser')).toBeNull();
  });

  it('sans columns (défaut) : pas de grille (empilé, mobile)', () => {
    const { container } = render(
      <ThemeProvider>
        <CollectPanel reservation={RV()} due={5200} players={4} members={[]} clubId="club-1" token="tok" onChanged={jest.fn()} />
      </ThemeProvider>,
    );
    expect(findGrid(container)).toBeUndefined();
  });

  it('payAtClubOnly : un seul bouton « Encaissé » (moyen CLUB), pas de choix de moyen', async () => {
    renderPanel({}, { payAtClubOnly: true });
    // aucun bouton de moyen (Carte / Espèces / Ticket CE…)
    expect(screen.queryByRole('button', { name: 'Carte' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Espèces' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Encaissé/ }));
    await waitFor(() => expect(api.adminAddPayment).toHaveBeenCalledWith(
      'club-1', 'rv-1', expect.objectContaining({ method: 'CLUB', amount: 52 }), 'tok',
    ));
  });
});
