'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, AdminMemberLevel, UserLevel } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ReliabilityMeter } from '@/components/player/ReliabilityMeter';
import { LevelOverrideForm } from '@/components/admin/LevelOverrideForm';

// Formate la date d'une correction (jour + heure courts, locale FR).
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminMemberLevelPage() {
  const { userId } = useParams<{ userId: string }>();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const levelEnabled = club?.levelSystemEnabled !== false;

  const [name, setName] = useState<string | null>(null);
  const [data, setData] = useState<AdminMemberLevel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !clubId || !userId) return;
    setLoading(true);
    try {
      setError(null);
      const [members, level] = await Promise.all([
        api.adminGetMembers(clubId, token),
        api.adminGetMemberLevel(clubId, userId, token),
      ]);
      const member = members.find((m) => m.userId === userId);
      setName(member ? `${member.firstName} ${member.lastName}` : null);
      setData(level);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, clubId, userId]);

  useEffect(() => { if (ready && token && clubId && levelEnabled) load(); }, [ready, token, clubId, levelEnabled, load]);

  const backLink = (
    <Link href="/admin/members" style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.textMute, textDecoration: 'none' }}>
      ← Retour aux membres
    </Link>
  );

  // Le système de niveau est désactivé pour ce club : fonctionnalité indisponible.
  if (!levelEnabled) {
    return (
      <div>
        <div style={{ marginBottom: 16 }}>{backLink}</div>
        <div style={{ background: th.surface, borderRadius: 18, padding: 24, boxShadow: `inset 0 0 0 1px ${th.line}`, fontFamily: th.fontUI, color: th.textMute }}>
          La gestion des niveaux est indisponible : le système de niveau est désactivé pour ce club (voir Réglages).
        </div>
      </div>
    );
  }

  // Sports proposés par le club (pour le sélecteur du formulaire).
  const clubSports = (club?.clubSports ?? []).map((cs) => ({ key: cs.sport.key, name: cs.sport.name }));
  // Si le club n'a pas de sports configurés, on retombe sur les sports présents dans les niveaux.
  const formSports = clubSports.length > 0
    ? clubSports
    : Object.keys(data?.levels ?? {}).map((key) => ({ key, name: key }));
  // Nom lisible d'un sport (pour la section Niveau et l'historique).
  const sportName = (key: string) => clubSports.find((s) => s.key === key)?.name ?? key;

  const levelEntries: [string, UserLevel][] = Object.entries(data?.levels ?? {});

  return (
    <div>
      <div style={{ marginBottom: 16 }}>{backLink}</div>

      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 6px', color: th.text }}>
        {name ?? 'Membre'}
      </h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 22px' }}>
        Niveau et corrections manuelles de ce membre. Le niveau est global ; la correction est tracée au nom de votre club.
      </p>

      {error && <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : (
        <>
          {/* Section Niveau : niveau courant + fiabilité par sport */}
          <section style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 16 }}>
            <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, margin: '0 0 12px', color: th.text }}>Niveau</h2>
            {levelEntries.length === 0 ? (
              <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, margin: 0 }}>Aucun niveau enregistré pour ce membre.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {levelEntries.map(([key, lvl]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.textMute, minWidth: 90 }}>{sportName(key)}</span>
                    <span style={{ fontFamily: th.fontDisplay, fontSize: 22, fontWeight: 700, color: th.text }}>{lvl.level.toFixed(1)}</span>
                    <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>{lvl.tier}</span>
                    {lvl.isProvisional && (
                      <span style={{ borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: '#ffb020', color: '#1a1a1a' }}>en calibrage</span>
                    )}
                    <ReliabilityMeter pct={lvl.reliability} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Formulaire de correction (override ADMIN 0–8) */}
          {clubId && (
            <div style={{ marginBottom: 16 }}>
              <LevelOverrideForm
                clubId={clubId}
                userId={userId}
                token={token!}
                sports={formSports}
                onSaved={load}
              />
            </div>
          )}

          {/* Historique des corrections (récent d'abord) */}
          <section style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
            <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, margin: '0 0 12px', color: th.text }}>Historique des corrections</h2>
            {(data?.history ?? []).length === 0 ? (
              <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, margin: 0 }}>Aucune correction manuelle pour l'instant.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(data?.history ?? []).map((h) => (
                  <li key={h.id} style={{ borderBottom: `1px solid ${th.line}`, paddingBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontFamily: th.fontUI, fontSize: 13.5, color: th.text }}>
                      <span style={{ fontWeight: 700 }}>{h.previousLevel ?? '—'} → {h.newLevel}</span>
                      {formSports.length > 1 && <span style={{ color: th.textMute }}>· {h.sportName}</span>}
                      <span style={{ color: th.textMute }}>· par {h.staffFirstName} {h.staffLastName}</span>
                      <span style={{ color: th.textFaint, fontSize: 12.5 }}>· {formatDate(h.createdAt)}</span>
                    </div>
                    {h.reason && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 3 }}>{h.reason}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
