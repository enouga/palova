'use client';
import { useEffect, useRef, useState, CSSProperties } from 'react';
import { api, ClubReservation, Member, CreateMemberBody, PaymentMethod, AddPaymentBody, Payment, MemberPackage } from '@/lib/api';
import { toCents, fmtEuros, isOptimisticId, PaymentIntent, QUICK_METHOD_LABEL } from '@/lib/caisse';
import { slotStatuses, nextSelectable, selectionTotal, SlotStatus } from '@/lib/caisseRegister';
import { pickPackageFor, packageLabel } from '@/lib/packages';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { colorForSeed } from '@/lib/playerColors';
import { Icon, IconName } from '@/components/ui/Icon';
import { AssociateMemberPicker } from '@/components/admin/caisse/AssociateMemberPicker';
import { SETTLED_COLOR } from '@/components/admin/PaymentDots';

const CORAL = '#ff7a4d';
const TOAST_MS = 6000;
const METHOD_ICON: Record<string, IconName> = { CASH: 'euro', CARD: 'card', VOUCHER: 'ticket', CHEQUE: 'ticket', CLUB: 'home', TRANSFER: 'arrowR', MEMBER: 'user', PACK_CREDIT: 'ticket', WALLET: 'euro', ONLINE: 'card', OTHER: 'euro', SUBSCRIPTION: 'user' };
const METHOD_LABEL_FULL: Record<string, string> = { CASH: 'Espèces', CARD: 'CB', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre', VOUCHER: 'Ticket CE', CHEQUE: 'Chèque', CLUB: 'Au club', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre', SUBSCRIPTION: 'Abonnement' };

