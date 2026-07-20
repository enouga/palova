'use client';
import { useRouter } from 'next/navigation';
import { ClubDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { OpenMatchActions } from '@/components/openmatch/useOpenMatchActions';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { OpenMatchChatSheet } from '@/components/openmatch/OpenMatchChatSheet';
import { AuthPromptDialog } from '@/components/openmatch/AuthPromptDialog';

// Les 4 modales d'une partie ouverte, partagées par la liste et la page détail.
export function OpenMatchModals({ club, token, viewerUserId, canModerate, actions: a, reload, authNextPath }: {
  club: ClubDetail; token: string | null; viewerUserId: string; canModerate: boolean;
  actions: OpenMatchActions; reload: () => Promise<void>; authNextPath: string;
}) {
  const router = useRouter();
  const { th } = useTheme();
  return (
    <>
      {a.recordingFor && token && (
        <MatchResultModal
          reservationId={a.recordingFor.id}
          players={a.recordingFor.players.map(({ userId, firstName, lastName, avatarUrl }) => ({ userId, firstName, lastName, avatarUrl }))}
          token={token}
          context={{ whenIso: a.recordingFor.startTime, tz: club.timezone, courtName: a.recordingFor.resourceName }}
          initialTeams={Object.fromEntries(a.recordingFor.players.filter((p) => p.team === 1 || p.team === 2).map((p) => [p.userId, p.team as 1 | 2]))}
          locked
          competitive={a.recordingFor.competitive ?? true}
          onClose={() => a.setRecordingFor(null)}
          onSaved={() => { a.setRecordingFor(null); reload(); }}
        />
      )}
      {a.joinWarning && (
        <ConfirmDialog
          title="Niveau hors fourchette"
          message="Cette partie est hors de ta fourchette de niveau. Rejoindre quand même ?"
          confirmLabel="Rejoindre quand même"
          cancelLabel="Annuler"
          busy={a.busyId === a.joinWarning.match.id}
          onConfirm={() => a.confirmJoin(a.joinWarning!)}
          onCancel={() => a.setJoinWarning(null)}
        />
      )}
      {a.chatting && token && (
        <OpenMatchChatSheet
          slug={club.slug} token={token} reservationId={a.chatting.id} viewerUserId={viewerUserId}
          viewerIsOrganizer={a.chatting.viewerIsOrganizer}
          canModerate={canModerate}
          title={`${a.chatting.resourceName} · ${new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: club.timezone }).format(new Date(a.chatting.startTime)).replace(':', 'h')}`}
          timezone={club.timezone}
          onClose={() => { a.setChatting(null); reload(); window.dispatchEvent(new Event('palova:openmatch-unread')); }}
        />
      )}
      {a.authPrompt && (
        <AuthPromptDialog
          detail={a.authPrompt.resourceName}
          onRegister={() => router.push(`/register?next=${authNextPath}`)}
          onLogin={() => router.push(`/login?next=${authNextPath}`)}
          onClose={() => a.setAuthPrompt(null)}
        />
      )}
      {/* Toast après avoir rejoint OU quitté une partie (snackbar fixe, auto-effacé ~4 s par le hook).
          Tappable pour le fermer tout de suite ; role=status pour l'annonce lecteur d'écran.
          Rejoint = ✓ émeraude (positif) ; quitté = ↩ neutre (pas un « succès » vert). */}
      {a.flash && (
        <div
          role="status"
          onClick={() => a.setFlash(null)}
          style={{
            position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 60,
            width: 'min(420px, calc(100vw - 32px))', boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            background: th.text, color: th.bg, borderRadius: 12, padding: '12px 16px',
            fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, boxShadow: th.shadow,
          }}
        >
          {a.flash.kind === 'joined'
            ? <span style={{ color: ACCENTS.emerald, fontSize: 16, fontWeight: 800 }}>✓</span>
            : <span style={{ color: th.bg, opacity: 0.7, fontSize: 15, fontWeight: 800 }}>↩</span>}
          <span style={{ flex: 1 }}>
            {a.flash.kind === 'joined' ? 'Vous avez rejoint la partie' : 'Vous avez quitté la partie'} · {a.flash.match.resourceName}
          </span>
        </div>
      )}
    </>
  );
}
