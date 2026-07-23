'use client';

import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import AnonymousView from '@/components/platform/AnonymousView';
import { MonPalova } from '@/components/platform/MonPalova';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';

// Accueil plateforme (palova.fr) — routeur de visages (spec Mon Palova 2026-07-22) :
//  - visiteur → vitrine AnonymousView (surface SEO, inchangée)
//  - connecté → Mon Palova (accueil personnel ; la carte Gestion y couvre les gérants,
//    l'ancien ManagerView et la redirection /decouvrir ont disparu)
export default function PlatformLanding() {
  const { token, ready } = useAuth();
  if (!ready) return <PlatformSkeleton />;
  if (!token) return <AnonymousView />;
  return <MonPalova />;
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
