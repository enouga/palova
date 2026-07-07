'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import { api, PlatformClub } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ChangeSlugDialog } from '@/components/superadmin/ChangeSlugDialog';

export default function SuperAdminClubs() {
  const { th } = useTheme();
  const { token } = useAuth();
  const [clubs, setClubs] = useState<PlatformClub[]>([]);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<PlatformClub | null>(null);   // club dont on confirme le changement de statut
  const [slugTarget, setSlugTarget] = useState<PlatformClub | null>(null); // club dont on change l'alias
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    api.platformClubs(token).then(setClubs).catch(() => setClubs([]));
  }, [token]);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clubs;
    return clubs.filter((c) =>
      c.name.toLowerCase().includes(q)
      || c.slug.toLowerCase().includes(q)
      || (c.city ?? '').toLowerCase().includes(q)
      || (c.owners[0]?.email ?? '').toLowerCase().includes(q));
  }, [clubs, query]);

  async function toggleExempt(c: PlatformClub) {
    if (!token) return;
    try {
      await api.platformSetBillingExempt(c.id, !c.billing.exempt, token);
      load();
    } catch {
      setError("Échec de la mise à jour de l'exonération. Réessayez.");
    }
  }

  async function applyStatus() {
    if (!pending || !token) return;
    const next = pending.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setBusy(true); setError(null);
    try {
      await api.platformSetClubStatus(pending.id, next, token);
      setPending(null);
      load();
    } catch {
      setError('Échec de la mise à jour du statut. Réessayez.');
    } finally {
      setBusy(false);
    }
  }

  const cell: React.CSSProperties = { padding: '12px 14px', borderBottom: `1px solid ${th.line}`, fontSize: 14, color: th.text };
  const head: React.CSSProperties = { ...cell, color: th.textMute, fontWeight: 700, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 };
  const actionBtn: React.CSSProperties = {
    border: `1px solid ${th.line}`, background: 'transparent', color: th.text,
    borderRadius: 9, padding: '6px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  };

  return (
    <div>
      <h1 style={{ fontFamily: th.fontDisplay, fontSize: 28, fontWeight: 700, color: th.text, marginBottom: 16 }}>Clubs</h1>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher un club (nom, alias, ville, gérant)…"
        style={{
          display: 'block', width: '100%', maxWidth: 420, marginBottom: 16, padding: '10px 14px',
          borderRadius: 11, border: `1px solid ${th.line}`, background: th.bgElev,
          color: th.text, fontFamily: th.fontUI, fontSize: 14, outline: 'none',
        }}
      />
      {error && (
        <div style={{ fontSize: 13.5, color: th.onAccent, background: th.accent, padding: '11px 14px', borderRadius: 12, fontWeight: 600, marginBottom: 16 }}>{error}</div>
      )}
      <div style={{ background: th.bgElev, border: `1px solid ${th.line}`, borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...head, textAlign: 'left' }}>Club</th>
            <th style={{ ...head, textAlign: 'left' }}>Gérant</th>
            <th style={{ ...head, textAlign: 'right' }}>Adhérents</th>
            <th style={{ ...head, textAlign: 'right' }}>Ressources</th>
            <th style={{ ...head, textAlign: 'left' }}>Billing</th>
            <th style={{ ...head, textAlign: 'left' }}>Statut</th>
            <th style={{ ...head, textAlign: 'right' }}>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td style={cell}>
                  <Link href={`/superadmin/clubs/${c.id}`} style={{ color: th.text, textDecoration: 'none', fontWeight: 700 }}>
                    {c.name}
                  </Link><br />
                  <span style={{ color: th.textFaint, fontSize: 12.5 }}>{c.slug}{c.city ? ` · ${c.city}` : ''}</span>
                  {c.aliases.length > 0 && (
                    <><br /><span style={{ color: th.textFaint, fontSize: 12 }}>Alias : {c.aliases.join(', ')}</span></>
                  )}
                </td>
                <td style={cell}>{c.owners[0]?.email ?? <span style={{ color: th.textFaint }}>—</span>}</td>
                <td style={{ ...cell, textAlign: 'right', fontFamily: th.fontMono }}>{c.counts.adherents}</td>
                <td style={{ ...cell, textAlign: 'right', fontFamily: th.fontMono }}>{c.counts.resources}</td>
                <td style={cell}>
                  <span style={{ fontFamily: th.fontMono, fontSize: 12.5 }}>{c.billing.activeMembers}</span>
                  <span style={{ color: th.textFaint, fontSize: 12 }}> actifs · T{c.billing.observedTier}</span><br />
                  <span style={{ fontSize: 12, fontWeight: 700, color:
                    c.billing.state === 'OK' ? th.accent
                    : c.billing.state === 'PAST_DUE' ? '#c4472e'
                    : c.billing.state === 'TO_REGULARIZE' ? '#e8804f'
                    : th.textFaint }}>
                    {{ EXEMPT: 'Exonéré', FREE: 'Gratuit', OK: 'Actif', TO_REGULARIZE: 'À régulariser', PAST_DUE: 'Impayé' }[c.billing.state]}
                  </span>
                </td>
                <td style={cell}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: c.status === 'ACTIVE' ? th.accent : th.textFaint }}>
                    {c.status === 'ACTIVE' ? 'Actif' : 'Suspendu'}
                  </span>
                </td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => toggleExempt(c)} style={{ ...actionBtn, marginRight: 8 }}>
                    {c.billing.exempt ? 'Rétablir la facturation' : 'Exonérer'}
                  </button>
                  <button onClick={() => setSlugTarget(c)} style={{ ...actionBtn, marginRight: 8 }}>
                    Changer l&apos;alias
                  </button>
                  <button onClick={() => setPending(c)} style={actionBtn}>
                    {c.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pending && (
        <ConfirmDialog
          title={pending.status === 'ACTIVE' ? `Suspendre ${pending.name} ?` : `Réactiver ${pending.name} ?`}
          message={pending.status === 'ACTIVE'
            ? "Le club disparaîtra de l'annuaire public et sa page ne sera plus accessible."
            : "Le club redeviendra visible dans l'annuaire et sa page sera de nouveau accessible."}
          confirmLabel={pending.status === 'ACTIVE' ? 'Suspendre' : 'Réactiver'}
          busy={busy}
          onConfirm={applyStatus}
          onCancel={() => setPending(null)}
        />
      )}

      {slugTarget && (
        <ChangeSlugDialog
          club={slugTarget}
          onDone={() => { setSlugTarget(null); load(); }}
          onCancel={() => setSlugTarget(null)}
        />
      )}
    </div>
  );
}
