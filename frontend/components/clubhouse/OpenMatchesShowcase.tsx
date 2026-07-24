'use client';
import { OpenMatch } from '@/lib/api';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';
import { AgendaRail } from '@/components/agenda/AgendaRail';
import { OpenMatchRailCard } from '@/components/match/OpenMatchRailCard';

// Section vedette « Ça joue bientôt » : la carte de partie unique des rails
// (OpenMatchRailCard, sans en-tête club — contexte mono-club) sur le rail partagé.
// Clic → /parties/[id] (relatif, même hôte).
export function OpenMatchesShowcase({ matches, timezone }: { matches: OpenMatch[]; timezone: string }) {
  const shown = matches.slice(0, 6);
  if (matches.length === 0) return null;
  const count = `${shown.length} partie${shown.length > 1 ? 's' : ''}`;
  return (
    <section id="ch-matches">
      <SectionHeader title="Ça joue bientôt" count={count} />
      <AgendaRail desktopColumns="272px" mobileColumns="272px" desktopRows={1}
        prevLabel="Parties précédentes" nextLabel="Parties suivantes">
        {shown.map((m) => (
          <OpenMatchRailCard key={m.id} match={m} href={`/parties/${m.id}`} timezone={timezone} />
        ))}
      </AgendaRail>
    </section>
  );
}
