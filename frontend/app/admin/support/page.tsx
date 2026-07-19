'use client';

import { useState } from 'react';
import { api, type SupportTicketCategory } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { FaqView } from '@/components/content/FaqView';

const CATEGORIES: { key: SupportTicketCategory; label: string }[] = [
  { key: 'BUG', label: 'Bug' },
  { key: 'QUESTION', label: 'Question' },
  { key: 'SUGGESTION', label: 'Suggestion' },
  { key: 'BILLING', label: 'Facturation' },
];

const ERRORS: Record<string, string> = {
  RATE_LIMITED: 'Vous avez envoyé beaucoup de demandes — réessayez dans une heure.',
  VALIDATION_ERROR: 'Vérifiez le sujet (3 caractères min.) et la description (10 caractères min.).',
  SUPPORT_UNAVAILABLE: "Impossible d'envoyer votre demande. Réessayez, ou écrivez-nous à contact@palova.fr.",
};

export default function AdminSupportPage() {
  const { token } = useAuth();
  const { club } = useClub();
  const { th } = useTheme();
  const [category, setCategory] = useState<SupportTicketCategory>('QUESTION');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ number: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!club || !token || busy) return;
    setSent(null);
    if (subject.trim().length < 3 || description.trim().length < 10) { setError(ERRORS.VALIDATION_ERROR); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.adminCreateSupportTicket(club.id, { category, subject: subject.trim(), description: description.trim() }, token);
      setSent(res); setSubject(''); setDescription('');
    } catch (e) {
      setError(ERRORS[(e as Error).message] ?? ERRORS.SUPPORT_UNAVAILABLE);
    } finally { setBusy(false); }
  };

  const card: React.CSSProperties = { background: th.surface, border: `1px solid ${th.line}`, borderRadius: 14, padding: 18 };
  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
    border: `1px solid ${th.line}`, background: th.bg, color: th.text, fontFamily: th.fontUI, fontSize: 14.5,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
      <h1 style={{ fontFamily: th.fontUI, fontSize: 24, fontWeight: 800, color: th.text, margin: 0 }}>Support</h1>

      {/* FAQ d'abord (déflection) : la moitié des questions ont déjà leur réponse. */}
      <section aria-label="Questions fréquentes">
        <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: '0 0 12px' }}>Questions fréquentes</h2>
        <FaqView source="platform" heading={null} />
      </section>

      <section aria-label="Nous écrire" style={card}>
        <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: '0 0 4px' }}>Nous écrire</h2>
        <p style={{ margin: '0 0 14px', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
          Un bug, une question, une idée ? L'équipe Palova vous répond par email.
        </p>

        {sent && (
          <div role="status" style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: `${th.accent}22`, color: th.text, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600 }}>
            Demande{sent.number != null ? ` #${sent.number}` : ''} transmise — nous vous répondrons par email.
          </div>
        )}
        {error && (
          <div role="alert" style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: `${th.danger}1e`, color: th.danger, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {CATEGORIES.map((c) => (
            <button key={c.key} onClick={() => setCategory(c.key)} aria-pressed={category === c.key}
              style={{
                padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
                border: `1.5px solid ${category === c.key ? th.accent : th.line}`,
                background: category === c.key ? `${th.accent}22` : 'transparent', color: th.text,
              }}>
              {c.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input aria-label="Sujet" placeholder="Sujet" maxLength={120} value={subject}
            onChange={(e) => { setSubject(e.target.value); setError(null); }} style={input} />
          <textarea aria-label="Description" placeholder="Décrivez votre demande (que faisiez-vous, sur quelle page, que s'est-il passé ?)"
            maxLength={5000} rows={6} value={description}
            onChange={(e) => { setDescription(e.target.value); setError(null); }} style={{ ...input, resize: 'vertical' }} />
        </div>

        <p style={{ margin: '10px 0 14px', fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>
          Votre nom, votre email et le nom du club sont transmis avec votre demande pour que nous puissions vous répondre.
        </p>

        <button onClick={submit} disabled={busy}
          style={{
            padding: '10px 20px', borderRadius: 12, border: 'none', cursor: busy ? 'default' : 'pointer',
            background: th.accent, color: inkOn(th.accent), fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, opacity: busy ? 0.6 : 1,
          }}>
          {busy ? 'Envoi…' : 'Envoyer'}
        </button>
      </section>
    </div>
  );
}
