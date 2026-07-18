'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, Announcement, assetUrl } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { Btn, Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { AnnouncementStudio } from '@/components/admin/AnnouncementStudio';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ANNOUNCEMENT_KIND_LABEL } from '@/lib/clubhouse';

// Page « Annonces » : liste déplaçable (glisser natif, pattern ClubHouseSectionsCard, + ↑↓
// pour mobile/accessibilité). L'ordre manuel s'applique tel quel au kiosque du Club-house.
// Création/édition dans une fenêtre studio (aperçu en direct).
export default function AdminAnnouncementsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studio, setStudio] = useState<{ editing: Announcement | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Announcement | null>(null);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); setItems(await api.adminGetAnnouncements(clubId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  // Réordonnancement optimiste : maj locale immédiate, reorder en tâche de fond, recharge si échec.
  const persistOrder = async (next: Announcement[]) => {
    if (!token || !clubId) return;
    setItems(next);
    try { setError(null); await api.adminReorderAnnouncements(clubId, next.map((a) => a.id), token); }
    catch (e) { setError((e as Error).message); await load(); }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[idx], next[target]] = [next[target], next[idx]];
    persistOrder(next);
  };

  const onDropRow = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const next = [...items];
    const from = next.findIndex((a) => a.id === dragId);
    const to = next.findIndex((a) => a.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persistOrder(next);
  };

  const remove = async (a: Announcement) => {
    if (!token || !clubId) return;
    try { setError(null); await api.adminDeleteAnnouncement(clubId, a.id, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const rowBtn: CSSProperties = { border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '6px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text };
  const arrow = (disabled: boolean): CSSProperties => ({ ...rowBtn, padding: '4px 9px', cursor: disabled ? 'default' : 'pointer', color: disabled ? th.textFaint : th.text });

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 8px', color: th.text }}>Annonces</h1>
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 22px' }}>Glissez pour réordonner. L&apos;ordre choisi s&apos;applique au Club-house.</p>
        </div>
        <Btn onClick={() => setStudio({ editing: null })} icon="plus">Nouvelle annonce</Btn>
      </div>

      {error && <div style={{ ...dangerBanner(th), marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : items.length === 0 ? (
        <div style={{ borderRadius: 18, background: th.surface, boxShadow: th.shadow, padding: '28px 16px', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>
          Aucune annonce pour l&apos;instant.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((a, idx) => (
            <div key={a.id} data-testid={`ann-row-${a.id}`} onDragOver={(e) => e.preventDefault()} onDrop={() => onDropRow(a.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 14,
                background: th.surface, boxShadow: th.shadow,
                borderLeft: `4px solid ${a.pinned ? th.accentWarm : 'transparent'}`,
                opacity: dragId === a.id ? 0.4 : 1,
              }}>
              <span draggable onDragStart={() => setDragId(a.id)} onDragEnd={() => setDragId(null)}
                title="Glisser pour réordonner" style={{ cursor: 'grab', display: 'flex', flexShrink: 0 }}>
                <Icon name="grip" size={18} color={th.textFaint} />
              </span>
              {a.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetUrl(a.imageUrl) ?? ''} alt={`Affiche de « ${a.title} »`}
                  style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }} />
              ) : (
                <div aria-hidden style={{ width: 46, height: 46, borderRadius: 10, background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: th.textFaint, fontSize: 18 }}>i</div>
              )}
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                  <Chip tone="mute">{ANNOUNCEMENT_KIND_LABEL[a.kind ?? 'INFO']}</Chip>
                  {a.pinned && <Chip tone="accent" icon="pin">À la une</Chip>}
                  {!a.isPublished && <Chip tone="line">Brouillon</Chip>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={`Monter ${a.title}`} style={arrow(idx === 0)}>↑</button>
                <button onClick={() => move(idx, 1)} disabled={idx === items.length - 1} aria-label={`Descendre ${a.title}`} style={arrow(idx === items.length - 1)}>↓</button>
                <button onClick={() => setStudio({ editing: a })} style={rowBtn}>Modifier</button>
                <button onClick={() => setPendingDelete(a)} style={{ ...rowBtn, color: '#ff7a4d' }}>Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {studio && clubId && token && (
        <AnnouncementStudio clubId={clubId} token={token} editing={studio.editing}
          onClose={() => setStudio(null)} onSaved={load} />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer cette annonce ?"
          detail={pendingDelete.title}
          message="Cette action est définitive."
          confirmLabel="Supprimer"
          onConfirm={() => { const a = pendingDelete; setPendingDelete(null); remove(a); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
