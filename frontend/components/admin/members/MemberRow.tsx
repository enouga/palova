'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Member } from '@/lib/api';
import { Theme } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { STAFF_LABEL, daysSince } from '@/lib/members';
import { lastVisitLabel } from '@/lib/memberStats';
import { daysUntil } from '@/lib/subscriptionAdmin';

export type SubActionKind = 'renew' | 'change' | 'cancel';
const fdate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');
const subActionBtn = (th: Theme, danger: boolean): React.CSSProperties => ({
  border: `1px solid ${danger ? '#f0b8a4' : th.lineStrong}`, background: th.surface,
  color: danger ? '#ff7a4d' : th.textMute, borderRadius: 999, padding: '5px 11px',
  fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});

// Une rangée-carte de la liste des membres. Un clic (n'importe où) ouvre le panneau d'édition ;
// le nom reste un lien distinct vers la fiche « passif » (stopPropagation).
export function MemberRow({ m, selected, nowMs, onOpen, onNavigate, subscriptionContext, onSubAction }: {
  m: Member;
  selected: boolean;
  nowMs: number;
  onOpen: () => void;
  onNavigate: () => void;
  /** En contexte abonnés : la ligne porte échéance + Renouveler/Changer/Résilier. */
  subscriptionContext?: boolean;
  onSubAction?: (kind: SubActionKind, m: Member) => void;
}) {
  const { th } = useTheme();
  const blocked = m.status === 'BLOCKED';
  const seen = lastVisitLabel(daysSince(m.lastSeenAt, nowMs));
  const contact = [m.email, m.phone, m.membershipNo ? `n° ${m.membershipNo}` : null].filter(Boolean).join(' · ');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Ouvrir la fiche de ${m.firstName} ${m.lastName}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="pl-lift"
      style={{
        // Même langage graphique que le registre /admin/abonnes : carte à ombre douce,
        // coin 12, liseré latéral d'accent pour les abonnés.
        display: 'flex', alignItems: 'center', gap: 13, padding: '11px 14px', borderRadius: 12,
        background: th.surface, cursor: 'pointer', opacity: blocked ? 0.6 : 1,
        borderLeft: `3px solid ${(m.isSubscriber || m.hasActiveSubscription) ? th.accent : 'transparent'}`,
        boxShadow: selected ? `0 0 0 2px ${th.accent}, ${th.shadow}` : th.shadow,
        fontFamily: th.fontUI, flexWrap: subscriptionContext ? 'wrap' : undefined,
      }}
    >
      <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={m.avatarUrl ?? null} size={42} color={colorForSeed(m.userId)} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          <span
            role="link"
            tabIndex={0}
            aria-label={`Voir le passif de ${m.firstName} ${m.lastName}`}
            onClick={(e) => { e.stopPropagation(); onNavigate(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onNavigate(); } }}
            style={{ fontSize: 15, fontWeight: 700, color: th.text, cursor: 'pointer' }}
          >
            {m.firstName} {m.lastName}
          </span>
          {m.watch && <span title="À surveiller" style={{ fontSize: 13 }}>👁</span>}
          {m.staffRole && <Chip tone="accent">{STAFF_LABEL[m.staffRole]}</Chip>}
          {m.isCoach && <Chip tone="line">Coach</Chip>}
          {(m.isSubscriber || m.hasActiveSubscription) && (
            // Chip abonné rendu inline (pas via <Chip>) pour tronquer un nom de formule long :
            // le nom de formule est libre → sans borne il déborde et crée un scroll horizontal en mobile.
            <span style={{
              display: 'inline-flex', alignItems: 'center', minWidth: 0, maxWidth: '100%',
              fontFamily: th.fontUI, fontWeight: 600, fontSize: 12.5, letterSpacing: 0.2, borderRadius: 8, padding: '5px 10px',
              color: th.mode === 'floodlit' ? th.accentWarm : th.ink,
              background: th.mode === 'floodlit' ? `${th.accentWarm}1f` : `${th.accentWarm}55`,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.subscriptionPlan ? `Abonné · ${m.subscriptionPlan}` : 'Abonné'}
              </span>
            </span>
          )}
          {m.hasActivePackage && <Chip tone="line">Carnet</Chip>}
          {blocked && <Chip tone="line">Bloqué</Chip>}
        </div>
        <div style={{ fontSize: 12.5, color: th.textMute, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {contact || '—'}
        </div>
      </div>

      {subscriptionContext && m.subscription ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {(() => {
            const days = daysUntil(m.subscription.expiresAt, nowMs);
            const soon = days <= 30;
            return (
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px', background: soon ? '#fdeee2' : '#e3f0e6', color: soon ? '#b45309' : '#2c7a44' }}>
                  {soon ? `Expire dans ${days} j` : 'Actif'}
                </span>
                <div style={{ fontSize: 11, color: th.textFaint, marginTop: 3 }}>échéance {fdate(m.subscription.expiresAt)}</div>
              </div>
            );
          })()}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); onSubAction?.('renew', m); }} style={subActionBtn(th, false)}>Renouveler</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onSubAction?.('change', m); }} style={subActionBtn(th, false)}>Changer</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onSubAction?.('cancel', m); }} style={subActionBtn(th, true)}>Résilier</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <LevelChip level={m.level} />
          {seen && <span style={{ fontSize: 12, color: th.textFaint, whiteSpace: 'nowrap' }}>{seen}</span>}
          <Icon name="chevR" size={18} color={th.textFaint} />
        </div>
      )}
    </div>
  );
}
