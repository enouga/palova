'use client';
import { useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { api, PaymentMethod } from '@/lib/api';

type Bal = {
  id: string; kind: 'ENTRIES' | 'WALLET'; name: string;
  creditsRemaining: number | null; amountRemaining: string | null; expiresAt: string | null;
};

const SALE_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CARD', label: 'Carte' }, { value: 'CASH', label: 'Espèces' },
  { value: 'TRANSFER', label: 'Virement' }, { value: 'VOUCHER', label: 'Ticket CE' }, { value: 'OTHER', label: 'Autre' },
];

const ERR: Record<string, string> = {
  PACKAGE_EXPIRED: 'Solde expiré — vendez une nouvelle offre.',
  VALIDATION_ERROR: 'Valeurs invalides.',
  PACKAGE_NOT_FOUND: 'Solde introuvable.',
};

// Dialog de recharge (top-up encaissé) ou de correction (valeur cible, sans argent) d'un solde prépayé.
export function PackageBalanceDialog({ clubId, userId, token, mode, bal, onClose, onDone }: {
  clubId: string; userId: string; token: string;
  mode: 'recharge' | 'adjust'; bal: Bal;
  onClose: () => void; onDone: () => void;
}) {
  const { th } = useTheme();
  const entries = bal.kind === 'ENTRIES';
  // Correction : préremplie au solde courant. Recharge : champs vides.
  const [qty, setQty] = useState(mode === 'adjust' && entries ? String(bal.creditsRemaining ?? 0) : '');
  const [amount, setAmount] = useState(mode === 'adjust' && !entries ? String(bal.amountRemaining ?? 0) : '');
  const [price, setPrice] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const [voucherRef, setVoucherRef] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 9, padding: '9px 10px', fontFamily: th.fontUI, fontSize: 14, width: '100%', boxSizing: 'border-box' };
  const label: CSSProperties = { fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3, display: 'block', marginBottom: 5 };

  const canSubmit = mode === 'recharge'
    ? (entries ? !!qty && !!price : !!amount) && (method !== 'VOUCHER' || !!voucherRef.trim())
    : (entries ? qty !== '' : amount !== '') && !!reason.trim();

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (mode === 'recharge') {
        const voucher = method === 'VOUCHER' ? { voucherRef: voucherRef.trim() } : {};
        await api.adminRechargePackage(clubId, userId, bal.id,
          entries
            ? { addEntries: parseInt(qty, 10), price: parseFloat(price), method, ...voucher }
            : { addAmount: parseFloat(amount), method, ...voucher },
          token);
      } else {
        await api.adminAdjustPackage(clubId, userId, bal.id,
          entries ? { newCredits: parseInt(qty, 10), reason: reason.trim() } : { newAmount: parseFloat(amount), reason: reason.trim() },
          token);
      }
      onDone(); onClose();
    } catch (e) {
      const m = (e as Error).message;
      setErr(ERR[m] ?? m);
    } finally { setBusy(false); }
  };

  const title = mode === 'recharge' ? `Recharger « ${bal.name} »` : `Corriger « ${bal.name} »`;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh 16px 16px', overflowY: 'auto' }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 420, background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 19, margin: 0, color: th.text }}>{title}</h2>
          <button onClick={onClose} aria-label="Fermer" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: '0 0 16px' }}>
          {mode === 'recharge'
            ? 'Ajoute au solde existant et encaisse le paiement (il apparaît dans la caisse du jour).'
            : 'Ajuste le solde sans encaissement (correction d’erreur). La modification est journalisée dans les notes.'}
        </p>

        {err && <div style={{ ...dangerBanner(th), marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'recharge' ? (
            <>
              {entries ? (
                <>
                  <div><span style={label}>Entrées à ajouter</span><input aria-label="Entrées à ajouter" type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} style={input} /></div>
                  <div><span style={label}>Montant encaissé (€)</span><input aria-label="Montant encaissé (€)" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} style={input} /></div>
                </>
              ) : (
                <div><span style={label}>Montant à ajouter (€)</span><input aria-label="Montant à ajouter (€)" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} /></div>
              )}
              <div><span style={label}>Moyen de paiement</span>
                <select aria-label="Moyen de paiement" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} style={{ ...input, appearance: 'auto' }}>
                  {SALE_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              {method === 'VOUCHER' && (
                <div><span style={label}>Référence ticket</span><input aria-label="Référence ticket" value={voucherRef} onChange={(e) => setVoucherRef(e.target.value)} placeholder="N° du ticket" style={input} /></div>
              )}
            </>
          ) : (
            <>
              {entries
                ? <div><span style={label}>Nouveau nombre d’entrées</span><input aria-label="Nouveau nombre d'entrées" type="number" min={0} step={1} value={qty} onChange={(e) => setQty(e.target.value)} style={input} /></div>
                : <div><span style={label}>Nouveau montant (€)</span><input aria-label="Nouveau montant (€)" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} /></div>}
              <div><span style={label}>Motif de la correction</span><input aria-label="Motif de la correction" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Erreur de saisie…" style={input} /></div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button type="button" onClick={onClose} style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 10, padding: '9px 16px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>Annuler</button>
          <button type="button" onClick={submit} disabled={busy || !canSubmit}
            style={{ flex: 1, border: 'none', borderRadius: 10, padding: '10px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, background: th.accent, color: th.onAccent, cursor: busy || !canSubmit ? 'default' : 'pointer', opacity: busy || !canSubmit ? 0.5 : 1 }}>
            {busy ? '…' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
}
