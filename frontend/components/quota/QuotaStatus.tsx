'use client';

import { StatPill } from '@/components/ui/StatPill';
import { IconName } from '@/components/ui/Icon';
import { useTheme } from '@/lib/ThemeProvider';
import { MyQuotaStatus, QuotaCount } from '@/lib/api';

// Affiche le compteur de quotas du joueur (« Heures pleines · 3/5 cette semaine »).
// Composant PUR, source de vérité du look : le calcul vit côté backend
// (reservation.service.getMyQuotaStatus), partagé avec l'enforcement.
// Rien n'est rendu si le club n'a pas de quotas ou si la classe est illimitée (null).
// `inline` : émet les pastilles sans conteneur (pour les fondre dans une rangée parente,
// ex. la rangée « soldes & quotas » de Réserver). Défaut : rangée flex autonome (BookingModal).
// `compact` : grille à colonnes égales (pleines / creuses sur UNE ligne dans un conteneur
// étroit), suffixe de période affiché une seule fois sous la rangée (BookingModal).
export function QuotaStatus(
  { status, inline = false, fill = false, compact = false }:
  { status: MyQuotaStatus | null | undefined; inline?: boolean; fill?: boolean; compact?: boolean },
) {
  const { th } = useTheme();
  if (!status) return null;

  const suffix = status.model === 'WEEKLY' ? 'cette semaine' : 'à venir';
  const cells: Array<{ label: string; icon: IconName; count: QuotaCount }> = [];
  if (status.peak) cells.push({ label: 'Heures pleines', icon: 'sun', count: status.peak });
  if (status.offPeak) cells.push({ label: 'Heures creuses', icon: 'moon', count: status.offPeak });
  if (cells.length === 0) return null;

  const pills = cells.map(({ label, icon, count }) => (
    <StatPill
      key={label}
      icon={icon}
      label={label}
      meter={{ used: count.used, limit: count.limit, suffix }}
      warn={count.used >= count.limit} // plafond atteint → alerte douce coral
      fill={fill}
      compact={compact}
    />
  ));

  // Compact : pastilles à largeur naturelle qui s'enroulent (2 côte à côte si ça tient,
  // sinon empilées) → jamais de débordement horizontal sur écran étroit (téléphone
  // réel plus étroit / grande police système), suffixe unique dessous.
  if (compact) {
    return (
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{pills}</div>
        <div style={{ marginTop: 6, textAlign: 'center', fontFamily: th.fontUI, fontSize: 11, fontWeight: 500, color: th.textFaint }}>{suffix}</div>
      </div>
    );
  }

  if (inline) return <>{pills}</>;
  return <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>{pills}</div>;
}
