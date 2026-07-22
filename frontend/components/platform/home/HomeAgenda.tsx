'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { CardStripe, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { AgendaListItem, agendaItemClub, clubMarker } from '@/lib/calendar';
import { agendaItemHeading, agendaDateParts, agendaKindIcon, startsInLabel } from '@/lib/monPalova';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

// « À venir · tous clubs » : TOUTES les entrées à venir (le hero ne rejoue plus la prochaine
// → plus de doublon), en grille dense de cartes à tuile-date (read-only — les actions vivent
// sur Mes réservations). Marqueur club systématique (plateforme = localSlug null → clubMarker
// partout). `now` (optionnel) → chip compte à rebours sur la 1ʳᵉ carte (la prochaine sortie).
export function HomeAgenda({ items, now }: { items: AgendaListItem[]; now?: number | null }) {
  const { th } = useTheme();
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHeader kicker="À venir · tous clubs" moreLabel="Tout voir →" moreHref="/me/reservations" />
      <div className="mp-grid">
        {items.map((item, i) => {
          const marker = clubMarker(agendaItemClub(item), null);
          const accent = marker?.accent ?? th.accent;
          const heading = agendaItemHeading(item);
          const { day, month, weekdayTime } = agendaDateParts(item);
          const countdown = i === 0 && now != null ? startsInLabel(item.start, new Date(now)) : null;
          return (
            <a key={`${item.kind}-${item.id}`} href={heading.href} className="pl-lift"
              style={{ position: 'relative', overflow: 'hidden', display: 'flex', gap: 12, textDecoration: 'none', background: th.surface, borderRadius: 16, padding: '13px 14px 13px 16px', boxShadow: th.shadow }}>
              {marker && <CardStripe color={accent} />}
              {/* Tuile date teintée à la couleur du club — ancre visuelle gauche. */}
              <div style={{ flexShrink: 0, width: 48, height: 48, borderRadius: 13, background: `${accent}22`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 18, color: th.text }}>{day}</span>
                <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute, marginTop: 2 }}>{month}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name={agendaKindIcon(item.kind)} size={13} color={th.textMute} />
                  <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{heading.title}</span>
                  <Icon name="chevR" size={15} color={th.textFaint} style={{ marginLeft: 'auto', flexShrink: 0 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 5 }}>
                  <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>{weekdayTime}</span>
                  {countdown && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: `${accent}22`, borderRadius: 999, padding: '2px 8px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.text }}>
                      <Icon name="clock" size={11} color={th.text} />{countdown}
                    </span>
                  )}
                  {marker && <Chip color={accent}>{marker.name}</Chip>}
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
