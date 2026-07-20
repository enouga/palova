'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { formatCountdown } from '@/lib/bookingWindow';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

// Heure locale HH:MM (fuseau du club) d'un instant — pour afficher le rendez-vous
// d'ouverture À CÔTÉ du compte à rebours (le compteur seul ne dit pas à quelle heure).
function fmtOpeningTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(ms)).replace(':', 'h');
}

// Panneau plein cadre affiché À LA PLACE de la grille quand le joueur a sélectionné
// le jour verrouillé 🔒 : le rendez-vous remplace l'attente anxieuse (brume bleue,
// jamais de panneau sombre — préférence design du repo).
export function OpeningPanel({ dayLabel, opensAtMs, nowMs, tz }: {
  dayLabel: string; opensAtMs: number; nowMs: number; tz: string;
}) {
  const { th } = useTheme();
  return (
    <div style={{
      background: HERO_GRADIENT, borderRadius: 18, padding: '34px 22px', textAlign: 'center',
      fontFamily: th.fontUI,
    }}>
      <div style={{ fontSize: 14, color: HERO_INK_MUTED, marginBottom: 6 }}>
        Les créneaux du <strong style={{ color: HERO_INK }}>{dayLabel}</strong> ouvrent à <strong style={{ color: HERO_INK }}>{fmtOpeningTime(opensAtMs, tz)}</strong>, dans
      </div>
      <div aria-live="off" style={{ fontFamily: th.fontDisplay, fontSize: 44, fontWeight: 700, color: HERO_INK, letterSpacing: 1 }}>
        {formatCountdown(opensAtMs - nowMs)}
      </div>
      <div style={{ fontSize: 13, color: HERO_INK_MUTED, marginTop: 8 }}>
        Ils apparaîtront ici automatiquement — inutile de rafraîchir la page.
      </div>
    </div>
  );
}

// Bandeau discret au-dessus de la grille quand l'ouverture est < 1 h (ou vient d'avoir
// lieu : variante « ouvert » avec bouton). `onGoToDay` absent = pas encore ouvert.
export function OpeningBanner({ dayLabel, opensAtMs, nowMs, tz, onGoToDay }: {
  dayLabel: string; opensAtMs: number; nowMs: number; tz: string; onGoToDay?: () => void;
}) {
  const { th } = useTheme();
  const opened = nowMs >= opensAtMs;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      background: th.surface2, borderRadius: 12, padding: '9px 13px', marginBottom: 12,
      fontFamily: th.fontUI, fontSize: 13, color: th.textMute,
    }}>
      {opened && onGoToDay ? (
        <button type="button" onClick={onGoToDay} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.accent,
        }}>
          Les créneaux du {dayLabel} sont ouverts →
        </button>
      ) : (
        <>
          <span aria-hidden>⏱</span>
          <span>Ouverture des créneaux du <strong style={{ color: th.text }}>{dayLabel}</strong> à <strong style={{ color: th.text }}>{fmtOpeningTime(opensAtMs, tz)}</strong>, dans</span>
          <span style={{ fontFamily: th.fontMono, fontWeight: 700, color: th.text }}>{formatCountdown(opensAtMs - nowMs)}</span>
        </>
      )}
    </div>
  );
}
