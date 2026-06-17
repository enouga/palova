'use client';

import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Chip } from '@/components/ui/atoms';
import { MyQuotaStatus, QuotaCount } from '@/lib/api';

// Affiche le compteur de quotas du joueur (« Heures pleines · 3/5 cette semaine »).
// Composant PUR, source de vérité du look : le calcul vit côté backend
// (reservation.service.getMyQuotaStatus), partagé avec l'enforcement.
// Rien n'est rendu si le club n'a pas de quotas ou si la classe est illimitée (null).
export function QuotaStatus({ status }: { status: MyQuotaStatus | null | undefined }) {
  const { th } = useTheme();
  if (!status) return null;

  const suffix = status.model === 'WEEKLY' ? 'cette semaine' : 'à venir';
  const cells: Array<{ label: string; count: QuotaCount }> = [];
  if (status.peak) cells.push({ label: 'Heures pleines', count: status.peak });
  if (status.offPeak) cells.push({ label: 'Heures creuses', count: status.offPeak });
  if (cells.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {cells.map(({ label, count }) => {
        const full = count.used >= count.limit; // plafond atteint → alerte douce
        return (
          <Chip key={label} color={full ? ACCENTS.coral : undefined} tone="mute" icon="check">
            <span style={{ color: th.textMute, fontWeight: 600 }}>{label}</span>
            <span style={{ marginLeft: 4 }}>{count.used}/{count.limit}</span>
            <span style={{ color: th.textMute, marginLeft: 4, fontWeight: 500 }}>{suffix}</span>
          </Chip>
        );
      })}
    </div>
  );
}
