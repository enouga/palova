'use client';
import { useState, useRef, CSSProperties } from 'react';
import { api, ClubReservation, Member, CreateMemberBody, PaymentMethod, AddPaymentBody, Payment, MemberPackage } from '@/lib/api';
import { toCents, fmtEuros, deriveSlots, QUICK_METHOD_LABEL, SlotEntry, PaymentIntent, isOptimisticId } from '@/lib/caisse';
import { pickPackageFor, packageLabel } from '@/lib/packages';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { colorForSeed } from '@/lib/playerColors';
import { Icon, IconName } from '@/components/ui/Icon';
import { PlayerPicker } from '@/components/admin/PlayerPicker';

const CORAL = '#ff7a4d';
const METHOD_ICON: Record<string, IconName> = { CASH: 'euro', CARD: 'card', VOUCHER: 'ticket', CHEQUE: 'ticket', CLUB: 'home', TRANSFER: 'arrowR', MEMBER: 'user', PACK_CREDIT: 'ticket', WALLET: 'euro', ONLINE: 'card', OTHER: 'euro', SUBSCRIPTION: 'user' };
// Libellé court de TOUS les moyens (un règlement peut venir de la modale : carnet, abo…).
const METHOD_LABEL_FULL: Record<string, string> = { CASH: 'Espèces', CARD: 'CB', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre', VOUCHER: 'Ticket CE', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre', SUBSCRIPTION: 'Abonnement' };

function mapPayError(e: unknown, perPlayer: boolean): string {
  const m = (e as Error).message;
  if (m === 'PAYMENT_EXCEEDS_DUE') return perPlayer ? 'Le montant dépasse la part du joueur.' : 'Le montant dépasse le reste dû.';
  return m;
}
function mapAssocError(e: unknown): string {
  const m = (e as Error).message;
  return ({
    TOO_MANY_PLAYERS: 'Terrain complet.',
    RESERVATION_HAS_NO_MEMBER: "Associez d'abord un joueur à la réservation.",
    PARTNER_DUPLICATE: 'Ce joueur est déjà ajouté.',
    MEMBER_NOT_FOUND: "Ce joueur n'est pas membre actif du club.",
  } as Record<string, string>)[m] ?? m;
}

export interface ReservationCollectProps {
  reservation: ClubReservation;
  players: number;        // capacité du terrain (2 single / 4 double)
  due: number;            // centimes — calculé par le parent (dueOf)
  members: Member[];
  quickMethods: PaymentMethod[];
  /** soldes prépayés utilisables, indexés par userId (boutons porte-monnaie/carnet). */
  packagesByUser?: Record<string, MemberPackage[]>;
  clubId: string;
  token: string;
  /** mutation (encaissement OU joueur) réussie → le parent recharge. */
  onChanged: (updated?: ClubReservation) => void | Promise<void>;
  /** patch local immédiat d'un encaissement (UI optimiste, avant l'aller-retour réseau). */
  onOptimisticPay?: (intent: PaymentIntent) => void;
  /** patch local immédiat d'une annulation de règlement (remboursement). */
  onOptimisticRefund?: (paymentIds: string[]) => void;
  /** ouvre la modale complète (montant libre, n° Ticket CE, carnet, reçu…). */
  onOpenDetails: () => void;
  /** annule la réservation (ConfirmDialog du parent). */
  onCancel?: () => void;
  onError: (msg: string) => void;
}

/**
 * Bloc d'encaissement compact affiché sous chaque réservation : une ligne fine
 * par place. Une place remplie encaisse la part du joueur ; une place vide
 * encaisse une part « anonyme » (sans nommer le joueur) ET propose de l'associer.
 * Boutons de moyens rapides configurés par le club, « Tout solder » et « Détails ».
 */
