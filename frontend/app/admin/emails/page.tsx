'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api, AdminEmailSummary } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';

const GROUP_LABEL: Record<string, string> = {
  inscriptions: 'Inscriptions', organisateur: 'Organisateur', parties: 'Parties ouvertes',
  matchs: 'Matchs', paiement: 'Paiement',
};
const GROUP_ORDER = ['inscriptions', 'organisateur', 'parties', 'matchs', 'paiement'];

export default function AdminEmailsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const [items, setItems] = useState<AdminEmailSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    setError(null);
    try { setItems((await api.adminListEmails(clubId, token)).items); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 6px', color: th.text }}>Emails</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 28px' }}>
        Personnalisez le contenu de chaque email automatique envoyé à vos membres.
      </p>
      {loading && <p style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</p>}
      {error && <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: '#e55', margin: '0 0 20px' }}>{error}</p>}
      {GROUP_ORDER.map((g) => {
        const groupItems = items.filter((i) => i.group === g);
        if (groupItems.length === 0) return null;
        return (
          <section key={g} style={{ marginBottom: 32 }}>
            <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: '0 0 14px' }}>{GROUP_LABEL[g]}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groupItems.map((it) => (
                <Link key={it.type} href={`/admin/emails/${it.type}`} style={{ textDecoration: 'none' }}>
                  <div style={{ background: th.bgElev, borderRadius: 14, padding: '14px 18px', border: `1px solid ${th.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text }}>{it.title}</div>
                      <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>{it.description}</div>
                    </div>
                    <span style={{ flexShrink: 0, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, color: it.customized ? th.accent : th.textFaint }}>
                      {it.customized ? 'Personnalisé' : 'Défaut'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
