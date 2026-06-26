'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, NationalTournament } from '@/lib/api';
import { clubUrl, platformUrl } from '@/lib/clubUrl';
import { ACCENTS } from '@/lib/theme';
import { AgendaCard } from '@/components/agenda/AgendaCard';
import { tournamentPlacesLabel } from '@/lib/clubhouse';
import { fillRatio, formatDateTimeRange } from '@/lib/tournament';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };
const MAX = 4;

// Aperçu des prochains tournois nationaux sur la vitrine visiteur. Vide → rien rendu.
export function UpcomingTournaments() {
  const { th } = useTheme();
  const [items, setItems] = useState<NationalTournament[] | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => { api.listNationalTournaments().then(setItems).catch(() => setItems([])); }, []);
  useEffect(() => { const t = setTimeout(() => setNow(new Date()), 0); return () => clearTimeout(t); }, []);

  if (!items || items.length === 0) return null; // déjà trié par date côté backend

  const top = items.slice(0, MAX);
  return (
    <>
      <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, padding: '30px 20px 0' }}>
        📅 Prochains tournois
      </div>
      <div style={{ padding: '12px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {top.map((t) => (
          <AgendaCard
            key={t.id}
            icon="trophy"
            accent={ACCENTS.apricot}
            tag={`${t.category} · ${GENDER_LABEL[t.gender]}`}
            title={t.name}
            subtitle={[t.club.name, t.club.city].filter(Boolean).join(' · ')}
            dateLabel={formatDateTimeRange(t.startTime, t.endTime, t.club.timezone)}
            deadline={t.registrationDeadline}
            now={now}
            ratio={fillRatio(t)}
            places={tournamentPlacesLabel(t)}
            extra={t.entryFee ? `${t.entryFee} €` : null}
            onClick={() => { window.location.href = clubUrl(t.club.slug, `/tournois/${t.id}`); }}
          />
        ))}
        <a href={platformUrl('/tournois')} style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text, textDecoration: 'none', marginTop: 2 }}>
          Voir tout le calendrier →
        </a>
      </div>
    </>
  );
}
