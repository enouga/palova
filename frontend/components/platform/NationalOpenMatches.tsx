'use client';
import { NationalOpenMatch } from '@/lib/api';
import { NationalMatchCard } from '@/components/platform/NationalMatchCard';

// Rail vedette de la vitrine palova.fr : les parties ouvertes publiques de tous les clubs,
// en grandes cartes snap-scroll (pattern OpenMatchesShowcase du club-house) enrichies de
// l'identité du club. Clic → la page partageable /parties/[id] sur le sous-domaine du club
// (le visiteur y retrouve le parcours rejoindre + invite de connexion). Vide → rien rendu.
export function NationalOpenMatches({ matches }: { matches: NationalOpenMatch[] }) {
  if (matches.length === 0) return null;
  return (
    // scrollPaddingLeft = padding-left : sans lui le snap `mandatory` mange le padding au montage.
    <div className="sp-scroll-x" style={{ display: 'flex', gap: 14, margin: '0 -20px', padding: '16px 20px 18px', scrollSnapType: 'x mandatory', scrollPaddingLeft: 20 }}>
      {matches.map((m) => (
        <NationalMatchCard key={m.id} match={m} style={{ flex: '0 0 282px', scrollSnapAlign: 'start' }} />
      ))}
    </div>
  );
}
