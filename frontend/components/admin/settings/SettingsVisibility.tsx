'use client';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { SettingsTabProps, useSettingsStyles } from './shared';

export function SettingsVisibility({ club, set }: SettingsTabProps) {
  const { card, h2, hint } = useSettingsStyles();
  return (
    <>
      <div style={card}>
        <h2 style={h2}>Visibilité</h2>
        <p style={hint}>Affiche votre club dans l&apos;annuaire public et la recherche. Décoché, votre club reste accessible par son adresse directe (sous-domaine) mais n&apos;apparaît pas dans l&apos;annuaire.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SwitchRow checked={club.listedInDirectory} onChange={(v) => set('listedInDirectory', v)} title="Afficher mon club dans l’annuaire public" />
          <SwitchRow checked={club.listTournamentsNationally} onChange={(v) => set('listTournamentsNationally', v)} title="Publier mes tournois dans le calendrier national Palova" />
          <SwitchRow checked={club.listOpenMatchesNationally ?? false} onChange={(v) => set('listOpenMatchesNationally', v)} title="Publier mes parties ouvertes sur palova.fr" />
          <SwitchRow checked={club.showOffersPublicly} onChange={(v) => set('showOffersPublicly', v)} title="Afficher mes formules (abonnements & carnets) sur le Club-house" />
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>Système de niveau de joueur</h2>
        <p style={hint}>Active le classement par niveau (Glicko-2), la saisie des résultats de matchs, le leaderboard et le matchmaking par niveau. Décoché, ces fonctionnalités et le menu « Matchs » sont masqués.</p>
        <SwitchRow checked={club.levelSystemEnabled} onChange={(v) => set('levelSystemEnabled', v)} title="Activer le système de niveau de joueur" />
      </div>

      <div style={card}>
        <h2 style={h2}>Page « Mes réservations »</h2>
        <p style={hint}>Par défaut, vos joueurs ne voient ici que les réservations, tournois et events de <strong>votre club</strong>. Activez pour leur afficher aussi ceux des autres clubs dont ils sont membres.</p>
        <SwitchRow checked={club.showOtherClubsReservations} onChange={(v) => set('showOtherClubsReservations', v)} title="Afficher aussi les réservations des autres clubs" />
      </div>
    </>
  );
}
