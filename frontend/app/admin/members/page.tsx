'use client';
import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { api, Member, SubscriptionPlan, SubscriptionPlanSummary } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, dangerBanner } from '@/lib/theme';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { computeVirtualRange } from '@/lib/virtualList';
import { storePendingRecipients } from '@/lib/broadcast';
import { daysUntil } from '@/lib/subscriptionAdmin';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { Pill } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { MemberRow, SubActionKind } from '@/components/admin/members/MemberRow';
import { AddMemberDialog } from '@/components/admin/members/AddMemberDialog';
import { SubscriberInsights } from '@/components/admin/members/SubscriberInsights';
import { SubscriptionActions } from '@/components/admin/subscriptions/SubscriptionActions';
import {
  MemberSeg, MemberSort, filterMembers, segCounts, sortMembers, memberKpis, membersCsv,
} from '@/lib/members';

// Hauteur d'une MemberRow (mesurée) + gap de la grille — sert de pas fixe à la virtualisation.
const ROW_HEIGHT = 64;
const ROW_GAP = 8;
const ROW_STRIDE = ROW_HEIGHT + ROW_GAP;
const LIST_MAX_HEIGHT = 'calc(100vh - 300px)';

export default function AdminMembersPage() {
  const { th } = useTheme();
  const router = useRouter();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const isDesktop = useIsDesktop(900);

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [seg, setSeg]         = useState<MemberSeg>('all');
  const [sort, setSort]       = useState<MemberSort>('name');
  const [addOpen, setAddOpen] = useState(false);
  const [nowMs, setNowMs] = useState(0);

  // Contexte abonnés (pastille « Abonnés ») : sous-filtres + cycle de vie sur la ligne.
  const [planFilter, setPlanFilter]       = useState<string | null>(null);
  const [expiringOnly, setExpiringOnly]   = useState(false);
  const [sportFilter, setSportFilter]     = useState<string | null>(null);
  const [plans, setPlans]                 = useState<SubscriptionPlan[]>([]);
  const [subAction, setSubAction]         = useState<{ kind: SubActionKind; m: Member } | null>(null);
  const multiSport = clubIsMultiSport(club as Parameters<typeof clubIsMultiSport>[0]);
  const sportName = (key: string) => {
    const cs = (club as { clubSports?: { sport?: { key: string; name: string } }[] } | null)?.clubSports?.find((c) => c.sport?.key === key)?.sport?.name;
    return cs ?? key.charAt(0).toUpperCase() + key.slice(1);
  };

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); setMembers(await api.adminGetMembers(clubId, token)); setNowMs(Date.now()); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  // Lien profond depuis /admin/offres : ?plan=<id> → contexte Abonnés pré-filtré (one-shot au montage).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const planId = new URLSearchParams(window.location.search).get('plan');
    if (planId) { setSeg('subs'); setPlanFilter(planId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Contexte abonnés : réinitialise les sous-filtres en sortant, charge les forfaits (paresseux, pour les cartes vides comprises).
  useEffect(() => { if (seg !== 'subs') { setPlanFilter(null); setExpiringOnly(false); setSportFilter(null); } }, [seg]);
  useEffect(() => {
    if (seg === 'subs' && token && clubId && plans.length === 0) {
      api.adminGetSubscriptionPlans(clubId, token).then(setPlans).catch(() => {});
    }
  }, [seg, token, clubId, plans.length]);

  // Débouncée : la frappe reste instantanée dans le champ, mais le filtre/tri (coûteux à
  // grande échelle) ne recalcule et ne re-rend qu'une fois la saisie stabilisée.
  const debouncedQuery = useDebouncedValue(query, 200);
  const searchAll = useMemo(() => filterMembers(members, debouncedQuery, 'all'), [members, debouncedQuery]);
  const counts = useMemo(() => segCounts(searchAll), [searchAll]);
  // Base abonnés (recherche appliquée, AVANT les sous-filtres) → KPIs/cartes du bandeau.
  const subsBase = useMemo(() => filterMembers(members, debouncedQuery, 'subs'), [members, debouncedQuery]);
  const visible = useMemo(() => {
    let rows = sortMembers(filterMembers(members, debouncedQuery, seg), sort);
    if (seg === 'subs') {
      rows = rows.filter((m) => {
        const s = m.subscription;
        if (!s) return false;
        if (planFilter && s.planId !== planFilter) return false;
        if (sportFilter && !s.sportKeys.includes(sportFilter)) return false;
        if (expiringOnly && daysUntil(s.expiresAt, nowMs) > 30) return false;
        return true;
      });
    }
    return rows;
  }, [members, debouncedQuery, seg, sort, planFilter, sportFilter, expiringOnly, nowMs]);
  const kpis = useMemo(() => memberKpis(members, nowMs), [members, nowMs]);

  // Sélection multiple (diffusion ciblée) : opère sur les userId, pas sur ce qui est monté à
  // l'écran — « Tout sélectionner » couvre TOUT `visible` (filtre/segment/recherche courant),
  // même la portion hors de la fenêtre virtualisée.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggleSel = (userId: string) => setSel((s) => {
    const n = new Set(s); if (n.has(userId)) n.delete(userId); else n.add(userId); return n;
  });
  const allVisibleSelected = visible.length > 0 && visible.every((m) => sel.has(m.userId));
  const toggleAll = () => setSel(allVisibleSelected ? new Set() : new Set(visible.map((m) => m.userId)));
  const openComposer = () => {
    const list = visible.filter((m) => sel.has(m.userId))
      .map((m) => ({ userId: m.userId, name: `${m.firstName} ${m.lastName.charAt(0)}.` }));
    storePendingRecipients(list);
    router.push('/admin/broadcast');
  };

  // Réconciliation : un changement de recherche/segment/tri peut faire sortir un membre
  // sélectionné de `visible` (ex. on coche un abonné ET un bloqué, puis on bascule sur le
  // segment « Abonnés » — le bloqué doit disparaître de la sélection, sinon la barre flottante
  // annoncerait un compte périmé et la diffusion cibleuse enverrait moins de destinataires que
  // ce qui est affiché, silencieusement).
  useEffect(() => {
    setSel((prev) => {
      if (prev.size === 0) return prev;
      const visibleIds = new Set(visible.map((m) => m.userId));
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  // Virtualisation de la liste : seule la fenêtre visible (+ overscan) est montée dans le DOM.
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll);
    window.addEventListener('resize', measure);
    return () => { el.removeEventListener('scroll', onScroll); window.removeEventListener('resize', measure); };
  }, [loading]);
  // Nouvelle recherche/segment/tri → on repart du haut (un scrollTop hérité resterait cohérent
  // grâce au clamp de computeVirtualRange, mais visuellement mieux vaut réafficher depuis le début).
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [debouncedQuery, seg, sort]);
  // Grille 2 colonnes ≥ 900px (desktop) : la virtualisation pave par RANGÉE (2 membres),
  // pas par membre — chaque rangée garde la hauteur fixe ROW_STRIDE d'une seule MemberRow.
  const columns = isDesktop ? 2 : 1;
  const range = useMemo(
    () => computeVirtualRange({ itemCount: Math.ceil(visible.length / columns), itemHeight: ROW_STRIDE, scrollTop, viewportHeight }),
    [visible.length, columns, scrollTop, viewportHeight],
  );
  const rowsToRender = useMemo(() => {
    const rows: Member[][] = [];
    for (let r = range.start; r < range.end; r++) rows.push(visible.slice(r * columns, r * columns + columns));
    return rows;
  }, [visible, range.start, range.end, columns]);

  const exportCsv = () => {
    const blob = new Blob([membersCsv(visible, nowMs)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `membres-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const searchInput: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 10, padding: '0 10px', fontFamily: th.fontUI, fontSize: 14, height: 40, width: '100%' };
  const toolBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 14px', borderRadius: 10, border: `1px solid ${th.line}`, background: th.surface, color: th.text, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' };

  const kpiStat = (label: string, value: number, color: string) => (
    <div style={{ padding: '2px 14px', minWidth: 74 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.05, marginTop: 2, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
  const kpiSep = <div style={{ width: 1, alignSelf: 'stretch', background: th.line, margin: '4px 0' }} />;

  const SEG_OPTS: { value: MemberSeg; label: string; n: number }[] = [
    { value: 'all', label: 'Tous', n: counts.all },
    { value: 'subs', label: 'Abonnés', n: counts.subs },
    { value: 'staff', label: 'Staff', n: counts.staff },
    { value: 'coach', label: 'Coachs', n: counts.coach },
    { value: 'referee', label: 'J/A', n: counts.referee },
    { value: 'watch', label: 'À surveiller', n: counts.watch },
    { value: 'blocked', label: 'Bloqués', n: counts.blocked },
  ];

  return (
    <div>
      {/* Titre + bandeau KPI */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', margin: '0 0 6px' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text }}>Membres</h1>
        {!loading && members.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', background: th.surface, borderRadius: 14, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: '6px 2px' }}>
            {kpiStat('Membres', kpis.total, th.text)}
            {kpiSep}
            {kpiStat('Abonnés', kpis.subscribers, th.accent)}
            {kpiSep}
            {kpiStat('Actifs 30 j', kpis.activeRecent, th.mode === 'floodlit' ? th.accent : th.text)}
            {kpiSep}
            {kpiStat('Bloqués', kpis.blocked, kpis.blocked > 0 ? ACCENTS.coral : th.textFaint)}
          </div>
        )}
      </div>
      <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, margin: '0 0 20px' }}>
        Le fichier-membres de votre club. Être membre (non bloqué) permet de réserver. « Abonné » ouvre la fenêtre de réservation élargie (voir Réglages).
      </p>

      {error && (
        <div style={{ ...dangerBanner(th), marginBottom: 16 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : (
        <>
          {/* Toolbar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 340 }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un membre (nom, email, tél., n° adhérent)…" aria-label="Rechercher un membre" style={{ ...searchInput, paddingRight: query ? 30 : 10 }} />
              {query && <button onClick={() => setQuery('')} aria-label="Effacer la recherche" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>}
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as MemberSort)} aria-label="Trier" style={{ ...toolBtn, appearance: 'auto' }}>
              <option value="name">Nom A–Z</option>
              <option value="recent">Plus récents</option>
              <option value="activity">Dernière activité</option>
            </select>
            <button onClick={exportCsv} disabled={visible.length === 0} style={{ ...toolBtn, opacity: visible.length === 0 ? 0.5 : 1, cursor: visible.length === 0 ? 'default' : 'pointer' }}>
              <Icon name="download" size={16} color={th.text} />Exporter CSV
            </button>
            <button onClick={() => setAddOpen(true)} style={{ ...toolBtn, background: th.accent, color: th.onAccent, border: 'none' }}>
              <Icon name="plus" size={17} color={th.onAccent} />Ajouter un membre
            </button>
          </div>

          {/* Segments */}
          <div className="sp-scroll-x" style={{ display: 'flex', gap: 8, marginBottom: 16, paddingBottom: 2 }}>
            {SEG_OPTS.map((o) => (
              <Pill key={o.value} label={`${o.label} · ${o.n}`} active={seg === o.value} size="sm" onClick={() => setSeg(o.value)} />
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 13, color: th.textMute, cursor: 'pointer', margin: '0 0 12px' }}>
            <input type="checkbox" aria-label="Tout sélectionner" checked={allVisibleSelected} onChange={toggleAll} style={{ width: 16, height: 16, accentColor: th.accent, cursor: 'pointer' }} />
            Tout sélectionner ({visible.length})
          </label>

          {/* Bandeau de pilotage abonnés (contexte « Abonnés » uniquement) */}
          {seg === 'subs' && (
            <SubscriberInsights th={th} subscribers={subsBase} plans={plans} nowMs={nowMs} multiSport={multiSport} sportName={sportName}
              planFilter={planFilter} onPlanFilter={setPlanFilter}
              expiringOnly={expiringOnly} onToggleExpiring={() => setExpiringOnly((v) => !v)}
              sportFilter={sportFilter} onSportFilter={setSportFilter} />
          )}

          {visible.length === 0 ? (
            <div style={{ padding: '28px 14px', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>
              {members.length === 0 ? "Aucun membre pour l'instant." : `Aucun membre ne correspond${query.trim() ? ` à « ${query.trim()} »` : ''}.`}
            </div>
          ) : (
            <div ref={listRef} style={{ maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {range.paddingTop > 0 && <div style={{ height: range.paddingTop }} />}
                {rowsToRender.map((row, i) => (
                  <div key={range.start + i} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 8 }}>
                    {row.map((m) => (
                      <MemberRow key={m.id} m={m} nowMs={nowMs} selected={false}
                        onOpen={() => router.push(`/admin/members/${m.userId}`)}
                        onNavigate={() => router.push(`/admin/members/${m.userId}`)}
                        subscriptionContext={seg === 'subs'}
                        onSubAction={(kind, mm) => setSubAction({ kind, m: mm })}
                        checked={sel.has(m.userId)} onToggleCheck={() => toggleSel(m.userId)} />
                    ))}
                  </div>
                ))}
                {range.paddingBottom > 0 && <div style={{ height: range.paddingBottom }} />}
              </div>
            </div>
          )}
          {query.trim() && visible.length > 0 && (
            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint, padding: '6px 4px 0' }}>{visible.length} sur {members.length}</div>
          )}
        </>
      )}

      {addOpen && token && clubId && (
        <AddMemberDialog clubId={clubId} token={token} onClose={() => setAddOpen(false)} onAdded={load} />
      )}

      {subAction && subAction.m.subscription && token && clubId && (
        <SubscriptionActions
          action={subAction.kind}
          sub={{
            id: subAction.m.subscription.id, planId: subAction.m.subscription.planId, planName: subAction.m.subscription.planName,
            expiresAt: subAction.m.subscription.expiresAt, monthlyPriceSnapshot: subAction.m.subscription.monthlyPriceSnapshot,
          }}
          plans={plans.map((p): SubscriptionPlanSummary => ({
            id: p.id, name: p.name, monthlyPrice: p.monthlyPrice, benefit: p.benefit,
            discountPercent: p.discountPercent, sportKeys: p.sportKeys, isActive: p.isActive, activeCount: 0,
          }))}
          clubId={clubId} token={token}
          onClose={() => setSubAction(null)} onDone={() => { setSubAction(null); load(); }} />
      )}

      {sel.size > 0 && (
        <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 40,
          background: '#1d2433', color: '#fff', borderRadius: 999, padding: '10px 18px',
          display: 'flex', alignItems: 'center', gap: 14, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
          boxShadow: '0 6px 20px rgba(0,0,0,.3)' }}>
          {sel.size} sélectionné{sel.size > 1 ? 's' : ''}
          <button onClick={openComposer} style={{ border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '7px 14px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>✉ Envoyer un message</button>
          <button onClick={() => setSel(new Set())} aria-label="Annuler la sélection" style={{ border: 'none', background: 'transparent', color: '#fff', opacity: 0.7, cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}
    </div>
  );
}
