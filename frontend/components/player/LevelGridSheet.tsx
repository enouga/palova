'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { LEVEL_GRID } from '@/lib/levelGrid';
import { LEVEL_SOURCE_PLAIN } from '@/lib/levelSource';
import { Icon } from '@/components/ui/Icon';

// Grille COMPLÈTE des 8 niveaux padel 2026 — feuille top-sheet.
// Chaque niveau : pastille teintée à l'accent (intensité croissante) + nom, critères de jeu,
// et équivalence compétition. Crédit Padel Magazine en texte. Ferme via overlay / bouton.
export function LevelGridSheet({ onClose }: { onClose: () => void }) {
  const { th } = useTheme();
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 110, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
      <div role="dialog" aria-modal="true" aria-label="Grille des niveaux"
        style={{ position: 'relative', width: '100%', maxWidth: 520, margin: '0 auto', maxHeight: '94vh', overflowY: 'auto', background: th.bgElev, borderRadius: '0 0 28px 28px', padding: '14px 20px 28px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, position: 'sticky', top: 0, background: th.bgElev, paddingBottom: 6, zIndex: 1 }}>
          <div>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, color: th.text, letterSpacing: -0.3 }}>Grille des niveaux</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 3 }}>Du premier échange à la P2000. Repère-toi, fixe ta fourchette.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"
            style={{ flex: '0 0 auto', background: th.surface2, border: 'none', borderRadius: 10, padding: 7, cursor: 'pointer', lineHeight: 0 }}>
            <Icon name="x" size={18} color={th.textMute} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {LEVEL_GRID.map((t) => {
            const frac = (t.level - 1) / 7;
            const alpha = Math.round((0.16 + frac * 0.62) * 255).toString(16).padStart(2, '0');
            return (
              <div key={t.level} style={{ display: 'flex', gap: 12, padding: '12px 14px', background: th.surface, border: `1px solid ${th.line}`, borderRadius: 16 }}>
                {/* rail : pastille + barre d'intensité verticale */}
                <div style={{ flex: '0 0 38px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${th.accent}${alpha}`, color: th.text, fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 18 }}>{t.level}</div>
                  <div style={{ flex: 1, width: 4, borderRadius: 999, background: th.surface2, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <span style={{ width: '100%', height: `${Math.round((0.25 + frac * 0.75) * 100)}%`, background: th.accent, borderRadius: 999 }} />
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: th.fontUI, fontSize: 15.5, fontWeight: 700, color: th.text, lineHeight: 1.15 }}>{t.name}</div>
                  <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.45, marginTop: 5 }}>{t.play}</div>

                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'flex-start', gap: 7, background: th.surface2, borderRadius: 10, padding: '7px 10px' }}>
                    <Icon name="trophy" size={14} color={t.comp ? th.accent : th.textFaint} />
                    <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: t.comp ? th.textMute : th.textFaint, lineHeight: 1.4 }}>
                      {t.comp || 'Pas encore de compétition à ce niveau.'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${th.line}`, display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint }}>
          <Icon name="info" size={14} color={th.textFaint} />
          {LEVEL_SOURCE_PLAIN}
        </div>

        <div style={{ width: 38, height: 5, borderRadius: 3, background: th.lineStrong, margin: '16px auto 0' }} />
      </div>
    </div>
  );
}
