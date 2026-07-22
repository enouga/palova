'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, NationalOpenMatch } from '@/lib/api';
import { NationalOpenMatches } from '@/components/platform/NationalOpenMatches';
import { SectionHeader } from '@/components/platform/home/SectionHeader';
import { sortMatchesForHome } from '@/lib/monPalova';

// Rail « Parties à rejoindre » : flux national public, mes clubs d'abord, cap 6.
// Section autonome : échec réseau → section absente, jamais d'erreur de page.
export function HomeMatchesRail({ myClubSlugs }: { myClubSlugs: Set<string> }) {
  const [matches, setMatches] = useState<NationalOpenMatch[] | null>(null);
  useEffect(() => {
    api.listNationalOpenMatches().then(setMatches).catch(() => setMatches([]));
  }, []);
  const sorted = useMemo(() => sortMatchesForHome(matches ?? [], myClubSlugs), [matches, myClubSlugs]);
  if (sorted.length === 0) return null;
  return (
    <section>
      <SectionHeader kicker="Parties à rejoindre" moreLabel="Toutes →" moreHref="/decouvrir#parties" />
      <NationalOpenMatches matches={sorted} />
    </section>
  );
}
