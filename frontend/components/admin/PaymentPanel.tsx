'use client';
import { useState, CSSProperties } from 'react';
import { api, ClubReservation, PaymentMethod, AddPaymentBody } from '@/lib/api';
import { toCents, fmtEuros } from '@/lib/caisse';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { colorForSeed } from '@/lib/playerColors';
import { Icon, IconName } from '@/components/ui/Icon';
import { SETTLED_COLOR } from '@/components/admin/PaymentDots';

const CORAL = '#ff7a4d';
const STATUS_LABEL: Record<string, string> = { PENDING: 'En attente', CONFIRMED: 'Confirmée', CANCELLED: 'Annulée' };
// Moyens d'encaissement rapide (1 clic). CB en avant (plein), Abo/Ticket CE en second (contour).
const QUICK: { method: PaymentMethod; label: string; icon: IconName }[] = [
  { method: 'CARD', label: 'CB', icon: 'card' },
  { method: 'MEMBER', label: 'Abo', icon: 'user' },
  { method: 'VOUCHER', label: 'Ticket CE', icon: 'ticket' },
];

function mapPayError(e: unknown, perPlayer: boolean): string {
  const m = (e as Error).message;
  if (m === 'PAYMENT_EXCEEDS_DUE') return perPlayer ? 'Le montant dépasse la part du joueur.' : 'Le montant dépasse le prix de la réservation.';
  return m;
}

export interface PaymentPanelProps {
  reservation: ClubReservation;
  due: number;       // centimes — calculé par le parent (dueOf)
  clubId: string;
  token: string;
  /** un encaissement a réussi → le parent recharge. */
  onPaid: () => void | Promise<void>;
  onError: (msg: string) => void;
  /** ouvre la modale complète (cas avancés : montant libre, n° Ticket CE, carnet, joueurs, reçu). */
  onOpenDetails: () => void;
  onCancel?: () => void;
  variant?: 'side' | 'inline';
}

/**
 * Volet d'encaissement rapide (sans modale) : règle la part d'un joueur ou la
 * réservation entière en 1 clic (CB / Abo-Membre / Ticket CE). Les cas avancés
 * passent par « Détails / options… » qui ouvre `CollectPanel` dans la modale.
 */
