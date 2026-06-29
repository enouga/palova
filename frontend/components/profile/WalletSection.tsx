'use client';
import { useTheme } from '@/lib/ThemeProvider';
import type { MemberPackage, Subscription } from '@/lib/api';
import { packageLabel, isUsable } from '@/lib/packages';

interface Props { packages: MemberPackage[]; subscriptions: Subscription[]; }

/** Portefeuille (lecture seule) : abonnements actifs + soldes prépayés du club courant. */
export function WalletSection({ packages, subscriptions }: Props) {
  const { th } = useTheme();
  const row: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    background: th.surface2, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 14, color: th.text,
  };
  const faint: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 13, color: th.textFaint };
  const empty = packages.length === 0 && subscriptions.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {empty && <span style={faint}>Aucun abonnement ni solde prépayé pour ce club.</span>}

      {subscriptions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {subscriptions.map((s) => (
            <div key={s.id} style={row}>
              <span style={{ fontWeight: 600 }}>{s.plan.name}</span>
              <span style={faint}>
                {s.benefit === 'INCLUDED' ? 'Inclus' : `-${s.discountPercent ?? 0}%`}
                {' · '}jusqu’au {new Date(s.expiresAt).toLocaleDateString('fr-FR')}
              </span>
            </div>
          ))}
        </div>
      )}

      {packages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {packages.map((p) => (
            <div key={p.id} style={row}>
              <span style={{ fontWeight: 600 }}>{packageLabel(p)}</span>
              {!isUsable(p) && <span style={faint}>expiré / épuisé</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
