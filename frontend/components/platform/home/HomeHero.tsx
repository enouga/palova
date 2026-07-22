'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { Icon } from '@/components/ui/Icon';
import { AgendaListItem, agendaItemClub } from '@/lib/calendar';
import { agendaItemHeading, agendaWhenLabel, startsInLabel, agendaKindIcon } from '@/lib/monPalova';

// Hero « prochaine partie » de Mon Palova — brume bleue (jamais de panneau sombre),
// fallback invitation quand l'agenda est vide. `now` null tant que l'horloge client
// n'est pas posée (hydration-safe) → pas de compte à rebours sur ce premier rendu.
export function HomeHero({ firstName, entry, now }: {
  firstName: string | null;
  entry: AgendaListItem | null;
  now: number | null;
}) {
  const { th } = useTheme();
  const chip = { display: 'inline-flex', alignItems: 'center', gap: 5, background: '#ffffffcc', borderRadius: 999, padding: '6px 13px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: HERO_INK, textDecoration: 'none' } as const;
  const countdown = entry && now != null ? startsInLabel(entry.start, new Date(now)) : null;
  const heading = entry ? agendaItemHeading(entry) : null;

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, background: HERO_GRADIENT, padding: '26px 26px 24px', color: HERO_INK }}>
      {/* Profondeur douce + filigrane balle : remplissent le côté droit sans surcharger. */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 88% 8%, rgba(255,255,255,0.5), transparent 55%)', pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', right: -18, bottom: -34, opacity: 0.07, pointerEvents: 'none' }}>
        <Icon name="ball" size={178} color={HERO_INK} />
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{ fontFamily: th.fontBrand, fontSize: 13, letterSpacing: 2.5, textTransform: 'uppercase', color: HERO_INK_MUTED }}>
          {firstName ? `Bonjour ${firstName}` : 'Bonjour'}
        </div>
        {entry && heading ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 9 }}>
              <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 11, background: 'rgba(255,255,255,0.6)' }}>
                <Icon name={agendaKindIcon(entry.kind)} size={17} color={HERO_INK} />
              </span>
              <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 'clamp(20px, 5vw, 26px)', letterSpacing: -0.5, lineHeight: 1.12 }}>
                {heading.title} · {agendaWhenLabel(entry)}
              </span>
            </div>
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: HERO_INK_MUTED, marginTop: 6, marginLeft: 43 }}>
              {agendaItemClub(entry).name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 15, marginLeft: 43 }}>
              {countdown && <span style={chip}><Icon name="clock" size={13} color={HERO_INK} />{countdown}</span>}
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
            <div style={{ marginTop: 14 }}>
              <a href="/decouvrir" style={chip}>Découvrir →</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
