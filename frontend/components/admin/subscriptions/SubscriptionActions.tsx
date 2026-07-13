'use client';
import { useState } from 'react';
import { api, SubscriberRow, SubscriptionPlanSummary, PaymentMethod } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Theme } from '@/lib/theme';
import { Btn } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type Action = 'renew' | 'change' | 'cancel' | null;
const SALE_METHODS: { m: PaymentMethod; label: string }[] = [
  { m: 'CARD', label: 'Carte' }, { m: 'CASH', label: 'Espèces' }, { m: 'TRANSFER', label: 'Virement' },
  { m: 'VOUCHER', label: 'Ticket CE' }, { m: 'OTHER', label: 'Autre' },
];
const eur = (s: string) => { const n = Number(s); return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ','); };

export function SubscriptionActions({ action, sub, plans, clubId, token, onClose, onDone }: {
  action: Action;
  sub: Pick<SubscriberRow, 'id' | 'planId' | 'planName' | 'expiresAt' | 'monthlyPriceSnapshot'> | null;
  plans: SubscriptionPlanSummary[]; clubId: string; token: string;
  onClose: () => void; onDone: () => void;
}) {
  const { th } = useTheme();
  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const [voucherRef, setVoucherRef] = useState('');
  const [planId, setPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!action || !sub) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); onDone(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const payBody = () => ({ method, voucherRef: method === 'VOUCHER' ? voucherRef : undefined });
  const canPay = method !== 'VOUCHER' || voucherRef.trim().length > 0;

  if (action === 'cancel') {
    return (
      <ConfirmDialog
        title="Résilier l’abonnement ?"
        detail={sub.planName}
        message={`L’abonnement sera résilié immédiatement (échéance perdue : ${new Date(sub.expiresAt).toLocaleDateString('fr-FR')}). Aucun remboursement automatique.`}
        confirmLabel="Résilier l’abonnement"
        busy={busy}
        onConfirm={() => run(() => api.adminCancelSubscription(clubId, sub.id, token))}
        onCancel={onClose}
      />
    );
  }

  const methodRow = (
    <div>
      <div style={label(th)}>Moyen de paiement</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SALE_METHODS.map(({ m, label: l }) => (
          <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m}
            style={chip(th, method === m)}>{l}</button>
        ))}
      </div>
      {method === 'VOUCHER' && (
        <input value={voucherRef} onChange={(e) => setVoucherRef(e.target.value)} placeholder="Référence du ticket"
          aria-label="Référence du ticket" style={input(th)} />
      )}
    </div>
  );

  return (
    <Modal th={th} onClose={onClose}>
      {action === 'renew' ? (
        <>
          <h3 style={title(th)}>Renouveler l’abonnement</h3>
          <p style={sub_(th)}>{sub.planName} · {eur(sub.monthlyPriceSnapshot)} € / mois (tarif du membre). Prolonge la période sans perte de jours.</p>
          {methodRow}
          {err && <div style={errBox(th)}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn variant="surface" onClick={onClose} disabled={busy}>Annuler</Btn>
            <Btn onClick={() => run(() => api.adminRenewSubscription(clubId, sub.id, payBody(), token))} disabled={busy || !canPay}>
              Renouveler · {eur(sub.monthlyPriceSnapshot)} €
            </Btn>
          </div>
        </>
      ) : (
        <>
          <h3 style={title(th)}>Changer de forfait</h3>
          <p style={sub_(th)}>L’abonnement actuel est résilié ; le nouveau démarre aujourd’hui au plein tarif (pas de prorata).</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plans.filter((p) => p.isActive && p.id !== sub.planId).map((p) => (
              <button key={p.id} type="button" onClick={() => setPlanId(p.id)} aria-pressed={planId === p.id}
                style={planCard(th, planId === p.id)}>
                <b>{p.name}</b><span>{eur(p.monthlyPrice)} € / mois</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>{methodRow}</div>
          {err && <div style={errBox(th)}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn variant="surface" onClick={onClose} disabled={busy}>Annuler</Btn>
            <Btn onClick={() => planId && run(() => api.adminChangeSubscription(clubId, sub.id, { planId, ...payBody() }, token))}
              disabled={busy || !planId || !canPay}>Confirmer le changement</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

function Modal({ th, onClose, children }: { th: Theme; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)' }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 440, margin: 16, background: th.bgElev, borderRadius: 20, padding: 20, boxShadow: '0 14px 50px rgba(0,0,0,.34)' }}>{children}</div>
    </div>
  );
}
const title = (th: Theme): React.CSSProperties => ({ fontFamily: th.fontDisplay, fontSize: 20, fontWeight: 800, color: th.text, margin: 0 });
const sub_ = (th: Theme): React.CSSProperties => ({ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, margin: '6px 0 14px' });
const label = (th: Theme): React.CSSProperties => ({ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: th.textMute, marginBottom: 8 });
const chip = (th: Theme, on: boolean): React.CSSProperties => ({ border: `1.5px solid ${on ? th.accent : th.lineStrong}`, background: on ? `${th.accent}14` : th.surface, color: th.text, borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700 });
const planCard = (th: Theme, on: boolean): React.CSSProperties => ({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1.5px solid ${on ? th.accent : th.lineStrong}`, background: on ? `${th.accent}14` : th.surface, color: th.text, borderRadius: 12, padding: '11px 13px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 });
const input = (th: Theme): React.CSSProperties => ({ marginTop: 8, width: '100%', border: `1px solid ${th.lineStrong}`, borderRadius: 10, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13, background: th.surface, color: th.text });
const errBox = (th: Theme): React.CSSProperties => ({ marginTop: 12, background: th.accent, color: th.onAccent, borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 });
