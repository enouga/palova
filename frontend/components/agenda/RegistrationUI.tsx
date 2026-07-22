'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';

// Briques partagées par les fiches event et tournoi : carte « À propos »,
// pastille de statut d'inscription, bouton « Se désinscrire ».

/** Carte description — même langage visuel que les cartes méta (surface + filet),
 *  coiffée d'un mini-titre icôné. `pad` enveloppe la carte dans le rythme de la page. */
export function AboutCard({ text, pad = true }: { text: string; pad?: boolean }) {
  const { th } = useTheme();
  return (
    <div style={pad ? { padding: '18px 20px 0' } : undefined}>
      <div style={{ background: th.surface, borderRadius: 16, padding: '15px 17px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textFaint, marginBottom: 9 }}>
          <Icon name="info" size={13} color={th.textFaint} />À propos
        </div>
        <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, margin: 0, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{text}</p>
      </div>
    </div>
  );
}

/** Pastille ronde + titre + sous-titre. Inscrit = accent (bleu marque),
 *  liste d'attente = apricot. `waitlistPos` affine le titre d'attente.
 *  `compact` : tout sur une ligne (sous-titre inline, pastille réduite). */
export function RegistrationStatus({ confirmed, waitlistPos, subtitle, compact }: { confirmed: boolean; waitlistPos?: number | null; subtitle?: string; compact?: boolean }) {
  const { th } = useTheme();
  const tint = confirmed ? th.accent : ACCENTS.apricot;
  const title = confirmed
    ? 'Vous êtes inscrit'
    : `En liste d'attente${waitlistPos != null ? ` · position n°${waitlistPos}` : ''}`;
  const sub = subtitle ?? (confirmed ? 'Votre place est confirmée' : 'Vous serez prévenu si une place se libère');
  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: th.mode === 'floodlit' ? `${tint}26` : `${tint}2e`,
        }}>
          <Icon name={confirmed ? 'check' : 'clock'} size={15} color={tint} />
        </span>
        <span style={{ fontFamily: th.fontDisplay, fontSize: 15, fontWeight: 600, letterSpacing: -0.2, color: th.text, lineHeight: 1.3 }}>{title}</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>· {sub}</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: th.mode === 'floodlit' ? `${tint}26` : `${tint}2e`,
      }}>
        <Icon name={confirmed ? 'check' : 'clock'} size={21} color={tint} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: th.fontDisplay, fontSize: 17, fontWeight: 600, letterSpacing: -0.2, color: th.text, lineHeight: 1.25 }}>{title}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  );
}

/** Bouton « Se désinscrire » discret : filet neutre au repos, teinte coral au
 *  survol (signale le départ sans dramatiser). Pleine largeur par défaut.
 *  `small` : gabarit pill (s'aligne sur AddPlayerPill dans une rangée d'actions). */
export function LeaveButton({ onClick, disabled, label = 'Se désinscrire', full = true, small = false }: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  full?: boolean;
  small?: boolean;
}) {
  const { th } = useTheme();
  const [hover, setHover] = useState(false);
  const active = hover && !disabled;
  return (
    <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: full ? '100%' : 'auto', height: small ? 32 : 46, padding: small ? '0 13px' : '0 18px', borderRadius: small ? 999 : 12,
        cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: small ? 6 : 8,
        border: `1.5px solid ${active ? ACCENTS.coral : th.line}`,
        background: active ? `${ACCENTS.coral}14` : 'transparent',
        color: active ? ACCENTS.coral : th.textMute,
        fontFamily: th.fontUI, fontWeight: 600, fontSize: small ? 12.5 : 14.5,
        transition: 'border-color .15s, background .15s, color .15s', opacity: disabled ? 0.5 : 1,
        WebkitTapHighlightColor: 'transparent',
      }}>
      <Icon name="x" size={small ? 14 : 17} color={active ? ACCENTS.coral : th.textMute} />{label}
    </button>
  );
}
