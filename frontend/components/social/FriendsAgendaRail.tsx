'use client';
import { useRouter } from 'next/navigation';
import { FriendsAgendaItem } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { cardStyle, SectionHeader } from '@/components/clubhouse/SectionHeader';
import { agendaWhenLabel } from '@/lib/social';

const HREF: Record<FriendsAgendaItem['kind'], (id: string) => string> = {
  match: (id) => `/parties/${id}`,
  tournament: (id) => `/tournois/${id}`,
  event: (id) => `/events/${id}`,
};

// Rail « Ça joue bientôt » : où jouent mes amis/favoris prochainement. Masqué si vide.
export function FriendsAgendaRail({ items, timezone }: { items: FriendsAgendaItem[]; timezone: string }) {
  const { th } = useTheme();
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <section aria-label="Ça joue bientôt">
      <SectionHeader title="Ça joue bientôt" />
      <div className="sp-scroll-x" style={{ display: 'flex', gap: 10, scrollSnapType: 'x proximity', paddingBottom: 4 }}>
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
    </section>
  );
}
