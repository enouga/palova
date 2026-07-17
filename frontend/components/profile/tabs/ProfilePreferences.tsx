'use client';
import { ReactNode } from 'react';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { CardKicker } from '@/components/profile/CardKicker';
import { ProfileSelect } from '@/components/profile/ProfileFields';
import { ProfileTabProps, useProfileStyles } from '@/components/profile/shared';

const LOCALE_OPTIONS = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

// ⚠️ Pas de sélecteur de thème ici : il n'a aucun état serveur, il ne peut donc pas passer
// par la SaveBar — et par la règle de la page (« un contrôle hors barre n'a pas le droit
// d'être habillé en champ »), il ne peut pas rester dans cette carte. Le ThemeToggle de
// l'en-tête (ClubNav, ou en-tête plateforme de la page) le couvre déjà.
export function ProfilePreferences({ profile, set }: ProfileTabProps) {
  const { th, card } = useProfileStyles();
  const hint = { fontFamily: th.fontUI, fontSize: 12, color: th.textFaint };

  // Lignes d'interrupteurs séparées par des filets fins ; la dernière n'en porte pas.
  const row = (node: ReactNode, last = false) => (
    <div style={{ borderBottom: last ? 'none' : `1px solid ${th.line}`, padding: '4px 0' }}>{node}</div>
  );

  return (
    <section style={card} aria-label="Préférences">
      <CardKicker>Préférences</CardKicker>

      <ProfileSelect label="Langue" value={profile.locale ?? 'fr'} onChange={(v) => set('locale', v)} options={LOCALE_OPTIONS} />
      <span style={{ ...hint, marginTop: -6 }}>L'interface reste en français pour l'instant.</span>

      <div style={{ marginTop: 4 }}>
        {row(
          <SwitchRow
            checked={profile.showInLeaderboard} onChange={(v) => set('showInLeaderboard', v)}
            title="Apparaître dans les classements"
          />,
        )}
        {row(
          <SwitchRow
            checked={profile.autoMatchProposals} onChange={(v) => set('autoMatchProposals', v)}
            title="Propose-moi les parties à mon niveau"
            description="Reçois une notification quand une partie ouverte à ton niveau est créée dans ton club. Tu rejoins en un tap — jamais d'inscription automatique."
          />,
        )}
        {row(
          <SwitchRow
            checked={profile.acceptsFriendRequests} onChange={(v) => set('acceptsFriendRequests', v)}
            title="Autoriser les demandes d'ami"
            description="Ce réglage ne concerne que les amitiés — la messagerie privée se règle séparément ci-dessous."
          />,
        )}
        {row(
          <SwitchRow
            checked={profile.acceptsDirectMessages} onChange={(v) => set('acceptsDirectMessages', v)}
            title="Recevoir des messages privés"
            description="Vos amis confirmés peuvent toujours vous écrire, même désactivé."
          />,
          true,
        )}
      </div>
    </section>
  );
}
