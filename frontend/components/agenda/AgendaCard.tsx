'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { CardStripe } from '@/components/ui/atoms';
import { cardStyle } from '@/components/clubhouse/SectionHeader';
import { AgendaCardHeader, AgendaCardHeaderProps } from '@/components/agenda/AgendaCardHeader';

export interface AgendaCardProps extends AgendaCardHeaderProps {
  deadline: string;            // ISO — compte à rebours avant clôture (toujours fourni ici)
  onClick: () => void;
}

// Carte d'event commune « liseré éditorial » (spec 2026-07-24) : ombre douce (cardStyle),
// liseré latéral teinté par type (CardStripe), lift au survol. Le corps visuel vit dans
// AgendaCardHeader, partagé avec les cartes dépliables (Arbitrage, Mes cours) qui ne
// peuvent pas être un <button>.
export function AgendaCard({ onClick, ...header }: AgendaCardProps) {
  const { th } = useTheme();

  return (
    <button onClick={onClick} className="pl-lift" style={{
      border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
      position: 'relative', overflow: 'hidden',
      ...cardStyle(th), padding: '13px 16px 13px 19px',
      display: 'flex', alignItems: 'stretch', gap: 13,
    }}>
      <CardStripe color={header.accent} />
      <AgendaCardHeader {...header} />
    </button>
  );
}
