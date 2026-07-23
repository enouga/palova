'use client';
import { useRouter } from 'next/navigation';
import { FriendsAgendaItem } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { cardStyle, SectionHeader } from '@/components/clubhouse/SectionHeader';
import { agendaWhenLabel } from '@/lib/social';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

const HREF: Record<FriendsAgendaItem['kind'], (id: string) => string> = {
  match: (id) => `/parties/${id}`,
  tournament: (id) => `/tournois/${id}`,
  event: (id) => `/events/${id}`,
};

// Rail « Ça joue bientôt » : où jouent mes amis/favoris prochainement. Masqué si vide.
export function FriendsAgendaRail({ items, timezone }: { items: FriendsAgendaItem[]; timezone: string }) {
  const { th } = useTheme();
  const router = useRouter();
  const { railRef, edges, scrollByPage } = useScrollRail([items.length]);
  if (items.length === 0) return null;
  const count = `${items.length} résultat${items.length > 1 ? 's' : ''}`;
  return (
    <section aria-label="Ça joue bientôt">
      <SectionHeader title="Ça joue bientôt" count={count} />
      <div style={{ position: 'relative', margin: '0 -20px' }}>
        {/* scrollPaddingLeft = padding-left : sans lui, le snap cale la 1re carte sur le bord du
            snapport dès le montage et mange le padding → carte tronquée + flèche gauche fantôme. */}
        <div ref={railRef} className="sp-scroll-x" style={{ display: 'flex', gap: 10, padding: '4px 20px 8px', scrollSnapType: 'x proximity', scrollPaddingLeft: 20 }}>
          {items.map((it) => (
            <button key={`${it.kind}-${it.id}`} type="button" onClick={() => router.push(HREF[it.kind](it.id))}
              style={{ ...cardStyle(th), scrollSnapAlign: 'start', flex: '0 0 auto', width: 190,
                padding: '12px 13px', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.3, color: th.accent, textTransform: 'uppercase' }}>
                {agendaWhenLabel(it.startTime, timezone)}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text, margin: '4px 0 8px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.label}
              </div>
              <div style={{ display: 'flex' }}>
                {it.friends.map((f, i) => (
                  <span key={f.id} style={{ marginLeft: i === 0 ? 0 : -8, display: 'inline-flex', borderRadius: '50%', boxShadow: `0 0 0 2px ${th.surface}` }}>
                    <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={26} color={colorForSeed(f.id)} />
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
        <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Résultats précédents" nextLabel="Résultats suivants" fadeBottom={8} />
      </div>
    </section>
  );
}
