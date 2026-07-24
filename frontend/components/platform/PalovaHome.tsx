'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  api, NationalOpenMatch, NationalTournament, MyReservation, MyTournamentRegistration,
  MyEventRegistration, MyLessonEnrollment, PlayerMembership,
} from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { buildAgendaList } from '@/lib/calendar';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { FranceDotsMap } from '@/components/platform/FranceDotsMap';
import { ClubPitch } from '@/components/platform/ClubPitch';
import { DiscoverSections } from '@/components/platform/home/DiscoverSections';
import { HomeHero } from '@/components/platform/home/HomeHero';
import { HomeAgenda } from '@/components/platform/home/HomeAgenda';
import { WalletCard } from '@/components/platform/home/WalletCard';
import { LevelCard } from '@/components/platform/home/LevelCard';
import { ManagedClubsCard } from '@/components/platform/home/ManagedClubsCard';
import { ResultsToRecord } from '@/components/match/ResultsToRecord';
import { ResultsToConfirm } from '@/components/match/ResultsToConfirm';

type Th = ReturnType<typeof useTheme>['th'];

// Accueil unifié de palova.fr — UNE page pour le visiteur et le joueur connecté. Elle porte
// pour tout le monde le moteur de découverte complet (recherche par lieu + les trois sections
// filtrables, `DiscoverSections`), et ajoute par-dessus ce qui est propre à l'état de session :
//   visiteur → hero SEO (<h1>), « Comment ça marche », panneau B2B, outro de marque ;
//   connecté → carte Gestion, hero « Bonjour X », résultats à confirmer/saisir, agenda,
//              puis niveau + portefeuille en pied de page.
// Remplace les trois surfaces d'avant (vitrine, « Mon Palova », /decouvrir), archivées telles
// quelles sous `components/legacy/` et consultables sur `/archive/*`.
//
// Frontière de responsabilité : ce composant possède les DONNÉES (un seul fetch de chaque),
// `DiscoverSections` possède le FILTRAGE. Hydration-safe : horloge posée en effet, sections
// data rendues seulement une fois résolues.
export function PalovaHome() {
  const { th } = useTheme();
  const { token } = useAuth();

  // ── Données publiques (toujours chargées : elles alimentent les trois sections) ──
  const [matches, setMatches] = useState<NationalOpenMatch[] | null>(null);
  const [nationalTournaments, setNationalTournaments] = useState<NationalTournament[] | null>(null);

  // ── Données du joueur connecté ──
  const [firstName, setFirstName] = useState<string | null>(null);
  const [reservations, setReservations] = useState<MyReservation[]>([]);
  const [myTournaments, setMyTournaments] = useState<MyTournamentRegistration[]>([]);
  const [myEvents, setMyEvents] = useState<MyEventRegistration[]>([]);
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
    api.listNationalOpenMatches().then(setMatches).catch(() => setMatches([]));
    api.listNationalTournaments().then(setNationalTournaments).catch(() => setNationalTournaments([]));
  }, []);

  // Un échec ne doit éteindre que sa propre brique (les `catch` vides sont le contrat de
  // « Mon Palova » : chaque section disparaît seule plutôt que de casser la page).
  useEffect(() => {
    if (!token) {
      setFirstName(null); setReservations([]); setMyTournaments([]);
      setMyEvents([]); setLessons([]); setMemberships([]);
      return;
    }
    api.getMyProfile(token).then((p) => setFirstName(p.firstName)).catch(() => {});
    api.getMyReservations(token).then(setReservations).catch(() => {});
    api.getMyTournaments(token).then(setMyTournaments).catch(() => {});
    api.getMyEvents(token).then(setMyEvents).catch(() => {});
    api.getMyLessons(token).then(setLessons).catch(() => {});
    api.getMyMemberships(token).then(setMemberships).catch(() => {});
  }, [token]);

  const nowDate = useMemo(() => (now == null ? null : new Date(now)), [now]);
  const agenda = useMemo(
    () => buildAgendaList(reservations, myTournaments, myEvents, lessons, nowDate ?? new Date(0)),
    [reservations, myTournaments, myEvents, lessons, nowDate],
  );
  const upcoming = useMemo(() => agenda.filter((i) => !i.past).slice(0, 6), [agenda]);

  // `null` (et non un Set vide) quand le filtre « Mes clubs » n'a pas lieu d'être : visiteur,
  // ou joueur sans adhésion active — DiscoverSections n'affiche alors pas la chip.
  const myClubSlugs = useMemo(() => {
    if (!token) return null;
    const slugs = memberships.filter((m) => m.status === 'ACTIVE').map((m) => m.slug);
    return slugs.length > 0 ? new Set(slugs) : null;
  }, [token, memberships]);

  // Contenu glissé entre la barre de recherche collante et la première section (cf. la prop
  // `intro` de DiscoverSections : la pilule chevauche le hero, rien ne peut s'intercaler avant).
  const intro = token ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26, padding: '14px 20px 4px' }}>
      <ResultsToConfirm token={token} />
      <ResultsToRecord token={token} />
      <HomeAgenda items={upcoming} now={now} />
    </div>
  ) : (
    <HowItWorks th={th} />
  );

  return (
    <Screen>
      <div style={{ paddingBottom: 46 }}>
        {/* En-tête sur une ligne. Volontairement NON collant : la barre de recherche + ancres
            de DiscoverSections est le seul élément épinglé de la page (deux `sticky top: 0`
            se chevaucheraient). Côté droit adaptatif selon la session. */}
        <div style={{ padding: '22px 20px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Logotype size={26} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ThemeToggle />
              {token ? <ProfileMenu /> : (
                <>
                  <a href="/login" style={{ ...pillBase(th), background: 'transparent', color: th.text, boxShadow: `inset 0 0 0 1.5px ${th.lineStrong}` }}>Connexion</a>
                  {/* pill inversée en thème sombre (encre sur encre sinon) */}
                  <a href="/register" style={{ ...pillBase(th), background: th.mode === 'floodlit' ? th.text : th.ink, color: th.mode === 'floodlit' ? th.ink : '#f7f5ee' }}>S&apos;inscrire</a>
                </>
              )}
            </div>
          </div>
        </div>

        {token && (
          <div style={{ padding: '10px 20px 0' }}>
            <ManagedClubsCard token={token} />
          </div>
        )}

        {/* Hero — la pilule de recherche de DiscoverSections vient chevaucher son bord bas
            (marge négative propre à LocationSearchPill), d'où les paddings bas généreux. */}
        <div style={{ padding: token ? '10px 20px 0' : '18px 20px 0' }}>
          {token ? <HomeHero firstName={firstName} /> : <VisitorHero th={th} matches={matches} tournaments={nationalTournaments} />}
        </div>

        <DiscoverSections matches={matches} tournaments={nationalTournaments} now={nowDate}
          myClubSlugs={myClubSlugs} intro={intro} />

        {token ? (
          /* Compteurs personnels en pied de page : niveau | portefeuille côte à côte ≥ 640px. */
          <div className="mp-duo" style={{ padding: '30px 20px 0' }}>
            <LevelCard token={token} memberships={memberships} />
            <WalletCard token={token} />
          </div>
        ) : (
          <>
            <ClubPitch />
            {/* Outro de marque (les liens légaux vivent dans le Footer global du layout) */}
            <div style={{ marginTop: 52, padding: '0 20px', textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}><Logotype size={22} /></div>
              <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, margin: '12px 0 0' }}>
                Le padel près de chez vous — réservez, jouez, progressez.
              </p>
            </div>
          </>
        )}
      </div>
    </Screen>
  );
}

