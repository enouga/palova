'use client';
import { useState, useEffect } from 'react';
import { api, ClubReservation, Member, MemberPackage, CreateMemberBody, PaymentMethod } from '@/lib/api';
import { packageLabel, isUsable, canCover, prepaidHint } from '@/lib/packages';
import { toCents, centsToInput, quickAmounts, fmtEuros, validatePaymentAmount } from '@/lib/caisse';
import { useTheme } from '@/lib/ThemeProvider';
import { PlayerPicker } from '@/components/admin/PlayerPicker';
import { SETTLED_COLOR } from '@/components/admin/PaymentDots';
import { Btn } from '@/components/ui/atoms';

const METHOD_LABEL: Record<string, string> = { CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', VOUCHER: 'Ticket CE', MEMBER: 'Abo / Membre', OTHER: 'Autre' };
const COUNTER_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'VOUCHER', 'MEMBER', 'OTHER'];

export interface CollectPanelProps {
  reservation: ClubReservation;
  due: number;       // centimes — calculé par le parent (dueCents)
  players: number;   // nb de joueurs du terrain (single=2 / double=4)
  members: Member[];
  clubId: string;
  token: string;
  /** mutation joueurs/participants réussie → le parent recharge (et met à jour la résa si fournie). */
  onChanged: (updated?: ClubReservation) => void;
  /** un encaissement a été enregistré (le parent peut fermer la modale). */
  onPaid?: () => void;
  onError?: (msg: string) => void;
}

export function CollectPanel({ reservation, due, players, members, clubId, token, onChanged, onPaid, onError }: CollectPanelProps) {
  const { th } = useTheme();
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

  const input = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '7px 10px', fontFamily: th.fontUI, fontSize: 14 } as const;
  const tint = (hex: string) => (th.mode === 'floodlit' ? `${hex}2e` : `${hex}24`);

  return (
    <div>
      {/* joueur rattaché */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: th.textMute, marginBottom: 4 }}>Joueur</div>
        <PlayerPicker
          members={members}
          value={reservation.user ? { firstName: reservation.user.firstName, lastName: reservation.user.lastName } : null}
          onSelect={assignPlayer} onClear={() => {}} onCreate={createAndAssign}
          placeholder="Cliquez pour voir les membres, ou tapez un nom…"
        />
      </div>

      {/* par joueur */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: th.textMute, marginBottom: 8 }}>Par joueur</div>
        {bills.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {bills.map((p) => {
              const rest = toCents(p.outstanding);
              const settled = rest <= 0;
              const on = payParticipantId === p.id;
              // L'organisateur ne peut être retiré que s'il est seul (sinon on ne laisse pas un terrain sans orga).
              const canRemove = !(p.isOrganizer && bills.length > 1);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 9, background: on ? tint(th.text) : th.surface2, border: `1px solid ${on ? th.text : 'transparent'}` }}>
                  <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text, flex: 1 }}>
                    {p.firstName} {p.lastName}{p.isOrganizer ? <span style={{ color: th.textFaint }}> · orga</span> : null}
                  </span>
                  <span style={{ fontFamily: th.fontMono, fontSize: 12.5, color: settled ? SETTLED_COLOR : th.textMute }}>
                    {fmtEuros(toCents(p.paid))} / {fmtEuros(toCents(p.share))}
                  </span>
                  {settled ? (
                    <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: SETTLED_COLOR }}>réglé</span>
                  ) : (
                    <button type="button" disabled={busy}
                      onClick={() => { setPayParticipantId(p.id); setPayAmount(centsToInput(rest)); }}
                      style={{ border: `1px solid ${th.line}`, background: th.surface, color: th.text, borderRadius: 8, padding: '5px 10px', cursor: busy ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
                      Régler
                    </button>
                  )}
                  {canRemove && (
                    <button type="button" disabled={busy} aria-label={`Retirer ${p.firstName} ${p.lastName}`} title="Retirer ce joueur"
                      onClick={() => removeParticipant(p.id)}
                      style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textMute, fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {activePart && (
          <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 12, color: th.text }}>
            Encaissement pour <b>{activePart.firstName} {activePart.lastName}</b> ·{' '}
            <button type="button" onClick={() => setPayParticipantId(null)} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, textDecoration: 'underline' }}>résa entière</button>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          {bills.length >= players ? (
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>Terrain complet ({players} joueurs).</div>
          ) : (
            <PlayerPicker members={members} value={null} onSelect={addParticipant} onClear={() => {}} onCreate={createAndAddParticipant} placeholder="+ Ajouter un joueur…" />
          )}
        </div>
      </div>

      {/* montant + chips rapides */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Encaisser €
          <input type="number" min={0} step="0.1" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
            style={{ ...input, border: `1px solid ${overCap ? '#ff7a4d' : th.line}`, width: 90 }} />
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 3 }}>
          {quickAmounts(due, toCents(reservation.paidAmount), players).map((q) => (
            <button key={q.key} type="button" onClick={() => setPayAmount(centsToInput(q.cents))}
              style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 999, padding: '6px 11px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* moyens 1-clic */}
      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {COUNTER_METHODS.map((m) => (
          <button key={m} type="button" disabled={cannotPay} title={capTitle}
            onClick={() => (m === 'VOUCHER' ? setVoucherOpen(true) : payNow(m))}
            style={{ border: `1.5px solid ${m === 'VOUCHER' && voucherOpen ? th.text : th.line}`, background: th.surface2, borderRadius: 10, padding: '8px 13px', cursor: cannotPay ? 'default' : 'pointer', opacity: cannotPay ? 0.5 : 1, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
            {METHOD_LABEL[m]}
          </button>
        ))}
      </div>
      {voucherOpen && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Référence
            <input type="text" value={voucherRef} onChange={(e) => setVoucherRef(e.target.value)} placeholder="N° ticket" style={{ ...input, width: 100 }} />
          </label>
          <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Émetteur
            <input type="text" value={voucherIssuer} onChange={(e) => setVoucherIssuer(e.target.value)} placeholder="ANCV…" style={{ ...input, width: 90 }} />
          </label>
          <Btn onClick={() => payNow('VOUCHER')} icon="check" disabled={cannotPay}>{busy ? '…' : 'Valider Ticket CE'}</Btn>
          <button type="button" onClick={() => setVoucherOpen(false)} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, paddingBottom: 10 }}>Annuler</button>
        </div>
      )}

      {/* prépayés */}
      {selPackages.length > 0 ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {selPackages.map((p) => {
            const ok = canCover(p, coverAmt);
            return (
              <button key={p.id} type="button" disabled={busy || !ok} onClick={() => payWithPackage(p)}
                title={ok ? 'Solder avec ce package' : 'Solde insuffisant'}
                style={{ border: `1.5px solid ${th.line}`, background: th.surface2, borderRadius: 10, padding: '7px 12px', cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.5, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
                {packageLabel(p)}
              </button>
            );
          })}
        </div>
      ) : (!pkgLoading && (() => {
        const msg = prepaidHint(!!reservation.user, selPackages.length, maxPayable);
        return msg ? <div style={{ marginTop: 12, fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>{msg}</div> : null;
      })())}
    </div>
  );
}
