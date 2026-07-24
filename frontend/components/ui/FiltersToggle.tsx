'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

// Bouton repliable « ⚙ Filtres · N » partagé par les tiroirs de filtres de /decouvrir
// (Tournois, Parties, Clubs) — extrait de TournamentFinder.tsx pour un seul langage. Badge
// compteur, chevron, lien « Effacer » à côté (rendu seulement si count > 0). Le tiroir de
// contenu (facettes) reste chez l'appelant — ce composant ne rend que la rangée de contrôle.
export function FiltersToggle({ count, open, onToggle, onClear, controlsId }: {
  count: number;
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  controlsId: string;
}) {
  const { th } = useTheme();
  return (
    <div style={{ padding: '4px 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={controlsId}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', cursor: 'pointer',
          borderRadius: 999, padding: '8px 14px', background: th.bgElev,
          boxShadow: `inset 0 0 0 1px ${th.line}`, fontFamily: th.fontUI, fontSize: 13.5,
          fontWeight: 700, color: th.text, WebkitTapHighlightColor: 'transparent',
        }}
      >
        <Icon name="settings" size={15} color={th.textMute} />
        Filtres
        {count > 0 && (
          <span aria-hidden="true" style={{
            minWidth: 18, height: 18, borderRadius: 999, padding: '0 5px', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', background: th.accent, color: th.onAccent,
            fontSize: 11.5, fontWeight: 800, lineHeight: 1,
          }}>{count}</span>
        )}
        <span aria-hidden="true" style={{ display: 'inline-flex', transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform .15s' }}>
          <Icon name="chevR" size={13} color={th.textMute} />
        </span>
      </button>
      {count > 0 && (
        <button type="button" onClick={onClear} style={{
          border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI,
          fontSize: 12.5, fontWeight: 600, color: th.textMute, padding: '4px 6px',
        }}>Effacer</button>
      )}
    </div>
  );
}
