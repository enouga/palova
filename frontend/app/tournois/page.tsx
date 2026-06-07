'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { api, Tournament } from '@/lib/api';
import { Screen } from '@/components/ui/Screen';
import { Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { ClubNav } from '@/components/ClubNav';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

function formatDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date(iso));
}

export default function TournoisPage() {
  const { club, loading } = useClub();
  const { th } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<Tournament[] | null>(null);

  useEffect(() => {
    if (!club) return;
    api.getClubTournaments(club.slug).then(setItems).catch(() => setItems([]));
  }, [club?.slug]);

  if (loading || !club) {
    return <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>Chargement…</div>;
  }

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />

        <div style={{ padding: '18px 20px 0' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, color: th.text, letterSpacing: -0.5 }}>Tournois</div>
          <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 4 }}>{club.name}</div>
        </div>

        <div style={{ padding: '22px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items === null && <div style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>}
          {items?.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun tournoi à venir pour le moment.</div>}
          {items?.map((t) => {
            const full = t.maxTeams != null && t.confirmedCount >= t.maxTeams;
            const closed = new Date(t.registrationDeadline) <= new Date();
            return (
              <button key={t.id} onClick={() => router.push(`/tournois/${t.id}`)} style={{ border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Chip tone="accent">{t.category}</Chip>
                  <Chip>{GENDER_LABEL[t.gender]}</Chip>
                  {closed ? <Chip>Inscriptions closes</Chip> : full ? <Chip>Complet · liste d&apos;attente</Chip> : null}
                </div>
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 19, color: th.text, marginTop: 10 }}>{t.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 6 }}>
                  <Icon name="calendar" size={14} color={th.textMute} />{formatDate(t.startTime, club.timezone)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 4 }}>
                  <Icon name="users" size={14} color={th.textMute} />
                  {t.maxTeams != null ? `${t.confirmedCount}/${t.maxTeams} binômes` : `${t.confirmedCount} binômes`}
                  {t.waitlistCount > 0 ? ` · ${t.waitlistCount} en attente` : ''}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}
