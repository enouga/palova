'use client';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { packageLabel } from '@/lib/packages';
import { eurosFromString } from '@/lib/payments';
import { Btn } from '@/components/ui/atoms';
import { PlayerPicker } from '@/components/admin/PlayerPicker';
import { SectionTitle } from '@/components/admin/ventes/SectionTitle';
import type { Member, PackageTemplate, SubscriptionPlan, MemberPackage, PaymentMethod, CreateMemberBody } from '@/lib/api';

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', VOUCHER: 'Ticket CE', OTHER: 'Autre',
};
const SALE_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'VOUCHER', 'OTHER'];

export interface SellSelection {
  kind: 'package' | 'subscription';
  id: string;
  method: PaymentMethod;
  voucherRef?: string;
  voucherIssuer?: string;
}

interface Offer { key: string; kind: 'package' | 'subscription'; id: string; name: string; price: string; suffix?: string }

const TOAST_MS = 3500;

/** Panneau de vente unifié : un seul acheteur, carnets ET abonnements groupés. */
export function SellPanel({ members, templates, plans, buyer, buyerPackages, busy, pickerBusy, onPickBuyer, onClear, onCreate, onSell }: {
  members: Member[];
  templates: PackageTemplate[];
  plans: SubscriptionPlan[];
  buyer: Member | null;
  buyerPackages: MemberPackage[];
  busy: boolean;
  /** sélection/création de l'acheteur en cours (distinct de `busy` = encaissement de la vente). */
  pickerBusy?: boolean;
  onPickBuyer: (m: Member) => void;
  onClear: () => void;
  onCreate: (body: CreateMemberBody) => Promise<{ tempPassword: string | null; existed: boolean }>;
  onSell: (sel: SellSelection) => void | Promise<boolean | void>;
}) {
  const { th } = useTheme();
  const [selKey, setSelKey] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [ref, setRef] = useState('');
  const [issuer, setIssuer] = useState('');
  const [refError, setRefError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const packageOffers: Offer[] = templates.map((t) => ({ key: `package:${t.id}`, kind: 'package', id: t.id, name: t.name, price: t.price }));
  const planOffers: Offer[] = plans.map((p) => ({ key: `subscription:${p.id}`, kind: 'subscription', id: p.id, name: p.name, price: p.monthlyPrice, suffix: '/mois' }));
  const selected = [...packageOffers, ...planOffers].find((o) => o.key === selKey) ?? null;

  const card = { background: th.surface, borderRadius: 16, padding: 18, boxShadow: th.shadow } as const;
  const groupLabel = { fontFamily: th.fontMono, fontSize: 10, fontWeight: 600 as const, letterSpacing: 0.5, textTransform: 'uppercase' as const, color: th.textFaint, margin: '10px 0 6px' };
  const input = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 } as const;

  const offerRow = (o: Offer) => {
    const active = o.key === selKey;
    return (
      <button key={o.key} type="button" onClick={() => { setSelKey(o.key); setRefError(false); }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left',
          border: 'none', boxShadow: active ? `inset 0 0 0 1.5px ${th.accent}` : `inset 0 0 0 1px ${th.line}`,
          background: active ? `${th.accent}12` : th.bg, color: th.text,
          borderRadius: 11, padding: '10px 13px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>{o.name}</span>
        <span style={{ fontFamily: th.fontDisplay, fontSize: 14, color: active ? th.accent : th.textMute, fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', letterSpacing: -0.2 }}>
          {eurosFromString(o.price)}{o.suffix ?? ''}
        </span>
      </button>
    );
  };

  const sell = async () => {
    if (!selected || !buyer) return;
    if (method === 'VOUCHER' && !ref.trim()) { setRefError(true); return; }
    const soldName = selected.name;
    const soldTo = `${buyer.firstName} ${buyer.lastName}`;
    // On ne vide la sélection (offre + réf ticket) que si la vente n'a PAS échoué,
    // pour que l'utilisateur puisse réessayer sans tout ressaisir.
    const ok = await onSell({
      kind: selected.kind, id: selected.id, method,
      voucherRef: method === 'VOUCHER' ? ref.trim() : undefined,
      voucherIssuer: method === 'VOUCHER' ? issuer.trim() || undefined : undefined,
    });
    if (ok !== false) {
      setSelKey(''); setRef(''); setIssuer(''); setRefError(false);
      onClear(); // prêt pour le client suivant
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast(`${soldName} → ${soldTo}`);
      toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
    }
  };

  return (
    <div style={card}>
      <SectionTitle icon="cart" accent={ACCENTS.emerald}>Vendre à un membre</SectionTitle>
      <div style={{ marginBottom: 12 }}>
        <PlayerPicker
          members={members}
          value={buyer ? { firstName: buyer.firstName, lastName: buyer.lastName } : null}
          onSelect={onPickBuyer}
          onClear={() => { onClear(); setSelKey(''); }}
          onCreate={onCreate}
          busy={pickerBusy}
          placeholder="Cliquez pour voir les membres, ou tapez un nom…"
        />
      </div>

      {buyer && (
        <>
          {buyerPackages.length > 0 && (
            <div style={{ marginBottom: 10, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
              Soldes actuels : {buyerPackages.map((p) => packageLabel(p)).join(' · ')}
            </div>
          )}

          {packageOffers.length > 0 && <div style={groupLabel}>Carnets &amp; cartes</div>}
          {packageOffers.map(offerRow)}
          {planOffers.length > 0 && <div style={groupLabel}>Abonnements</div>}
          {planOffers.map(offerRow)}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
            {SALE_METHODS.map((m) => (
              <button key={m} type="button" onClick={() => { setMethod(m); setRefError(false); }}
                style={{ border: `1px solid ${method === m ? th.accent : th.line}`, background: method === m ? th.accent : 'transparent',
                  color: method === m ? th.onAccent : th.text, borderRadius: 999, padding: '5px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>

          {method === 'VOUCHER' && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <input type="text" value={ref} onChange={(e) => { setRef(e.target.value); setRefError(false); }} placeholder="N° du ticket"
                style={{ ...input, flex: 1, minWidth: 120, border: `1px solid ${refError ? '#ff7a4d' : th.line}` }} />
              <input type="text" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="ANCV…" style={{ ...input, width: 110 }} />
            </div>
          )}

          <Btn type="button" icon="check" onClick={sell} disabled={busy || !selected}>
            {busy ? '…' : selected ? `Encaisser ${eurosFromString(selected.price)}${selected.suffix ?? ''}` : 'Encaisser'}
          </Btn>
        </>
      )}

      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 55, width: 'min(420px, calc(100vw - 32px))', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, background: th.text, color: th.bg, borderRadius: 12, padding: '11px 16px', fontSize: 12.5, fontWeight: 600, boxShadow: th.shadow }}>
          <span aria-hidden="true">✓</span>
          <span style={{ flex: 1 }}>Vendu · {toast}</span>
        </div>
      )}
    </div>
  );
}