export function ReservationCollect({ reservation, players, due, members, quickMethods, packagesByUser, clubId, token, onChanged, onOptimisticPay, onOptimisticRefund, onOpenDetails, onCancel, onError }: ReservationCollectProps) {
  const { th } = useTheme();
  const [busyKey, setBusyKey] = useState<string | null>(null);   // verrou des actions JOUEUR (association) uniquement
  const [associatingIndex, setAssociatingIndex] = useState<number | null>(null);

  // File sérialisée des appels d'encaissement/remboursement de CETTE réservation :
  // l'UI réagit au clic (optimiste), les appels réseau s'enchaînent sans se chevaucher,
  // et on réconcilie avec le serveur UNE seule fois quand la file est vide.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const enqueue = (task: () => Promise<void>) => {
    pending.current += 1;
    const run = async () => {
      await task();
      pending.current -= 1;
      if (pending.current === 0) await onChanged();
    };
    chain.current = chain.current.then(run, run);
  };

  if (reservation.status === 'CANCELLED') return null;

  const paid = toCents(reservation.paidAmount);
  const remaining = Math.max(0, due - paid);
  const settled = due > 0 && remaining <= 0;
  const isCourt = reservation.type === 'COURT';
  const bills = reservation.participants ?? [];
  const slots: SlotEntry[] = isCourt ? deriveSlots(reservation, players) : [];
  const anyBusy = busyKey !== null;
  const methods = quickMethods.filter((m) => METHOD_ICON[m]); // moyens connus seulement

  // Part d'une place non nommée / du titulaire (répartition à parts égales), plafonnée au reste dû.
  const perPlayerCents = players > 0 ? Math.round(due / players) : remaining;
  const shareAmt = Math.min(perPlayerCents, remaining);

  // 1 place = 1 part ÉGALE (dû ÷ capacité). Joueur NOMMÉ : « réglé » suivi par SON propre
  // paiement (participantId) → l'encaissement est attribué à la bonne personne. Places
  // GÉNÉRIQUES/titulaire : paiement anonyme → on marque autant de places (de haut en bas)
  // que de parts anonymes encaissées (= payé total − payé attribué aux joueurs nommés).
  // Reste remboursable d'un paiement (centimes).
  const rem = (p: Payment) => toCents(p.amount) - toCents(p.refundedAmount ?? '0');
  const capShare = perPlayerCents;
  const participantPaidCents = bills.reduce((sum, p) => sum + toCents(p.paid), 0);
  const anonPaidCents = Math.max(0, paid - participantPaidCents);
  const coveredGeneric = capShare > 0 ? Math.floor(anonPaidCents / capShare) : 0;
  // Paiements anonymes encore remboursables (place générique/titulaire), ordonnés (createdAt asc côté API).
  const anonPays = (reservation.payments ?? []).filter((p) => !p.participantId && rem(p) > 0);
  // Pour chaque place anonyme : réglée ? et par quel paiement (→ moyen affiché + annulation ciblée).
  let genericSeen = 0;
  const genericSlotInfo = slots.map((s) => {
    if (s.kind === 'participant') return { paid: false, pay: null as Payment | null };
    const g = genericSeen; genericSeen += 1;
    const covered = g < coveredGeneric;
    return { paid: covered, pay: covered ? anonPays[g] ?? null : null };
  });

  // Encaisse une part : reflète le paiement IMMÉDIATEMENT (patch optimiste du parent),
  // puis envoie l'appel réseau en file. Pas de verrou : le comptoir enchaîne les clics.
  const pay = (amountCents: number, method: PaymentMethod, participantId?: string, sourcePackageId?: string) => {
    if (amountCents <= 0) return;
    onOptimisticPay?.({ amountCents, method, participantId: participantId ?? null });
    enqueue(async () => {
      try {
        const body: AddPaymentBody = { amount: amountCents / 100, method };
        if (participantId) body.participantId = participantId;
        if (sourcePackageId) body.sourcePackageId = sourcePackageId;
        await api.adminAddPayment(clubId, reservation.id, body, token);
      } catch (e) { onError(mapPayError(e, !!participantId)); }
    });
  };

  const needsHolder = !reservation.user && bills.length === 0;
  const associate = async (m: Member) => {
    if (busyKey) return;
    setBusyKey('assoc');
    try {
      const updated = needsHolder
        ? await api.adminAssignReservationMember(clubId, reservation.id, m.userId, token)
        : await api.adminAddReservationParticipant(clubId, reservation.id, m.userId, token);
      setAssociatingIndex(null);
      await onChanged(updated);
    } catch (e) { onError(mapAssocError(e)); }
    finally { setBusyKey(null); }
  };
  const createThen = async (body: CreateMemberBody, then: (m: Member) => Promise<void>) => {
    const r = await api.adminCreateMember(clubId, body, token);
    const mem = await api.adminGetMembers(clubId, token);
    const created = mem.find((m) => m.email.toLowerCase() === body.email.toLowerCase());
    if (created) await then(created);
    return r;
  };
  const createAndAssociate = (body: CreateMemberBody) => createThen(body, associate);

  // Annule (rembourse) le règlement d'une ligne : reflète le remboursement immédiatement,
  // puis rembourse intégralement les paiements (déjà persistés) en file. Les paiements
  // encore optimistes (non persistés) sont ignorés — ils n'existent pas côté serveur.
  const refundLine = (pays: Payment[]) => {
    const targets = pays.filter((p) => rem(p) > 0 && !isOptimisticId(p.id));
    if (targets.length === 0) return;
    onOptimisticRefund?.(targets.map((p) => p.id));
    enqueue(async () => {
      try {
        for (const p of targets) await api.refundPayment(clubId, p.id, { amount: rem(p) / 100, reason: 'Annulation au comptoir' }, token);
      } catch (e) { onError((e as Error).message); }
    });
  };

  // ── styles (lignes fines, une rangée qui s'enroule) ─────────────────────
  const container: CSSProperties = { background: th.surface, borderRadius: 12, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: '6px 6px 10px', marginBottom: 10 };
  // Bandes zébrées : chaque place lit comme une rangée continue en pleine largeur — l'œil
  // relie sans effort le nom (à gauche) à son statut / ses boutons (à droite), même large.
  const row = (i: number): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 8px', borderRadius: 9, minHeight: 40, background: i % 2 === 1 ? th.surface2 : 'transparent' });
  const nameStyle: CSSProperties = { flex: '1 1 100px', minWidth: 0, fontFamily: th.fontUI, fontSize: 14, fontWeight: 500, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7 };
  const regle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent, whiteSpace: 'nowrap' };

  // Badge « réglé » + MOYEN de règlement (comment ça a été réglé) + lien discret « annuler » (remboursement) si remboursable.
  const settledBadge = (pays: Payment[], method?: PaymentMethod) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
      <span style={regle}><Icon name="check" size={12} color={th.accent} />réglé</span>
      {method && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: th.fontUI, fontSize: 11, color: th.textMute }}>
          {METHOD_ICON[method] && <Icon name={METHOD_ICON[method]} size={11} color={th.textMute} />}{METHOD_LABEL_FULL[method] ?? method}
        </span>
      )}
      {pays.some((p) => rem(p) > 0 && !isOptimisticId(p.id)) && (
        <button type="button" disabled={anyBusy} onClick={() => refundLine(pays)}
          style={{ border: 'none', background: 'transparent', cursor: anyBusy ? 'default' : 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, textDecoration: 'underline', padding: 0 }}>annuler</button>
      )}
    </span>
  );

  const avatar = (seed: string, first: string, last: string, dim = false) => {
    const c = colorForSeed(seed);
    return (
      <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: c, color: inkOn(c), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, fontSize: 9.5, fontWeight: 700, opacity: dim ? 0.45 : 1 }}>
        {(first[0] ?? '').toUpperCase()}{(last[0] ?? '').toUpperCase()}
      </span>
    );
  };

  // Boutons de moyens rapides : l'encaissement est optimiste (réaction au clic), donc pas
  // d'état « occupé » par bouton ; seules les actions JOUEUR (association) grisent la rangée.
  const quickRow = (amountCents: number, participantId?: string, userId?: string, allowEntries = true) => {
    const pkgs = userId ? (packagesByUser?.[userId] ?? []) : [];
    // Porte-monnaie d'abord (débit € exact) ; carnet seulement si autorisé (1 entrée = 1 part).
    const pk = pickPackageFor(pkgs, amountCents, 'WALLET') ?? (allowEntries ? pickPackageFor(pkgs, amountCents, 'ENTRIES') : null);
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {methods.map((m) => {
          const primary = m === methods[0];
          return (
            <button key={m} type="button" disabled={anyBusy} onClick={() => pay(amountCents, m, participantId)}
              style={{ height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '0 12px', border: 'none', borderRadius: 9,
                cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy ? 0.5 : 1,
                background: primary ? th.accent : th.surface, color: primary ? th.onAccent : th.text,
                boxShadow: primary ? 'none' : `inset 0 0 0 1.5px ${th.lineStrong}`, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
              <Icon name={METHOD_ICON[m]} size={13} color={primary ? th.onAccent : th.textMute} />{QUICK_METHOD_LABEL[m]}
            </button>
          );
        })}
        {pk && (
          <button key="prepaid" type="button" disabled={anyBusy}
            onClick={() => pay(amountCents, pk.kind === 'ENTRIES' ? 'PACK_CREDIT' : 'WALLET', participantId, pk.id)}
            title={`Régler avec ${packageLabel(pk)}`}
            style={{ height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '0 12px', border: 'none', borderRadius: 9,
              cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy ? 0.5 : 1, background: th.surface, color: th.text,
              boxShadow: `inset 0 0 0 1.5px ${th.accent}`, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
            <Icon name="ticket" size={13} color={th.accent} />{pk.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie'}
          </button>
        )}
      </div>
    );
  };

  // Avatar neutre numéroté pour un joueur générique non renseigné.
  const genericAvatar = (n: number) => (
    <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: th.surfaceHi, color: th.textMute, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, fontSize: 10, fontWeight: 700 }}>{n}</span>
  );

  const renderSlot = (s: SlotEntry, i: number) => {
    if (s.kind === 'empty') {
      if (associatingIndex === s.index) {
        return (
          <div key={`e${s.index}`} style={row(i)}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <PlayerPicker members={members} value={null} onSelect={associate} onClear={() => setAssociatingIndex(null)} onCreate={createAndAssociate} placeholder="Rechercher un membre…" />
            </div>
          </div>
        );
      }
      // Joueur générique par défaut : la place est encaissable (sa part) et reste associable à un membre.
      const info = genericSlotInfo[i];
      const placePaid = info.paid || settled;
      return (
        <div key={`e${s.index}`} style={row(i)}>
          {genericAvatar(i + 1)}
          <span style={nameStyle}>
            <span style={{ color: th.textMute }}>Joueur {i + 1}</span>
            <button type="button" aria-label="Associer un membre" onClick={() => setAssociatingIndex(s.index)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, padding: 0 }}>associer</button>
          </span>
          {placePaid
            ? settledBadge(info.pay ? [info.pay] : [], info.pay?.method)
            : (remaining > 0 && quickRow(shareAmt))}
        </div>
      );
    }
    if (s.kind === 'holder') {
      const info = genericSlotInfo[i];
      const placePaid = info.paid || settled;
      return (
        <div key="holder" style={row(i)}>
          {avatar(s.seed, s.firstName, s.lastName, placePaid)}
          <span style={nameStyle}>{s.firstName} {s.lastName}</span>
          {placePaid ? settledBadge(info.pay ? [info.pay] : [], info.pay?.method) : quickRow(shareAmt, undefined, reservation.user?.id ?? undefined, true)}
        </div>
      );
    }
    // Place nommée : « réglé » suivi par SON paiement ; elle ne règle QUE sa part (dû ÷ capacité).
    const playerRemaining = Math.max(0, capShare - s.paidCents);
    const placePaid = playerRemaining <= 0 || settled;
    const ownPays = (reservation.payments ?? []).filter((p) => p.participantId === s.participantId);
    const ownMethod = ownPays.length ? ownPays[ownPays.length - 1].method : undefined;
    return (
      <div key={s.participantId} style={row(i)}>
        {avatar(s.seed, s.firstName, s.lastName, placePaid)}
        <span style={nameStyle}>
          {s.firstName} {s.lastName}
          {s.isOrganizer && <span style={{ fontSize: 9.5, fontWeight: 600, color: th.textFaint, background: th.surfaceHi, borderRadius: 5, padding: '1px 5px' }}>orga</span>}
        </span>
        {placePaid
          ? settledBadge(ownPays, ownMethod)
          : quickRow(Math.min(playerRemaining, remaining), s.participantId, bills.find((b) => b.id === s.participantId)?.userId, true)}
      </div>
    );
  };

  // « Tout solder » (ou « Encaisser » pour un event) : régler le reste total d'un coup.
  const wholeRow = !settled && remaining > 0 && (!isCourt || players >= 2);
  const wholeLabel = isCourt ? 'Tout solder' : 'Encaisser';

  return (
    <div style={container}>
      {slots.map(renderSlot)}

      {wholeRow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 8px', borderTop: slots.length ? `1px dashed ${th.line}` : 'none', marginTop: slots.length ? 6 : 0 }}>
          <span style={{ flex: '1 1 90px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>{wholeLabel} · <span style={{ color: CORAL }}>{fmtEuros(remaining)}</span></span>
          {quickRow(remaining, undefined, reservation.user?.id ?? undefined, false)}
        </div>
      )}

      {due <= 0 && !settled && (
        <button type="button" onClick={onOpenDetails} style={{ width: '100%', height: 38, border: 'none', borderRadius: 10, background: th.accent, color: th.onAccent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, marginTop: 6 }}>Encaisser un montant…</button>
      )}

      <div style={{ marginTop: 8, padding: '8px 8px 0', borderTop: `1px solid ${th.line}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={onOpenDetails} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0 }}>
          Détails / options <Icon name="chevR" size={14} color={th.accent} />
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, padding: 0 }}>Annuler</button>
        )}
      </div>
    </div>
  );
}
