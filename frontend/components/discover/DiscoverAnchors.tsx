'use client';
import { useTheme } from '@/lib/ThemeProvider';

export interface DiscoverAnchorItem { id: string; label: string; count: number | null }

// Rangée d'ancres de /decouvrir : navigation dans le scroll (PAS des onglets — les sections
// restent toutes rendues). Le parent fournit la section active (scroll-spy) ET la collante
// (DiscoverClient l'empile avec la barre de recherche dans un seul conteneur sticky).
export function DiscoverAnchors({ items, active, onJump }: {
  items: DiscoverAnchorItem[];
  active: string;
  onJump: (id: string) => void;
}) {
  const { th } = useTheme();
  return (
    <div style={{ padding: '6px 20px 8px' }}>
      <div style={{ display: 'flex', gap: 4, background: th.surface2, borderRadius: 999, padding: 4, maxWidth: 430, margin: '0 auto' }}>
        {items.map((it) => {
          const isActive = it.id === active;
          return (
            <button key={it.id} onClick={() => onJump(it.id)} aria-current={isActive ? 'true' : undefined}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                border: 'none', cursor: 'pointer', borderRadius: 999, padding: '9px 6px',
                fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap',
                background: isActive ? th.accent : 'transparent',
                color: isActive ? th.onAccent : th.textMute,
                boxShadow: isActive ? th.shadowSoft : 'none', transition: 'background .15s, color .15s' }}>
              {it.label}
              {it.count != null && (
                <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '1px 7px',
                  background: isActive ? 'rgba(255,255,255,.3)' : th.surface,
                  color: isActive ? th.onAccent : th.textMute }}>{it.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