// Hero du visiteur : la surface SEO de palova.fr. Le <h1> et la France en pointillés sont le
// geste signature « tous les clubs à la fois » ; les chips « pouls » ne sortent qu'une fois
// les données connues (hydration-safe) et sautent aux sections correspondantes.
function VisitorHero({ th, matches, tournaments }: {
  th: Th; matches: NationalOpenMatch[] | null; tournaments: NationalTournament[] | null;
}) {
  return (
    <div className="sp-hero-rise" style={{
      position: 'relative', overflow: 'hidden', borderRadius: 26,
      background: HERO_GRADIENT, color: HERO_INK, padding: '36px 26px 58px',
    }}>
      <FranceDotsMap />
      <div className="pl-hero-copy">
        <div style={{ fontFamily: th.fontBrand, fontSize: 15, letterSpacing: 3, textTransform: 'uppercase', color: HERO_INK_MUTED }}>
          Palova
        </div>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 'clamp(34px, 8vw, 46px)', lineHeight: 1.02, letterSpacing: -1.2, margin: '14px 0 0' }}>
          Trouvez où jouer.
        </h1>
        <p style={{ fontFamily: th.fontUI, fontSize: 16, lineHeight: 1.55, color: HERO_INK_MUTED, margin: '14px 0 0', maxWidth: 480 }}>
          Réservez un terrain, rejoignez une partie ouverte, visez un tournoi —
          dans les clubs Palova près de chez vous.
        </p>

        {((matches?.length ?? 0) > 0 || (tournaments?.length ?? 0) > 0) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 22 }}>
            {matches !== null && matches.length > 0 && (
              <a href="#parties" style={pulseChip(th)}>
                🎾 {matches.length} partie{matches.length > 1 ? 's' : ''} à rejoindre cette semaine
              </a>
            )}
            {tournaments !== null && tournaments.length > 0 && (
              <a href="#tournois" style={pulseChip(th)}>
                🏆 {tournaments.length} tournoi{tournaments.length > 1 ? 's' : ''} à venir
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Mode d'emploi en trois temps — visiteur seulement, juste avant les listes.
function HowItWorks({ th }: { th: Th }) {
  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ padding: '0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden="true" style={{ width: 18, height: 3, borderRadius: 2, background: th.accent }} />
          <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: th.textMute }}>Simple</span>
        </div>
        <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, letterSpacing: -0.6, color: th.text, margin: '8px 0 0' }}>Comment ça marche</h2>
      </div>
      {/* Le padding bas rattrape l'écart entre sections : la première section n'apporte que
          ses 10px de `paddingTop`, sans quoi les listes collent aux trois cartes. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, padding: '16px 20px 18px' }}>
        {[
          { n: '01', t: 'Trouvez votre club', d: 'Par ville ou autour de vous — chaque club a son espace Palova.' },
          { n: '02', t: 'Réservez ou rejoignez', d: 'Un terrain en quelques secondes, ou une partie ouverte s’il manque des joueurs.' },
          { n: '03', t: 'Jouez, progressez', d: 'Résultats, niveau, tournois, events : votre vie de club au même endroit.' },
        ].map((s) => (
          <div key={s.n} style={{ background: th.surface, borderRadius: 18, padding: '18px 16px 17px', boxShadow: `${th.shadowSoft}, inset 0 0 0 1px ${th.line}` }}>
            <div style={{ fontFamily: th.fontMono, fontWeight: 700, fontSize: 13, color: th.accent, letterSpacing: 1 }}>{s.n}</div>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 17.5, letterSpacing: -0.2, color: th.text, marginTop: 8 }}>{s.t}</div>
            <p style={{ fontFamily: th.fontUI, fontSize: 13.5, lineHeight: 1.5, color: th.textMute, margin: '6px 0 0' }}>{s.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function pillBase(th: Th): React.CSSProperties {
  return { borderRadius: 30, padding: '8px 15px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' };
}

function pulseChip(th: Th): React.CSSProperties {
  return {
    fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
    background: 'rgba(24,21,14,0.06)', color: HERO_INK, borderRadius: 999, padding: '6px 12px', whiteSpace: 'nowrap',
  };
}
