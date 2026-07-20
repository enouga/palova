'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, Promotion, CreatePromotionBody, AdminResource } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { groupPromotions } from '@/lib/adminPromotions';
import { PromotionCard } from '@/components/admin/promotions/PromotionCard';
import { PromotionForm } from '@/components/admin/promotions/PromotionForm';

export default function AdminPromotionsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;

  const [promos, setPromos] = useState<Promotion[]>([]);
  const [courts, setCourts] = useState<AdminResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | undefined>(undefined);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try {
      setError(null);
      const [ps, rs] = await Promise.all([api.adminGetPromotions(clubId, token), api.adminGetResources(clubId, token)]);
      setPromos(ps); setCourts(rs); setNowMs(Date.now());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);
  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const submit = async (body: CreatePromotionBody) => {
    if (!token || !clubId) return;
    setBusy(true);
    try {
      setError(null);
      if (editing) await api.adminUpdatePromotion(clubId, editing.id, body, token);
      else await api.adminCreatePromotion(clubId, body, token);
      setFormOpen(false); setEditing(undefined); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const toggle = async (p: Promotion) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { await api.adminUpdatePromotion(clubId, p.id, { enabled: !p.enabled }, token); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (p: Promotion) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { await api.adminDeletePromotion(clubId, p.id, token); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const groups = groupPromotions(promos, nowMs);

  const h1: CSSProperties = { fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text };
  const kicker: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: th.textMute, margin: '26px 0 12px' };
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 };
  const Kicker = ({ children }: { children: React.ReactNode }) => (
    <div style={kicker}><span>{children}</span><span aria-hidden style={{ flex: 1, height: 1, background: th.line }} /></div>
  );

  const openCreate = () => { setEditing(undefined); setFormOpen(true); };
  const openEdit = (p: Promotion) => { setEditing(p); setFormOpen(true); };

  const empty = !loading && promos.length === 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={h1}>Promotions</h1>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={openCreate}
          style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '10px 18px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800, boxShadow: th.shadowSoft }}>
          ＋ Créer une promotion
        </button>
      </div>

      {error && !formOpen && <div style={{ marginTop: 16, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {loading ? (
        <div style={{ marginTop: 20, fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : empty ? (
        <div style={{ marginTop: 30, background: th.surface, borderRadius: 16, boxShadow: th.shadow, padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: th.text }}>Aucune promotion</div>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 6 }}>Créez une remise datée (« −20 % du 1er au 15 août ») sur tout ou partie de vos terrains.</div>
          <button type="button" onClick={openCreate} style={{ marginTop: 16, border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '10px 18px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800 }}>＋ Créer une promotion</button>
        </div>
      ) : (
        <>
          {groups.running.length > 0 && (
            <>
              <Kicker>En cours</Kicker>
              <div style={grid}>
                {groups.running.map((p) => (
                  <PromotionCard key={p.id} promo={p} totalCourts={courts.length} busy={busy}
                    onEdit={() => openEdit(p)} onToggleEnabled={() => toggle(p)} onDelete={() => remove(p)} />
                ))}
              </div>
            </>
          )}

          {groups.upcoming.length > 0 && (
            <>
              <Kicker>À venir</Kicker>
              <div style={grid}>
                {groups.upcoming.map((p) => (
                  <PromotionCard key={p.id} promo={p} totalCourts={courts.length} busy={busy}
                    onEdit={() => openEdit(p)} onToggleEnabled={() => toggle(p)} onDelete={() => remove(p)} />
                ))}
              </div>
            </>
          )}

          {groups.past.length > 0 && (
            <>
              <Kicker>Passées</Kicker>
              <div style={grid}>
                {groups.past.map((p) => (
                  <PromotionCard key={p.id} promo={p} totalCourts={courts.length} faded busy={busy}
                    onEdit={() => openEdit(p)} onToggleEnabled={() => toggle(p)} onDelete={() => remove(p)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      <PromotionForm open={formOpen} editing={editing} courts={courts} busy={busy}
        error={formOpen ? error : null} onClose={() => { setFormOpen(false); setEditing(undefined); }} onSubmit={submit} />
    </div>
  );
}
