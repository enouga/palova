'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, MyReservation, MyTournamentRegistration, MyEventRegistration, MyLessonEnrollment, PlayerMembership } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { buildAgendaList } from '@/lib/calendar';
import { HomeHero } from '@/components/platform/home/HomeHero';
import { HomeAgenda } from '@/components/platform/home/HomeAgenda';
import { HomeMatchesRail } from '@/components/platform/home/HomeMatchesRail';
import { MyClubsRow } from '@/components/platform/home/MyClubsRow';
import { WalletCard } from '@/components/platform/home/WalletCard';
import { LevelCard } from '@/components/platform/home/LevelCard';
import { ManagedClubsCard } from '@/components/platform/home/ManagedClubsCard';
import { DiscoverPill } from '@/components/platform/home/DiscoverPill';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
import { ResultsToConfirm } from '@/components/match/ResultsToConfirm';

// « Mon Palova » — accueil plateforme du joueur connecté (spec 2026-07-22). Orchestrateur :
// charge l'agenda (4 payloads, allSettled — une brique en échec n'éteint rien) + le profil
// + les adhésions UNE fois ; le reste est self-fetché par les sections. Ordre des sections
// = spec (Gestion, hero, résultats, à venir, parties, clubs, portefeuille, niveau, découvrir).
export function MonPalova() {
  const { token } = useAuth();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [reservations, setReservations] = useState<MyReservation[]>([]);
  const [tournaments, setTournaments] = useState<MyTournamentRegistration[]>([]);
  const [events, setEvents] = useState<MyEventRegistration[]>([]);
  const [lessons, setLessons] = useState<MyLessonEnrollment[]>([]);
  const [memberships, setMemberships] = useState<PlayerMembership[]>([]);

  // Horloge posée en effet — jamais de new Date() au rendu (hydration-safe).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const h = setInterval(tick, 60_000);
    return () => clearInterval(h);
  }, []);

  useEffect(() => {
    if (!token) return;
    api.getMyProfile(token).then((p) => setFirstName(p.firstName)).catch(() => {});
    api.getMyReservations(token).then(setReservations).catch(() => {});
    api.getMyTournaments(token).then(setTournaments).catch(() => {});
    api.getMyEvents(token).then(setEvents).catch(() => {});
    api.getMyLessons(token).then(setLessons).catch(() => {});
    api.getMyMemberships(token).then(setMemberships).catch(() => {});
  }, [token]);

  const nowDate = useMemo(() => new Date(now ?? 0), [now]);
  const agenda = useMemo(() => buildAgendaList(reservations, tournaments, events, lessons, nowDate), [reservations, tournaments, events, lessons, nowDate]);
  // « À venir » possède désormais TOUT l'agenda à venir (le hero ne rejoue plus la prochaine → plus de doublon).
  const upcoming = useMemo(() => agenda.filter((i) => !i.past).slice(0, 6), [agenda]);
  const myClubSlugs = useMemo(() => new Set(memberships.filter((m) => m.status === 'ACTIVE').map((m) => m.slug)), [memberships]);

  if (!token) return null; // gardé par PlatformLanding — jamais atteint en pratique

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <div style={{ padding: '28px 20px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Logotype size={22} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ThemeToggle />
              <ProfileMenu />
            </div>
          </div>
        </div>
        {/* Pas de maxWidth ici : Screen clampe déjà tout à 1080px (largeur unique des pages joueur). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26, padding: '10px 20px 0' }}>
          <ManagedClubsCard token={token} />
          {/* Hero = accueil, puis la pilule de recherche qui flotte sur son bord (marge négative
              propre à LocationSearchPill) — groupés dans un bloc pour éviter le gap flex entre eux.
              La recherche n'est ainsi plus enterrée en bas de page. */}
          <div>
            <HomeHero firstName={firstName} />
            <DiscoverPill />
          </div>
          <ResultsToConfirm token={token} />
          <ResultsToRecord token={token} />
          <HomeAgenda items={upcoming} now={now} />
          <HomeMatchesRail myClubSlugs={myClubSlugs} />
          {/* Carte joueur : niveau + clubs côte à côte sur desktop (auto-fit → l'un remplit si l'autre manque). */}
          <div className="mp-duo">
            <LevelCard token={token} memberships={memberships} />
            <MyClubsRow memberships={memberships} />
          </div>
          <WalletCard token={token} />
        </div>
      </div>
    </Screen>
  );
}
