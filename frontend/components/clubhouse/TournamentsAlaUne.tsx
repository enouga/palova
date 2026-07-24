'use client';
import Link from 'next/link';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { AgendaItem, eventPlacesLabel, KIND_LABEL } from '@/lib/events';
import { deadlineCountdown, fillRatio, formatHourRange } from '@/lib/tournament';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, gaugeTrack } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

function formatDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}

// « Prochains events » : tournois + animations fusionnés (nom de fichier historique conservé).
// Étagère qui défile HORIZONTALEMENT sur 2 lignes (grid-auto-flow: column) — même mécanique
// que les rails à 1 ligne (compteur + flèches), pas une grille qui wrap : le glisser/les
// flèches révèlent les colonnes suivantes, le nombre de colonnes visibles dépend juste de la
// largeur d'écran. Section pleine largeur (cf. ClubHouse.tsx), plus jamais partagée à
// mi-largeur avec « Vos réservations ». `now` null avant le mount (hydration-safe) : les
// countdowns n'apparaissent qu'ensuite.
export function TournamentsAlaUne({ items, timezone, now = null, multiSport = false }: { items: AgendaItem[]; timezone: string; now?: Date | null; multiSport?: boolean }) {
  const { th } = useTheme();
  const shown = items.filter((item) => item.source !== 'lesson');
  const { railRef, edges, scrollByPage } = useScrollRail([shown.length]);
  if (items.length === 0) return null;
  const count = `${shown.length} résultat${shown.length > 1 ? 's' : ''}`;
  return (
    <div style={{ ...cardStyle(th), padding: '16px' }}>
      {/* grid-auto-columns en calc(50% - gap/2) — pas un px fixe : toujours 2 vignettes
          pleinement visibles dans la largeur du conteneur, sur tout écran (mobile compris),
          la 3e colonne démarre juste après et se révèle au défilement. */}
      <style>{`.ta-grid{display:grid;grid-template-rows:repeat(2,auto);grid-auto-flow:column;grid-auto-columns:calc(50% - 5px);gap:10px;align-items:start}
      @media (max-width: 700px) { .ta-grid{grid-template-rows:auto;grid-auto-columns:86%} }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: th.mode === 'floodlit' ? `${ACCENTS.apricot}26` : `${ACCENTS.apricot}40` }}>
          <Icon name="trophy" size={15} color={th.mode === 'floodlit' ? ACCENTS.apricot : th.ink} />
        </span>
        <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 14, color: th.text }}>Prochains events</span>
        <span style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>{count}</span>
      </div>
      <div style={{ position: 'relative', margin: '0 -20px' }}>
        <div ref={railRef} className="sp-scroll-x ta-grid" style={{ padding: '4px 20px 8px', scrollSnapType: 'x proximity', scrollPaddingLeft: 20 }}>
          {shown.map((item) => {
            const isT = item.source === 'tournament';
            const id = isT ? item.tournament.id : item.event.id;
            const name = isT ? item.tournament.name : item.event.name;
            const badge = isT ? `${item.tournament.category} · ${GENDER_LABEL[item.tournament.gender]}` : KIND_LABEL[item.event.kind];
            const sportName = multiSport ? ((isT ? item.tournament.sport?.name : item.event.sport?.name) ?? null) : null;
            const places = isT ? tournamentPlacesLabel(item.tournament) : eventPlacesLabel(item.event);
            const href = isT ? `/tournois/${id}` : `/events/${id}`;
            const deadline = isT ? item.tournament.registrationDeadline : item.event.registrationDeadline;
            const countdown = now ? deadlineCountdown(deadline, now) : null;
            const ratio = isT
              ? fillRatio(item.tournament)
              : fillRatio({ confirmedCount: item.event.confirmedCount, maxTeams: item.event.capacity });
            return (
              <Link key={`${item.source}-${id}`} href={href} aria-label={name} style={{ textDecoration: 'none', background: th.surface2, borderRadius: 12, padding: '10px 12px', display: 'block' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: th.text }}>{name}</span>
                  {countdown && (
                    <span style={{
                      fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 999, padding: '2px 8px',
                      background: countdown.urgent ? (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}40`) : th.surface,
                      color: countdown.urgent ? (th.mode === 'floodlit' ? ACCENTS.coral : th.ink) : th.textMute,
                    }}>
                      {countdown.text}
                    </span>
                  )}
                </span>
                <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>
                  {sportName ? `${sportName} · ` : ''}{badge}
                  {' · '}
                  {formatDay(item.startTime, timezone)}
                  {' · '}
                  {formatHourRange(item.startTime, item.endTime, timezone)}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                  {ratio != null && (
                    <span style={{ flex: '0 1 90px', ...gaugeTrack(th, 4, 999, th.surface) }}>
                      <span style={{ display: 'block', height: '100%', borderRadius: 999, background: places.urgent ? ACCENTS.coral : th.accent, width: `${Math.round(ratio * 100)}%` }} />
                    </span>
                  )}
                  <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: places.urgent ? 700 : 500, color: places.urgent ? ACCENTS.coral : th.textMute }}>{places.text}</span>
                </span>
              </Link>
            );
          })}
        </div>
        <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Précédents" nextLabel="Suivants" fadeBottom={8} />
      </div>
    </div>
  );
}
