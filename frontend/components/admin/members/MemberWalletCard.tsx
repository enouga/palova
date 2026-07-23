'use client';
// Carte « Abonnement & soldes » du cockpit fiche membre 360 — composant PUR (aucun
// fetch) : n'ouvre aucun dialog elle-même (SubscriptionActions/PackageBalanceDialog
// restent montés par la page), elle se contente d'émettre les intentions.
import { useTheme } from '@/lib/ThemeProvider';
import { MemberHistory } from '@/lib/api';

export function MemberWalletCard({ data, onSubAction, onPkgAction }: {
  data: MemberHistory;
  onSubAction: (kind: 'renew' | 'change' | 'cancel') => void;
  onPkgAction: (mode: 'recharge' | 'adjust', bal: MemberHistory['finance']['prepaid']['balances'][number]) => void;
}) {
  const { th } = useTheme();
  const sub = data.subscription;
  const fmtDate = (iso: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso));
  const line = { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderBottom: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13, color: th.text } as const;
  const ghost = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '5px 10px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.accent } as const;
  return (
    <section aria-label="Abonnement et soldes" style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: th.shadow }}>
      <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, margin: '0 0 8px', color: th.text }}>Abonnement &amp; soldes</h2>
      {sub ? (
        <>
          <div style={line}><span>{sub.planName}</span><b>→ {fmtDate(sub.expiresAt)}</b></div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button style={ghost} onClick={() => onSubAction('renew')}>Renouveler</button>
            <button style={ghost} onClick={() => onSubAction('change')}>Changer</button>
            <button style={ghost} onClick={() => onSubAction('cancel')}>Résilier</button>
          </div>
        </>
      ) : <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>Pas d&apos;abonnement actif.</div>}
      <div style={{ marginTop: 10 }}>
        {data.finance.prepaid.balances.map((b) => (
          <div key={b.id} style={line}>
            <span>{b.name}</span>
            <span><b>{b.kind === 'ENTRIES' ? `${b.creditsRemaining ?? 0} rest.` : `${b.amountRemaining ?? '0.00'} €`}</b>
              {' '}<button style={ghost} onClick={() => onPkgAction('recharge', b)}>Recharger</button>
              {' '}<button style={ghost} onClick={() => onPkgAction('adjust', b)}>Ajuster</button></span>
          </div>
        ))}
      </div>
    </section>
  );
}
