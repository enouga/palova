'use client';
import { useTheme } from '@/lib/ThemeProvider';

/**
 * Bloc d'info « Conditions d'annulation » — PURE information (lecture seule),
 * volontairement distinct des cartes de choix au-dessus : pas de bordure « carte »,
 * fond plat discret et titre en petit capitale → ne se lit pas comme une option à cocher.
 *
 * Extrait de BookingModal.tsx (composant privé) pour être réutilisable ailleurs (checkout page).
 */
export function CancellationNotice({ text }: { text: string }) {
  const { th } = useTheme();
  return (
    <div style={{ marginTop: 16, background: th.surface2, borderRadius: 12, padding: '11px 13px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ width: 26, height: 26, flex: '0 0 auto', borderRadius: 8, background: '#fff1e9', color: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>↺</span>
      <div>
        <div style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textMute, marginBottom: 2 }}>Conditions d&apos;annulation</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.45 }}>{text}</div>
      </div>
    </div>
  );
}
