'use client';
import { useRouter } from 'next/navigation';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { AgendaItem, eventPlacesLabel, KIND_LABEL } from '@/lib/events';
import { fillRatio, formatDateTimeRange } from '@/lib/tournament';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { AgendaRail } from '@/components/agenda/AgendaRail';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

// « Prochains events » : tournois + animations fusionnés (nom de fichier historique conservé).
// Depuis la spec 2026-07-24 : de VRAIES AgendaCard restylées dans le rail partagé AgendaRail
// (une carte à la fois + points en mobile, étagère + flèches en desktop) — plus de
// mini-tuiles dédiées. `now` null avant le mount (hydration-safe).
export function TournamentsAlaUne({ items, timezone, now = null, multiSport = false }: { items: AgendaItem[]; timezone: string; now?: Date | null; multiSport?: boolean }) {
  const { th } = useTheme();
  const router = useRouter();
  const shown = items.filter((item) => item.source !== 'lesson');
  if (items.length === 0) return null;
  const count = `${shown.length} résultat${shown.length > 1 ? 's' : ''}`;
  return (
    <div style={{ ...cardStyle(th), padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: th.mode === 'floodlit' ? `${ACCENTS.apricot}26` : `${ACCENTS.apricot}40` }}>
          <Icon name="trophy" size={15} color={th.mode === 'floodlit' ? ACCENTS.apricot : th.ink} />
        </span>
        <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 14, color: th.text }}>Prochains events</span>
        <span style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>{count}</span>
      </div>
      <AgendaRail prevLabel="Events précédents" nextLabel="Events suivants">
        {shown.map((item) => {
          const isT = item.source === 'tournament';
          const id = isT ? item.tournament.id : item.event.id;
          const priceValue = isT
            ? (item.tournament.entryFee ? `${item.tournament.entryFee} €` : null)
            : (item.event.price != null && Number(item.event.price) > 0 ? `${Number(item.event.price)} €` : null);
          return (
            <AgendaCard
              key={`${item.source}-${id}`}
              icon={isT ? 'trophy' : 'bolt'}
              accent={isT ? ACCENTS.apricot : ACCENTS.violet}
              tag={isT ? `${item.tournament.category} · ${GENDER_LABEL[item.tournament.gender]}` : KIND_LABEL[item.event.kind]}
              title={isT ? item.tournament.name : item.event.name}
              dateLabel={formatDateTimeRange(item.startTime, item.endTime, timezone)}
              deadline={isT ? item.tournament.registrationDeadline : item.event.registrationDeadline}
              now={now}
              ratio={isT ? fillRatio(item.tournament) : fillRatio({ confirmedCount: item.event.confirmedCount, maxTeams: item.event.capacity })}
              places={isT ? tournamentPlacesLabel(item.tournament) : eventPlacesLabel(item.event)}
              price={priceValue}
              extra={!isT && item.event.memberOnly ? 'Membres' : null}
              sportLabel={multiSport ? ((isT ? item.tournament.sport?.name : item.event.sport?.name) ?? null) : null}
              onClick={() => router.push(isT ? `/tournois/${id}` : `/events/${id}`)}
            />
          );
        })}
      </AgendaRail>
    </div>
  );
}
