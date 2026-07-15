'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { hhmm, isSalePayment, toCents, fmtEuros } from '@/lib/caisse';
import { Icon, IconName } from '@/components/ui/Icon';
import { SectionTitle } from '@/components/admin/ventes/SectionTitle';
import type { CaissePayment, PaymentMethod } from '@/lib/api';

export type JournalFilter = 'all' | 'sales' | 'resa';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre',
  VOUCHER: 'Ticket CE', CHEQUE: 'Chèque', CLUB: 'Au club', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre', SUBSCRIPTION: 'Abonnement',
};
const METHOD_ICON: Record<PaymentMethod, IconName> = {
  CASH: 'euro', CARD: 'card', TRANSFER: 'arrowR', ONLINE: 'card', OTHER: 'euro',
  VOUCHER: 'ticket', CHEQUE: 'ticket', CLUB: 'home', PACK_CREDIT: 'ticket', WALLET: 'wallet', MEMBER: 'user', SUBSCRIPTION: 'bolt',
};
const MONEY_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER', 'CHEQUE', 'CLUB'];
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

  // Teinte de la tuile-icône : CB = accent du club, espèces = emerald, tickets/chèques = apricot,
  // virement = cyan ; prépayé et le reste = tuile neutre (pas d'argent qui rentre / cas divers).
  const tintOf = (m: PaymentMethod): string | null =>
    m === 'CARD' || m === 'ONLINE' ? th.accent
    : m === 'CASH' ? ACCENTS.emerald
    : m === 'VOUCHER' || m === 'CHEQUE' ? ACCENTS.apricot
    : m === 'TRANSFER' ? ACCENTS.cyan
    : null;

  const methodTile = (m: PaymentMethod) => {
    const c = tintOf(m);
    return (
      <span aria-hidden="true" style={{
        width: 34, height: 34, borderRadius: 11, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: c ? (th.mode === 'floodlit' ? `${c}24` : `${c}40`) : th.surface2,
      }}>
        <Icon name={METHOD_ICON[m]} size={16} color={c ? (th.mode === 'floodlit' ? c : th.ink) : th.textMute} />
      </span>
    );
  };

  const ghostBtn = {
    border: `1px solid ${th.line}`, background: 'transparent', borderRadius: 9, padding: '4px 10px',
    fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' as const,
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
        <SectionTitle icon="clock" accent={th.accent} right={
          <div style={{ display: 'flex', gap: 4, background: th.surface2, borderRadius: 10, padding: 3 }}>
            {FILTERS.map((f) => (
              <button key={f.value} type="button" onClick={() => onFilter(f.value)}
                style={{ border: 'none', cursor: 'pointer', borderRadius: 8, padding: '5px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
                  background: filter === f.value ? th.surface : 'transparent', color: filter === f.value ? th.text : th.textMute, boxShadow: filter === f.value ? th.shadow : 'none' }}>
                {f.label}
              </button>
            ))}
          </div>
        }>Journal du jour</SectionTitle>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {shown.map((p) => {
            const refunded = toCents(p.refundedAmount ?? '0');
            const isFullyRefunded = p.status === 'REFUNDED';
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${th.line}`, opacity: isFullyRefunded ? 0.6 : 1 }}>
                {methodTile(p.method)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 650, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(p)}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 1, fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>
                    <span style={{ fontFamily: th.fontMono, fontSize: 11 }}>{hhmm(p.createdAt, tz)}</span>
                    <span>· {METHOD_LABEL[p.method]}{p.voucherRef ? ` · ${p.voucherRef}` : ''}</span>
                  </div>
                </div>
                {refunded > 0 && (
                  <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, color: ACCENTS.coral, background: `${ACCENTS.coral}22`, borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                    remboursé {fmtEuros(refunded)}
                  </span>
                )}
                <b style={{ fontFamily: th.fontDisplay, fontSize: 14.5, fontWeight: 700, letterSpacing: -0.2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                  color: isFullyRefunded ? th.textMute : th.text, textDecoration: isFullyRefunded ? 'line-through' : 'none' }}>{euro(p.amount)}</b>
                {!isFullyRefunded && (
                  <button type="button" onClick={() => onRefund(p)} disabled={busy}
                    style={{ ...ghostBtn, color: th.text, cursor: busy ? 'default' : 'pointer' }}>
                    Rembourser
                  </button>
                )}
                <button type="button" onClick={() => onReceipt(p)} style={{ ...ghostBtn, color: th.textMute, cursor: 'pointer' }}>
                  Reçu
                </button>
              </div>
            );
          })}
          {shown.length === 0 && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, paddingTop: 6 }}>Aucun encaissement.</div>}
        </div>
      </div>

      <div style={card}>
        <SectionTitle icon="wallet" accent={ACCENTS.apricot}>Compter la caisse</SectionTitle>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {moneyChips.map(({ m, v }) => (
            <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, borderRadius: 999, padding: '6px 13px', background: th.surface2, color: th.text }}>
              <Icon name={METHOD_ICON[m]} size={14} color={th.textMute} />
              {METHOD_LABEL[m]} {euro(v)}
            </span>
          ))}
          {moneyChips.length === 0 && <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>Aucune entrée d&apos;argent.</span>}
        </div>
        {prepaidChips.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${th.line}` }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, alignSelf: 'center' }}>Consommations prépayées (pas d&apos;argent) :</span>
            {prepaidChips.map(({ m, v }) => (
              <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, borderRadius: 999, padding: '4px 11px', background: 'transparent', color: th.textMute, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                <Icon name={METHOD_ICON[m]} size={13} color={th.textFaint} />
                {METHOD_LABEL[m]} {euro(v)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