function fmtTime(iso: string): string { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
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

/** Un lot d'encaissements annulable via le toast (les ids réels arrivent au fil de la file). */
interface UndoBatch {
  label: string;
  items: { amountCents: number; syntheticId: string; realId: string | null }[];
  /** ce lot a soldé la résa → à l'expiration du toast, la page passe à la suivante (desktop). */
  settledAll: boolean;
}

export interface CashRegisterProps {
  reservation: ClubReservation;
  players: number;          // capacité du terrain (2 single / 4 double), 0 hors COURT
  due: number;              // centimes — calculé par le parent (dueCents)
  members: Member[];
  quickMethods: PaymentMethod[];
  packagesByUser?: Record<string, MemberPackage[]>;
  clubId: string;
  slug: string;
  token: string;
  isDesktop: boolean;
  /** option club « paiement au club » : un seul bouton « Encaissé » (moyen neutre CLUB), pas de choix de moyen. */
  payAtClubOnly?: boolean;
  onChanged: (updated?: ClubReservation) => void | Promise<void>;
  /** patch local immédiat d'un encaissement ; renvoie l'id synthétique (`opt:N`) créé. */
  onOptimisticPay: (intent: PaymentIntent) => string;
  onOptimisticRefund: (paymentIds: string[]) => void;
  onOpenDetails: () => void;
  onCancel: () => void;
  onError: (msg: string) => void;
  /** la résa vient d'être soldée ET le toast a expiré → passer à la suivante. */
  onSettled?: () => void;
}

/**
 * Zone « caisse » de la page Caisse express : on sélectionne QUI paie (tuiles),
 * le montant à annoncer s'affiche en grand, puis un tap sur le MOYEN encaisse
 * (optimiste, un appel par place). Toast « Annuler » ~6 s après chaque lot.
 */
export function CashRegister({ reservation, players, due, members, quickMethods, packagesByUser, clubId, slug, token, isDesktop, payAtClubOnly = false, onChanged, onOptimisticPay, onOptimisticRefund, onOpenDetails, onCancel, onError, onSettled }: CashRegisterProps) {
  const { th } = useTheme();
  const isCourt = reservation.type === 'COURT';
  const paid = toCents(reservation.paidAmount);
  const remaining = Math.max(0, due - paid);
  const settled = due > 0 && remaining <= 0;
  const statuses: SlotStatus[] = isCourt && players > 0 ? slotStatuses(reservation, players, due) : [];

  // Sélection semée SYNCHRONEMENT dès le 1er rendu (pas via effet) : la caisse peut
  // être montée à la volée par la page (auto-sélection), et un clic sur un moyen doit
  // trouver une place déjà cochée. L'effet [rvId] plus bas re-sème au changement de résa.
  const [selected, setSelected] = useState<Set<number>>(() => {
    const first = nextSelectable(statuses);
    return first === null ? new Set() : new Set([first]);
  });
  const [associatingIndex, setAssociatingIndex] = useState<number | null>(null);
  const [assocBusy, setAssocBusy] = useState(false);
  const [toast, setToast] = useState<UndoBatch | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // File sérialisée des appels réseau (pattern ReservationCollect) : l'UI réagit au
  // clic, les appels s'enchaînent, réconciliation UNE fois la file vide.
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

  // Changement de réservation → sélection re-semée sur la 1re place non réglée,
  // picker fermé, toast conservé (il annule des paiements déjà identifiés par id).
  const rvId = reservation.id;
  useEffect(() => {
    setAssociatingIndex(null);
    setSelected(() => {
      const first = nextSelectable(isCourt && players > 0 ? slotStatuses(reservation, players, due) : []);
      return first === null ? new Set() : new Set([first]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rvId]);

  // Une place sélectionnée devenue réglée (paiement depuis la modale Détails,
  // réconciliation…) sort de la sélection.
  useEffect(() => {
    setSelected((cur) => {
      const kept = [...cur].filter((i) => statuses[i] && !statuses[i].paid);
      return kept.length === cur.size ? cur : new Set(kept);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const armToast = (batch: UndoBatch) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(batch);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      if (batch.settledAll && isDesktop) onSettled?.();
    }, TOAST_MS);
  };

  const undoToast = (batch: UndoBatch) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
    // Visuel immédiat : ids synthétiques (avant réconciliation) ET réels (après) —
    // applyOptimisticRefund ignore les ids absents.
    onOptimisticRefund([...batch.items.map((i) => i.syntheticId), ...batch.items.flatMap((i) => (i.realId ? [i.realId] : []))]);
    // Réseau : la tâche s'exécute APRÈS les encaissements du lot (file FIFO) → realId posés.
    enqueue(async () => {
      try {
        for (const it of batch.items) {
          if (it.realId) await api.refundPayment(clubId, it.realId, { amount: it.amountCents / 100, reason: 'Annulation au comptoir' }, token);
        }
      } catch (e) { onError((e as Error).message); }
    });
  };

  // Encaisse un lot de places (ou le reste entier hors COURT) avec un moyen.
  const paySelection = (method: PaymentMethod, sourcePackageId?: string) => {
    const targets: { amountCents: number; participantId?: string }[] = isCourt && players > 0
      ? [...selected].sort((a, b) => a - b).flatMap((i) => {
          const s = statuses[i];
          return s && !s.paid && s.amountCents > 0 ? [{ amountCents: s.amountCents, participantId: s.participantId ?? undefined }] : [];
        })
      : remaining > 0 ? [{ amountCents: remaining }] : [];
    if (targets.length === 0) return;
    const totalCents = targets.reduce((s, t) => s + t.amountCents, 0);
    const batch: UndoBatch = {
      label: `${fmtEuros(totalCents)} ${METHOD_LABEL_FULL[method] ?? method}`,
      items: [], settledAll: totalCents >= remaining,
    };
    for (const t of targets) {
      const syntheticId = onOptimisticPay({ amountCents: t.amountCents, method, participantId: t.participantId ?? null });
      const item: UndoBatch['items'][number] = { amountCents: t.amountCents, syntheticId, realId: null };
      batch.items.push(item);
      enqueue(async () => {
        try {
          const body: AddPaymentBody = { amount: t.amountCents / 100, method };
          if (t.participantId) body.participantId = t.participantId;
          if (sourcePackageId) body.sourcePackageId = sourcePackageId;
          const created = await api.adminAddPayment(clubId, reservation.id, body, token);
          item.realId = (created as Payment | undefined)?.id ?? null;
        } catch (e) { onError(mapPayError(e, !!t.participantId)); }
      });
    }
    // Auto-avance : la place non réglée suivante (déterministe, sans attendre le state).
    if (isCourt && players > 0) {
      const next = nextSelectable(statuses, new Set(selected));
      setSelected(next === null ? new Set() : new Set([next]));
    }
    armToast(batch);
  };

  // Annule (rembourse) le règlement d'une place déjà réglée.
  const refundSlot = (pays: Payment[]) => {
    const targets = pays.filter((p) => toCents(p.amount) - toCents(p.refundedAmount ?? '0') > 0 && !isOptimisticId(p.id));
    if (targets.length === 0) return;
    onOptimisticRefund(targets.map((p) => p.id));
    enqueue(async () => {
      try {
        for (const p of targets) {
          const rem = toCents(p.amount) - toCents(p.refundedAmount ?? '0');
          await api.refundPayment(clubId, p.id, { amount: rem / 100, reason: 'Annulation au comptoir' }, token);
        }
      } catch (e) { onError((e as Error).message); }
    });
  };

  // Association d'un membre à une place générique (mêmes appels que ReservationCollect).
  // La place associée reste sélectionnée ensuite (focus) : `idx` est capturé avant la remise
  // à zéro de `associatingIndex`, `statuses[idx]` retombe forcément non payé.
  const needsHolder = !reservation.user && (reservation.participants ?? []).length === 0;
  const finishAssociation = async (idx: number | null, updated: ClubReservation) => {
    setAssociatingIndex(null);
    if (idx !== null) setSelected(new Set([idx]));
    await onChanged(updated);
  };
  const associate = async (userId: string) => {
    if (assocBusy) return;
    setAssocBusy(true);
    const idx = associatingIndex;
    try {
      const updated = needsHolder
        ? await api.adminAssignReservationMember(clubId, reservation.id, userId, token)
        : await api.adminAddReservationParticipant(clubId, reservation.id, userId, token);
      await finishAssociation(idx, updated);
    } catch (e) { onError(mapAssocError(e)); }
    finally { setAssocBusy(false); }
  };
  // Remplacer le joueur d'une place déjà associée (recalcule les parts côté serveur).
  const changeParticipant = async (participantId: string, userId: string) => {
    if (assocBusy) return;
    setAssocBusy(true);
    const idx = associatingIndex;
    try {
      const updated = await api.adminChangeReservationParticipant(clubId, reservation.id, participantId, userId, token);
      await finishAssociation(idx, updated);
    } catch (e) { onError(mapAssocError(e)); }
    finally { setAssocBusy(false); }
  };
  // Création + association en UN SEUL aller-retour réseau : le serveur crée le membre PUIS
  // l'associe dans la même requête (avant : 2 appels séquentiels — créer, puis associer).
  const createAndAssociate = async (body: CreateMemberBody, replaceParticipantId?: string) => {
    if (assocBusy) return { tempPassword: null, existed: false, userId: '' };
    setAssocBusy(true);
    const idx = associatingIndex;
    try {
      const updated = replaceParticipantId
        ? await api.adminChangeReservationParticipantNew(clubId, reservation.id, replaceParticipantId, body, token)
        : needsHolder
          ? await api.adminAssignReservationMemberNew(clubId, reservation.id, body, token)
          : await api.adminAddReservationParticipantNew(clubId, reservation.id, body, token);
      await finishAssociation(idx, updated);
      return updated.createdMember ?? { tempPassword: null, existed: false, userId: '' };
    } catch (e) {
      onError(mapAssocError(e));
      return { tempPassword: null, existed: false, userId: '' };
    } finally { setAssocBusy(false); }
  };

  // ── dérivés d'affichage ──────────────────────────────────────────────────
  const selTotal = isCourt && players > 0 ? selectionTotal(statuses, selected) : remaining;
  const unpaid = statuses.filter((s) => !s.paid && s.amountCents > 0);
  const methods = quickMethods.filter((m) => METHOD_ICON[m]);
  // Carnet/porte-monnaie : mono-sélection d'une place à joueur identifié seulement.
  const single = selected.size === 1 ? statuses[[...selected][0]] : null;
  const singlePkgs = single?.userId ? (packagesByUser?.[single.userId] ?? []) : [];
  const pk = single ? (pickPackageFor(singlePkgs, single.amountCents, 'WALLET') ?? pickPackageFor(singlePkgs, single.amountCents, 'ENTRIES')) : null;
  const who = reservation.title?.trim() ? reservation.title : reservation.user ? `${reservation.user.firstName} ${reservation.user.lastName}` : 'Événement';
  const pct = due > 0 ? Math.max(0, Math.min(100, Math.round((paid / due) * 100))) : 0;

  const toggle = (i: number) => {
    const s = statuses[i];
    if (!s || s.paid) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  // ── styles ───────────────────────────────────────────────────────────────
  const card: CSSProperties = { background: th.surface, borderRadius: 16, boxShadow: th.shadow, overflow: 'hidden', fontFamily: th.fontUI, position: 'relative' };
  const tileBase = (sel: boolean, isPaid: boolean): CSSProperties => ({
    borderRadius: 13, padding: 12, display: 'flex', alignItems: 'center', gap: 10, minHeight: 58,
    background: isPaid ? `${SETTLED_COLOR}14` : sel ? `${th.accent}1a` : th.surface2,
    boxShadow: sel ? `0 0 0 2px ${th.accent}` : `inset 0 0 0 1px ${isPaid ? `${SETTLED_COLOR}44` : th.line}`,
    cursor: isPaid ? 'default' : 'pointer', opacity: isPaid ? 0.8 : 1, position: 'relative',
  });
  const payBtn = (primary: boolean): CSSProperties => ({
    width: '100%', boxSizing: 'border-box', height: 46, border: 'none', borderRadius: 13, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    fontFamily: th.fontUI, fontSize: 14, fontWeight: 700,
    background: primary ? th.accent : `${th.accent}16`, color: primary ? th.onAccent : th.text,
    boxShadow: primary ? `0 3px 10px ${th.accent}4d` : 'none',
  });
  const avatar = (seed: string, first: string, last: string) => {
    const c = colorForSeed(seed);
    return (
      <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: c, color: inkOn(c), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700 }}>
        {(first[0] ?? '').toUpperCase()}{(last[0] ?? '').toUpperCase()}
      </span>
    );
  };

  const renderTile = (s: SlotStatus) => {
    if (associatingIndex === s.index) {
      const excludeIds = [reservation.user?.id, ...(reservation.participants ?? []).map((p) => p.userId)].filter(Boolean) as string[];
      return (
        <div key={`t${s.index}`} style={{ ...tileBase(false, false), cursor: 'default', gridColumn: '1 / -1', alignItems: 'stretch' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <AssociateMemberPicker slug={slug} token={token} excludeIds={excludeIds} members={members} busy={assocBusy}
              onSelect={s.participantId ? (uid) => changeParticipant(s.participantId!, uid) : associate}
              onCancel={() => setAssociatingIndex(null)}
              onCreate={(body) => createAndAssociate(body, s.participantId ?? undefined)} />
          </div>
        </div>
      );
    }
    const isSel = selected.has(s.index);
    const name = s.slot.kind === 'empty' ? `Joueur ${s.index + 1}` : `${(s.slot as { firstName: string }).firstName} ${(s.slot as { lastName: string }).lastName}`;
    const generic = s.slot.kind === 'empty';
    return (
      <div key={`t${s.index}`} role="checkbox" aria-checked={isSel} aria-disabled={s.paid} aria-label={name}
        tabIndex={s.paid ? -1 : 0} onClick={() => toggle(s.index)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(s.index); } }}
        style={tileBase(isSel, s.paid)}>
        {generic
          ? <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: th.surfaceHi, color: th.textMute, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{s.index + 1}</span>
          : avatar((s.slot as { seed: string }).seed, (s.slot as { firstName: string }).firstName, (s.slot as { lastName: string }).lastName)}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: generic ? th.textFaint : th.textMute, lineHeight: 1.2, wordBreak: 'break-word' }}>
            {name}
            {s.slot.kind === 'participant' && (s.slot as { isOrganizer: boolean }).isOrganizer && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 600, color: th.textFaint, background: th.surfaceHi, borderRadius: 5, padding: '1px 5px' }}>orga</span>}
          </span>
          {s.paid ? (
            <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, rowGap: 2, fontSize: 11.5, color: SETTLED_COLOR, fontWeight: 700 }}>
              <span style={{ whiteSpace: 'nowrap' }}>✓ réglé</span>{s.method && <span style={{ color: th.textMute, fontWeight: 500, whiteSpace: 'nowrap' }}>· {METHOD_LABEL_FULL[s.method] ?? s.method}</span>}
              {s.payments.some((p) => toCents(p.amount) - toCents(p.refundedAmount ?? '0') > 0 && !isOptimisticId(p.id)) && (
                <button type="button" onClick={(e) => { e.stopPropagation(); refundSlot(s.payments); }}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontSize: 11, fontWeight: 600, textDecoration: 'underline', padding: 0 }}>annuler</button>
              )}
            </span>
          ) : generic ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); setAssociatingIndex(s.index); }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontSize: 11.5, fontWeight: 600, padding: 0 }}>associer un membre</button>
          ) : s.slot.kind === 'participant' && !(s.slot as { isOrganizer: boolean }).isOrganizer ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); setAssociatingIndex(s.index); }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontSize: 11.5, fontWeight: 600, padding: 0 }}>changer</button>
          ) : null}
        </span>
        {!s.paid && <span style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: th.text, whiteSpace: 'nowrap' }}>{fmtEuros(s.amountCents)}</span>}
        {(isSel || s.paid) && (
          <span aria-hidden style={{ position: 'absolute', top: -7, right: -6, width: 20, height: 20, borderRadius: '50%', background: s.paid ? SETTLED_COLOR : th.accent, color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: th.shadow }}>✓</span>
        )}
      </div>
    );
  };

  return (
    <div style={card}>
      {/* ── en-tête ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px 12px', borderBottom: `1px solid ${th.line}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: th.textMute }}><span style={{ color: th.accent }}>{fmtTime(reservation.startTime)}</span> — {reservation.resource.name}</div>
          <div style={{ fontSize: 12, color: th.textMute, marginTop: 2 }}>
            {who}{isCourt && players > 0 ? ` · ${players} joueurs` : ''}{due > 0 ? ` · ${fmtEuros(due)}` : ''}
          </div>
        </div>
        {due > 0 && (
          <>
            <span style={{ flex: '0 1 130px', height: 6, borderRadius: 3, background: th.surfaceHi, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: SETTLED_COLOR, transition: 'width .3s ease' }} />
            </span>
            <div style={{ textAlign: 'right', fontSize: 11.5, color: th.textMute, whiteSpace: 'nowrap' }}>
              encaissé {fmtEuros(paid)}<br />reste <b style={{ color: settled ? SETTLED_COLOR : CORAL, fontSize: 13 }}>{fmtEuros(remaining)}</b>
            </div>
          </>
        )}
      </div>

      {/* ── tuiles joueurs (COURT à parts) ── */}
      {isCourt && players > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(184px, 1fr))', gap: 10, padding: '16px 18px 4px' }}>
          {statuses.map(renderTile)}
          {unpaid.length > 1 && !settled && (
            <button type="button" onClick={() => setSelected(new Set(unpaid.map((s) => s.index)))}
              style={{ gridColumn: '1 / -1', padding: '10px 0', borderRadius: 12, border: 'none', background: th.surface2, boxShadow: 'none', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute }}>
              Tout le reste — {unpaid.length} parts · {fmtEuros(unpaid.reduce((s, x) => s + x.amountCents, 0))}
            </button>
          )}
        </div>
      )}

      {/* ── zone d'action ── */}
      {settled ? (
        <div style={{ margin: '14px 18px', borderRadius: 14, padding: '18px 16px', background: `${SETTLED_COLOR}14`, boxShadow: `inset 0 0 0 1px ${SETTLED_COLOR}44`, display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 700, color: SETTLED_COLOR }}>
          <Icon name="check" size={20} color={SETTLED_COLOR} />Soldé · {fmtEuros(paid)} encaissés
        </div>
      ) : due <= 0 ? (
        <div style={{ margin: '14px 18px' }}>
          <button type="button" onClick={onOpenDetails} style={{ width: '100%', height: 44, border: 'none', borderRadius: 12, background: th.accent, color: th.onAccent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600 }}>Encaisser un montant…</button>
        </div>
      ) : (
        <div style={{ margin: '12px 18px 16px', borderRadius: 14, background: th.bgElev, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: th.textMute }}>
              {isCourt && players > 0
                ? `${selected.size} joueur${selected.size > 1 ? 's' : ''} sélectionné${selected.size > 1 ? 's' : ''}`
                : 'Reste à encaisser'}
            </span>
            <span data-testid="cx-total" style={{ marginLeft: 'auto', fontFamily: th.fontDisplay, fontSize: 30, fontWeight: 800, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums', color: th.text }}>{fmtEuros(selTotal)}</span>
          </div>
          {payAtClubOnly ? (
            /* Option club « paiement au club » : un seul bouton, pas de choix de moyen. */
            <button type="button" disabled={selTotal <= 0} onClick={() => paySelection('CLUB')}
              style={{ ...payBtn(true), opacity: selTotal <= 0 ? 0.45 : 1 }}>
              <Icon name="check" size={16} color={th.onAccent} />Encaissé · {fmtEuros(selTotal)}
            </button>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {methods.map((m, i) => (
                  <button key={m} type="button" disabled={selTotal <= 0} onClick={() => paySelection(m)}
                    style={{ ...payBtn(i === 0), flex: '1 1 130px', width: 'auto', opacity: selTotal <= 0 ? 0.45 : 1 }}>
                    <Icon name={METHOD_ICON[m]} size={15} color={i === 0 ? th.onAccent : th.accent} />{QUICK_METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
              {/* Carnet / porte-monnaie : bouton secondaire, largeur au contenu (label déjà complet via packageLabel). */}
              {pk && single && (
                <div style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => paySelection(pk.kind === 'ENTRIES' ? 'PACK_CREDIT' : 'WALLET', pk.id)}
                    title={`Régler avec ${packageLabel(pk)}`}
                    style={{ ...payBtn(false), width: 'auto', height: 46, padding: '0 18px', color: th.accent, fontSize: 13 }}>
                    <Icon name={pk.kind === 'ENTRIES' ? 'ticket' : 'wallet'} size={15} color={th.accent} />{packageLabel(pk)}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── pied ── */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 18px 14px', fontSize: 12.5 }}>
        <button type="button" onClick={onCancel} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, padding: 0 }}>Annuler la réservation</button>
      </div>

      {/* ── toast Annuler (snackbar fixe en bas — ne recouvre jamais les moyens de paiement) ── */}
      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 55, width: 'min(420px, calc(100vw - 32px))', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, background: th.text, color: th.bg, borderRadius: 12, padding: '11px 16px', fontSize: 12.5, fontWeight: 600, boxShadow: th.shadow }}>
          <span style={{ flex: 1 }}>✓ {toast.label} encaissé</span>
          <button type="button" onClick={() => undoToast(toast)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, padding: 0 }}>Annuler</button>
        </div>
      )}
    </div>
  );
}
