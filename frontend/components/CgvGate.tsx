'use client';
import { ReactNode, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { hasAcceptedCgv, rememberCgvAccepted } from '@/lib/cgv';

/**
 * Case CGV obligatoire avant tout paiement CB en ligne (pattern BookingModal, partagé par
 * les inscriptions tournoi/event et les offres). Les enfants — le formulaire Stripe — ne
 * sont montés qu'une fois la case cochée : l'intent n'est donc créé qu'après acceptation.
 * Grâce au repli légal backend, /cgv du club rend TOUJOURS un texte opposable.
 */
export function CgvGate({ children }: { children: ReactNode }) {
  const { th } = useTheme();
  const { slug } = useClub();
  const [accepted, setAccepted] = useState(() => hasAcceptedCgv(slug));

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={accepted}
          onChange={(e) => { const v = e.target.checked; setAccepted(v); if (v) rememberCgvAccepted(slug); }}
          aria-label="J'accepte les conditions générales de vente et la politique de confidentialité"
          style={{ width: 15, height: 15, marginTop: 1, accentColor: th.accent, flex: '0 0 auto', cursor: 'pointer' }} />
        <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, lineHeight: 1.4 }}>
          J&apos;accepte les{' '}
          <a href="/cgv" target="_blank" rel="noopener noreferrer" style={{ color: th.textMute, textDecoration: 'underline' }}>conditions générales de vente</a>
          {' '}et la{' '}
          <a href="/confidentialite" target="_blank" rel="noopener noreferrer" style={{ color: th.textMute, textDecoration: 'underline' }}>politique de confidentialité</a>.
        </span>
      </label>
      {accepted ? (
        <div style={{ marginTop: 14 }}>{children}</div>
      ) : (
        <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, margin: '10px 0 0' }}>
          Acceptez les conditions pour continuer.
        </p>
      )}
    </div>
  );
}
