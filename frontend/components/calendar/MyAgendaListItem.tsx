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
export function MyAgendaListItem({ item, now, localSlug, token, onCancel, onPlayersChanged }: {
  item: AgendaListItem;
  now: number;
  localSlug: string | null;
  token: string | null;
  onCancel: (r: MyReservation) => void;
  onPlayersChanged: () => void;
}) {
  const { th } = useTheme();
  const color = agendaKindMeta(item.kind).color;
  const itemSlug = agendaItemClubSlug(item);
  const isForeign = localSlug != null && itemSlug !== localSlug;
  const tz = item.kind === 'reservation' ? item.r.resource.club.timezone
    : item.kind === 'tournament' ? item.reg.tournament.club.timezone
    : item.ev.event.club.timezone;

  const foreignHref = item.kind === 'reservation' ? clubUrl(itemSlug, '/me/reservations')
    : item.kind === 'tournament' ? clubUrl(itemSlug, `/tournois/${item.reg.tournament.id}`)
    : clubUrl(itemSlug, `/events/${item.ev.event.id}`);

  const title = { fontFamily: th.fontUI, fontWeight: 700, fontSize: 16, color: th.text } as const;
  const subtitle = { fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 3 } as const;
  const metaRow = { display: 'flex', alignItems: 'center', gap: 12, marginTop: 9, fontFamily: th.fontUI, fontSize: 13, color: th.textMute } as const;
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
    const canCancel = isCancellationOpen(r, now);
    body = (
      <>
        <div style={headRow}>
          <span style={title}>{r.resource.name}</span>
          <Chip tone={r.status === 'CONFIRMED' ? 'accent' : 'line'}>{STATUS_LABEL[r.status]}</Chip>
        </div>
        <div style={subtitle}>{r.resource.club.name}</div>
        <div style={metaRow}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="clock" size={14} color={th.textMute} />{fmtHour(r.startTime, tz)}–{fmtHour(r.endTime, tz)}</span>
          <span style={{ fontFamily: th.fontMono }}>{Number(r.totalPrice)}€</span>
          {isForeign ? goHint : (!item.past && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button onClick={() => onCancel(r)} disabled={!canCancel} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: canCancel ? 'pointer' : 'not-allowed', borderRadius: 9, padding: '5px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: canCancel ? '#ff7a4d' : th.textFaint }}>Annuler</button>
            </span>
          ))}
        </div>
        {!isForeign && !item.past && token ? (
          <ReservationPlayersInline reservation={r} token={token} now={now} onChanged={onPlayersChanged} />
        ) : (r.participants?.length ?? 0) > 0 ? (
          <div style={{ marginTop: 9 }}>
            <PlayerPills
              players={r.participants ?? []}
              spotsLeft={Math.max(0, (r.capacity ?? 0) - (r.participants?.length ?? 0))}
              size="sm"
            />
          </div>
        ) : null}
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
        <div style={subtitle}>{t.category} · {GENDER_LABEL[t.gender] ?? t.gender} · {t.club.name}</div>
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
        <div style={subtitle}>{KIND_LABEL[ev.kind]} · {ev.club.name}</div>
        <div style={metaRow}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="calendar" size={14} color={th.textMute} />{fmtDate(ev.startTime, tz)}{ev.endTime && ` – ${fmtDate(ev.endTime, tz)}`} · {fmtHour(ev.startTime, tz)}</span>
          {isForeign ? goHint : <a href={clubUrl(ev.club.slug, `/events/${ev.id}`)} style={linkStyle}>Voir</a>}
        </div>
      </>
    );
  }

  const cardStyle = { background: th.surface, borderRadius: 20, padding: 16, boxShadow: `inset 0 0 0 1px ${th.line}`, display: 'flex', gap: 12, opacity: item.past ? 0.7 : 1 } as const;
  const inner = (
    <>
      <div style={{ width: 4, borderRadius: 2, background: color, flexShrink: 0, alignSelf: 'stretch' }} />
      <div style={{ width: 52, flexShrink: 0, textAlign: 'center', borderRight: `1px solid ${th.line}`, paddingRight: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, lineHeight: 1, color: th.text }}>{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', timeZone: tz }).format(new Date(item.start))}</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: th.textMute, marginTop: 3 }}>{new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: tz }).format(new Date(item.start)).replace('.', '')}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
    </>
  );

  return isForeign
    ? <a href={foreignHref} style={{ ...cardStyle, textDecoration: 'none', color: 'inherit' }}>{inner}</a>
    : <div style={cardStyle}>{inner}</div>;
}
