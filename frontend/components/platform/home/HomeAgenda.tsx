'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { CardStripe, Chip } from '@/components/ui/atoms';
import { AgendaListItem, agendaItemClub, clubMarker } from '@/lib/calendar';
import { agendaItemHeading, agendaWhenLabel } from '@/lib/monPalova';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

// « À venir · tous clubs » : les entrées APRÈS celle du hero (jamais de doublon), en
// cartes-liens read-only — les actions (annuler, joueurs, chat) vivent sur Mes réservations.
// Marqueur club systématique (plateforme = localSlug null → clubMarker partout).
export function HomeAgenda({ items }: { items: AgendaListItem[] }) {
  const { th } = useTheme();
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHeader kicker="À venir · tous clubs" moreLabel="Tout voir →" moreHref="/me/reservations" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item) => {
          const marker = clubMarker(agendaItemClub(item), null);
          const heading = agendaItemHeading(item);
          return (
            <a key={`${item.kind}-${item.id}`} href={heading.href}
              style={{ position: 'relative', overflow: 'hidden', display: 'block', textDecoration: 'none', background: th.surface, borderRadius: 16, padding: '12px 14px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
              {marker && <CardStripe color={marker.accent} />}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{heading.title}</span>
                {marker && <Chip color={marker.accent}>{marker.name}</Chip>}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 3 }}>{agendaWhenLabel(item)}</div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
