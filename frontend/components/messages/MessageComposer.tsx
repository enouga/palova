'use client';
import { useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { CHAT_EMOJIS } from '@/lib/chatEmojis';

// Composer de message privé : textarea auto-grow, Entrée = envoyer (Maj+Entrée = saut de
// ligne), 🙂 emojis, 📷 photo avec préview. Throttle « typing » 3 s (fire-and-forget).
export function MessageComposer({ disabled, onSend, onSendImage, onTyping }: {
  disabled?: boolean;
  onSend: (body: string) => Promise<boolean>; // false = échec → draft restauré
  onSendImage: (file: File, caption: string) => Promise<boolean>;
  onTyping: () => void;
}) {
  const { th } = useTheme();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const lastTypingRef = useRef(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const throttledTyping = () => {
    const now = Date.now();
    if (now - lastTypingRef.current > 3000) { lastTypingRef.current = now; onTyping(); }
  };

  const send = async () => {
    if (sending || disabled) return;
    const body = draft.trim();
    if (pendingImage) {
      const file = pendingImage;
      setSending(true); setPendingImage(null); setDraft('');
      const ok = await onSendImage(file, body);
      if (!ok) { setPendingImage(file); setDraft(body); }
      setSending(false);
      return;
    }
    if (!body) return;
    setSending(true); setDraft('');
    const ok = await onSend(body);
    if (!ok) setDraft(body);
    setSending(false);
  };

  return (
    <div style={{ position: 'relative', borderTop: `1px solid ${th.line}` }}>
      {emojiOpen && (
        <div role="menu" aria-label="Choisir un emoji"
          style={{ position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 8, background: th.surface,
            boxShadow: `inset 0 0 0 1px ${th.line}, 0 8px 24px rgba(0,0,0,0.18)`, borderRadius: 12, padding: 8,
            display: 'flex', flexWrap: 'wrap', gap: 2, maxHeight: 180, overflowY: 'auto' }}>
          {CHAT_EMOJIS.map((e) => (
            <button key={e} type="button" aria-label={`Emoji ${e}`} onClick={() => setDraft((d) => (d + e).slice(0, 2000))}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 6, borderRadius: 8 }}>
              {e}
            </button>
          ))}
        </div>
      )}
      {pendingImage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 0' }}>
          {/* préview avant envoi */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={URL.createObjectURL(pendingImage)} alt="Aperçu de la photo"
            style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, border: `1px solid ${th.line}` }} />
          <button type="button" aria-label="Retirer la photo" onClick={() => setPendingImage(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18 }}>×</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, padding: '10px 16px', paddingBottom: 'max(10px, env(safe-area-inset-bottom))', alignItems: 'flex-end' }}>
        <button type="button" aria-label="Emojis" aria-expanded={emojiOpen} disabled={disabled} onClick={() => setEmojiOpen((o) => !o)}
          style={{ border: `1px solid ${th.line}`, borderRadius: 12, background: emojiOpen ? th.surface : 'transparent', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '9px 12px', color: th.text, opacity: disabled ? 0.5 : 1 }}>
          🙂
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Choisir une photo"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingImage(f); e.target.value = ''; }} />
        <button type="button" aria-label="Envoyer une photo" disabled={disabled} onClick={() => fileRef.current?.click()}
          style={{ border: `1px solid ${th.line}`, borderRadius: 12, background: 'transparent', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '10px 12px', color: th.text, opacity: disabled ? 0.5 : 1 }}>
          📷
        </button>
        <textarea value={draft} rows={1} disabled={disabled}
          onChange={(e) => { setDraft(e.target.value.slice(0, 2000)); throttledTyping(); }}
          onFocus={() => setEmojiOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEmojiOpen(false);
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="Votre message…"
          style={{ flex: 1, minWidth: 0, resize: 'none', border: `1px solid ${th.line}`, borderRadius: 12, padding: '10px 12px',
            fontFamily: th.fontUI, fontSize: 14, background: th.surface, color: th.text, maxHeight: 120, opacity: disabled ? 0.5 : 1 }} />
        <button type="button" aria-label="Envoyer" onClick={send}
          disabled={disabled || sending || (!draft.trim() && !pendingImage)}
          style={{ border: 'none', borderRadius: 12, padding: '10px 16px', background: th.accent, color: th.onAccent,
            fontFamily: th.fontUI, fontWeight: 700,
            cursor: disabled || sending || (!draft.trim() && !pendingImage) ? 'default' : 'pointer',
            opacity: disabled || sending || (!draft.trim() && !pendingImage) ? 0.5 : 1 }}>
          Envoyer
        </button>
      </div>
    </div>
  );
}
