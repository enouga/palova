'use client';
import { NationalOpenMatch } from '@/lib/api';
import { NationalMatchCard } from '@/components/platform/NationalMatchCard';
import { useTheme } from '@/lib/ThemeProvider';
import { useScrollRail } from '@/lib/useScrollRail';
import { RailArrows } from '@/components/ui/RailArrows';

// Rail vedette de la vitrine palova.fr : les parties ouvertes publiques de tous les clubs,
// en grandes cartes snap-scroll (pattern OpenMatchesShowcase du club-house) enrichies de
// l'identité du club. Clic → la page partageable /parties/[id] sur le sous-domaine du club
// (le visiteur y retrouve le parcours rejoindre + invite de connexion). Vide → rien rendu.
// Pas d'en-tête propre — ses 2 appelants (HomeMatchesRail, AnonymousView) ont chacun le
// leur, différent — donc le compteur de résultats est affiché ici, en ligne discrète
// juste au-dessus du rail.
export function NationalOpenMatches({ matches }: { matches: NationalOpenMatch[] }) {
  const { th } = useTheme();
  const { railRef, edges, scrollByPage } = useScrollRail([matches.length]);
  if (matches.length === 0) return null;
  const count = `${matches.length} partie${matches.length > 1 ? 's' : ''}`;
  return (
    <div>
      <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text }}>{count}</div>
      <div style={{ position: 'relative', margin: '0 -20px' }}>
        {/* scrollPaddingLeft = padding-left : sans lui le snap `mandatory` mange le padding au montage. */}
        <div ref={railRef} className="sp-scroll-x" style={{ display: 'flex', gap: 14, padding: '16px 20px 18px', scrollSnapType: 'x mandatory', scrollPaddingLeft: 20 }}>
          {matches.map((m) => (
            <NationalMatchCard key={m.id} match={m} style={{ flex: '0 0 282px', scrollSnapAlign: 'start' }} />
          ))}
        </div>
        <RailArrows edges={edges} onPrev={() => scrollByPage(-1)} onNext={() => scrollByPage(1)} prevLabel="Parties précédentes" nextLabel="Parties suivantes" fadeBottom={18} />
      </div>
    </div>
  );
}
