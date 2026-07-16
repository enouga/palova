'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ClubDetail, Announcement, Sponsor, MyReservation, Tournament, ClubEvent, OpenMatch, ClubPresentation, PublicOffers, TopMonthEntry } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { kiosqueSlides, resolveSections, hiddenSectionKeys } from '@/lib/clubhouse';
import { mergeAgenda } from '@/lib/events';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AnnouncementKiosk } from '@/components/clubhouse/AnnouncementKiosk';
import { SectionHeader } from '@/components/clubhouse/SectionHeader';
import { TournamentsAlaUne } from '@/components/clubhouse/TournamentsAlaUne';
import { MyReservationsCard } from '@/components/clubhouse/MyReservationsCard';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { OpenMatchesShowcase } from '@/components/clubhouse/OpenMatchesShowcase';
import { OffersShowcase } from '@/components/clubhouse/OffersShowcase';
import { TopOfMonth } from '@/components/clubhouse/TopOfMonth';
import { ClubShowcase } from '@/components/clubhouse/ClubShowcase';
import { showShowcase } from '@/lib/clubShowcase';
import { SponsorFlipDeck } from '@/components/clubhouse/SponsorFlipDeck';
import { AuthPromptDialog } from '@/components/openmatch/AuthPromptDialog';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';

function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

