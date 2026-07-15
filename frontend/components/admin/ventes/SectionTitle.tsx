'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon, IconName } from '@/components/ui/Icon';

/** En-tête de carte de la page Ventes & journée : tuile icône teintée + titre
 *  (convention TournamentsAlaUne : teintes 26/40 selon le thème). */
export function SectionTitle({ icon, accent, children, right }: {
  icon: IconName;
  accent: string;
  children: ReactNode;
  /** Contenu calé à droite (segmented de filtres, pastille compteur…). */
  right?: ReactNode;
}) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12, flexWrap: 'wrap' }}>
      <span aria-hidden="true" style={{
        width: 28, height: 28, borderRadius: 9, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: th.mode === 'floodlit' ? `${accent}26` : `${accent}40`,
      }}>
        <Icon name={icon} size={15} color={th.mode === 'floodlit' ? accent : th.ink} />
      </span>
      <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 14, color: th.text }}>{children}</span>
      <span style={{ flex: 1 }} />
      {right}
    </div>
  );
}
