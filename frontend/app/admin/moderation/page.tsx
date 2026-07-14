'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, MessageReportRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const REASON_LABEL: Record<string, string> = { HARASSMENT: 'Harcèlement', ILLEGAL: 'Contenu illicite', SPAM: 'Spam', OTHER: 'Autre' };

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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

      {actionError && (
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: '#e0554f', marginBottom: 14 }}>{actionError}</div>
      )}

      {loading ? (
        <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Chargement…</div>
      ) : loadError ? (
        <div style={{ fontFamily: th.fontUI, color: '#e0554f' }}>{loadError}</div>
      ) : items.length === 0 ? (
        <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun signalement.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {open.map((r) => (
            <div key={r.id} style={{ background: th.bgElev, borderRadius: 14, padding: 16, boxShadow: th.shadow }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.accent }}>{REASON_LABEL[r.reason]}</div>
              <div style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.text, marginTop: 6 }}>{r.message.body}</div>
              <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 8 }}>
                {r.message.author.firstName} {r.message.author.lastName} · {r.match?.resourceName} · {r.match && fmt(r.match.startTime)}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, marginTop: 4 }}>
                Signalé par {r.reporter.firstName} {r.reporter.lastName} le {fmt(r.createdAt)}
                {r.detail ? ` — « ${r.detail} »` : ''}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <Btn variant="danger" onClick={() => setConfirmDelete(r)} disabled={busy === r.id}>Supprimer le message</Btn>
                <Btn variant="surface" onClick={() => resolve(r, 'REJECT')} disabled={busy === r.id}>Rejeter</Btn>
              </div>
            </div>
          ))}
          {resolved.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, cursor: 'pointer' }}>
                Historique ({resolved.length})
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {resolved.map((r) => (
                  <div key={r.id} style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, padding: '8px 0', borderTop: `1px solid ${th.line}` }}>
                    {REASON_LABEL[r.reason]} · {r.resolution === 'DELETED' ? 'Supprimé' : 'Rejeté'} · {r.resolvedAt && fmt(r.resolvedAt)}
                  </div>
                ))}
              </div>
            </details>
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
