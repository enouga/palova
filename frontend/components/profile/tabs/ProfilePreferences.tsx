'use client';
import { Segmented } from '@/components/ui/atoms';
import { ProfileTabProps, useProfileStyles } from '@/components/profile/shared';

const LOCALE_OPTIONS = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];

const YES_NO = [{ value: 'oui' as const, label: 'Oui' }, { value: 'non' as const, label: 'Non' }];

// ⚠️ Pas de sélecteur de thème ici : il n'a aucun état serveur, il ne peut donc pas passer
// par la SaveBar — et par la règle de la page (« un contrôle hors barre n'a pas le droit
// d'être habillé en champ »), il ne peut pas rester dans cette carte. Le ThemeToggle de
// l'en-tête (ClubNav, ou en-tête plateforme de la page) le couvre déjà.
export function ProfilePreferences({ profile, set }: ProfileTabProps) {
  const { th, card, cardTitle, label, input } = useProfileStyles();
  const hint = { fontFamily: th.fontUI, fontSize: 12, color: th.textFaint };

  const toggle = (
    name: string,
    value: boolean,
    onChange: (v: boolean) => void,
    note?: string,
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={label}>{name}</span>
      <div role="group" aria-label={name}>
        <Segmented<'oui' | 'non'> value={value ? 'oui' : 'non'} onChange={(v) => onChange(v === 'oui')} options={YES_NO} />
      </div>
      {note && <span style={hint}>{note}</span>}
    </div>
  );

  return (
    <section style={card} aria-label="Préférences">
      <div style={cardTitle}>Préférences</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={label}>Langue</span>
        <select value={profile.locale ?? 'fr'} onChange={(e) => set('locale', e.target.value)}
          aria-label="Langue" style={{ ...input, cursor: 'pointer' }}>
          {LOCALE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span style={hint}>L’interface reste en français pour l’instant.</span>
      </div>

      {toggle('Apparaître dans les classements', profile.showInLeaderboard, (v) => set('showInLeaderboard', v))}

      {toggle('Propose-moi les parties à mon niveau', profile.autoMatchProposals, (v) => set('autoMatchProposals', v),
        'Reçois une notification quand une partie ouverte à ton niveau est créée dans ton club. Tu rejoins en un tap — jamais d’inscription automatique.')}

      {toggle('Autoriser les demandes d\'ami', profile.acceptsFriendRequests, (v) => set('acceptsFriendRequests', v),
        'Ce réglage ne concerne que les amitiés — la messagerie privée se règle séparément ci-dessous.')}

      {toggle('Recevoir des messages privés', profile.acceptsDirectMessages, (v) => set('acceptsDirectMessages', v),
        'Vos amis confirmés peuvent toujours vous écrire, même désactivé.')}
    </section>
  );
}
