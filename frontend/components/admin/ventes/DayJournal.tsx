'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { hhmm, isSalePayment, toCents, fmtEuros } from '@/lib/caisse';
import type { CaissePayment, PaymentMethod } from '@/lib/api';

export type JournalFilter = 'all' | 'sales' | 'resa';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre',
  VOUCHER: 'Ticket CE', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre', SUBSCRIPTION: 'Abonnement',
};
const MONEY_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER'];
const PREPAID_METHODS: PaymentMethod[] = ['PACK_CREDIT', 'WALLET', 'MEMBER', 'SUBSCRIPTION'];
const FILTERS: { value: JournalFilter; label: string }[] = [
  { value: 'all', label: 'Tout' }, { value: 'sales', label: 'Ventes' }, { value: 'resa', label: 'Résas' },
];

const euro = (s: string) => `${Number(s).toFixed(2).replace('.', ',')} €`;

function label(p: CaissePayment): string {
  if (p.memberPackage) return `${p.memberPackage.user.firstName} ${p.memberPackage.user.lastName} · ${p.memberPackage.template.name}`;
  if (p.reservation) {
    const who = p.reservation.user ? `${p.reservation.user.firstName} ${p.reservation.user.lastName}` : 'Réservation';
    return `${who} · ${p.reservation.resource.name}`;
  }
  return p.payerName ?? 'Encaissement';
}

/** Journal horodaté du jour (filtrable) + carte « Compter la caisse ». */
export function DayJournal({ payments, tz, totalsByMethod, filter, onFilter, onReceipt, onRefund, busy }: {
  payments: CaissePayment[];
  tz: string;
  totalsByMethod: Partial<Record<PaymentMethod, string>>;
  filter: JournalFilter;
  onFilter: (f: JournalFilter) => void;
  onReceipt: (p: CaissePayment) => void;
  onRefund: (p: CaissePayment) => void;
  busy: boolean;
}) {
  const { th } = useTheme();
  const card = { background: th.surface, borderRadius: 16, padding: 18, boxShadow: th.shadow } as const;
  const shown = payments.filter((p) => (filter === 'all' ? true : filter === 'sales' ? isSalePayment(p) : !isSalePayment(p)));

  const chipTint = (m: PaymentMethod): { bg: string; color: string } => {
    if (m === 'CARD' || m === 'ONLINE') return { bg: `${th.accent}1f`, color: th.accent };
    if (m === 'VOUCHER') return { bg: `${ACCENTS.apricot}26`, color: ACCENTS.coral };
    return { bg: th.surface2, color: th.textMute };
  };

  const totalChips = (methods: PaymentMethod[]) =>
    methods
      .map((m) => ({ m, v: totalsByMethod[m] }))
      .filter((x): x is { m: PaymentMethod; v: string } => x.v != null && toCents(x.v) !== 0);

  const moneyChips = totalChips(MONEY_METHODS);
  const prepaidChips = totalChips(PREPAID_METHODS);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text }}>Journal du jour</div>
          <div style={{ display: 'flex', gap: 4, background: th.surface2, borderRadius: 10, padding: 3 }}>
            {FILTERS.map((f) => (
              <button key={f.value} type="button" onClick={() => onFilter(f.value)}
                style={{ border: 'none', cursor: 'pointer', borderRadius: 8, padding: '5px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
                  background: filter === f.value ? th.surface : 'transparent', color: filter === f.value ? th.text : th.textMute, boxShadow: filter === f.value ? th.shadow : 'none' }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {shown.map((p) => {
            const refunded = toCents(p.refundedAmount ?? '0');
            const isFullyRefunded = p.status === 'REFUNDED';
            const chip = chipTint(p.method);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 13, color: th.text, padding: '9px 0', borderTop: `1px solid ${th.line}` }}>
                <span style={{ fontFamily: th.fontMono, fontSize: 11.5, color: th.textMute, minWidth: 40 }}>{hhmm(p.createdAt, tz)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{label(p)}</span>
                <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '2px 9px', background: chip.bg, color: chip.color, whiteSpace: 'nowrap' }}>
                  {METHOD_LABEL[p.method]}{p.voucherRef ? ` · ${p.voucherRef}` : ''}
                </span>
                {refunded > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: ACCENTS.coral, background: `${ACCENTS.coral}22`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                    remboursé {fmtEuros(refunded)}
                  </span>
                )}
                <b style={{ color: isFullyRefunded ? th.textMute : th.text, whiteSpace: 'nowrap' }}>{euro(p.amount)}</b>
                {!isFullyRefunded && (
                  <button type="button" onClick={() => onRefund(p)} disabled={busy}
                    style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9, padding: '4px 9px', cursor: busy ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Rembourser
                  </button>
                )}
                <button type="button" onClick={() => onReceipt(p)}
                  style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 9, padding: '4px 9px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Reçu
                </button>
              </div>
            );
          })}
          {shown.length === 0 && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, paddingTop: 6 }}>Aucun encaissement.</div>}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontFamily: th.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textFaint, marginBottom: 8 }}>Compter la caisse</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {moneyChips.map(({ m, v }) => (
            <span key={m} style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '5px 12px', background: th.surface2, color: th.text }}>
              {METHOD_LABEL[m]} {euro(v)}
            </span>
          ))}
          {moneyChips.length === 0 && <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>Aucune entrée d'argent.</span>}
        </div>
        {prepaidChips.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${th.line}` }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, alignSelf: 'center' }}>Consommations prépayées (pas d'argent) :</span>
            {prepaidChips.map(({ m, v }) => (
              <span key={m} style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, borderRadius: 999, padding: '4px 10px', background: 'transparent', color: th.textMute, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                {METHOD_LABEL[m]} {euro(v)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
