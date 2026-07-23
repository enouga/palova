'use client';
// Carte « Abonnement & soldes » du cockpit fiche membre 360 — composant PUR (aucun
// fetch) : n'ouvre aucun dialog elle-même (SubscriptionActions/PackageBalanceDialog
// restent montés par la page), elle se contente d'émettre les intentions.
import { useTheme } from '@/lib/ThemeProvider';
import { MemberHistory } from '@/lib/api';
import { Kicker, MEMBER_CARD_TINTS, memberCardStyle } from '@/components/admin/members/memberCardUi';

// La carte ne montre que les soldes encore UTILISABLES (miroir d'isUsable du backend) : un
// joueur accumule des carnets épuisés/expirés au fil des ans, ils ne doivent pas empiler la
// carte — le détail complet (dont recharge/correction des anciens) vit dans la porte Finances.
const BALANCES_PREVIEW = 4;
const balanceIsUsable = (b: MemberHistory['finance']['prepaid']['balances'][number], nowMs: number) =>
  (b.expiresAt == null || new Date(b.expiresAt).getTime() > nowMs)
  && ((b.creditsRemaining ?? 0) > 0 || Number(b.amountRemaining ?? 0) > 0);

export function MemberWalletCard({ data, onSubAction, onPkgAction, onSeeAllBalances }: {
  data: MemberHistory;
  onSubAction: (kind: 'renew' | 'change' | 'cancel') => void;
  onPkgAction: (mode: 'recharge' | 'adjust', bal: MemberHistory['finance']['prepaid']['balances'][number]) => void;
  /** Ouvre le détail Finances (tous les soldes, y compris épuisés/expirés). */
  onSeeAllBalances?: () => void;
}) {
  const { th } = useTheme();
  const sub = data.subscription;
  const fmtDate = (iso: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso));
  const line = { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderBottom: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13, color: th.text } as const;
  const ghost = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '5px 10px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.accent } as const;

  const all = data.finance.prepaid.balances;
  const nowMs = Date.now();
  const shown = all.filter((b) => balanceIsUsable(b, nowMs)).slice(0, BALANCES_PREVIEW);
  const hiddenCount = all.length - shown.length;

  return (
    <section aria-label="Abonnement et soldes" style={memberCardStyle(th)}>
      <Kicker color={MEMBER_CARD_TINTS.green}>Abonnement &amp; soldes</Kicker>
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
        {shown.map((b) => (
          <div key={b.id} style={line}>
            <span>{b.name}</span>
            <span><b>{b.kind === 'ENTRIES' ? `${b.creditsRemaining ?? 0} rest.` : `${b.amountRemaining ?? '0.00'} €`}</b>
              {' '}<button style={ghost} onClick={() => onPkgAction('recharge', b)}>Recharger</button>
              {' '}<button style={ghost} onClick={() => onPkgAction('adjust', b)}>Ajuster</button></span>
          </div>
        ))}
        {hiddenCount > 0 && onSeeAllBalances && (
          <button
            onClick={onSeeAllBalances}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '7px 0 0', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent }}
          >{hiddenCount} autre{hiddenCount > 1 ? 's' : ''} solde{hiddenCount > 1 ? 's' : ''} (épuisés ou expirés) — tout voir →</button>
        )}
      </div>
    </section>
  );
}
