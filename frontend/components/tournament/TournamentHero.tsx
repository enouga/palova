'use client';
import { TournamentDetail } from '@/lib/api';
import { fillRatio, formatDateShortTimeRange, formatDateTimeShort, heroPlacesLabel } from '@/lib/tournament';
import { AgendaHero, MetaCardsRow, MetaCard } from '@/components/agenda/AgendaHero';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

// Hero de la fiche tournoi : habillage tournoi au-dessus du AgendaHero partagé.
// `multiSport` (club à ≥2 sports) → pill sport en tête.
export function TournamentHero({ t, now, multiSport = false }: { t: TournamentDetail; now: Date | null; multiSport?: boolean }) {
  return (
    <AgendaHero
      pills={[
        ...(multiSport ? [{ label: t.clubSport.sport.name }] : []),
        { label: t.category, strong: true },
        { label: GENDER_LABEL[t.gender] ?? t.gender },
        ...(t.gender === 'MEN' && t.openToWomen ? [{ label: 'Ouvert aux femmes' }] : []),
      ]}
      title={t.name}
      subtitle={t.club.name}
      deadline={t.registrationDeadline}
      now={now}
      ratio={fillRatio(t)}
      counter={
        (t.maxTeams != null ? `${t.confirmedCount}/${t.maxTeams} binômes` : `${t.confirmedCount} binôme${t.confirmedCount > 1 ? 's' : ''}`)
        + (t.waitlistCount > 0 ? ` · ${t.waitlistCount} en attente` : '')
      }
      places={heroPlacesLabel(t.confirmedCount, t.maxTeams)}
    />
  );
}

// Cartes méta de la fiche tournoi : début, clôture, prix par binôme, juge-arbitre.
export function MetaCards({ t }: { t: TournamentDetail }) {
  const tz = t.club.timezone;
  const cards: MetaCard[] = [
    { icon: 'calendar', label: t.endTime ? 'Horaire' : 'Début', value: formatDateShortTimeRange(t.startTime, t.endTime, tz) },
    { icon: 'clock', label: 'Clôture', value: formatDateTimeShort(t.registrationDeadline, tz) },
    ...(t.entryFee ? [{ icon: 'euro', label: 'Inscription', value: `${t.entryFee} € / binôme` } as MetaCard] : []),
    // Nom seul : le J/A répond du tournoi, mais ses coordonnées restent l'affaire de `contactInfo`.
    ...(t.referee ? [{ icon: 'whistle', label: 'Juge-arbitre', value: t.referee.name } as MetaCard] : []),
  ];
  return <MetaCardsRow cards={cards} />;
}
