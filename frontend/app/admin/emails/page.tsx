'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api, AdminEmailSummary } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon, IconName } from '@/components/ui/Icon';

const GROUP_META: Record<string, { label: string; icon: IconName; color: string }> = {
  inscriptions: { label: 'Inscriptions', icon: 'trophy', color: '#e8b04b' },
  organisateur: { label: 'Organisateur', icon: 'users', color: '#2bb6a3' },
  parties: { label: 'Parties ouvertes', icon: 'ball', color: '#5e93da' },
  messages: { label: 'Messagerie', icon: 'mail', color: '#8e7cc3' },
  matchs: { label: 'Matchs', icon: 'bolt', color: '#e0705a' },
  paiement: { label: 'Paiement', icon: 'euro', color: '#5bbd6e' },
};
const GROUP_ORDER = ['inscriptions', 'organisateur', 'parties', 'messages', 'matchs', 'paiement'];

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
    <div style={{ maxWidth: 1160 }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 6px', color: th.text }}>Emails</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 28px' }}>
        Personnalisez le contenu de chaque email automatique — texte, mise en forme et photos, sans aucune technique.
      </p>
      {loading && <p style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</p>}
      {error && <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.danger, margin: '0 0 20px' }}>{error}</p>}
      {GROUP_ORDER.map((g) => {
        const groupItems = items.filter((i) => i.group === g);
        if (groupItems.length === 0) return null;
        const meta = GROUP_META[g];
        return (
          <section key={g} style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 14px' }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: `${meta.color}22`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={meta.icon} size={17} color={meta.color} />
              </span>
              <h2 style={{ fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text, margin: 0 }}>{meta.label}</h2>
            </div>
            <div className="admin-cards-2col">
              {groupItems.map((it) => (
                <Link key={it.type} href={`/admin/emails/${it.type}`} style={{ textDecoration: 'none' }}>
                  <div style={{ background: th.bgElev, borderRadius: 14, padding: '14px 18px', border: `1px solid ${th.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text }}>{it.title}</div>
                      <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>{it.description}</div>
                    </div>
                    <span style={{ flexShrink: 0, fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, padding: '3px 11px', borderRadius: 99, background: it.customized ? `${th.accent}22` : 'transparent', color: it.customized ? th.accent : th.textFaint, border: `1px solid ${it.customized ? th.accent : th.line}` }}>
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