export function PaymentPanel({ reservation, due, clubId, token, onPaid, onError, onOpenDetails, onCancel, variant = 'side' }: PaymentPanelProps) {
  const { th } = useTheme();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const paid = toCents(reservation.paidAmount);
  const remaining = Math.max(0, due - paid);
  const settled = due > 0 && remaining <= 0;
  const freeEvent = due <= 0;            // event libre : montant inconnu → renvoi à la modale
  const pct = due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;
  const bills = reservation.participants ?? [];
  const anyBusy = busyKey !== null;
  const time = new Date(reservation.startTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const pay = async (key: string, body: AddPaymentBody) => {
    if (busyKey) return;
    setBusyKey(key);
    try { await api.adminAddPayment(clubId, reservation.id, body, token); await onPaid(); }
    catch (e) { onError(mapPayError(e, !!body.participantId)); }
    finally { setBusyKey(null); }
  };

  // Rangée des 3 moyens rapides (CB / Abo / Ticket CE) — Ticket CE encaisse sans référence.
  const quickRow = (keyPrefix: string, amountCents: number, participantId?: string) => (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      {QUICK.map((q) => {
        const key = `${keyPrefix}:${q.method}`;
        const busy = busyKey === key;
        const primary = q.method === 'CARD';
        return (
          <button key={q.method} type="button" disabled={anyBusy}
            onClick={() => pay(key, { amount: amountCents / 100, method: q.method, participantId })}
            style={{ flex: 1, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: 'none', borderRadius: 11,
              cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy && !busy ? 0.5 : 1,
              background: primary ? th.accent : th.surface, color: primary ? th.onAccent : th.text,
              boxShadow: primary ? 'none' : `inset 0 0 0 1.5px ${th.lineStrong}`,
              fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>
            {busy ? '…' : <><Icon name={q.icon} size={15} color={primary ? th.onAccent : th.textMute} />{q.label}</>}
          </button>
        );
      })}
    </div>
  );

  const container: CSSProperties = variant === 'side'
    ? { background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: 20 }
    : { background: th.surface, borderRadius: 14, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: 16, marginTop: 8, marginBottom: 4 };

  return (
    <div style={container}>
      {/* en-tête */}
      <div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text }}>{reservation.resource.name}</div>
        <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: th.fontMono, fontSize: 12.5, color: th.textMute }}>{time}</span>
          <span style={{ borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, background: reservation.status === 'CONFIRMED' ? `${th.accent}22` : th.surface2, color: th.textMute }}>{STATUS_LABEL[reservation.status]}</span>
        </div>
      </div>

      {/* état */}
      <div style={{ marginTop: 14, borderRadius: 13, padding: '13px 15px', background: settled ? 'rgba(52,184,136,0.10)' : th.surface2, boxShadow: `inset 0 0 0 1px ${settled ? 'rgba(52,184,136,0.30)' : th.line}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textMute }}>{freeEvent ? 'Encaissé' : settled ? 'Statut' : 'Reste à encaisser'}</div>
            {freeEvent ? (
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, marginTop: 5, color: th.text }}>{fmtEuros(paid)}</div>
            ) : settled ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, marginTop: 5, color: SETTLED_COLOR }}><Icon name="check" size={20} color={SETTLED_COLOR} />Soldé</div>
            ) : (
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, letterSpacing: -0.5, marginTop: 5, color: CORAL }}>{fmtEuros(remaining)}</div>
            )}
          </div>
          {due > 0 && <div style={{ textAlign: 'right', fontSize: 12.5, color: th.textMute, lineHeight: 1.5 }}>Payé <b style={{ color: th.text }}>{fmtEuros(paid)}</b><br />sur {fmtEuros(due)}</div>}
        </div>
        {due > 0 && <div style={{ marginTop: 11, height: 7, borderRadius: 999, background: th.surfaceHi, overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: SETTLED_COLOR, transition: 'width .35s ease' }} /></div>}
      </div>

      {/* corps */}
      {freeEvent ? (
        <button type="button" onClick={onOpenDetails} style={{ marginTop: 14, width: '100%', height: 46, border: 'none', borderRadius: 12, background: th.accent, color: th.onAccent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600 }}>Encaisser un montant…</button>
      ) : (
        <>
          {bills.length > 1 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textMute, marginBottom: 4 }}>Par joueur</div>
              {bills.map((p) => {
                const rest = toCents(p.outstanding);
                const pPaid = rest <= 0;
                const c = colorForSeed(p.id);
                return (
                  <div key={p.id} style={{ padding: '10px 0', borderTop: `1px solid ${th.line}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: c, color: inkOn(c), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700, opacity: pPaid ? 0.45 : 1 }}>{(p.firstName[0] ?? '').toUpperCase()}{(p.lastName[0] ?? '').toUpperCase()}</span>
                      <span style={{ flex: 1, fontSize: 13.5, color: pPaid ? th.textMute : th.text, display: 'flex', alignItems: 'center', gap: 6 }}>{p.firstName} {p.lastName}{p.isOrganizer && <span style={{ fontSize: 10, fontWeight: 600, color: th.textFaint, background: th.surfaceHi, borderRadius: 5, padding: '1px 6px' }}>orga</span>}</span>
                      {pPaid ? (
                        <span style={{ fontSize: 12, fontWeight: 700, color: th.accent, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={13} color={th.accent} />réglé</span>
                      ) : (
                        <span style={{ fontFamily: th.fontMono, fontSize: 12.5, color: th.textMute }}>reste {fmtEuros(rest)}</span>
                      )}
                    </div>
                    {!pPaid && quickRow(`p:${p.id}`, rest, p.id)}
                  </div>
                );
              })}
            </div>
          )}

          {!settled && (
            <div style={{ marginTop: 16, paddingTop: bills.length > 1 ? 14 : 0, borderTop: bills.length > 1 ? `1px dashed ${th.line}` : 'none' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: th.text }}>{bills.length > 1 ? 'Tout solder' : 'Encaisser'} · <span style={{ color: CORAL }}>{fmtEuros(remaining)}</span></div>
              {quickRow('all', remaining)}
            </div>
          )}
        </>
      )}

      {/* pied */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${th.line}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={onOpenDetails} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0 }}>Détails / options <Icon name="chevR" size={15} color={th.accent} /></button>
        {onCancel && reservation.status !== 'CANCELLED' && (
          <button type="button" onClick={onCancel} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, padding: 0 }}>Annuler</button>
        )}
      </div>
    </div>
  );
}
