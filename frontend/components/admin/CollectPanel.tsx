'use client';
import { useState, useEffect, CSSProperties } from 'react';
import { api, ClubReservation, Member, MemberPackage, CreateMemberBody, PaymentMethod, Payment } from '@/lib/api';
import { packageLabel, isUsable, canCover, prepaidHint } from '@/lib/packages';
import { toCents, centsToInput, quickAmounts, fmtEuros, validatePaymentAmount, DEFAULT_QUICK_METHODS } from '@/lib/caisse';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { colorForSeed } from '@/lib/playerColors';
import { PlayerPicker } from '@/components/admin/PlayerPicker';
import { Icon, IconName } from '@/components/ui/Icon';
import { Btn } from '@/components/ui/atoms';

const METHOD_LABEL: Record<string, string> = { CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', VOUCHER: 'Ticket CE', MEMBER: 'Abo / Membre', OTHER: 'Autre' };
// Libellé court de TOUS les moyens, pour le badge « réglé · {moyen} » (carnet/porte-monnaie/abo inclus).
const METHOD_SHORT: Record<string, string> = { CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', VOUCHER: 'Ticket CE', MEMBER: 'Abo', OTHER: 'Autre', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', SUBSCRIPTION: 'Abonnement' };
// Tous les moyens de paiement manuels du comptoir (carnets/porte-monnaie = boutons package à part).
const ALL_METHODS: PaymentMethod[] = ['CARD', 'CASH', 'TRANSFER', 'VOUCHER', 'MEMBER', 'OTHER'];
const METHOD_ICON: Partial<Record<PaymentMethod, IconName>> = { CARD: 'card', MEMBER: 'user', VOUCHER: 'ticket', CASH: 'euro', TRANSFER: 'arrowR', OTHER: 'euro' };

const CORAL = '#ff7a4d';

export interface CollectPanelProps {
  reservation: ClubReservation;
  due: number;       // centimes — calculé par le parent (dueCents)
  players: number;   // nb de joueurs du terrain (single=2 / double=4)
  members: Member[];
  clubId: string;
  token: string;
  /** moyens rapides configurés par le club → mis en avant (mêmes règles que la page). */
  quickMethods?: PaymentMethod[];
  /** soldes prépayés utilisables, indexés par userId (résolus pour la cible courante). */
  packagesByUser?: Record<string, MemberPackage[]>;
  /** mutation joueurs/participants réussie → le parent recharge (et met à jour la résa si fournie). */
  onChanged: (updated?: ClubReservation) => void;
  /** un encaissement a été enregistré (le parent peut fermer la modale). */
  onPaid?: () => void;
  /** rend les places SANS joueur sélectionnables (« Régler ») pour encaisser une part
   *  anonyme, et affiche leur statut « réglé » — utilisé par la modale du planning. Défaut false. */
  collectEmptyPlaces?: boolean;
  /** règlements « sans encaissement » (débités au joueur : coffre, offres, abonnement…) rendus
   *  en boutons 1 clic → enregistrés en MEMBER (hors totaux caisse) avec `note` = libellé.
   *  Affichés seulement si le joueur ciblé a souscrit à des offres (abonnement actif OU
   *  carnet/porte-monnaie). */
  settlementPresets?: { label: string; note: string }[];
  /** userId ayant un abonnement ACTIF (résolu par le parent) — pour la garde ci-dessus. */
  subscribedUserIds?: ReadonlySet<string>;
  onError?: (msg: string) => void;
}

export function CollectPanel({ reservation, due, players, members, clubId, token, quickMethods, packagesByUser, onChanged, onPaid, collectEmptyPlaces = false, settlementPresets, subscribedUserIds, onError }: CollectPanelProps) {
  const { th } = useTheme();

  // Moyens mis en avant (boutons pleins) = ceux configurés par le club, dans le même ordre que
  // la page Encaissement ; les autres moyens manuels restent disponibles en rangée discrète.
  // En présence de règlements « sans encaissement » (dont Abonnement), le bouton générique
  // « Abo / Membre » (MEMBER) ferait doublon → on le retire des moyens.
  const methodPool = ALL_METHODS.filter((m) => !(settlementPresets?.length && m === 'MEMBER'));
  const primaryMethods = (quickMethods && quickMethods.length ? quickMethods : DEFAULT_QUICK_METHODS).filter((m) => methodPool.includes(m));
  const secondaryMethods = methodPool.filter((m) => !primaryMethods.includes(m));
  const [payAmount, setPayAmount] = useState('');
  const [payParticipantId, setPayParticipantId] = useState<string | null>(null);
  const [payGenericN, setPayGenericN] = useState<number | null>(null);   // place SANS joueur sélectionnée (n° affiché)
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherRef, setVoucherRef] = useState('');
  const [voucherIssuer, setVoucherIssuer] = useState('');
  const [otherOpen, setOtherOpen] = useState(false);   // moyen « Autre » → champ « comment ça a été réglé »
  const [otherNote, setOtherNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);   // participant en cours de remplacement (sélecteur inline)
  const [associatingIndex, setAssociatingIndex] = useState<number | null>(null);   // place libre en cours d'association

  const fail = (msg: string) => onError?.(msg);
  const remaining = Math.max(0, due - toCents(reservation.paidAmount));

  // Réinitialise montant + voucher quand la résa cible change (ouverture / reload).
  useEffect(() => {
    setPayAmount(centsToInput(remaining));
    setPayParticipantId(null);
    setPayGenericN(null);
    setVoucherOpen(false); setVoucherRef(''); setVoucherIssuer('');
    setOtherOpen(false); setOtherNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation.id, reservation.paidAmount]);

  const bills = reservation.participants ?? [];
  const isCourt = reservation.type === 'COURT';
  // Places de la réservation = capacité du terrain (comme la page Encaissement) : les places
  // remplies viennent des participants (à défaut le titulaire occupe 1 place, affichée via
  // « Réservation au nom de »), le reste est libre/associable et numéroté. Hors COURT : aucune place.
  const filled = Math.max(bills.length, reservation.user ? 1 : 0);
  const emptyCount = isCourt ? Math.max(0, players - filled) : 0;
  const activePart = payParticipantId ? bills.find((p) => p.id === payParticipantId) ?? null : null;
  const maxPayable = activePart ? toCents(activePart.outstanding) : remaining;
  const amountC = toCents(payAmount);
  const overCap = due > 0 && amountC > maxPayable;
  const cannotPay = busy || !validatePaymentAmount(amountC, maxPayable);
  const capTitle = overCap ? `Plafond : ${fmtEuros(maxPayable)}` : undefined;
  // Soldé = il y a un prix dû et il est entièrement couvert (les events libres, due=0, restent encaissables).
  const settled = due > 0 && remaining <= 0;

  // Part d'une place (dû ÷ capacité) + places SANS joueur couvertes par les paiements anonymes
  // (payé total − payé attribué aux joueurs nommés) → statut « réglé » de haut en bas, comme la page.
  const perPlayerCents = players > 0 ? Math.round(due / players) : remaining;
  const participantPaidCents = bills.reduce((s, p) => s + toCents(p.paid), 0);
  const anonPaidCents = Math.max(0, toCents(reservation.paidAmount) - participantPaidCents);
  const coveredGeneric = perPlayerCents > 0 ? Math.floor(anonPaidCents / perPlayerCents) : 0;
  const anonPays = (reservation.payments ?? []).filter((p) => !p.participantId && toCents(p.amount) - toCents(p.refundedAmount ?? '0') > 0);

  // Soldes prépayés utilisables de la cible courante (joueur sélectionné, sinon titulaire).
  const targetUserId = activePart?.userId ?? reservation.user?.id ?? null;
  const selPackages = (targetUserId ? (packagesByUser?.[targetUserId] ?? []) : []).filter((p) => isUsable(p));
  // Règlements « sans encaissement » (offres souscrites) : proposés seulement si le joueur ciblé
  // (participant sélectionné, sinon titulaire) a souscrit à des offres — abonnement ACTIF en base
  // OU carnet/porte-monnaie utilisable.
  const hasSubscribedOffer = selPackages.length > 0 || !!(targetUserId && subscribedUserIds?.has(targetUserId));

  const payNow = async (method: PaymentMethod, noteOverride?: string) => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { fail('Montant invalide.'); return; }
    setBusy(true);
    try {
      await api.adminAddPayment(clubId, reservation.id, {
        amount, method,
        participantId: payParticipantId ?? undefined,
        note: noteOverride ?? (method === 'OTHER' ? otherNote.trim() || undefined : undefined),
        voucherRef: method === 'VOUCHER' ? voucherRef.trim() || undefined : undefined,
        voucherIssuer: method === 'VOUCHER' ? voucherIssuer.trim() || undefined : undefined,
      }, token);
      setPayParticipantId(null);
      setOtherOpen(false); setOtherNote('');
      onChanged(); onPaid?.();
    } catch (e) {
      fail((e as Error).message === 'PAYMENT_EXCEEDS_DUE'
        ? (payParticipantId ? 'Le montant dépasse la part du joueur.' : 'Le montant dépasse le prix de la réservation.')
        : (e as Error).message);
    } finally { setBusy(false); }
  };

  const payWithPackage = async (pkg: MemberPackage) => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { fail('Montant invalide.'); return; }
    setBusy(true);
    try {
      await api.adminAddPayment(clubId, reservation.id, {
        amount,
        method: pkg.kind === 'ENTRIES' ? 'PACK_CREDIT' : 'WALLET',
        sourcePackageId: pkg.id,
        participantId: payParticipantId ?? undefined,
      }, token);
      setPayParticipantId(null);
      onChanged(); onPaid?.();
    } catch (e) {
      fail((e as Error).message === 'INSUFFICIENT_BALANCE' ? 'Solde du package insuffisant.'
        : (e as Error).message === 'PAYMENT_EXCEEDS_DUE' ? (payParticipantId ? 'Le montant dépasse la part du joueur.' : 'Le montant dépasse le prix de la réservation.')
        : (e as Error).message);
    } finally { setBusy(false); }
  };

  // Clic sur un moyen : VOUCHER / OTHER ouvrent leur champ (réf. Ticket CE / « comment ça a été réglé »),
  // les autres encaissent directement.
  const onMethod = (m: PaymentMethod) => {
    if (m === 'VOUCHER') { setVoucherOpen((v) => !v); setOtherOpen(false); }
    else if (m === 'OTHER') { setOtherOpen((v) => !v); setVoucherOpen(false); }
    else payNow(m);
  };

  const participantErr = (code: string): string => ({
    TOO_MANY_PLAYERS: 'Terrain complet.',
    CANNOT_REMOVE_ORGANIZER: "Impossible de retirer l'organisateur.",
    RESERVATION_HAS_NO_MEMBER: "Associez d'abord un joueur à la réservation.",
    PARTNER_DUPLICATE: 'Ce joueur est déjà ajouté.',
    MEMBER_NOT_FOUND: "Ce joueur n'est pas membre actif du club.",
  }[code] ?? code);

  const assignPlayer = async (m: Member) => {
    setBusy(true);
    try { onChanged(await api.adminAssignReservationMember(clubId, reservation.id, m.userId, token)); }
    catch (e) { fail((e as Error).message === 'MEMBER_NOT_FOUND' ? "Ce joueur n'est pas membre actif du club." : (e as Error).message); }
    finally { setBusy(false); }
  };
  const addParticipant = async (m: Member) => {
    setBusy(true);
    try { onChanged(await api.adminAddReservationParticipant(clubId, reservation.id, m.userId, token)); }
    catch (e) { fail(participantErr((e as Error).message)); }
    finally { setBusy(false); }
  };
  const removeParticipant = async (participantId: string) => {
    setBusy(true);
    try {
      const updated = await api.adminRemoveReservationParticipant(clubId, reservation.id, participantId, token);
      if (payParticipantId === participantId) setPayParticipantId(null);
      onChanged(updated);
    } catch (e) { fail(participantErr((e as Error).message)); }
    finally { setBusy(false); }
  };
  // Remplace un joueur par un autre (membre du club) en une fois — recalcule les parts côté serveur.
  const changeParticipant = async (participantId: string, m: Member) => {
    setBusy(true);
    try {
      const updated = await api.adminChangeReservationParticipant(clubId, reservation.id, participantId, m.userId, token);
      setChangingId(null);
      if (payParticipantId === participantId) setPayParticipantId(null);
      onChanged(updated);
    } catch (e) { fail(participantErr((e as Error).message)); }
    finally { setBusy(false); }
  };

  // Annule (rembourse intégralement) les règlements déjà attribués à un joueur, puis recharge.
  const rem = (pp: Payment) => toCents(pp.amount) - toCents(pp.refundedAmount ?? '0');
  const refundParticipant = async (pays: Payment[]) => {
    const targets = pays.filter((pp) => rem(pp) > 0);
    if (targets.length === 0) return;
    setBusy(true);
    try {
      for (const pp of targets) await api.refundPayment(clubId, pp.id, { amount: rem(pp) / 100, reason: 'Annulation au comptoir' }, token);
      onChanged();
    } catch (e) { fail((e as Error).message); }
    finally { setBusy(false); }
  };

  // Création à la volée : crée le membre, le retrouve, applique l'action (assign/ajout).
  const createThen = async (body: CreateMemberBody, then: (m: Member) => Promise<void>) => {
    const r = await api.adminCreateMember(clubId, body, token);
    const mem = await api.adminGetMembers(clubId, token);
    const created = mem.find((m) => m.email.toLowerCase() === body.email.toLowerCase());
    if (created) await then(created);
    return r;
  };
  const createAndAssign = (body: CreateMemberBody) => createThen(body, assignPlayer);
  const createAndAddParticipant = (body: CreateMemberBody) => createThen(body, addParticipant);
  // Associe un membre à une place libre : 1re place sans titulaire → titulaire (assign),
  // sinon → participant supplémentaire (comme la page Encaissement).
  const associateEmpty = async (m: Member) => {
    if (!reservation.user && bills.length === 0) await assignPlayer(m);
    else await addParticipant(m);
    setAssociatingIndex(null);
  };
  const createAndAssociateEmpty = (body: CreateMemberBody) => createThen(body, associateEmpty);

  // ── tokens de style partagés ───────────────────────────────────────────
  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '7px 10px', fontFamily: th.fontUI, fontSize: 14 };
  const sectionLabel: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textMute };
  const caption: CSSProperties = { fontSize: 12, color: th.textMute, marginBottom: 8 };

  const targetTo = (id: string | null, cents: number) => { setPayParticipantId(id); setPayGenericN(null); setPayAmount(centsToInput(cents)); };
  // Sélectionne une place SANS joueur : encaissement anonyme (participantId null) d'une part.
  const targetGeneric = (n: number, cents: number) => { setPayParticipantId(null); setPayGenericN(n); setPayAmount(centsToInput(cents)); };

  // Avatar initiales, teinté par identité (cohérent avec le reste de l'app).
  const avatar = (seed: string, first: string, last: string) => {
    const c = colorForSeed(seed);
    return (
      <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: c, color: inkOn(c), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700 }}>
        {(first[0] ?? '').toUpperCase()}{(last[0] ?? '').toUpperCase()}
      </span>
    );
  };

  // Avatar neutre numéroté pour une place libre (joueur non renseigné).
  const genericAvatar = (n: number) => (
    <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: th.surfaceHi, color: th.textMute, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700 }}>{n}</span>
  );

  return (
    <div>
      {/* ── JOUEURS (fusion « Joueur » + « Par joueur ») — en tête, juste sous « Reste à encaisser » ── */}
      <div>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>Joueurs</div>

        {/* Titulaire de la réservation */}
        <div style={{ marginBottom: bills.length > 0 || emptyCount > 0 ? 12 : 4 }}>
          <div style={caption}>Réservation au nom de</div>
          <PlayerPicker
            members={members}
            value={reservation.user ? { firstName: reservation.user.firstName, lastName: reservation.user.lastName } : null}
            onSelect={assignPlayer} onClear={() => {}} onCreate={createAndAssign}
            placeholder="Cliquez pour voir les membres, ou tapez un nom…"
          />
        </div>

        {/* Répartition par joueur — places remplies + places libres jusqu'à la capacité */}
        {(bills.length > 0 || emptyCount > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {bills.map((p) => {
              const rest = toCents(p.outstanding);
              const paid = rest <= 0;
              const on = payParticipantId === p.id;
              const canRemove = !(p.isOrganizer && bills.length > 1);
              const canChange = !p.isOrganizer;   // le titulaire/organisateur se change via « Réservation au nom de »
              // Règlements attribués à CE joueur → moyen affiché + annulation ciblée.
              const ownPays = (reservation.payments ?? []).filter((pp) => pp.participantId === p.id);
              const method = ownPays.length ? ownPays[ownPays.length - 1].method : undefined;
              const refundable = ownPays.some((pp) => rem(pp) > 0);

              // En cours de remplacement : le sélecteur de membre occupe toute la ligne.
              if (changingId === p.id) {
                return (
                  <div key={p.id} style={{ padding: '2px 0' }}>
                    <div style={{ ...caption, marginBottom: 4 }}>Remplacer {p.firstName} {p.lastName} par…</div>
                    <PlayerPicker members={members} value={null}
                      onSelect={(m) => changeParticipant(p.id, m)} onClear={() => setChangingId(null)}
                      onCreate={(body) => createThen(body, (m) => changeParticipant(p.id, m))}
                      placeholder="Rechercher un membre…" />
                  </div>
                );
              }

              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 11px', borderRadius: 12, background: on ? `${th.accent}14` : th.surface2, boxShadow: on ? `inset 0 0 0 1.5px ${th.accent}` : 'inset 0 0 0 1px transparent' }}>
                  {avatar(p.id, p.firstName, p.lastName)}
                  <span style={{ flex: 1, minWidth: 90, fontFamily: th.fontUI, fontSize: 14, color: th.text, display: 'flex', alignItems: 'center', gap: 7 }}>
                    {p.firstName} {p.lastName}
                    {p.isOrganizer && <span style={{ fontSize: 11, fontWeight: 600, color: th.textFaint, background: th.surfaceHi, borderRadius: 6, padding: '2px 7px' }}>orga</span>}
                  </span>
                  <span style={{ fontFamily: th.fontMono, fontSize: 12.5, color: paid ? th.textMute : th.text, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtEuros(toCents(p.paid))} / {fmtEuros(toCents(p.share))}
                  </span>
                  {paid ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent }}>
                        <Icon name="check" size={13} color={th.accent} />réglé
                        {method && <span style={{ fontWeight: 600, color: th.textMute }}>· {METHOD_SHORT[method] ?? method}</span>}
                      </span>
                      {refundable && (
                        <button type="button" disabled={busy} onClick={() => refundParticipant(ownPays)}
                          style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, textDecoration: 'underline', padding: 0 }}>annuler</button>
                      )}
                    </span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => targetTo(p.id, rest)}
                      style={{ border: 'none', background: on ? th.accent : th.surface, color: on ? th.onAccent : th.text, boxShadow: on ? 'none' : `inset 0 0 0 1px ${th.line}`, borderRadius: 9, padding: '6px 12px', cursor: busy ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>Régler</button>
                  )}
                  {canChange && (
                    <button type="button" disabled={busy} title="Remplacer ce joueur" onClick={() => setChangingId(p.id)}
                      style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, padding: 0 }}>Changer</button>
                  )}
                  {canRemove && (
                    <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} title="Retirer ce joueur"
                      onClick={() => removeParticipant(p.id)}
                      style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textFaint, fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                  )}
                </div>
              );
            })}

            {/* Places libres (jusqu'à la capacité) — numérotées + associables, comme la page */}
            {Array.from({ length: emptyCount }).map((_, j) => {
              const idx = filled + j;   // index de place (stable parmi les places libres)
              const n = idx + 1;        // numéro affiché « Joueur N »
              if (associatingIndex === idx) {
                return (
                  <div key={`empty-${idx}`} style={{ padding: '2px 0' }}>
                    <PlayerPicker members={members} value={null}
                      onSelect={associateEmpty} onClear={() => setAssociatingIndex(null)}
                      onCreate={createAndAssociateEmpty} placeholder="Rechercher un membre…" />
                  </div>
                );
              }
              const gPaid = collectEmptyPlaces && (settled || j < coveredGeneric);   // place couverte par un paiement anonyme
              const gPay = collectEmptyPlaces && j < coveredGeneric ? anonPays[j] : undefined;   // règlement anonyme (best-effort) → moyen + annulation
              const gOn = payGenericN === n;
              return (
                <div key={`empty-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 11px', borderRadius: 12, background: gOn ? `${th.accent}14` : th.surface2, boxShadow: gOn ? `inset 0 0 0 1.5px ${th.accent}` : 'inset 0 0 0 1px transparent' }}>
                  {genericAvatar(n)}
                  <span style={{ flex: 1, minWidth: 90, fontFamily: th.fontUI, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: th.textMute }}>Joueur {n}</span>
                    <button type="button" aria-label="Associer un membre" disabled={busy} onClick={() => setAssociatingIndex(idx)}
                      style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, padding: 0 }}>associer</button>
                  </span>
                  {collectEmptyPlaces && !settled && (gPaid ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent }}>
                        <Icon name="check" size={13} color={th.accent} />réglé
                        {gPay?.method && <span style={{ fontWeight: 600, color: th.textMute }}>· {METHOD_SHORT[gPay.method] ?? gPay.method}</span>}
                      </span>
                      {gPay && rem(gPay) > 0 && (
                        <button type="button" disabled={busy} onClick={() => refundParticipant([gPay])}
                          style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, textDecoration: 'underline', padding: 0 }}>annuler</button>
                      )}
                    </span>
                  ) : (remaining > 0 && (
                    <button type="button" disabled={busy} onClick={() => targetGeneric(n, Math.min(perPlayerCents, remaining))}
                      style={{ border: 'none', background: gOn ? th.accent : th.surface, color: gOn ? th.onAccent : th.text, boxShadow: gOn ? 'none' : `inset 0 0 0 1px ${th.line}`, borderRadius: 9, padding: '6px 12px', cursor: busy ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>Régler</button>
                  )))}
                </div>
              );
            })}
          </div>
        )}

        {/* Ajout libre — events / réservations hors capacité COURT (les places numérotées remplacent ce picker pour un terrain) */}
        {!isCourt && (
          <div style={{ marginTop: 10 }}>
            <PlayerPicker members={members} value={null} onSelect={addParticipant} onClear={() => {}} onCreate={createAndAddParticipant} placeholder="+ Ajouter un joueur…" />
          </div>
        )}
      </div>

      {/* ── ENCAISSER — masqué quand soldé ─────────────────────── */}
      {!settled && (
        <div style={{ marginTop: 22, borderRadius: 16, background: th.surface2, padding: 14 }}>
          {/* Cible active : encaissement ciblé sur un joueur ou une place sans joueur (sinon, résa entière) */}
          {(activePart || payGenericN != null) && (
            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, background: `${th.accent}1f`, fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
              Encaisser pour <b>{activePart ? `${activePart.firstName} ${activePart.lastName}` : `Joueur ${payGenericN}`}</b>
              <button type="button" onClick={() => targetTo(null, remaining)}
                style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>Réservation entière</button>
            </div>
          )}

          {/* Montant */}
          <div style={caption}>Montant à encaisser</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: th.surface, borderRadius: 12, boxShadow: `inset 0 0 0 1.5px ${overCap ? CORAL : th.line}`, padding: '0 14px', height: 46 }}>
              <input type="number" min={0} step="0.1" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} aria-label="Montant à encaisser"
                style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: th.fontMono, fontWeight: 600, fontSize: 21, color: th.text, width: 84, textAlign: 'right' }} />
              <span style={{ fontFamily: th.fontMono, fontSize: 18, color: th.textMute }}>€</span>
            </div>
            {!payParticipantId && quickAmounts(due, toCents(reservation.paidAmount), players).map((q) => (
              <button key={q.key} type="button" onClick={() => setPayAmount(centsToInput(q.cents))}
                style={{ border: 'none', background: th.surface, boxShadow: `inset 0 0 0 1px ${th.line}`, color: th.text, borderRadius: 999, padding: '9px 14px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>
                {q.label}
              </button>
            ))}
          </div>
          {overCap && <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: CORAL }}>Plafond : {fmtEuros(maxPayable)}</div>}

          {/* Moyens — rapides du club (pleins) puis tous les autres (discrets) */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {primaryMethods.map((m) => (
              <button key={m} type="button" disabled={cannotPay} title={capTitle}
                onClick={() => onMethod(m)}
                style={{ flex: '1 1 130px', minWidth: 124, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', borderRadius: 11,
                  cursor: cannotPay ? 'default' : 'pointer', opacity: cannotPay ? 0.45 : 1, background: th.accent, color: th.onAccent,
                  fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, boxShadow: th.neon ? `0 6px 20px ${th.accent}33` : 'none',
                  outline: (m === 'VOUCHER' && voucherOpen) || (m === 'OTHER' && otherOpen) ? `2px solid ${th.text}` : 'none', outlineOffset: 2 }}>
                {METHOD_ICON[m] && <Icon name={METHOD_ICON[m]!} size={16} color={th.onAccent} />}
                {METHOD_LABEL[m]}
              </button>
            ))}
            {selPackages.map((p) => {
              const ok = !cannotPay && canCover(p, amountC / 100);
              return (
                <button key={p.id} type="button" disabled={!ok} title={ok ? `Régler avec ${packageLabel(p)}` : 'Solde insuffisant'}
                  onClick={() => payWithPackage(p)}
                  style={{ flex: '1 1 130px', minWidth: 124, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', borderRadius: 11,
                    cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.45, background: th.accent, color: th.onAccent,
                    fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, boxShadow: th.neon ? `0 6px 20px ${th.accent}33` : 'none' }}>
                  <Icon name="ticket" size={16} color={th.onAccent} />{packageLabel(p)}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {secondaryMethods.map((m) => (
              <button key={m} type="button" disabled={cannotPay} title={capTitle}
                onClick={() => onMethod(m)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', borderRadius: 10, padding: '9px 14px',
                  cursor: cannotPay ? 'default' : 'pointer', opacity: cannotPay ? 0.45 : 1, background: 'transparent',
                  boxShadow: `inset 0 0 0 1px ${(m === 'VOUCHER' && voucherOpen) || (m === 'OTHER' && otherOpen) ? th.text : th.line}`,
                  color: th.textMute, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>
                {METHOD_ICON[m] && <Icon name={METHOD_ICON[m]!} size={15} color={th.textMute} />}
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>

          {/* Règlements SANS encaissement (débités au joueur : coffre, offres, abonnement) →
              MEMBER (hors totaux caisse), le libellé est stocké en note. */}
          {settlementPresets && settlementPresets.length > 0 && hasSubscribedOffer && (
            <div style={{ marginTop: 12 }}>
              <div style={{ ...caption, marginBottom: 6 }}>Sans encaissement (débité au joueur)</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {settlementPresets.map((s) => (
                  <button key={s.note} type="button" disabled={cannotPay} title={capTitle}
                    onClick={() => payNow('MEMBER', s.note)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', borderRadius: 10, padding: '9px 14px',
                      cursor: cannotPay ? 'default' : 'pointer', opacity: cannotPay ? 0.45 : 1, background: 'transparent',
                      boxShadow: `inset 0 0 0 1px ${th.line}`, color: th.textMute, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>
                    <Icon name="user" size={15} color={th.textMute} />{s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ticket CE : référence / émetteur */}
          {voucherOpen && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Référence
                <input type="text" value={voucherRef} onChange={(e) => setVoucherRef(e.target.value)} placeholder="N° ticket" style={{ ...input, width: 110 }} />
              </label>
              <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Émetteur
                <input type="text" value={voucherIssuer} onChange={(e) => setVoucherIssuer(e.target.value)} placeholder="ANCV…" style={{ ...input, width: 96 }} />
              </label>
              <Btn onClick={() => payNow('VOUCHER')} icon="check" disabled={cannotPay}>{busy ? '…' : 'Valider Ticket CE'}</Btn>
              <button type="button" onClick={() => setVoucherOpen(false)} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, paddingBottom: 10 }}>Annuler</button>
            </div>
          )}

          {/* Autre : préciser comment ça a été réglé (ex. abonnement, coffre-fort) → note du paiement */}
          {otherOpen && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 }}>Comment ça a été réglé ?
                <input type="text" value={otherNote} onChange={(e) => setOtherNote(e.target.value)} placeholder="Ex. abonnement, coffre-fort…" style={input} />
              </label>
              <Btn onClick={() => payNow('OTHER')} icon="check" disabled={cannotPay}>{busy ? '…' : 'Valider'}</Btn>
              <button type="button" onClick={() => setOtherOpen(false)} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, paddingBottom: 10 }}>Annuler</button>
            </div>
          )}

          {/* Repli : aucun solde prépayé utilisable pour la cible */}
          {selPackages.length === 0 && (() => {
            const msg = prepaidHint(!!targetUserId, 0, maxPayable);
            return msg ? <div style={{ marginTop: 14, fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>{msg}</div> : null;
          })()}
        </div>
      )}
    </div>
  );
}
