'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, NationalOpenMatch, NationalTournament } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { ClubDirectory } from '@/components/ClubDirectory';
import { UpcomingTournaments } from '@/components/calendar/UpcomingTournaments';
import { NationalOpenMatches } from '@/components/platform/NationalOpenMatches';
import { ClubPitch } from '@/components/platform/ClubPitch';
import { FranceDotsMap } from '@/components/platform/FranceDotsMap';
import { LocationSearchPill } from '@/components/discover/LocationSearchPill';

type Th = ReturnType<typeof useTheme>['th'];

// Vitrine publique de palova.fr (visiteur non connecté) — la « plus belle page du site » :
// hero brume bleue signature + pouls live, parties ouvertes publiques agrégées tous clubs,
// annuaire, tournois nationaux, mode d'emploi, panneau B2B, footer éditorial.
// Hydration-safe : le pouls et les sections data n'apparaissent qu'une fois les fetchs résolus.
export default function AnonymousView() {
  const { th } = useTheme();
  const [matches, setMatches] = useState<NationalOpenMatch[] | null>(null);
  const [tournaments, setTournaments] = useState<NationalTournament[] | null>(null);
  const router = useRouter();
  const [q, setQ] = useState('');
  const goSearch = () => router.push(q.trim() ? `/decouvrir?q=${encodeURIComponent(q.trim())}` : '/decouvrir');

  useEffect(() => { api.listNationalOpenMatches().then(setMatches).catch(() => setMatches([])); }, []);
  useEffect(() => { api.listNationalTournaments().then(setTournaments).catch(() => setTournaments([])); }, []);

  return (
    <Screen>
      <div style={{ paddingBottom: 46 }}>
        {/* ── Nav sticky translucide ── */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 40,
          background: th.mode === 'floodlit' ? 'rgba(19,19,18,0.78)' : 'rgba(241,238,229,0.82)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          borderBottom: `1px solid ${th.line}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px' }}>
            <Logotype size={26} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ThemeToggle />
              <a href="/login" style={{ ...pillBase(th), background: 'transparent', color: th.text, boxShadow: `inset 0 0 0 1.5px ${th.lineStrong}` }}>Connexion</a>
              {/* pill inversée en thème sombre (encre sur encre sinon) */}
              <a href="/register" style={{ ...pillBase(th), background: th.mode === 'floodlit' ? th.text : th.ink, color: th.mode === 'floodlit' ? th.ink : '#f7f5ee' }}>S&apos;inscrire</a>
            </div>
          </div>
        </header>

        {/* ── Hero immersif ── */}
        <div style={{ padding: '18px 20px 0' }}>
          <div className="sp-hero-rise" style={{
            position: 'relative', overflow: 'hidden', borderRadius: 26,
            background: HERO_GRADIENT, color: HERO_INK, padding: '36px 26px 58px',
          }}>
            {/* la France en pointillés : le geste signature « tous les clubs à la fois » */}
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

              {/* pouls : rendu une fois les données connues (hydration-safe) */}
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
          {/* recherche flottante à cheval sur le bord bas du hero → /decouvrir prérempli */}
          <LocationSearchPill value={q} onChange={setQ} onSubmit={goSearch}
            onNearMe={() => router.push('/decouvrir?pres=1')} nearActive={false} locating={false} />
        </div>

        {/* ── Parties ouvertes publiques ── */}
        {matches !== null && matches.length > 0 && (
          <Section id="parties" th={th} kicker="En ce moment" title="Ça joue bientôt"
            sub="Des places à prendre dans les clubs — rejoignez une partie en deux taps.">
            <NationalOpenMatches matches={matches} />
          </Section>
        )}

        {/* ── Annuaire ── */}
        <Section id="clubs" th={th} kicker="Annuaire" title="Clubs près de chez vous"
          sub="Cherchez par nom, par ville, ou autour de vous.">
          <ClubDirectory />
        </Section>

        {/* ── Tournois nationaux ── */}
        {tournaments !== null && tournaments.length > 0 && (
          <Section id="tournois" th={th} kicker="Compétition" title="Prochains tournois"
            sub="Les tournois homologués des clubs Palova, partout en France.">
            <UpcomingTournaments items={tournaments} hideTitle />
          </Section>
        )}

        {/* ── Comment ça marche ── */}
        <Section th={th} kicker="Simple" title="Comment ça marche">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, padding: '16px 20px 0' }}>
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
        </Section>

        {/* ── Panneau B2B ── */}
        <ClubPitch />

        {/* ── Outro de marque (les liens légaux vivent dans le Footer global du layout) ── */}
        <div style={{ marginTop: 52, padding: '0 20px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Logotype size={22} /></div>
          <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, margin: '12px 0 0' }}>
            Le padel près de chez vous — réservez, jouez, progressez.
          </p>
        </div>
      </div>
    </Screen>
  );
}

// En-tête de section éditorial : tiret accent + kicker uppercase, titre display.
function Section({ id, th, kicker, title, sub, children }: {
  id?: string; th: Th; kicker: string; title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ marginTop: 44, scrollMarginTop: 70 }}>
      <div style={{ padding: '0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden="true" style={{ width: 18, height: 3, borderRadius: 2, background: th.accent }} />
          <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: th.textMute }}>{kicker}</span>
        </div>
        <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, letterSpacing: -0.6, color: th.text, margin: '8px 0 0' }}>{title}</h2>
        {sub && <p style={{ fontFamily: th.fontUI, fontSize: 14, lineHeight: 1.5, color: th.textMute, margin: '6px 0 0', maxWidth: 480 }}>{sub}</p>}
      </div>
      {children}
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
