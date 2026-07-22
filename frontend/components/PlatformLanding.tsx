'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, ManagedClub } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import AnonymousView from '@/components/platform/AnonymousView';
import { Screen } from '@/components/ui/Screen';
import { Logotype, Btn, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';

// Accueil plateforme (palova.fr) selon le rôle — réservé aux connectés (verrou proxy.ts) :
//  - joueur connecté sans club géré : redirigé vers /decouvrir (même contenu enrichi que le
//    visiteur anonyme — parties/tournois/annuaire — plutôt qu'un accueil dédié pauvre ; ses
//    propres clubs restent à un tap via « Mes clubs » du menu profil)
//  - gérant connecté : écran de redirection vers l'admin de ses clubs
export default function PlatformLanding() {
  const { token, ready } = useAuth();
  const router = useRouter();
  const [managed, setManaged] = useState<ManagedClub[] | null>(null); // null = non résolu

  useEffect(() => {
    if (!ready || !token) return;                 // visiteur → AnonymousView (pas de fetch)
    api.getMyClubs(token).then(setManaged).catch(() => setManaged([]));
  }, [ready, token]);

  useEffect(() => {
    if (managed !== null && managed.length === 0) router.replace('/decouvrir');
  }, [managed, router]);

  if (!ready) return <PlatformSkeleton />;
  if (!token) return <AnonymousView />;
  if (managed === null) return <PlatformSkeleton />; // rôle en cours de résolution
  if (managed.length > 0) return <ManagerView clubs={managed} />;
  return <PlatformSkeleton />; // joueur sans club géré : redirection /decouvrir en cours
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 28 }}>
      <Logotype size={26} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><ThemeToggle />{children}</div>
    </div>
  );
}

function PlatformSkeleton() {
  const { th } = useTheme();
  return (
    <Screen>
      <div style={{ padding: '0 24px' }}><Header /></div>
      <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
    </Screen>
  );
}

function ManagerView({ clubs }: { clubs: ManagedClub[] }) {
  const { th } = useTheme();
  return (
    <Screen>
      <div style={{ padding: '0 24px 40px' }}>
        <Header><ProfileMenu /></Header>
        {/* Clamp desktop : liste d'actions courte, un bouton pleine largeur devient
            démesuré sur 1040px (le Header, lui, garde toute la largeur du Screen). */}
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 44, lineHeight: 1.04, color: th.text, marginTop: 40, letterSpacing: -0.5 }}>
            Vos clubs.
          </div>
          <p style={{ fontFamily: th.fontUI, fontSize: 15.5, color: th.textMute, marginTop: 12, lineHeight: 1.5 }}>
            Accédez au back-office de {clubs.length > 1 ? 'vos clubs' : 'votre club'}.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 28 }}>
            {clubs.map((c) => (
              <Btn key={c.clubId} full icon="arrowR" onClick={() => window.location.assign(clubUrl(c.slug, '/admin'))}>
                Aller à l&apos;admin de {c.name}
              </Btn>
            ))}
          </div>
        </div>
      </div>
    </Screen>
  );
}
