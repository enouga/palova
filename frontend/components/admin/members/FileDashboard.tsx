'use client';
import { useTheme } from '@/lib/ThemeProvider';

const CORAL = '#ff7a4d';

/** État vide du panneau droit : le fichier-membres en chiffres (jamais d'écran blanc). */
export function FileDashboard({ kpis, watchCount }: {
  kpis: { total: number; subscribers: number; activeRecent: number; blocked: number };
  watchCount: number;
}) {
  const { th } = useTheme();
  const tile = (label: string, value: number, color: string) => (
    <div style={{ flex: 1, minWidth: 130, background: th.surface, borderRadius: 16, padding: '18px 20px', boxShadow: th.shadow }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>{label}</div>
      <div style={{ fontFamily: th.fontDisplay, fontSize: 36, fontWeight: 600, letterSpacing: -0.5, marginTop: 6, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {tile('Membres', kpis.total, th.text)}
        {tile('Abonnés', kpis.subscribers, th.accent)}
        {tile('Actifs 30 j', kpis.activeRecent, th.text)}
        {tile('Bloqués', kpis.blocked, kpis.blocked > 0 ? CORAL : th.textFaint)}
      </div>
      {watchCount > 0 && (
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
          👁 {watchCount} membre{watchCount > 1 ? 's' : ''} à surveiller
        </div>
      )}
      <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, margin: '4px 0 0' }}>
        Sélectionnez un membre dans la liste pour ouvrir sa fiche — ↑↓ pour naviguer, Échap pour revenir ici.
      </p>
    </div>
  );
}
