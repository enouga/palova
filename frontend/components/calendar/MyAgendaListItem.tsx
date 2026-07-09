'use client';

import { useTheme } from '@/lib/ThemeProvider';
import { Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { AgendaListItem, agendaKindMeta, agendaItemClubSlug, STATUS_LABEL, REG_LABEL, GENDER_LABEL } from '@/lib/calendar';
import { MyReservation } from '@/lib/api';
import { isCancellationOpen } from '@/lib/reservations';
import { clubUrl } from '@/lib/clubUrl';
import { KIND_LABEL } from '@/lib/events';
import { PlayerPills } from '@/components/player/PlayerPills';
import { ReservationPlayersInline } from '@/components/reservations/ReservationPlayersInline';
import { MatchTeams } from '@/components/match/MatchTeams';
import { ReservationAgendaCard } from '@/components/reservations/ReservationAgendaCard';

function fmtHour(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}
function fmtDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}

/**
 * Un item de la liste « Mes réservations » : réservation, tournoi ou event, barre de couleur par type.
 * `localSlug` = club courant (sous-domaine), ou null sur la plateforme. Une entrée d'un AUTRE club
 * (« étrangère ») devient une carte-lien qui renvoie vers l'app de ce club, sans actions inline.
 */
export function MyAgendaListItem({ item, now, localSlug, token, onCancel, onPlayersChanged, onOpenChat, onRecordResult, canRecord, existingMatchStatus, showSport }: {
  item: AgendaListItem;
  now: number;
  localSlug: string | null;
  token: string | null;
  onCancel: (r: MyReservation) => void;
  onPlayersChanged: () => void;
  onOpenChat: (r: MyReservation) => void;
  onRecordResult?: (r: MyReservation) => void;
  canRecord?: (r: MyReservation) => boolean;
  existingMatchStatus?: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'CANCELLED';
  showSport?: boolean; // vue cross-club couvrant plusieurs sports → préfixe le sport au sous-titre
}) {
  const { th } = useTheme();
  // Préfixe « Sport · » sur le sous-titre quand la vue couvre plusieurs sports.
  const sportName = !showSport ? null
    : item.kind === 'reservation' ? item.r.resource.sport?.name ?? null
    : item.kind === 'tournament' ? item.reg.tournament.sport?.name ?? null
    : item.kind === 'event' ? item.ev.event.sport?.name ?? null
    : item.enrollment.lesson.sport?.name ?? null;
  const sportPrefix = sportName ? `${sportName} · ` : '';
  const color = agendaKindMeta(item.kind).color;
  const itemSlug = agendaItemClubSlug(item);
  // Les cours (lesson) n'ont pas de slug de club — jamais « étrangers ».
  const isForeign = item.kind !== 'lesson' && localSlug != null && itemSlug !== localSlug;
  const tz = item.kind === 'reservation' ? item.r.resource.club.timezone
    : item.kind === 'tournament' ? item.reg.tournament.club.timezone
    : item.kind === 'lesson' ? item.enrollment.lesson.club.timezone
    : item.ev.event.club.timezone;

  const foreignHref = item.kind === 'reservation' ? clubUrl(itemSlug, '/me/reservations')
    : item.kind === 'tournament' ? clubUrl(itemSlug, `/tournois/${item.reg.tournament.id}`)
    : item.kind === 'lesson' ? `/cours/${item.enrollment.lesson.id}`
    : clubUrl(itemSlug, `/events/${item.ev.event.id}`);

  const title = { fontFamily: th.fontUI, fontWeight: 700, fontSize: 16, color: th.text } as const;
  const subtitle = { fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 3 } as const;
  const metaRow = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 9, fontFamily: th.fontUI, fontSize: 13, color: th.textMute } as const;
  const headRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } as const;
  const linkStyle = { marginLeft: 'auto', textDecoration: 'none', borderRadius: 9, padding: '6px 12px', background: th.ink, color: th.mode === 'floodlit' ? th.text : '#f7f5ee', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' } as const;
  const goHint = (
    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute }}>
      Voir<Icon name="chevR" size={14} color={th.textMute} />
    </span>
  );

  let body: React.ReactNode;
  if (item.kind === 'reservation') {
    const r = item.r;
    const isPadel = r.resource.sport?.key === 'padel';
    if (!isForeign && isPadel) {
      body = (
        <ReservationAgendaCard
          reservation={r} past={item.past} showSport={showSport} showDate token={token} now={now}
          onCancel={onCancel} onPlayersChanged={onPlayersChanged} onOpenChat={onOpenChat}
          onRecordResult={onRecordResult} canRecord={canRecord} existingMatchStatus={existingMatchStatus}
        />
      );
    } else {
      const canCancel = isCancellationOpen(r, now);
      const showRecord = item.past && !isForeign && canRecord?.(r) && !existingMatchStatus;
      const MATCH_STATUS_LABEL: Record<string, string> = { PENDING: 'À confirmer', CONFIRMED: 'Résultat enregistré', DISPUTED: 'En litige' };
      body = (
        <>
          <div style={headRow}>
            <span style={title}>{r.resource.name}</span>
            <Chip tone={r.status === 'CONFIRMED' ? 'accent' : 'line'}>{STATUS_LABEL[r.status]}</Chip>
          </div>
          <div style={subtitle}>{sportPrefix}{r.resource.club.name}</div>
          <div style={metaRow}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="calendar" size={14} color={th.textMute} />{fmtDate(r.startTime, tz)} · {fmtHour(r.startTime, tz)}–{fmtHour(r.endTime, tz)}</span>
            <span style={{ fontFamily: th.fontMono }}>{Number(r.totalPrice)}€</span>
            {isForeign ? goHint : (!item.past && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button onClick={() => onCancel(r)} disabled={!canCancel} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: canCancel ? 'pointer' : 'not-allowed', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: canCancel ? '#ff7a4d' : th.textFaint }}>Annuler</button>
              </span>
            ))}
          </div>
          {showRecord && onRecordResult && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => onRecordResult(r)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>Saisir le résultat</button>
            </div>
          )}
          {item.past && !isForeign && existingMatchStatus && MATCH_STATUS_LABEL[existingMatchStatus] && (
            <div style={{ marginTop: 8, fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>{MATCH_STATUS_LABEL[existingMatchStatus]}</div>
          )}
          {!isForeign && !item.past && token ? (
            <ReservationPlayersInline reservation={r} token={token} now={now} onChanged={onPlayersChanged} />
          ) : (r.participants?.length ?? 0) > 0 ? (
            <div style={{ marginTop: 9 }}>
              {r.resource.sport?.key === 'padel' ? (
                <MatchTeams
                  players={(r.participants ?? []).map((p) => ({
                    userId: p.userId, firstName: p.firstName, lastName: p.lastName,
                    avatarUrl: p.avatarUrl, isOrganizer: p.isOrganizer, level: p.level,
                    team: (p.team ?? 1) as 1 | 2,
                    slot: p.slot,
                  }))}
                  capacity={r.capacity ?? 4}
                  size="sm"
                />
              ) : (
                <PlayerPills
                  players={r.participants ?? []}
                  spotsLeft={Math.max(0, (r.capacity ?? 0) - (r.participants?.length ?? 0))}
                  size="sm"
                />
              )}
            </div>
          ) : null}
        </>
      );
    }
  } else if (item.kind === 'lesson') {
    const lesson = item.enrollment.lesson;
    const res = lesson.reservation;
    body = (
      <>
        <div style={headRow}>
          <span style={title}>Cours · {lesson.coach.name} · {res.resource.name}</span>
          <Chip color={color}>{item.enrollment.status === 'CONFIRMED' ? 'Inscrit' : item.enrollment.status}</Chip>
        </div>
        {sportName && <div style={subtitle}>{sportName}</div>}
        <div style={metaRow}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon name="calendar" size={14} color={th.textMute} />{fmtDate(res.startTime, tz)} · {fmtHour(res.startTime, tz)}–{fmtHour(res.endTime, tz)}
          </span>
          <a href={`/cours/${lesson.id}`} style={linkStyle}>Voir</a>
        </div>
      </>
    );
  } else if (item.kind === 'tournament') {
    const t = item.reg.tournament;
    body = (
      <>
        <div style={headRow}>
          <span style={title}>{t.name}</span>
          <Chip color={color}>{REG_LABEL[item.reg.status] ?? item.reg.status}</Chip>
        </div>
        <div style={subtitle}>{sportPrefix}{t.category} · {GENDER_LABEL[t.gender] ?? t.gender} · {t.club.name}</div>
        <div style={metaRow}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="calendar" size={14} color={th.textMute} />{fmtDate(t.startTime, tz)}{t.endTime && ` – ${fmtDate(t.endTime, tz)}`} · {fmtHour(t.startTime, tz)}</span>
          {isForeign ? goHint : <a href={clubUrl(t.club.slug, `/tournois/${t.id}`)} style={linkStyle}>Voir</a>}
        </div>
      </>
    );
  } else {
    const ev = item.ev.event;
    body = (
      <>
        <div style={headRow}>
          <span style={title}>{ev.name}</span>
          <Chip color={color}>{REG_LABEL[item.ev.status] ?? item.ev.status}</Chip>
        </div>
        <div style={subtitle}>{sportPrefix}{KIND_LABEL[ev.kind]} · {ev.club.name}</div>
        <div style={metaRow}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="calendar" size={14} color={th.textMute} />{fmtDate(ev.startTime, tz)}{ev.endTime && ` – ${fmtDate(ev.endTime, tz)}`} · {fmtHour(ev.startTime, tz)}</span>
          {isForeign ? goHint : <a href={clubUrl(ev.club.slug, `/events/${ev.id}`)} style={linkStyle}>Voir</a>}
        </div>
      </>
    );
  }

  // Même chrome que les cartes de Parties (OpenMatchCard) : pas de barre de couleur latérale.
  const cardStyle = { background: th.surface, borderRadius: 20, padding: 16, boxShadow: `inset 0 0 0 1px ${th.line}`, opacity: item.past ? 0.7 : 1 } as const;

  return isForeign
    ? <a href={foreignHref} style={{ ...cardStyle, textDecoration: 'none', color: 'inherit' }}>{body}</a>
    : <div style={cardStyle}>{body}</div>;
}
