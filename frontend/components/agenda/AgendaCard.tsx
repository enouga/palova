'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { AgendaCardHeader, AgendaCardHeaderProps } from '@/components/agenda/AgendaCardHeader';

export interface AgendaCardProps extends AgendaCardHeaderProps {
  deadline: string;            // ISO — compte à rebours avant clôture (toujours fourni ici)
  onClick: () => void;
}

// Carte de la liste Events : tuile icône teintée, infos, countdown, jauge de remplissage.
// Le corps visuel vit dans AgendaCardHeader, partagé avec les cartes dépliables
// (Arbitrage, Mes cours) qui ne peuvent pas être un <button>.
export function AgendaCard({ onClick, ...header }: AgendaCardProps) {
  const { th } = useTheme();

  return (
    <button onClick={onClick} style={{
      border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
      background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}`,
      display: 'flex', alignItems: 'flex-start', gap: 13,
    }}>
      <AgendaCardHeader {...header} />
      <Icon name="chevR" size={17} color={th.textFaint} style={{ alignSelf: 'center' }} />
    </button>
  );
}
