'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ClubDetail, Announcement, Sponsor, MyReservation, Tournament, ClubEvent, ClubAvailability, OpenMatch, ClubPresentation, PublicOffers, TopMonthEntry } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { effectiveDurations, defaultDuration } from '@/lib/duration';
import { pickUpcomingSlots, todayISO, addDaysISO, activePosters, announcementExpired, clubPulse } from '@/lib/clubhouse';
import { mergeAgenda } from '@/lib/events';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Chip } from '@/components/ui/atoms';
import { ClubHouseHero } from '@/components/clubhouse/ClubHouseHero';
import { SectionHeader, cardStyle } from '@/components/clubhouse/SectionHeader';
import { TournamentsAlaUne } from '@/components/clubhouse/TournamentsAlaUne';
import { MyReservationsCard } from '@/components/clubhouse/MyReservationsCard';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { PosterMosaic } from '@/components/clubhouse/PosterMosaic';
import { OpenMatchesShowcase } from '@/components/clubhouse/OpenMatchesShowcase';
import { OffersShowcase } from '@/components/clubhouse/OffersShowcase';
import { TopOfMonth } from '@/components/clubhouse/TopOfMonth';
import { ClubPresentationCard } from '@/components/clubhouse/ClubPresentationCard';
import { SponsorMarquee } from '@/components/clubhouse/SponsorMarquee';
import { AuthPromptDialog } from '@/components/openmatch/AuthPromptDialog';

function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

