'use client';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { FranceDotsIcon } from '@/components/platform/FranceDotsMap';
import { PILL_INK } from '@/components/discover/LocationSearchPill';

// Porte vers /decouvrir — pastille encre compacte qui flotte sur le bord bas du hero (marge
// haute négative, même geste que la pilule blanche de /decouvrir, silhouette opposée). La
// grande pilule de recherche (LocationSearchPill) est la signature EXCLUSIVE de la page
// Découvrir : depuis l'accueil on ne tape rien, on passe la porte et on cherche là-bas.
export function DiscoverPill() {
  const router = useRouter();
  const { th } = useTheme();
  return (
    <div style={{ margin: '-20px 22px 0', position: 'relative', zIndex: 3 }}>
      <button
        type="button"
        className="pl-lift"
        onClick={() => router.push('/decouvrir')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 9, border: 'none', cursor: 'pointer',
          background: PILL_INK, color: '#f4f6fa', borderRadius: 999, height: 42, padding: '0 18px 0 15px',
          fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
          boxShadow: '0 12px 28px rgba(27,42,63,.35)',
        }}
      >
        <FranceDotsIcon />
        Découvrir · clubs, parties, tournois
        <span aria-hidden="true" style={{ opacity: 0.7, fontWeight: 400 }}>→</span>
      </button>
    </div>
  );
}
