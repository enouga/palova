'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { AgendaGroup } from '@/lib/adminAgenda';
import { groupAccentColor } from '@/components/admin/AgendaAdminCard';

interface Props<T> {
  groups: AgendaGroup<T>[];
  renderCard: (item: T) => ReactNode;
  itemKey: (item: T) => string;
  emptyLabel: string;
  ready: boolean; // l'horloge `now` est connue → on peut classer/afficher
}

// Rend les sections de statut (point coloré + label + compteur) puis les cartes.
export function AgendaAdminList<T>({ groups, renderCard, itemKey, emptyLabel, ready }: Props<T>) {
  const { th } = useTheme();
  if (!ready) return null;
  if (groups.length === 0) return <div style={{ fontFamily: th.fontUI, color: th.textMute }}>{emptyLabel}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {groups.map((g) => (
        <section key={g.key}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 2px 10px' }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: groupAccentColor(th, g.key) }} />
            <b style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: th.text }}>{g.label}</b>
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textFaint }}>· {g.items.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {g.items.map((it) => <div key={itemKey(it)}>{renderCard(it)}</div>)}
          </div>
        </section>
      ))}
    </div>
  );
}