// Page « Club-house » : hero À la une, vitrine du club (présentation, affiches,
// offres, top du mois, parties ouvertes), rivière de partenaires. L'ordre des
// sections s'adapte au visiteur (découverte d'abord) ou au membre (action d'abord).
// Chaque bloc charge en indépendance et se masque en silence si vide ou en erreur.
export function ClubHouse({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const router = useRouter();
  const [ann, setAnn] = useState<Announcement[]>([]);
  const [spons, setSpons] = useState<Sponsor[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [avail, setAvail] = useState<ClubAvailability[]>([]);
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

  const duration = defaultDuration(Array.from(new Set(
    club.clubSports.flatMap((cs) => effectiveDurations(cs.durationsMin, cs.sport.defaultDurationsMin)),
  )).sort((a, b) => a - b));

  const loadNext = useCallback(async () => {
    if (!token) return;
    try {
      const rs = await api.getMyReservations(token);
      setNext(rs.filter((r) => r.resource.club.slug === club.slug && r.status !== 'CANCELLED' && new Date(r.startTime) > new Date()).slice(0, 3));
    } catch { /* silencieux */ }
  }, [token, club.slug]);

  useEffect(() => { api.getClubAnnouncements(club.slug).then(setAnn).catch(() => setAnn([])); }, [club.slug]);
  useEffect(() => { api.getClubSponsors(club.slug).then(setSpons).catch(() => setSpons([])); }, [club.slug]);
  useEffect(() => { api.getClubTournaments(club.slug).then(setTournaments).catch(() => setTournaments([])); }, [club.slug]);
  useEffect(() => { api.getClubEvents(club.slug).then(setEvents).catch(() => setEvents([])); }, [club.slug]);
  useEffect(() => { api.getClubPresentation(club.slug).then(setPresentation).catch(() => setPresentation(null)); }, [club.slug]);
  useEffect(() => { api.getClubOffers(club.slug).then(setOffers).catch(() => setOffers(null)); }, [club.slug]);
  useEffect(() => { api.getClubTopMonth(club.slug).then(setTopMonth).catch(() => setTopMonth([])); }, [club.slug]);
  useEffect(() => {
    if (!token) { setHasSub(false); return; }
    api.getMyClubSubscriptions(club.slug, token).then((subs) => setHasSub(subs.length > 0)).catch(() => setHasSub(false));
  }, [club.slug, token]);
  // Prochains créneaux libres : on avance jour par jour (jusqu'à 7 j) et on s'arrête
  // dès qu'on a au moins 3 créneaux à venir → le bloc ne disparaît plus le soir.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const acc: ClubAvailability[] = [];
      for (let d = 0; d < 7; d++) {
        try { acc.push(...await api.getClubAvailability(club.slug, addDaysISO(todayISO(), d), duration)); }
        catch { /* jour ignoré */ }
        if (cancelled) return;
        if (pickUpcomingSlots(acc, new Date(), 3).length >= 3) break;
      }
      if (!cancelled) setAvail(acc);
    })();
    return () => { cancelled = true; };
  }, [club.slug, duration]);
  useEffect(() => { if (ready && token) loadNext(); }, [ready, token, loadNext]);
  // Parties ouvertes visibles de tous : token facultatif (flags viewer à false en anonyme).
  useEffect(() => {
    if (!ready) return;
    api.getOpenMatches(club.slug, token ?? undefined).then(setOpenMatches).catch(() => setOpenMatches([]));
  }, [club.slug, token, ready]);

  const cancel = async (r: MyReservation) => {
    if (!token) return;
    setCancelling(true);
    try { await api.cancelReservation(r.id, token); setConfirmCancel(null); await loadNext(); }
    catch { /* l'erreur reste affichée dans le dialog via busy off */ }
    finally { setCancelling(false); }
  };

  const now = new Date();
  // Hero : l'annonce épinglée la plus récente (l'API renvoie épinglées d'abord), non expirée.
  const hero = ann.length > 0 && ann[0].pinned && !announcementExpired(ann[0], now) ? ann[0] : null;
  // Les annonces AVEC image vivent dans la bento « À l'affiche » ; la liste texte garde les autres.
  const posters = activePosters(ann, now, hero?.id ?? null);
  const restAnn = ann.filter((a) => a !== hero && !posters.includes(a) && !announcementExpired(a, now) && !a.imageUrl);
  const slots = pickUpcomingSlots(avail, now);
  const nextEvents = mergeAgenda(tournaments, events, [], now).slice(0, 3);
  const upcomingMatches = openMatches.filter((m) => new Date(m.startTime) > now);
  const showClubCard = !!presentation && (!!presentation.presentationText || presentation.photos.length > 0);
  const showOffers = !!offers && ((!hasSub && offers.plans.length > 0) || offers.packages.length > 0);

  const empty = !hero && slots.length === 0 && nextEvents.length === 0 && restAnn.length === 0 && spons.length === 0
    && next.length === 0 && upcomingMatches.length === 0 && posters.length === 0 && !showClubCard && !showOffers && topMonth.length < 3;

  const wrap = (key: string, node: React.ReactNode) => node && <div key={key} style={{ padding: '30px 20px 0' }}>{node}</div>;

  const sections: Record<string, React.ReactNode> = {
    clubCard: showClubCard && presentation && (
      <div>
        <SectionHeader title="Le club" action={{ label: 'Découvrir →', href: '/club' }} />
        <ClubPresentationCard presentation={presentation} clubName={club.name} />
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
    posters: posters.length > 0 && <PosterMosaic posters={posters} />,
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
    announcements: restAnn.length > 0 && (
      <div>
        <SectionHeader title="Annonces" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {restAnn.map((a) => (
            <div key={a.id} style={{ ...cardStyle(th), borderRadius: 16, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {a.pinned && <Chip tone="accent">Épinglé</Chip>}
                <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text }}>{a.title}</span>
              </div>
              <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.body}</p>
              {a.linkUrl && <a href={a.linkUrl} target="_blank" rel="noreferrer" style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.accent }}>En savoir plus →</a>}
            </div>
          ))}
        </div>
      </div>
    ),
  };

  // Visiteur : découverte d'abord (Le club, offres) ; membre : action d'abord (parties, agenda).
  const order = token
    ? ['matches', 'agenda', 'posters', 'top', 'offers', 'clubCard', 'announcements']
    : ['matches', 'clubCard', 'agenda', 'posters', 'offers', 'top', 'announcements'];

  return (
    <>
      <ClubHouseHero
        clubName={club.name}
        announcement={hero}
        pulse={clubPulse({ slots, matchCount: upcomingMatches.length, nextEventStart: nextEvents[0]?.startTime ?? null, now: clock, timezone: club.timezone })}
      />

      {order.map((k) => wrap(k, sections[k]))}

      <SponsorMarquee sponsors={spons} now={clock} />

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
