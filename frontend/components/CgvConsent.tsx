'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

interface CgvConsentProps {
  accepted: boolean;
  onChange: (v: boolean) => void;
  /** Acceptation retrouvée en mémoire locale (joueur récurrent) → rappel discret au lieu de la carte. */
  alreadyAccepted?: boolean;
  /** Le club n'a pas publié ses CGV → mention « conditions de la plateforme ». */
  fallbackNote?: boolean;
  /** Incrémenté par le parent quand l'utilisateur tape le CTA sans avoir coché → la carte pulse. */
  nudge?: number;
}

/**
 * Acceptation des CGV avant paiement/empreinte CB — carte pleine largeur tappable
 * (remplace la petite case de 15 px, facile à rater). Cochée, elle prend le langage
 * visuel des cartes de paiement sélectionnées (liseré accent + lavis + check).
 * `alreadyAccepted` (mémoire locale par club) → simple rappel « déjà accepté »,
 * la trace légale par transaction reste envoyée par le parent.
 */
export function CgvConsent({ accepted, onChange, alreadyAccepted, fallbackNote, nudge = 0 }: CgvConsentProps) {
  const { th } = useTheme();

  const links = (
    <>
      <a href="/cgv" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
        style={{ color: th.textMute, textDecoration: 'underline' }}>conditions générales de vente</a>
      {' '}et la{' '}
      <a href="/confidentialite" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
        style={{ color: th.textMute, textDecoration: 'underline' }}>politique de confidentialité</a>
    </>
  );

  if (alreadyAccepted && accepted) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="check" size={14} color={th.successInk} style={{ flex: '0 0 auto', marginTop: 2 }} />
        <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute, lineHeight: 1.4 }}>
          Vous avez déjà accepté les conditions de ce club — les {links}.
        </span>
      </div>
    );
  }

  return (
    <label key={nudge} className={nudge > 0 && !accepted ? 'pl-cgv-nudge' : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 11, cursor: 'pointer',
        background: accepted ? `${th.accent}14` : th.surface,
        boxShadow: `inset 0 0 0 1.5px ${accepted ? th.accent : th.lineStrong}`,
        borderRadius: 12, padding: '12px 14px', transition: 'background .15s, box-shadow .15s',
      }}>
      <input type="checkbox" checked={accepted}
        onChange={(e) => onChange(e.target.checked)}
        aria-label="J'accepte les conditions générales de vente et la politique de confidentialité"
        style={{ width: 18, height: 18, marginTop: 1, accentColor: th.accent, flex: '0 0 auto', cursor: 'pointer' }} />
      <span style={{ fontFamily: th.fontUI, fontSize: 12, color: accepted ? th.text : th.textMute, lineHeight: 1.45 }}>
        J&apos;accepte les {links}.
        {fallbackNote && (
          <span style={{ display: 'block', color: th.textFaint, fontSize: 10.5, marginTop: 2 }}>
            Les conditions générales de la plateforme s&apos;appliquent.
          </span>
        )}
      </span>
      {accepted && <Icon name="check" size={15} color={th.accent} style={{ flex: '0 0 auto', marginLeft: 'auto', marginTop: 2 }} />}
    </label>
  );
}
