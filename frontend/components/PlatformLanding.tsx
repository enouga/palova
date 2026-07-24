'use client';

import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { PalovaHome } from '@/components/platform/PalovaHome';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';

// Accueil plateforme (palova.fr). Depuis la fusion des trois surfaces (vitrine anonyme,
// « Mon Palova », /decouvrir), il n'y a plus de routeur de visages : UNE seule page,
// `PalovaHome`, qui s'adapte elle-même à la session. On attend quand même `ready` pour ne
// pas peindre la version visiteur une fraction de seconde à un joueur connecté.
export default function PlatformLanding() {
  const { ready } = useAuth();
  if (!ready) return <PlatformSkeleton />;
  return <PalovaHome />;
}

function PlatformSkeleton() {
  const { th } = useTheme();
  return (
    <Screen>
      <div style={{ padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 28 }}>
          <Logotype size={26} />
          <ThemeToggle />
        </div>
      </div>
      <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
    </Screen>
  );
}
