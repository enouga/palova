'use client';
import { OpenMatch } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { PartnerSearch } from '@/components/tournament/PartnerSearch';
import { PlayerPills, PlayerPillData } from '@/components/player/PlayerPills';
import { AddPlayerPill } from '@/components/player/AddPlayerPill';
import { rangeLabel } from '@/lib/levelMatch';

function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

export interface OpenMatchCardProps {
  match: OpenMatch;
  timezone: string;
  slug: string;
  token: string;
  busy: boolean;
  addingOpen: boolean;
  onJoin: (m: OpenMatch) => void;
  onLeave: (m: OpenMatch) => void;
  onRemovePlayer: (m: OpenMatch, p: PlayerPillData) => void;
  onAddPlayer: (m: OpenMatch, memberId: string) => void;
  onToggleAdd: (m: OpenMatch) => void;
  onCancelAdd: () => void;
  onRecordResult: (m: OpenMatch) => void;
  canRecordResult: boolean;
  onToggleInterest: (m: OpenMatch) => void;
  onOpenChat: (m: OpenMatch) => void;
  hasUnread: boolean;
  showSport?: boolean; // club multi-sport → chip sport près du terrain
}

// Carte d'une partie ouverte (terrain, créneau, fourchette, joueurs, actions).
// Extraite d'OpenMatches pour être réutilisée dans la section « Pour toi ».
export function OpenMatchCard({
  match: m, timezone, slug, token, busy, addingOpen,
  onJoin, onLeave, onRemovePlayer, onAddPlayer, onToggleAdd, onCancelAdd, onRecordResult, canRecordResult,
  onToggleInterest, onOpenChat, hasUnread, showSport,
}: OpenMatchCardProps) {
  const { th } = useTheme();
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Icon name="users" size={18} color={th.accent} />
        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{m.resourceName}</span>
        {showSport && m.sport && <Chip tone="line">{m.sport.name}</Chip>}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {(m.targetLevelMin != null || m.targetLevelMax != null) && (
            <Chip tone="line">{rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null)}</Chip>
          )}
          {m.interestedCount > 0 && (
            <Chip tone="line" icon="users">{m.interestedCount} intéressé{m.interestedCount > 1 ? 's' : ''}</Chip>
          )}
          <Chip tone={m.full ? 'mute' : 'accent'}>{m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}</Chip>
        </span>
      </div>
      <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 12 }}>
        {formatWhen(m.startTime, timezone)} → {formatWhen(m.endTime, timezone)}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PlayerPills
            players={m.players}
            spotsLeft={m.spotsLeft}
            onRemove={(p) => onRemovePlayer(m, p)}
            canRemove={(p) => m.viewerIsOrganizer && !p.isOrganizer}
            busy={busy}
            firstSpotSlot={m.viewerIsOrganizer ? (
              <AddPlayerPill disabled={busy} ariaLabel={`Ajouter un joueur à ${m.resourceName}`}
                onClick={() => onToggleAdd(m)} />
            ) : undefined}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          {m.viewerIsOrganizer ? (
            <Chip tone="line" icon="check">Vous organisez</Chip>
          ) : m.viewerIsParticipant ? (
            <Btn variant="surface" disabled={busy} onClick={() => onLeave(m)}>Quitter</Btn>
          ) : (
            <Btn icon="plus" disabled={busy || m.full} onClick={() => onJoin(m)}>Rejoindre</Btn>
          )}
          <Btn variant="surface" disabled={!(m.viewerIsParticipant || m.viewerIsInterested)} onClick={() => onOpenChat(m)}>
            Discuter{hasUnread ? ' •' : ''}
          </Btn>
          {!m.viewerIsParticipant && (
            <Btn variant={m.viewerIsInterested ? 'primary' : 'surface'} disabled={busy} onClick={() => onToggleInterest(m)}>
              {m.viewerIsInterested ? 'Intéressé ✓' : "Ça m'intéresse"}
            </Btn>
          )}
          {canRecordResult && new Date(m.endTime).getTime() <= Date.now() && m.players.length === 4 && (
            <Btn variant="surface" disabled={busy} onClick={() => onRecordResult(m)}>Saisir le résultat</Btn>
          )}
        </div>
      </div>
      {m.viewerIsOrganizer && addingOpen && (
        <div style={{ marginTop: 12 }}>
          <PartnerSearch
            slug={slug} token={token} selected={null}
            excludeIds={m.players.map((p) => p.userId)}
            onSelect={(member) => onAddPlayer(m, member.id)}
            onClear={() => {}}
            disabled={busy}
          />
          <button type="button" onClick={onCancelAdd} style={{ marginTop: 8, border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 }}>Annuler</button>
        </div>
      )}
    </div>
  );
}
