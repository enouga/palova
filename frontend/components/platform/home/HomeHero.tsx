'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { AgendaListItem, agendaItemClub } from '@/lib/calendar';
import { agendaItemHeading, agendaWhenLabel, startsInLabel } from '@/lib/monPalova';

// Hero « prochaine partie » de Mon Palova — brume bleue (jamais de panneau sombre),
// fallback invitation quand l'agenda est vide. `now` null tant que l'horloge client
// n'est pas posée (hydration-safe) → pas de compte à rebours sur ce premier rendu.
export function HomeHero({ firstName, entry, now }: {
  firstName: string | null;
  entry: AgendaListItem | null;
  now: number | null;
}) {
  const { th } = useTheme();
  const chip = { display: 'inline-flex', alignItems: 'center', background: '#ffffffcc', borderRadius: 999, padding: '5px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: HERO_INK, textDecoration: 'none' } as const;
  const countdown = entry && now != null ? startsInLabel(entry.start, new Date(now)) : null;
  const heading = entry ? agendaItemHeading(entry) : null;

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, background: HERO_GRADIENT, padding: '24px 22px', color: HERO_INK }}>
      <div style={{ fontFamily: th.fontBrand, fontSize: 13, letterSpacing: 2.5, textTransform: 'uppercase', color: HERO_INK_MUTED }}>
        {firstName ? `Bonjour ${firstName}` : 'Bonjour'}
      </div>
      {entry && heading ? (
        <>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 'clamp(21px, 5.4vw, 27px)', letterSpacing: -0.5, marginTop: 7, lineHeight: 1.15 }}>
            {heading.title} · {agendaWhenLabel(entry)}
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: HERO_INK_MUTED, marginTop: 4 }}>
            {agendaItemClub(entry).name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {countdown && <span style={chip}>⏱ {countdown}</span>}
            <a href={heading.href} style={chip}>Gérer →</a>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 'clamp(21px, 5.4vw, 27px)', letterSpacing: -0.5, marginTop: 7, lineHeight: 1.15 }}>
            Trouve ta prochaine partie
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: HERO_INK_MUTED, marginTop: 4 }}>
            Parties ouvertes, tournois et clubs partout en France.
          </div>
          <div style={{ marginTop: 12 }}>
            <a href="/decouvrir" style={chip}>Découvrir →</a>
          </div>
        </>
      )}
    </div>
  );
}