// Page « Club-house » : kiosque « À la une » (les annonces du club), vitrine du club
// (présentation, offres, top du mois, parties ouvertes), rivière de partenaires. L'ordre
// des sections s'adapte au visiteur (découverte d'abord) ou au membre (action d'abord).
// Chaque bloc charge en indépendance et se masque en silence si vide ou en erreur.
export function ClubHouse({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const router = useRouter();
  const [ann, setAnn] = useState<Announcement[]>([]);
  const [spons, setSpons] = useState<Sponsor[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [next, setNext] = useState<MyReservation[]>([]);
  const [openMatches, setOpenMatches] = useState<OpenMatch[]>([]);
  const [presentation, setPresentation] = useState<ClubPresentation | null>(null);
  const [offers, setOffers] = useState<PublicOffers | null>(null);
  const [topMonth, setTopMonth] = useState<TopMonthEntry[]>([]);
  const [hasSub, setHasSub] = useState(false);
  const [authPrompt, setAuthPrompt] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<MyReservation | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Horloge des countdowns : null au premier rendu (hydration-safe), puis tick chaque minute.
  const [clock, setClock] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setClock(new Date());
    const t = setTimeout(tick, 0);
    const h = setInterval(tick, 60_000);
    return () => { clearTimeout(t); clearInterval(h); };
  }, []);

  // Sections masquées par la config admin : leurs fetchs sont sautés (les annonces
  // restent inconditionnelles — le kiosque « À la une » en dépend).
  const hidden = useMemo(() => hiddenSectionKeys(club.clubHouseSections), [club.clubHouseSections]);

  const loadNext = useCallback(async () => {
    if (!token) return;
    try {
      const rs = await api.getMyReservations(token);
      setNext(rs.filter((r) => r.resource.club.slug === club.slug && r.status !== 'CANCELLED' && new Date(r.startTime) > new Date()).slice(0, 3));
    } catch { /* silencieux */ }
  }, [token, club.slug]);

  useEffect(() => { api.getClubAnnouncements(club.slug).then(setAnn).catch(() => setAnn([])); }, [club.slug]);
  useEffect(() => {
    if (hidden.has('sponsors')) return;
    api.getClubSponsors(club.slug).then(setSpons).catch(() => setSpons([]));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (hidden.has('agenda')) return;
    api.getClubTournaments(club.slug).then(setTournaments).catch(() => setTournaments([]));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (hidden.has('agenda')) return;
    api.getClubEvents(club.slug).then(setEvents).catch(() => setEvents([]));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (hidden.has('clubCard')) return;
    api.getClubPresentation(club.slug).then(setPresentation).catch(() => setPresentation(null));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (hidden.has('offers')) return;
    api.getClubOffers(club.slug).then(setOffers).catch(() => setOffers(null));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (hidden.has('top')) return;
    api.getClubTopMonth(club.slug).then(setTopMonth).catch(() => setTopMonth([]));
  }, [club.slug, hidden]);
  useEffect(() => {
    if (!token || hidden.has('offers')) { setHasSub(false); return; }
    api.getMyClubSubscriptions(club.slug, token).then((subs) => setHasSub(subs.length > 0)).catch(() => setHasSub(false));
  }, [club.slug, token, hidden]);
  useEffect(() => { if (ready && token && !hidden.has('agenda')) loadNext(); }, [ready, token, loadNext, hidden]);
  // Parties ouvertes visibles de tous : token facultatif (flags viewer à false en anonyme).
  useEffect(() => {
    if (!ready || hidden.has('matches')) return;
    api.getOpenMatches(club.slug, token ?? undefined).then(setOpenMatches).catch(() => setOpenMatches([]));
  }, [club.slug, token, ready, hidden]);

  const cancel = async (r: MyReservation) => {
    if (!token) return;
    setCancelling(true);
    try { await api.cancelReservation(r.id, token); setConfirmCancel(null); await loadNext(); }
    catch { /* l'erreur reste affichée dans le dialog via busy off */ }
    finally { setCancelling(false); }
  };

  const now = new Date();
  // Kiosque « À la une » : toutes les annonces actives (avec ou sans image), épinglées d'abord.
  const slides = kiosqueSlides(ann, now);
  const nextEvents = mergeAgenda(tournaments, events, [], now).slice(0, 3);
  const upcomingMatches = openMatches.filter((m) => new Date(m.startTime) > now);
  const showClubCard = showShowcase(presentation);
  const showOffers = !!offers && ((!hasSub && offers.plans.length > 0) || offers.packages.length > 0);

  const empty = slides.length === 0 && nextEvents.length === 0 && spons.length === 0
    && next.length === 0 && upcomingMatches.length === 0 && !showClubCard && !showOffers && topMonth.length < 3;

  const wrap = (key: string, node: React.ReactNode) => node && <div key={key} style={{ padding: '30px 20px 0' }}>{node}</div>;

  const sections: Record<string, React.ReactNode> = {
    // Kiosque « À la une » : rendu dès que la section est visible — il porte lui-même son
    // repli (« brume bleue ») quand il n'y a aucune annonce, et gère son propre bord.
    kiosk: <AnnouncementKiosk key="kiosk" clubName={club.name} slides={slides} now={clock} intervalSeconds={club.clubHouseKioskSeconds} />,
    clubCard: showClubCard && presentation && (
      <div>
        <SectionHeader title="Le club" action={{ label: 'Découvrir →', href: '/club' }} />
        <ClubShowcase presentation={presentation} club={club} now={clock} />
      </div>
    ),
    // Prochains events + Vos réservations côte à côte (≥ 700px) — cartes sœurs, même langage.
    agenda: (nextEvents.length > 0 || next.length > 0) && (
      <>
        <style>{`.ch-grid{display:grid;grid-template-columns:1fr;gap:12px;align-items:start}@media(min-width:700px){.ch-grid{grid-template-columns:1fr 1fr}}`}</style>
        <div className={nextEvents.length > 0 && next.length > 0 ? 'ch-grid' : undefined}>
          {nextEvents.length > 0 && (
            <TournamentsAlaUne items={nextEvents} timezone={club.timezone} now={clock} multiSport={clubIsMultiSport(club)} />
          )}
          {next.length > 0 && <MyReservationsCard reservations={next} onManage={setConfirmCancel} />}
        </div>
      </>
    ),
    matches: upcomingMatches.length > 0 && <OpenMatchesShowcase matches={upcomingMatches.slice(0, 6)} timezone={club.timezone} />,
    offers: showOffers && offers && (
      <OffersShowcase
        offers={offers}
        token={token}
        hasActiveSubscription={hasSub}
        onAuthPrompt={() => setAuthPrompt(true)}
        onPurchased={() => { if (token) api.getMyClubSubscriptions(club.slug, token).then((subs) => setHasSub(subs.length > 0)).catch(() => {}); }}
      />
    ),
    top: topMonth.length >= 3 && <TopOfMonth entries={topMonth} />,
    // SponsorFlipDeck gère déjà son propre padding de bord (contrairement aux autres sections,
    // wrappées par `wrap()`) — rendu tel quel dans la boucle, jamais passé à `wrap()`.
    sponsors: spons.length > 0 && <SponsorFlipDeck key="sponsors" sponsors={spons} now={clock} />,
  };

  // Config admin (Club.clubHouseSections) : un seul ordre pour tous ; null → ordre adaptatif.
  const { order } = resolveSections(club.clubHouseSections, !!token);

  return (
    <>
      {club.levelSystemEnabled !== false && (
        <ResultsToRecord token={token} clubSlug={club.slug} />
      )}

      {/* Kiosque et partenaires portent leur propre bord → jamais passés à wrap().
          Le kiosque n'a besoin d'un espacement que s'il n'est plus en tête de page. */}
      {order.map((k, i) => {
        if (k === 'sponsors') return sections[k];
        if (k === 'kiosk') return <div key="kiosk" style={i > 0 ? { paddingTop: 30 } : undefined}>{sections[k]}</div>;
        return wrap(k, sections[k]);
      })}

      {empty && (
        <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
          Pas d&apos;informations pour le moment.
        </div>
      )}

      {authPrompt && (
        <AuthPromptDialog
          detail={club.name}
          onRegister={() => router.push('/register?next=/')}
          onLogin={() => router.push('/login?next=/')}
          onClose={() => setAuthPrompt(false)}
        />
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Annuler la réservation ?"
          detail={<>{confirmCancel.resource.name} · {formatDateTime(confirmCancel.startTime, confirmCancel.resource.club.timezone)}</>}
          message="Cette action est définitive : le créneau sera remis à disposition des autres joueurs."
          confirmLabel="Annuler la réservation"
          cancelLabel="Retour"
          busy={cancelling}
          onConfirm={() => cancel(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}
    </>
  );
}
