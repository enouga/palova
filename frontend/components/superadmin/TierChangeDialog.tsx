'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { Btn } from '@/components/ui/atoms';
import { PLATFORM_TIERS, tierLabel, tierPriceCents } from '@/lib/platformTiers';
import { eurosCompact as euros } from '@/lib/payments';

/**
 * Change le palier (et éventuellement la cadence) de l'abonnement d'un club.
 * Top-sheet, même langage visuel que ChangeSlugDialog. Sans prorata : effectif
 * à la prochaine facture.
 */
export function TierChangeDialog({ clubId, currentTier, currentInterval, onDone, onCancel }: {
  clubId: string;
  currentTier: number;
  currentInterval: 'month' | 'year';
  onDone: () => void;
  onCancel: () => void;
}) {
  const { th } = useTheme();
  const { token } = useAuth();
  const [tier, setTier] = useState(currentTier);
  const [interval, setInterval] = useState<'month' | 'year'>(currentInterval);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payableTiers = PLATFORM_TIERS.filter((t) => t.tier >= 1);
  const unchanged = tier === currentTier && interval === currentInterval;

  async function submit() {
    if (!token || unchanged) return;
    setBusy(true); setError(null);
    try {
      await api.platformSetSubscriptionTier(clubId, { tier, interval }, token);
      onDone();
    } catch (err) {
      const m = (err as Error).message;
      setError(m === 'NO_SUBSCRIPTION' ? "Ce club n'a pas d'abonnement actif."
        : m === 'TIER_INVALID' ? 'Palier invalide.'
        : 'Échec du changement de palier. Réessayez.');
    } finally { setBusy(false); }
  }

  const segBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '9px 0', borderRadius: 9, cursor: 'pointer', fontFamily: th.fontUI,
    fontWeight: 700, fontSize: 13.5, border: 'none',
    background: active ? th.accent : 'transparent', color: active ? th.onAccent : th.textMute,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      <div onClick={busy ? undefined : onCancel} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
      <div role="dialog" aria-modal="true" style={{ position: 'relative', width: '100%', maxWidth: 520, margin: '0 auto', background: th.bgElev, borderRadius: '0 0 28px 28px', padding: '12px 20px 36px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)' }}>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, letterSpacing: -0.3 }}>
          Changer le palier
        </div>

        {/* Cadence */}
        <div style={{ display: 'flex', gap: 4, marginTop: 16, padding: 4, background: th.surface2, borderRadius: 12 }}>
          <button style={segBtn(interval === 'month')} onClick={() => setInterval('month')}>Mensuel</button>
          <button style={segBtn(interval === 'year')} onClick={() => setInterval('year')}>Annuel −15 %</button>
        </div>

        {/* Grille des paliers payants */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))', gap: 10, marginTop: 16 }}>
          {payableTiers.map((t) => {
            const selected = t.tier === tier;
            const isCurrent = t.tier === currentTier;
            return (
              <button key={t.tier} onClick={() => setTier(t.tier)} style={{
                position: 'relative', textAlign: 'center', cursor: 'pointer',
                background: th.bgElev, borderRadius: 14, padding: '16px 12px 12px',
                border: `1px solid ${selected ? 'transparent' : th.line}`,
                boxShadow: selected ? `0 0 0 2px ${th.accent}` : undefined,
              }}>
                {isCurrent && (
                  <div style={{
                    position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)',
                    background: th.textMute, color: '#fff', fontFamily: th.fontUI, fontSize: 10,
                    fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase',
                    padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
                  }}>Actuel</div>
                )}
                <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute }}>
                  {tierLabel(t.tier).replace(' membres actifs', '')}
                </div>
                <div style={{ fontFamily: th.fontDisplay, fontSize: 22, fontWeight: 700, color: selected ? th.accent : th.text, marginTop: 6 }}>
                  {euros(tierPriceCents(t.tier, interval))}
                </div>
                <div style={{ fontFamily: th.fontUI, fontSize: 10.5, color: th.textFaint, marginTop: 2 }}>
                  {interval === 'year' ? '/an HT' : '/mois HT'}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 14, lineHeight: 1.45 }}>
          Le changement est <strong>sans prorata</strong> : il prend effet à la prochaine facture. Le club
          n&apos;est ni débité ni remboursé immédiatement.
        </div>

        {error && (
          <div style={{ ...dangerBanner(th), marginTop: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 11, marginTop: 22 }}>
          <Btn variant="surface" onClick={onCancel} disabled={busy} style={{ flex: '0 0 42%' }}>Retour</Btn>
          <Btn onClick={submit} disabled={busy || unchanged} style={{ flex: 1 }}>
            {busy ? '…' : 'Appliquer le palier'}
          </Btn>
        </div>
        <div style={{ width: 38, height: 5, borderRadius: 3, background: th.lineStrong, margin: '18px auto 0' }} />
      </div>
    </div>
  );
}
