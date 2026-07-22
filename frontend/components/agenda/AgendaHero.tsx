'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Icon, IconName } from '@/components/ui/Icon';
import { deadlineCountdown } from '@/lib/tournament';

// Dégradé « brume bleue » : hero clair, pastel, texte encre — remplace
// l'ancien dégradé sombre bleu Palova → bleu nuit (jugé trop lourd).
/** Dégradé signature des heros (fiches tournoi/event, club-house). */
export const HERO_GRADIENT = `linear-gradient(115deg, #e3edf9, #c8daf0)`;

/** Encre fixe pour le texte sur HERO_GRADIENT (le dégradé est clair dans les 2 thèmes,
 *  donc le texte NE doit PAS suivre th.text qui vire au clair en thème sombre). */
export const HERO_INK = '#181510';
export const HERO_INK_MUTED = 'rgba(24,21,14,0.65)';

// Briques partagées par les fiches tournoi et event (et leurs heros).

// Pastille sur fond dégradé : couleurs fixes (le composant Chip lit le thème
// et deviendrait illisible en mode clair sur le dégradé). `urgent` = fond coral.
export function HeroPill({ children, strong, urgent }: { children: React.ReactNode; strong?: boolean; urgent?: boolean }) {
  const { th } = useTheme();
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontWeight: 700,
      fontSize: 12.5, letterSpacing: 0.3, padding: '5px 11px', borderRadius: 999, whiteSpace: 'nowrap',
      background: urgent ? ACCENTS.coral : strong ? '#fff' : 'rgba(24,21,14,0.06)',
      color: urgent ? '#fff' : HERO_INK,
    }}>
      {children}
    </span>
  );
}

export interface AgendaHeroProps {
  pills: { label: string; strong?: boolean }[];
  title: string;
  subtitle: string;
  deadline: string;            // ISO — clôture des inscriptions (compte à rebours)
  now: Date | null;            // null avant le mount (hydration-safe)
  ratio: number | null;        // remplissage 0..1, null = pas de jauge
  counter: string;             // « 7/12 binômes » / « 9/16 inscrits »
  places: { text: string; urgent: boolean } | null;  // null = badge masqué
  meta?: MetaCard[];           // bande de faits intégrée en pied de hero (remplace MetaCardsRow)
}

/** Le countdown brut (« Plus que 6 h », « J-24 ») ne dit pas avant QUOI —
 *  dans le hero on explicite : « Clôture dans 6 h » / « Clôture J-24 ». */
function heroCountdownLabel(text: string): string {
  return text.startsWith('J-') ? `Clôture ${text}` : text.replace(/^Plus que\b/, 'Clôture dans');
}

// Hero immersif : dégradé « brume bleue » clair (texte encre), compte à
// rebours, jauge de remplissage animée, places restantes — l'urgence est
// portée par les touches coral, pas par le fond. `now` null au premier
// rendu : pas de countdown, jauge à 0 — le remplissage s'anime au mount via
// la transition CSS. `meta` intègre les faits (horaire, clôture, prix…) en
// pied de hero, derrière un filet — un seul bloc au lieu de deux.
export function AgendaHero({ pills, title, subtitle, deadline, now, ratio, counter, places, meta }: AgendaHeroProps) {
  const { th } = useTheme();
  const countdown = now ? deadlineCountdown(deadline, now) : null;

  return (
    <div style={{ padding: '12px 20px 0' }}>
      <div data-testid="agenda-hero" style={{ background: HERO_GRADIENT, borderRadius: 18, padding: '20px 22px 18px', color: HERO_INK }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {pills.map((p) => <HeroPill key={p.label} strong={p.strong}>{p.label}</HeroPill>)}
          <span style={{ flex: 1 }} />
          {countdown && <HeroPill urgent={countdown.urgent}><Icon name="clock" size={13} color={countdown.urgent ? '#fff' : HERO_INK} />{heroCountdownLabel(countdown.text)}</HeroPill>}
        </div>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, letterSpacing: -0.6, marginTop: 10, lineHeight: 1.1 }}>{title}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 13.5, opacity: 0.65, marginTop: 4 }}>{subtitle}</div>

        <div style={{ marginTop: 14 }}>
          {ratio != null && (
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(24,21,14,0.14)', boxShadow: 'inset 0 0 0 1px rgba(24,21,14,0.22)', overflow: 'hidden' }}>
              <div data-testid="hero-fill" style={{ height: '100%', borderRadius: 999, background: ACCENTS.blue, width: now ? `${Math.round(ratio * 100)}%` : 0, transition: 'width .8s ease' }} />
            </div>
          )}
          {/* Compteur et places restantes fusionnés sur une seule ligne (fini le badge à droite). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: ratio != null ? 8 : 0, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{counter}</span>
            {places && (
              <>
                <span aria-hidden="true" style={{ opacity: 0.45 }}>·</span>
                <span style={{
                  fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
                  ...(places.urgent ? { color: ACCENTS.coral } : { opacity: 0.7 }),
                }}>{places.text}</span>
              </>
            )}
          </div>
        </div>

        {meta && meta.length > 0 && (
          <div style={{ marginTop: 13, paddingTop: 12, borderTop: '1px solid rgba(24,21,14,0.16)', display: 'flex', flexWrap: 'wrap', columnGap: 22, rowGap: 8 }}>
            {meta.map((m) => (
              <span key={m.label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
                <Icon name={m.icon} size={12} color={HERO_INK_MUTED} style={{ alignSelf: 'center', flexShrink: 0 }} />
                <span style={{ fontFamily: th.fontUI, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: HERO_INK_MUTED }}>{m.label}</span>
                <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: HERO_INK }}>{m.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export interface MetaCard {
  icon: IconName;
  label: string;
  value: string;
}

// Rangée de cartes méta icônées sous le hero (début, clôture, prix, juge-arbitre…).
// Jusqu'à 3 cartes : tiers égaux sans scroll horizontal — sur mobile ~110 px par
// carte (les valeurs — formats courts — wrappent sur 2-3 lignes), sur desktop
// ~255 px. Au-delà, `.agenda-meta-row` (globals.css) les passe à 2 par ligne
// sous 700 px : à 4 de front il ne resterait ~75 px par carte et les libellés
// déborderaient sous la carte voisine. La classe n'est posée qu'au-delà de 3
// cartes → le cas à 3 garde exactement le rendu d'origine (--meta-basis absente
// → repli 0px, soit l'ancien `flex: 1 1 0`).
export function MetaCardsRow({ cards }: { cards: MetaCard[] }) {
  const { th } = useTheme();
  return (
    <div className={cards.length > 3 ? 'agenda-meta-row' : undefined} style={{ display: 'flex', gap: 6, padding: '10px 20px 0' }}>
      {cards.map((c) => (
        <div key={c.label} style={{ flex: '1 1 var(--meta-basis, 0px)', minWidth: 0, background: th.surface, borderRadius: 14, padding: '10px 11px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textFaint }}>
            <Icon name={c.icon} size={12} color={th.textFaint} style={{ flexShrink: 0 }} />{c.label}
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text, marginTop: 5, lineHeight: 1.35 }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
