'use client';
import { ReactNode, useState, useEffect, useCallback } from 'react';
import { api, MessageReportRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, dangerBanner } from '@/lib/theme';
import { Btn } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const REASON_LABEL: Record<string, string> = { HARASSMENT: 'Harcèlement', ILLEGAL: 'Contenu illicite', SPAM: 'Spam', OTHER: 'Autre' };

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// En-tête de section : point coloré + label + compteur (convention AgendaAdminList).
function SectionHead({ color, label, count }: { color: string; label: string; count: number }) {
  const { th } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 2px 10px' }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: color }} />
      <b style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: th.text }}>{label}</b>
      <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textFaint }}>· {count}</span>
    </div>
  );
}

// Carte d'un signalement : liseré statut, tuile drapeau, message signalé en bloc
// citation, auteur avec pastille colorée, ligne signaleur, actions (ouvert seulement).
function ReportCard({ r, actions }: { r: MessageReportRow; actions?: ReactNode }) {
  const { th } = useTheme();
  const resolved = r.status === 'RESOLVED';
  const coralInk = th.danger;
  const stripe = resolved ? th.textFaint : ACCENTS.coral;
  const authorLine = [
    `${r.message.author.firstName} ${r.message.author.lastName}`,
    r.match?.resourceName,
    r.match ? fmt(r.match.startTime) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{
      position: 'relative', overflow: 'hidden', background: th.surface, borderRadius: 16,
      boxShadow: th.shadow, padding: '15px 16px 15px 21px', opacity: resolved ? 0.72 : 1,
    }}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: stripe }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
        <span aria-hidden style={{
          flex: 'none', width: 44, height: 44, marginTop: 2, borderRadius: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: th.mode === 'floodlit' ? `${ACCENTS.coral}24` : `${ACCENTS.coral}40`,
        }}>
          <Icon name="flag" size={20} color={th.mode === 'floodlit' ? ACCENTS.coral : th.ink} />
        </span>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.5,
              textTransform: 'uppercase', color: resolved ? th.textMute : coralInk,
            }}>{REASON_LABEL[r.reason]}</span>
            <span style={{ flex: 1 }} />
            {resolved && (
              <>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '3px 9px',
                  fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
                  background: r.resolution === 'DELETED' ? `${th.accent}22` : `${th.textFaint}22`,
                  color: r.resolution === 'DELETED' ? th.accent : th.textFaint,
                }}>{r.resolution === 'DELETED' ? 'Supprimé' : 'Rejeté'}</span>
                {r.resolvedAt && (
                  <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, whiteSpace: 'nowrap' }}>{fmt(r.resolvedAt)}</span>
                )}
              </>
            )}
          </div>

          <div style={{
            background: th.surface2, borderRadius: 10, padding: '9px 12px',
            boxShadow: `inset 0 0 0 1px ${th.line}`, fontFamily: th.fontUI, fontSize: 14.5,
            color: th.text, lineHeight: 1.45, overflowWrap: 'anywhere',
          }}>
            {r.message.body || <i style={{ color: th.textFaint }}>Message supprimé</i>}
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
            <Avatar firstName={r.message.author.firstName} lastName={r.message.author.lastName} avatarUrl={null} size={20} color={colorForSeed(r.message.author.id)} />
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, minWidth: 0, alignSelf: 'center' }}>{authorLine}</span>
          </div>

          <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>
            Signalé par {r.reporter.firstName} {r.reporter.lastName} le {fmt(r.createdAt)}
            {r.detail ? <> — <i>« {r.detail} »</i></> : null}
          </div>

          {actions && <div style={{ display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>{actions}</div>}
        </div>
      </div>
    </div>
  );
}

export default function AdminModerationPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;

  const [items, setItems] = useState<MessageReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MessageReportRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true); setLoadError(null);
    try { setItems((await api.adminListReports(clubId, token)).items); }
    catch (err) {
      setLoadError((err as Error).message === 'FORBIDDEN'
        ? 'Cette page est réservée aux administrateurs du club.'
        : 'Impossible de charger les signalements. Réessayez.');
    }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const resolve = async (report: MessageReportRow, action: 'DELETE' | 'REJECT') => {
    if (!token || !clubId) return;
    setBusy(report.id); setActionError(null);
    try {
      const updated = await api.adminResolveReport(clubId, report.id, action, token);
      setItems((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch {
      setActionError('Échec de l\'action, réessayez.');
    } finally { setBusy(null); setConfirmDelete(null); }
  };

  const open = items.filter((r) => r.status === 'OPEN');
  const resolved = items.filter((r) => r.status === 'RESOLVED');

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontSize: 26, color: th.text, marginBottom: 4 }}>Signalements</h1>
      <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 20 }}>
        Messages du chat de partie signalés par les membres.
      </div>

      {actionError && <div style={{ ...dangerBanner(th), marginBottom: 14 }}>{actionError}</div>}

      {loading ? (
        <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Chargement…</div>
      ) : loadError ? (
        <div style={{ ...dangerBanner(th), marginBottom: 14 }}>{loadError}</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '46px 20px' }}>
          <span aria-hidden style={{
            width: 44, height: 44, borderRadius: 13, margin: '0 auto 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: th.mode === 'floodlit' ? `${ACCENTS.emerald}24` : `${ACCENTS.emerald}40`,
          }}>
            <Icon name="check" size={20} color={th.mode === 'floodlit' ? ACCENTS.emerald : th.ink} />
          </span>
          <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 800, color: th.text }}>Aucun signalement</div>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 4 }}>
            Les messages signalés par les membres apparaîtront ici.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {open.length > 0 && (
            <section>
              <SectionHead color={ACCENTS.coral} label="À traiter" count={open.length} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {open.map((r) => (
                  <ReportCard key={r.id} r={r} actions={
                    <>
                      <Btn variant="danger" onClick={() => setConfirmDelete(r)} disabled={busy === r.id}>Supprimer le message</Btn>
                      <Btn variant="surface" onClick={() => resolve(r, 'REJECT')} disabled={busy === r.id}>Rejeter</Btn>
                    </>
                  } />
                ))}
              </div>
            </section>
          )}

          {open.length === 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI,
              fontSize: 13, fontWeight: 600, color: th.successInk,
            }}>
              <Icon name="check" size={15} color={th.successInk} />
              Aucun signalement en attente.
            </div>
          )}

          {resolved.length > 0 && (
            <section>
              <SectionHead color={th.textFaint} label="Historique" count={resolved.length} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {resolved.map((r) => <ReportCard key={r.id} r={r} />)}
              </div>
            </section>
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Supprimer le message"
          message="Le message sera retiré du chat et le signalement clos."
          confirmLabel="Supprimer" cancelLabel="Annuler"
          busy={busy === confirmDelete.id}
          onConfirm={() => resolve(confirmDelete, 'DELETE')}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
