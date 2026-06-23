'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, ClubBroadcastItem } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

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
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const labelStyle: CSSProperties = {
    fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
    color: th.textMute, display: 'flex', flexDirection: 'column', gap: 6,
  };
  const inputStyle: CSSProperties = {
    height: 46, padding: '0 14px', borderRadius: 12,
    background: th.bg, color: th.text, border: `1px solid ${th.line}`,
    fontFamily: th.fontUI, fontSize: 15,
  };
  const textareaStyle: CSSProperties = {
    padding: '12px 14px', borderRadius: 12,
    background: th.bg, color: th.text, border: `1px solid ${th.line}`,
    fontFamily: th.fontUI, fontSize: 15, resize: 'vertical', minHeight: 120,
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

  const canSend = form.title.trim().length > 0 && form.body.trim().length > 0;

  async function handleConfirm() {
    if (!token || !clubId) return;
    setSending(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const payload: { title: string; body: string; url?: string } = {
        title: form.title.trim(),
        body: form.body.trim(),
      };
      if (form.url.trim()) payload.url = form.url.trim();
      const result = await api.sendClubBroadcast(clubId, payload, token);
      setSuccessMsg(`Message envoyé à ${result.recipientCount} membre${result.recipientCount > 1 ? 's' : ''}`);
      setForm(EMPTY_FORM);
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
    <div style={{ maxWidth: 680 }}>
      <h1 style={{
        fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34,
        letterSpacing: -0.5, margin: '0 0 6px', color: th.text,
      }}>
        Messages
      </h1>

      {recipientCount !== null && (
        <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 28px' }}>
          Envoyer à{' '}
          <strong style={{ color: th.text }}>{recipientCount} membre{recipientCount > 1 ? 's' : ''} actif{recipientCount > 1 ? 's' : ''}</strong>
        </p>
      )}

      {/* Compose form */}
      <section style={{
        background: th.bgElev, borderRadius: 18, padding: '24px 24px 28px',
        border: `1px solid ${th.line}`, marginBottom: 36,
      }}>
        <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: '0 0 20px' }}>
          Composer un message
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={labelStyle}>
            Titre
            <input
              style={inputStyle}
              placeholder="Titre du message"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>

          <label style={labelStyle}>
            Message
            <textarea
              style={textareaStyle}
              placeholder="Contenu du message…"
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            />
          </label>

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

          {error && (
            <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: '#e55', margin: 0 }}>{error}</p>
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
                <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, flexShrink: 0 }}>
                  {formatDate(item.createdAt)}
                </span>
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
          message={`Ce message sera envoyé à ${recipientCount ?? '…'} membre${(recipientCount ?? 0) > 1 ? 's' : ''}.`}
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
