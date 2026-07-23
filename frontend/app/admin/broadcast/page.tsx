'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, ClubBroadcastItem } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn, Segmented, Chip } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RichEmailEditor } from '@/components/admin/email/RichEmailEditor';
import { EmailPreview } from '@/components/admin/email/EmailPreview';
import {
  broadcastHasContent, hasAnyChannel, BroadcastChannels, EMAIL_BROADCAST_ENABLED,
  readPendingRecipients, BroadcastRecipient,
} from '@/lib/broadcast';
import { SwitchRow } from '@/components/ui/SwitchRow';

type BroadcastKind = 'INFO' | 'COMMERCIAL';
interface BroadcastAudience { total: number; email: number; inApp: number; excluded: number }

// `body` porte le HTML riche émis par l'éditeur (format stocké, sans variables).
const EMPTY_FORM = { title: '', body: '', url: '' };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminBroadcastPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;

  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [items, setItems] = useState<ClubBroadcastItem[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [previewHtml, setPreviewHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [channels, setChannels] = useState<BroadcastChannels>({ email: EMAIL_BROADCAST_ENABLED, inApp: true, push: true });
  const [recipients, setRecipients] = useState<BroadcastRecipient[] | null>(null);
  const [kind, setKind] = useState<BroadcastKind>('INFO');
  const [aud, setAud] = useState<BroadcastAudience | null>(null);

  // Sélection déposée depuis la page Membres (Task 6) : one-shot, ne re-cible jamais au refresh.
  useEffect(() => {
    const pending = readPendingRecipients();
    if (pending && pending.length) setRecipients(pending);
  }, []);

  const labelStyle: CSSProperties = {
    fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
    color: th.textMute, display: 'flex', flexDirection: 'column', gap: 6,
  };
  const inputStyle: CSSProperties = {
    height: 46, padding: '0 14px', borderRadius: 12,
    background: th.bg, color: th.text, border: `1px solid ${th.line}`,
    fontFamily: th.fontUI, fontSize: 15,
  };
  const linkBtnStyle: CSSProperties = {
    border: 'none', background: 'transparent', color: th.accent,
    fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0,
  };

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try {
      setError(null);
      const data = await api.getClubBroadcasts(clubId, token);
      setRecipientCount(data.recipientCount);
      setItems(data.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, clubId]);

  useEffect(() => {
    if (ready && token && clubId) load();
  }, [ready, token, clubId, load]);

  // Aperçu serveur débouncé : l'email tel qu'il sera reçu (marque du club, corps riche).
  useEffect(() => {
    if (!token || !clubId || !channels.email) return;
    const h = setTimeout(async () => {
      try {
        const body: { title: string; bodyHtml: string; url?: string } = {
          title: form.title.trim(),
          bodyHtml: form.body,
        };
        if (form.url.trim()) body.url = form.url.trim();
        setPreviewHtml((await api.previewClubBroadcast(clubId, body, token)).html);
      } catch { /* aperçu best-effort */ }
    }, 400);
    return () => clearTimeout(h);
  }, [token, clubId, form.title, form.body, form.url, channels.email]);

  // Aperçu d'audience débouncé : combien de destinataires selon la cible (tous/sélection) et le type.
  useEffect(() => {
    if (!token || !clubId) return;
    const h = setTimeout(async () => {
      try {
        setAud(await api.broadcastAudience(clubId, {
          recipientUserIds: recipients ? recipients.map((r) => r.userId) : undefined,
          kind,
        }, token));
      } catch { setAud(null); }
    }, 400);
    return () => clearTimeout(h);
  }, [token, clubId, recipients, kind]);

  const uploadImage = useCallback(async (file: File) => {
    if (!token || !clubId) throw new Error('Non connecté');
    return (await api.adminUploadEmailImage(clubId, file, token)).url;
  }, [token, clubId]);

  const canSend = form.title.trim().length > 0 && broadcastHasContent(form.body) && hasAnyChannel(channels)
    && (recipients === null || recipients.length > 0);

  const confirmMessage = recipients !== null
    ? `Ce message sera envoyé à ${recipients.length} membre${recipients.length > 1 ? 's' : ''} sélectionné${recipients.length > 1 ? 's' : ''}.`
    : `Ce message sera envoyé à tous les membres actifs (${recipientCount ?? '…'}).`;

  async function handleConfirm() {
    if (!token || !clubId) return;
    setSending(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const payload: {
        title: string; bodyHtml: string; url?: string; channels: BroadcastChannels;
        recipientUserIds?: string[]; kind: BroadcastKind;
      } = {
        title: form.title.trim(),
        bodyHtml: form.body,
        channels,
        recipientUserIds: recipients ? recipients.map((r) => r.userId) : undefined,
        kind,
      };
      if (form.url.trim()) payload.url = form.url.trim();
      const result = await api.sendClubBroadcast(clubId, payload, token);
      setSuccessMsg(`Message envoyé à ${result.recipientCount} membre${result.recipientCount > 1 ? 's' : ''}`);
      setForm(EMPTY_FORM);
      setRecipients(null);
      setKind('INFO');
      setConfirm(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ maxWidth: 1120 }}>
      <h1 style={{
        fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34,
        letterSpacing: -0.5, margin: '0 0 6px', color: th.text,
      }}>
        Messages
      </h1>

      {recipientCount !== null && (
        <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 24px' }}>
          Envoyer à{' '}
          <strong style={{ color: th.text }}>{recipientCount} membre{recipientCount > 1 ? 's' : ''} actif{recipientCount > 1 ? 's' : ''}</strong>
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, alignItems: 'start', marginBottom: 36 }}>
        {/* Compose form */}
        <section style={{
          background: th.bgElev, borderRadius: 18, padding: '24px 24px 28px',
          border: `1px solid ${th.line}`, minWidth: 0,
        }}>
          <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: '0 0 20px' }}>
            Composer un message
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute }}>
                Destinataires
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {recipients === null ? (
                  <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
                    Tous les membres actifs{recipientCount !== null ? ` (${recipientCount})` : ''}
                  </span>
                ) : recipients.length === 0 ? (
                  <>
                    <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.danger }}>
                      Aucun destinataire sélectionné.
                    </span>
                    <button type="button" onClick={() => setRecipients(null)} style={linkBtnStyle}>
                      Revenir à tous les membres
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>
                      {recipients.length} destinataire{recipients.length > 1 ? 's' : ''}
                    </span>
                    {recipients.map((r) => (
                      <span key={r.userId} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, background: th.surface2,
                        borderRadius: 999, padding: '3px 6px 3px 10px', fontFamily: th.fontUI, fontSize: 12.5, color: th.text,
                      }}>
                        {r.name}
                        <button
                          type="button"
                          aria-label={`Retirer ${r.name}`}
                          onClick={() => setRecipients((recipients ?? []).filter((x) => x.userId !== r.userId))}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 12, lineHeight: 1, padding: 2 }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    <button type="button" onClick={() => setRecipients(null)} style={linkBtnStyle}>
                      Tout le club
                    </button>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute }}>
                Type de message
              </span>
              <Segmented
                value={kind}
                onChange={setKind}
                options={[{ value: 'INFO', label: 'Info club' }, { value: 'COMMERCIAL', label: 'Commercial' }]}
              />
              {kind === 'COMMERCIAL' && aud && (
                <div style={{
                  background: `${th.accentWarm}26`, borderRadius: 10, padding: '8px 12px',
                  fontFamily: th.fontUI, fontSize: 12.5, color: th.text,
                }}>
                  {aud.email} recevront l&apos;email · {aud.inApp} la notification
                  {aud.excluded > 0 ? ` · ${aud.excluded} ne recevront rien (offres refusées)` : ''}
                </div>
              )}
            </div>

            <label style={labelStyle}>
              Titre
              <input
                style={inputStyle}
                placeholder="Titre du message"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </label>

            {/* Div (pas <label>) : le label engloberait les boutons de l'éditeur. */}
            <div style={labelStyle}>
              Message
              <div style={{ fontWeight: 400 }}>
                <RichEmailEditor
                  value={form.body}
                  vars={[
                    { key: 'prenom', label: 'Prénom', sample: 'Camille' },
                    { key: 'nom', label: 'Nom', sample: 'Durand' },
                  ]}
                  onChange={(stored) => setForm((f) => ({ ...f, body: stored }))}
                  onUploadImage={uploadImage}
                />
              </div>
            </div>

            <label style={labelStyle}>
              Lien (optionnel)
              <input
                style={inputStyle}
                placeholder="https://…"
                type="url"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </label>

            {/* Canaux d'envoi : le club choisit ; push couplé à la cloche. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, marginBottom: 6 }}>
                Comment l&apos;envoyer
              </span>
              <div style={{ opacity: EMAIL_BROADCAST_ENABLED ? 1 : 0.45, pointerEvents: EMAIL_BROADCAST_ENABLED ? 'auto' : 'none' }}>
                <SwitchRow
                  checked={channels.email}
                  onChange={(v) => { if (EMAIL_BROADCAST_ENABLED) setChannels((c) => ({ ...c, email: v })); }}
                  title="Email"
                  description={EMAIL_BROADCAST_ENABLED
                    ? "L'email HTML mis en forme ci-dessus."
                    : 'Temporairement indisponible — envoi par email en cours de configuration.'}
                />
              </div>
              <SwitchRow
                checked={channels.inApp}
                onChange={(v) => setChannels((c) => ({ ...c, inApp: v, push: v ? c.push : false }))}
                title="Notification dans l'appli"
                description="Dans la cloche des membres."
              />
              <div style={{ opacity: channels.inApp ? 1 : 0.45, pointerEvents: channels.inApp ? 'auto' : 'none' }}>
                <SwitchRow
                  checked={channels.push}
                  onChange={(v) => setChannels((c) => ({ ...c, push: v }))}
                  title="Notification push"
                  description="Alerte sur le téléphone (si activée par le membre)."
                />
              </div>
              <div style={{ opacity: 0.45, pointerEvents: 'none' }}>
                <SwitchRow checked={false} onChange={() => {}} title="SMS" description="Bientôt disponible." />
              </div>
              {!hasAnyChannel(channels) && (
                <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.danger, margin: '4px 0 0' }}>
                  Choisissez au moins un canal.
                </p>
              )}
            </div>

            {error && (
              <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.danger, margin: 0 }}>{error}</p>
            )}
            {successMsg && (
              <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.accent, margin: 0, fontWeight: 600 }}>
                {successMsg}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <Btn
                variant="primary"
                disabled={!canSend || sending}
                onClick={() => setConfirm(true)}
              >
                Envoyer
              </Btn>
            </div>
          </div>
        </section>

        {/* Aperçu (collant en desktop) */}
        <div style={{ position: 'sticky', top: 12, minWidth: 0 }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.textMute, marginBottom: 6 }}>
            Aperçu de l&apos;email
          </div>
          {channels.email ? (
            <EmailPreview html={previewHtml} />
          ) : (
            <div style={{ background: th.bgElev, border: `1px solid ${th.line}`, borderRadius: 12, padding: '18px 16px', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, lineHeight: 1.5 }}>
              {!EMAIL_BROADCAST_ENABLED
                ? "L'envoi par email est temporairement désactivé. Les membres recevront la notification (cloche / push) avec le texte du message."
                : (
                  <>
                    L&apos;email est désactivé pour cet envoi.
                    {channels.inApp
                      ? ` Les membres recevront la notification${channels.push ? ' (cloche + push)' : ' (cloche)'} avec le texte du message.`
                      : ''}
                  </>
                )}
            </div>
          )}
        </div>
      </div>

      {/* History */}
      <section>
        <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: '0 0 14px' }}>
          Historique
        </h2>

        {loading && (
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textFaint }}>Chargement…</p>
        )}

        {!loading && items.length === 0 && (
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Aucun message envoyé pour l&apos;instant.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                background: th.bgElev, borderRadius: 14, padding: '16px 20px',
                border: `1px solid ${th.line}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text }}>
                  {item.title}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <Chip tone={item.kind === 'COMMERCIAL' ? 'accent' : 'mute'}>
                    {item.kind === 'COMMERCIAL' ? 'Commercial' : 'Info'}
                  </Chip>
                  <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>
                    {formatDate(item.createdAt)}
                  </span>
                </div>
              </div>
              <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, margin: '0 0 8px', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {item.body}
              </p>
              <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>
                {item.recipientCount} destinataire{item.recipientCount > 1 ? 's' : ''}
              </span>
            </div>
          ))}
        </div>
      </section>

      {confirm && (
        <ConfirmDialog
          title="Envoyer ce message ?"
          message={confirmMessage}
          confirmLabel="Envoyer"
          cancelLabel="Retour"
          busy={sending}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  );
}
