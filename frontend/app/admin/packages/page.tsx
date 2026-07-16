'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, PackageTemplate, SubscriptionPlan, SubscriptionOverview } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { offerTint, planPulse, packagePulse, planRevenueCents, splitByActive } from '@/lib/adminOffers';
import { OfferCard } from '@/components/admin/offers/OfferCard';
import { OfferStudio, OfferStudioResult } from '@/components/admin/offers/OfferStudio';

const euro = (s: string | number) => `${Number(s).toFixed(2).replace('.', ',')} €`;
const SPORT_OPTIONS = ['padel', 'squash', 'tennis', 'badminton', 'pickleball', 'pingpong'];

type Editing = { kind: 'plan'; plan: SubscriptionPlan } | { kind: 'package'; tpl: PackageTemplate };

export default function AdminPackagesPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;

  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [plans, setPlans]         = useState<SubscriptionPlan[]>([]);
  const [overview, setOverview]   = useState<SubscriptionOverview | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);
  const [nowMs, setNowMs]         = useState(0);

  const [studioOpen, setStudioOpen] = useState(false);
  const [editing, setEditing]       = useState<Editing | undefined>(undefined);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try {
      setError(null);
      const [tpls, pls, ov] = await Promise.all([
        api.adminGetPackageTemplates(clubId, token),
        api.adminGetSubscriptionPlans(clubId, token),
        api.adminGetSubscriptionOverview(clubId, token),
      ]);
      setTemplates(tpls); setPlans(pls); setOverview(ov); setNowMs(Date.now());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const openCreate = () => { setEditing(undefined); setStudioOpen(true); };
  const openEditPlan = (p: SubscriptionPlan) => { setEditing({ kind: 'plan', plan: p }); setStudioOpen(true); };
  const openEditTpl = (t: PackageTemplate) => { setEditing({ kind: 'package', tpl: t }); setStudioOpen(true); };

  const submitStudio = async (r: OfferStudioResult) => {
    if (!token || !clubId) return;
    setBusy(true);
    try {
      setError(null);
      if (r.kind === 'plan') {
        if (editing?.kind === 'plan') {
          await api.adminUpdateSubscriptionPlan(clubId, editing.plan.id, {
            ...r.body, ...(r.removeImage && !r.imageFile ? { imageUrl: null } : {}),
          }, token);
          if (r.imageFile) await api.adminUploadSubscriptionPlanImage(clubId, editing.plan.id, r.imageFile, token);
        } else {
          const created = await api.adminCreateSubscriptionPlan(clubId, r.body, token);
          if (r.imageFile) await api.adminUploadSubscriptionPlanImage(clubId, created.id, r.imageFile, token);
        }
      } else {
        if (editing?.kind === 'package') {
          await api.adminUpdatePackageTemplate(clubId, editing.tpl.id, {
            ...r.body, ...(r.removeImage && !r.imageFile ? { imageUrl: null } : {}),
          }, token);
          if (r.imageFile) await api.adminUploadPackageTemplateImage(clubId, editing.tpl.id, r.imageFile, token);
        } else {
          const created = await api.adminCreatePackageTemplate(clubId, r.body, token);
          if (r.imageFile) await api.adminUploadPackageTemplateImage(clubId, created.id, r.imageFile, token);
        }
      }
      setStudioOpen(false); setEditing(undefined);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const toggleTpl = async (t: PackageTemplate) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { setError(null); await api.adminUpdatePackageTemplate(clubId, t.id, { isActive: !t.isActive }, token); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const togglePlan = async (p: SubscriptionPlan) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { setError(null); await api.adminUpdateSubscriptionPlan(clubId, p.id, { isActive: !p.isActive }, token); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const subscribers = overview?.subscribers ?? [];
  const activeCountFor = (planId: string) => overview?.plans.find((p) => p.id === planId)?.activeCount ?? 0;
  const membersHref = (planId: string) => `/admin/members?plan=${planId}`;

  const { active: activePlans, inactive: inactivePlans } = splitByActive(plans);
  const { active: activeTpls, inactive: inactiveTpls } = splitByActive(templates);
  const orderedPlans = [...activePlans, ...inactivePlans];
  const orderedTpls = [...activeTpls, ...inactiveTpls];

  const h1: CSSProperties = { fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text };
  const kicker: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: th.textMute, margin: '26px 0 12px' };
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 };
  const Kicker = ({ children }: { children: React.ReactNode }) => (
    <div style={kicker}><span>{children}</span><span aria-hidden style={{ flex: 1, height: 1, background: th.line }} /></div>
  );

  const empty = !loading && plans.length === 0 && templates.length === 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={h1}>Offres</h1>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={openCreate}
          style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '10px 18px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800, boxShadow: th.shadowSoft }}>
          ＋ Créer une offre
        </button>
      </div>

      {error && <div style={{ marginTop: 16, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {loading ? (
        <div style={{ marginTop: 20, fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : empty ? (
        <div style={{ marginTop: 30, background: th.surface, borderRadius: 16, boxShadow: th.shadow, padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ fontFamily: th.fontUI, fontSize: 15, fontWeight: 700, color: th.text }}>Créez votre première offre</div>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 6 }}>Abonnements, carnets d’entrées ou porte-monnaie — vos joueurs les verront sur le Club-house.</div>
          <button type="button" onClick={openCreate} style={{ marginTop: 16, border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '10px 18px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800 }}>＋ Créer une offre</button>
        </div>
      ) : (
        <>
          {orderedPlans.length > 0 && (
            <>
              <Kicker>Abonnements</Kicker>
              <div style={grid}>
                {orderedPlans.map((p) => (
                  <OfferCard key={p.id} tint={offerTint('SUBSCRIPTION')} kindLabel="Abonnement" name={p.name}
                    price={euro(p.monthlyPrice)} priceSuffix={`/mois · ${p.commitmentMonths} mois`}
                    features={[
                      p.sportKeys.length > 0 ? p.sportKeys.join(', ') : 'Tous sports',
                      p.offPeakOnly ? 'Heures creuses' : 'Toutes heures',
                      p.benefit === 'INCLUDED' ? 'inclus' : `−${p.discountPercent} %`,
                    ].join(' · ')}
                    pulse={
                      activeCountFor(p.id) > 0 ? (
                        <a href={membersHref(p.id)} style={{ color: 'inherit', textDecoration: 'none' }}>
                          {planPulse(activeCountFor(p.id), planRevenueCents(subscribers, p.id, nowMs))} <span aria-hidden>→</span>
                        </a>
                      ) : planPulse(0, 0)
                    }
                    isActive={p.isActive} busy={busy} onEdit={() => openEditPlan(p)} onToggleActive={() => togglePlan(p)} />
                ))}
              </div>
            </>
          )}

          {orderedTpls.length > 0 && (
            <>
              <Kicker>Carnets &amp; Porte-monnaie</Kicker>
              <div style={grid}>
                {orderedTpls.map((t) => (
                  <OfferCard key={t.id} tint={offerTint(t.kind)}
                    kindLabel={t.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie'} name={t.name}
                    price={euro(t.price)}
                    priceSuffix={t.kind === 'ENTRIES' ? `· ${t.entriesCount} entrées` : `· ${euro(t.walletAmount ?? 0)} crédités`}
                    features={[
                      t.sportKeys.length > 0 ? t.sportKeys.join(', ') : 'Tous sports',
                      t.validityDays ? `valable ${t.validityDays} j` : 'sans expiration',
                    ].join(' · ')}
                    pulse={packagePulse(t.stats, t.kind)}
                    isActive={t.isActive} busy={busy} onEdit={() => openEditTpl(t)} onToggleActive={() => toggleTpl(t)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      <OfferStudio open={studioOpen} editing={editing}
        sportOptions={SPORT_OPTIONS} busy={busy} error={studioOpen ? error : null}
        onClose={() => { setStudioOpen(false); setEditing(undefined); }} onSubmit={submitStudio} />
    </div>
  );
}
