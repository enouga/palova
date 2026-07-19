'use client';
import { ReactNode, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { hasAcceptedCgv, rememberCgvAccepted } from '@/lib/cgv';
import { CgvConsent } from '@/components/CgvConsent';

/**
 * Case CGV obligatoire avant tout paiement CB en ligne (pattern BookingModal, partagé par
 * les inscriptions tournoi/event et les offres). Les enfants — le formulaire Stripe — ne
 * sont montés qu'une fois la case cochée : l'intent n'est donc créé qu'après acceptation.
 * Déjà accepté pour ce club (mémoire locale) → rappel « déjà accepté » au lieu de la carte.
 * Grâce au repli légal backend, /cgv du club rend TOUJOURS un texte opposable.
 */
export function CgvGate({ children }: { children: ReactNode }) {
  const { th } = useTheme();
  const { slug } = useClub();
  const [accepted, setAccepted] = useState(() => hasAcceptedCgv(slug));
  // Figé au montage : si le joueur vient de cocher, il garde la carte cochée (pas de saut d'UI).
  const [preAccepted] = useState(() => hasAcceptedCgv(slug));

  return (
    <div>
      <CgvConsent
        accepted={accepted}
        alreadyAccepted={preAccepted}
        onChange={(v) => { setAccepted(v); if (v) rememberCgvAccepted(slug); }}
      />
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
