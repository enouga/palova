'use client';
import { useTheme } from '@/lib/ThemeProvider';
import type { MemberPackage, Subscription } from '@/lib/api';
import { packageLabel, isUsable } from '@/lib/packages';
import { Icon } from '@/components/ui/Icon';
import { AccountEmpty } from './AccountEmpty';

interface Props { packages: MemberPackage[]; subscriptions: Subscription[]; }

/** Portefeuille (lecture seule) : abonnements actifs + soldes prépayés du club courant. */
export function WalletSection({ packages, subscriptions }: Props) {
  const { th } = useTheme();

  if (packages.length === 0 && subscriptions.length === 0) {
    return <AccountEmpty icon="wallet" title="Aucun abonnement ni solde prépayé"
      hint="Vos abonnements et carnets de ce club s’afficheront ici." />;
  }

  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12,
    background: th.surface2, borderRadius: 13, padding: '11px 13px',
  };
  const tile = (accent: boolean): React.CSSProperties => ({
    width: 36, height: 36, flexShrink: 0, borderRadius: 10,
    background: accent ? th.accent : th.surface,
    boxShadow: accent ? 'none' : `inset 0 0 0 1px ${th.line}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  const name: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text };
  const meta: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {subscriptions.map((s) => (
        <div key={s.id} style={row}>
          <span aria-hidden="true" style={tile(true)}><Icon name="check" size={18} color={th.onAccent} /></span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
            <span style={name}>{s.plan.name}</span>
            <span style={meta}>{s.benefit === 'INCLUDED' ? 'Inclus' : `-${s.discountPercent ?? 0}%`}</span>
          </div>
          <span style={{ ...meta, flexShrink: 0 }}>jusqu’au {new Date(s.expiresAt).toLocaleDateString('fr-FR')}</span>
        </div>
      ))}

      {packages.map((p) => {
        const usable = isUsable(p);
        return (
          <div key={p.id} style={row}>
            <span aria-hidden="true" style={tile(false)}>
              <Icon name={p.kind === 'ENTRIES' ? 'ticket' : 'wallet'} size={18} color={usable ? th.textMute : th.textFaint} />
            </span>
            <span style={{ ...name, flex: 1, minWidth: 0, color: usable ? th.text : th.textFaint }}>{packageLabel(p)}</span>
            {!usable && <span style={{ ...meta, flexShrink: 0 }}>expiré / épuisé</span>}
          </div>
        );
      })}
    </div>
  );
}
