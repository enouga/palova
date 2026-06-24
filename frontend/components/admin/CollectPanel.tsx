'use client';
import { useState, useEffect, CSSProperties } from 'react';
import { api, ClubReservation, Member, MemberPackage, CreateMemberBody, PaymentMethod } from '@/lib/api';
import { packageLabel, isUsable, canCover, prepaidHint } from '@/lib/packages';
import { toCents, centsToInput, quickAmounts, fmtEuros, validatePaymentAmount, DEFAULT_QUICK_METHODS } from '@/lib/caisse';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { colorForSeed } from '@/lib/playerColors';
import { PlayerPicker } from '@/components/admin/PlayerPicker';
import { Icon, IconName } from '@/components/ui/Icon';
import { Btn } from '@/components/ui/atoms';

const METHOD_LABEL: Record<string, string> = { CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', VOUCHER: 'Ticket CE', MEMBER: 'Abo / Membre', OTHER: 'Autre' };
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
  /** mutation joueurs/participants réussie → le parent recharge (et met à jour la résa si fournie). */
  onChanged: (updated?: ClubReservation) => void;
  /** un encaissement a été enregistré (le parent peut fermer la modale). */
  onPaid?: () => void;
  onError?: (msg: string) => void;
}

export function CollectPanel({ reservation, due, players, members, clubId, token, quickMethods, onChanged, onPaid, onError }: CollectPanelProps) {
  const { th } = useTheme();

  // Moyens mis en avant (boutons pleins) = ceux configurés par le club, dans le même ordre que
  // la page Encaissement ; les autres moyens manuels restent disponibles en rangée discrète.
  const primaryMethods = (quickMethods && quickMethods.length ? quickMethods : DEFAULT_QUICK_METHODS).filter((m) => ALL_METHODS.includes(m));
  const secondaryMethods = ALL_METHODS.filter((m) => !primaryMethods.includes(m));
  const [payAmount, setPayAmount] = useState('');
  const [payParticipantId, setPayParticipantId] = useState<string | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherRef, setVoucherRef] = useState('');
  const [voucherIssuer, setVoucherIssuer] = useState('');
  const [selPackages, setSelPackages] = useState<MemberPackage[]>([]);
  const [pkgLoading, setPkgLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const fail = (msg: string) => onError?.(msg);
  const remaining = Math.max(0, due - toCents(reservation.paidAmount));

  // Réinitialise montant + voucher quand la résa cible change (ouverture / reload).
  useEffect(() => {
    setPayAmount(centsToInput(remaining));
    setPayParticipantId(null);
    setVoucherOpen(false); setVoucherRef(''); setVoucherIssuer('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation.id, reservation.paidAmount]);

  // Carnets/porte-monnaie utilisables du joueur de la résa.
  const userId = reservation.user?.id ?? null;
  useEffect(() => {
    if (!userId) { setSelPackages([]); return; }
    setPkgLoading(true);
    api.adminGetMemberPackages(clubId, userId, token)
      .then((pkgs) => setSelPackages(pkgs.filter((p) => isUsable(p))))
      .catch(() => setSelPackages([]))
      .finally(() => setPkgLoading(false));
  }, [userId, clubId, token]);

  const bills = reservation.participants ?? [];
  const activePart = payParticipantId ? bills.find((p) => p.id === payParticipantId) ?? null : null;
  const maxPayable = activePart ? toCents(activePart.outstanding) : remaining;
  const amountC = toCents(payAmount);
  const overCap = due > 0 && amountC > maxPayable;
  const cannotPay = busy || !validatePaymentAmount(amountC, maxPayable);
  const capTitle = overCap ? `Plafond : ${fmtEuros(maxPayable)}` : undefined;
  // Soldé = il y a un prix dû et il est entièrement couvert (les events libres, due=0, restent encaissables).
  const settled = due > 0 && remaining <= 0;

  const payNow = async (method: PaymentMethod) => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { fail('Montant invalide.'); return; }
    setBusy(true);
    try {
      await api.adminAddPayment(clubId, reservation.id, {
        amount, method,
        participantId: payParticipantId ?? undefined,
        voucherRef: method === 'VOUCHER' ? voucherRef.trim() || undefined : undefined,
        voucherIssuer: method === 'VOUCHER' ? voucherIssuer.trim() || undefined : undefined,
      }, token);
      setPayParticipantId(null);
      onChanged(); onPaid?.();
    } catch (e) {
      fail((e as Error).message === 'PAYMENT_EXCEEDS_DUE'
        ? (payParticipantId ? 'Le montant dépasse la part du joueur.' : 'Le montant dépasse le prix de la réservation.')
        : (e as Error).message);
    } finally { setBusy(false); }
  };

  const payWithPackage = async (pkg: MemberPackage) => {
    const rest = activePart ? toCents(activePart.outstanding) / 100 : remaining / 100;
    if (rest <= 0) { fail('Rien à encaisser.'); return; }
    setBusy(true);
    try {
      await api.adminAddPayment(clubId, reservation.id, {
        amount: rest,
        method: pkg.kind === 'ENTRIES' ? 'PACK_CREDIT' : 'WALLET',
        sourcePackageId: pkg.id,
        participantId: payParticipantId ?? undefined,
      }, token);
      setPayParticipantId(null);
      onChanged(); onPaid?.();
    } catch (e) {
      fail((e as Error).message === 'INSUFFICIENT_BALANCE' ? 'Solde du package insuffisant.' : (e as Error).message);
    } finally { setBusy(false); }
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

  const coverAmt = activePart ? toCents(activePart.outstanding) / 100 : remaining / 100;

  // ── tokens de style partagés ───────────────────────────────────────────
  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '7px 10px', fontFamily: th.fontUI, fontSize: 14 };
  const sectionLabel: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textMute };
  const caption: CSSProperties = { fontSize: 12, color: th.textMute, marginBottom: 8 };

  const targetTo = (id: string | null, cents: number) => { setPayParticipantId(id); setPayAmount(centsToInput(cents)); };

  // Avatar initiales, teinté par identité (cohérent avec le reste de l'app).
  const avatar = (seed: string, first: string, last: string) => {
    const c = colorForSeed(seed);
    return (
      <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: c, color: inkOn(c), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700 }}>
        {(first[0] ?? '').toUpperCase()}{(last[0] ?? '').toUpperCase()}
      </span>
    );
  };

  return (
    <div>
      {/* ── JOUEURS (fusion « Joueur » + « Par joueur ») — en tête, juste sous « Reste à encaisser » ── */}
      <div>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>Joueurs</div>

        {/* Titulaire de la réservation */}
        <div style={{ marginBottom: bills.length > 0 ? 12 : 4 }}>
          <div style={caption}>Réservation au nom de</div>
          <PlayerPicker
            members={members}
            value={reservation.user ? { firstName: reservation.user.firstName, lastName: reservation.user.lastName } : null}
            onSelect={assignPlayer} onClear={() => {}} onCreate={createAndAssign}
            placeholder="Cliquez pour voir les membres, ou tapez un nom…"
          />
        </div>

        {/* Répartition par joueur */}
        {bills.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {bills.map((p) => {
              const rest = toCents(p.outstanding);
              const paid = rest <= 0;
              const on = payParticipantId === p.id;
              const canRemove = !(p.isOrganizer && bills.length > 1);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: 12, background: on ? `${th.accent}14` : th.surface2, boxShadow: on ? `inset 0 0 0 1.5px ${th.accent}` : 'inset 0 0 0 1px transparent' }}>
                  {avatar(p.id, p.firstName, p.lastName)}
                  <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text, display: 'flex', alignItems: 'center', gap: 7 }}>
                    {p.firstName} {p.lastName}
                    {p.isOrganizer && <span style={{ fontSize: 11, fontWeight: 600, color: th.textFaint, background: th.surfaceHi, borderRadius: 6, padding: '2px 7px' }}>orga</span>}
                  </span>
                  <span style={{ fontFamily: th.fontMono, fontSize: 12.5, color: paid ? th.textMute : th.text, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtEuros(toCents(p.paid))} / {fmtEuros(toCents(p.share))}
                  </span>
                  {paid ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent }}>
                      <Icon name="check" size={13} color={th.accent} />réglé
                    </span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => targetTo(p.id, rest)}
                      style={{ border: 'none', background: on ? th.accent : th.surface, color: on ? th.onAccent : th.text, boxShadow: on ? 'none' : `inset 0 0 0 1px ${th.line}`, borderRadius: 9, padding: '6px 12px', cursor: busy ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>Régler</button>
                  )}
                  {canRemove && (
                    <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} title="Retirer ce joueur"
                      onClick={() => removeParticipant(p.id)}
                      style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textFaint, fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Ajouter un joueur */}
        <div style={{ marginTop: 10 }}>
          {bills.length >= players ? (
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Terrain complet ({players} joueurs).</div>
          ) : (
            <PlayerPicker members={members} value={null} onSelect={addParticipant} onClear={() => {}} onCreate={createAndAddParticipant} placeholder="+ Ajouter un joueur…" />
          )}
        </div>
      </div>

      {/* ── ENCAISSER — masqué quand soldé ─────────────────────── */}
      {!settled && (
        <div style={{ marginTop: 22, borderRadius: 16, background: th.surface2, padding: 14 }}>
          {/* Cible active : encaissement ciblé sur un joueur (sinon, résa entière) */}
          {activePart && (
            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, background: `${th.accent}1f`, fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
              Encaisser pour <b>{activePart.firstName} {activePart.lastName}</b>
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
                onClick={() => (m === 'VOUCHER' ? setVoucherOpen((v) => !v) : payNow(m))}
                style={{ flex: '1 1 130px', minWidth: 124, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', borderRadius: 11,
                  cursor: cannotPay ? 'default' : 'pointer', opacity: cannotPay ? 0.45 : 1, background: th.accent, color: th.onAccent,
                  fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, boxShadow: th.neon ? `0 6px 20px ${th.accent}33` : 'none',
                  outline: m === 'VOUCHER' && voucherOpen ? `2px solid ${th.text}` : 'none', outlineOffset: 2 }}>
                {METHOD_ICON[m] && <Icon name={METHOD_ICON[m]!} size={16} color={th.onAccent} />}
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {secondaryMethods.map((m) => (
              <button key={m} type="button" disabled={cannotPay} title={capTitle}
                onClick={() => (m === 'VOUCHER' ? setVoucherOpen((v) => !v) : payNow(m))}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', borderRadius: 10, padding: '9px 14px',
                  cursor: cannotPay ? 'default' : 'pointer', opacity: cannotPay ? 0.45 : 1, background: 'transparent',
                  boxShadow: `inset 0 0 0 1px ${m === 'VOUCHER' && voucherOpen ? th.text : th.line}`,
                  color: th.textMute, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>
                {METHOD_ICON[m] && <Icon name={METHOD_ICON[m]!} size={15} color={th.textMute} />}
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>

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

          {/* Carnets / porte-monnaie prépayés */}
          {selPackages.length > 0 ? (
            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selPackages.map((p) => {
                const ok = canCover(p, coverAmt);
                return (
                  <button key={p.id} type="button" disabled={busy || !ok} onClick={() => payWithPackage(p)}
                    title={ok ? 'Solder avec ce package' : 'Solde insuffisant'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: th.surface, boxShadow: `inset 0 0 0 1px ${ok ? th.accent : th.line}`, borderRadius: 10, padding: '9px 13px',
                      cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.5, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
                    <Icon name="ticket" size={15} color={ok ? th.accent : th.textMute} />{packageLabel(p)}
                  </button>
                );
              })}
            </div>
          ) : (!pkgLoading && (() => {
            const msg = prepaidHint(!!reservation.user, selPackages.length, maxPayable);
            return msg ? <div style={{ marginTop: 14, fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>{msg}</div> : null;
          })())}
        </div>
      )}
    </div>
  );
}
