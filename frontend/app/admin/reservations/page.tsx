'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, ClubReservation, ClubReservationsResponse, PaymentMethod, AdminResource, OffPeakHours, Member, ClubAdminDetail, Payment, CaissePayment } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { DateField } from '@/components/ui/DateField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CollectPanel } from '@/components/admin/CollectPanel';
import { PaymentPanel } from '@/components/admin/PaymentPanel';
import { Receipt } from '@/components/admin/Receipt';
import { PaymentDots, SETTLED_COLOR } from '@/components/admin/PaymentDots';
import { Icon, IconName } from '@/components/ui/Icon';
import { dueCents, toCents, fmtEuros, paymentDots } from '@/lib/caisse';
import { playerCount } from '@/lib/courtType';
import { overlapsHourWindow, outstandingFilter, matchesQuery, OutstandingMode } from '@/lib/collect';

const CORAL = '#ff7a4d';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function fmtTime(iso: string): string { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }

// Adapte un paiement de réservation au format attendu par le reçu (Receipt).
function toCaissePayment(p: Payment, rv: ClubReservation): CaissePayment {
  return {
    ...p,
    reservation: { id: rv.id, startTime: rv.startTime, resource: { name: rv.resource.name }, user: rv.user ? { firstName: rv.user.firstName, lastName: rv.user.lastName } : null },
    memberPackage: null,
  };
}

const STATUS_LABEL: Record<string, string> = { PENDING: 'En attente', CONFIRMED: 'Confirmée', CANCELLED: 'Annulée' };
const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre',
  VOUCHER: 'Ticket CE', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre',
  SUBSCRIPTION: 'Abonnement',
};
const METHOD_ICON: Record<PaymentMethod, IconName> = {
  CASH: 'euro', CARD: 'card', TRANSFER: 'arrowR', ONLINE: 'card', OTHER: 'euro',
  VOUCHER: 'ticket', PACK_CREDIT: 'ticket', WALLET: 'euro', MEMBER: 'user',
  SUBSCRIPTION: 'user',
};

export default function AdminReservationsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const wide = useIsDesktop(900);
  const [data, setData]   = useState<ClubReservationsResponse | null>(null);
  const [date, setDate]   = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<ClubReservation | null>(null);
  const [cancelling, setCancelling]       = useState(false);

  const [resources, setResources]     = useState<AdminResource[]>([]);
  const [peak, setPeak]               = useState<OffPeakHours | null>(null);
  const [tz, setTz]                   = useState('Europe/Paris');
  const [members, setMembers]         = useState<Member[]>([]);
  const [clubDetail, setClubDetail]   = useState<ClubAdminDetail | null>(null);
  const [selected, setSelected]       = useState<ClubReservation | null>(null);   // modale « Détails »
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);        // ligne ciblée par le panneau d'encaissement
  const [receiptTarget, setReceiptTarget] = useState<{ payment: Payment; rv: ClubReservation } | null>(null);

  const [query, setQuery]   = useState('');
  const [outMode, setOut]   = useState<OutstandingMode>('all');
  const [fromHour, setFrom] = useState<number | null>(null);
  const [toHour, setTo]     = useState<number | null>(null);

  const statusStyle = (s: string): CSSProperties => ({
    borderRadius: 999, padding: '4px 11px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600,
    background: s === 'CONFIRMED' ? `${th.accent}22` : s === 'PENDING' ? th.surfaceHi : th.surface2,
    color: s === 'CONFIRMED' ? (th.mode === 'floodlit' ? th.accent : th.ink) : s === 'CANCELLED' ? th.textFaint : th.textMute,
  });

  const load = useCallback(async (): Promise<ClubReservation[]> => {
    if (!token || !clubId) return [];
    setLoading(true);
    try {
      setError(null);
      const [detail, res, resv, mem] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetResources(clubId, token),
        api.adminGetReservations(clubId, date ? { date } : {}, token),
        api.adminGetMembers(clubId, token),
      ]);
      setClubDetail(detail);
      setTz(detail.timezone);
      setPeak(detail.offPeakHours ?? null);
      setResources(res.filter((r) => r.isActive));
      setMembers(mem);
      setData(resv);
      return resv.reservations;
    } catch (e) { setError((e as Error).message); return []; }
    finally { setLoading(false); }
  }, [token, clubId, date]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const cancel = async (r: ClubReservation) => {
    if (!token || !clubId) return;
    setCancelling(true);
    try { setError(null); await api.adminCancelReservation(clubId, r.id, token); setConfirmCancel(null); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setCancelling(false); }
  };

  // Derived helpers
  const resById = new Map(resources.map((r) => [r.id, r]));
  const dueOf = (r: ClubReservation) => dueCents(r, resById.get(r.resourceId), peak, tz);
  const playersOf = (r: ClubReservation) => playerCount(typeof resById.get(r.resourceId)?.attributes?.format === 'string' ? (resById.get(r.resourceId)!.attributes.format as string) : undefined);
  const remainingOf = (r: ClubReservation) => Math.max(0, dueOf(r) - toCents(r.paidAmount));
  const isCollectable = (r: ClubReservation) => r.status !== 'CANCELLED' && remainingOf(r) > 0;

  const refreshSelected = useCallback(async (updated?: ClubReservation) => {
    const list = await load();
    setSelected((cur) => (updated ?? (cur ? list.find((r) => r.id === cur.id) ?? cur : cur)));
  }, [load]);

  const openH  = resources.length ? Math.min(...resources.map((r) => r.openHour)) : 8;
  const closeH = resources.length ? Math.max(...resources.map((r) => r.closeHour)) : 22;
  const nowHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date()));

  const visible = (data?.reservations ?? []).filter((r) =>
    matchesQuery(r, query) &&
    outstandingFilter(outMode, dueOf(r), toCents(r.paidAmount), r.status === 'CANCELLED') &&
    ((fromHour == null && toHour == null) || overlapsHourWindow(r, fromHour ?? openH, toHour ?? closeH, tz)),
  );

  // Tri + groupe par terrain (ordre de la page Terrains = ordre du tableau `resources`).
  const rankOf = new Map(resources.map((r, i) => [r.id, i]));
  const sortedVisible = [...visible].sort((a, b) => {
    const ra = rankOf.get(a.resourceId) ?? resources.length;
    const rb = rankOf.get(b.resourceId) ?? resources.length;
    return ra !== rb ? ra - rb : a.startTime.localeCompare(b.startTime);
  });
  const groups: { resource: { id: string; name: string }; rows: ClubReservation[] }[] = [];
  for (const r of sortedVisible) {
    const last = groups[groups.length - 1];
    if (last && last.resource.id === r.resourceId) last.rows.push(r);
    else groups.push({ resource: r.resource, rows: [r] });
  }

  // KPI du jour (hors annulées).
  const kpiRows = visible.filter((r) => r.status !== 'CANCELLED');
  const totalDay = kpiRows.reduce((s, r) => s + dueOf(r), 0);
  const paidDay  = kpiRows.reduce((s, r) => s + toCents(r.paidAmount), 0);
  const restDay  = Math.max(0, totalDay - paidDay);
  const pctDay   = totalDay > 0 ? Math.round((paidDay / totalDay) * 100) : 0;
  const dueCount = kpiRows.filter(isCollectable).length;
  const encCount = kpiRows.reduce((s, r) => s + r.payments.length, 0);

  // Réservation affichée dans le panneau latéral (desktop) — id stable, re-dérivée depuis les données.
  const allResas = data?.reservations ?? [];
  const selectedRow: ClubReservation | null = (() => {
    if (selectedRowId) { const r = allResas.find((x) => x.id === selectedRowId); if (r) return r; }
    if (wide) return sortedVisible.find(isCollectable) ?? sortedVisible[0] ?? null;
    return null;
  })();

  const onPanelPaid = useCallback(async () => { await load(); }, [load]);

  const kpiTile = (label: string, value: string, color: string, sub: string, bar?: number) => (
    <div style={{ flex: '1 1 200px', background: th.surface, borderRadius: 16, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textMute }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5, marginTop: 6, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 12.5, color: th.textMute, marginTop: 4 }}>{sub}</div>
      {bar != null && <div style={{ marginTop: 12, height: 7, borderRadius: 999, background: th.surfaceHi, overflow: 'hidden' }}><div style={{ height: '100%', width: `${bar}%`, background: SETTLED_COLOR, transition: 'width .4s ease' }} /></div>}
    </div>
  );

  const renderRow = (r: ClubReservation) => {
    const cancelled = r.status === 'CANCELLED';
    const due = dueOf(r);
    const rem = remainingOf(r);
    const sttld = due > 0 && rem <= 0 && !cancelled;
    const partial = due > 0 && toCents(r.paidAmount) > 0 && rem > 0;
    const rail = cancelled ? th.textFaint : sttld ? SETTLED_COLOR : partial ? th.accentWarm : due > 0 ? CORAL : th.textFaint;
    const isSel = (wide ? selectedRow?.id : selectedRowId) === r.id && !cancelled;
    const dots = paymentDots(r, playersOf(r), due);
    const who = r.title?.trim() ? r.title : r.user ? `${r.user.firstName} ${r.user.lastName}` : 'Événement';
    return (
      <div key={r.id}>
        <button type="button" onClick={() => { if (cancelled) return; setSelectedRowId((prev) => (!wide && prev === r.id) ? null : r.id); }}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', marginBottom: 8,
            padding: '11px 13px', borderRadius: 13, background: isSel ? `${th.accent}0d` : th.surface,
            boxShadow: `inset 0 0 0 ${isSel ? 2 : 1}px ${isSel ? th.accent : th.line}`,
            cursor: cancelled ? 'default' : 'pointer', opacity: cancelled ? 0.55 : 1, fontFamily: th.fontUI }}>
          <span style={{ width: 4, height: 34, borderRadius: 999, background: rail, flexShrink: 0 }} />
          <span style={{ fontFamily: th.fontMono, fontSize: 13, fontWeight: 600, color: th.text, width: 46, flexShrink: 0 }}>{fmtTime(r.startTime)}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</span>
          {dots && <PaymentDots dots={dots} color={th.accent} />}
          <span style={{ fontFamily: th.fontUI, fontSize: 13, whiteSpace: 'nowrap', color: th.textMute }}>
            {cancelled ? 'Annulée'
              : sttld ? <span style={{ color: SETTLED_COLOR, fontWeight: 600 }}>Soldé</span>
              : rem > 0 ? <>reste <b style={{ color: CORAL, fontVariantNumeric: 'tabular-nums' }}>{fmtEuros(rem)}</b></>
              : due > 0 ? <span style={{ color: SETTLED_COLOR, fontWeight: 600 }}>Soldé</span>
              : '—'}
          </span>
        </button>
        {!wide && isSel && (
          <PaymentPanel reservation={r} due={due} clubId={clubId!} token={token!} variant="inline"
            onPaid={onPanelPaid} onError={(m) => setError(m)} onOpenDetails={() => setSelected(r)} onCancel={() => setConfirmCancel(r)} />
        )}
      </div>
    );
  };

  return (
    <div>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 20px', color: th.text }}>Paiements</h1>

      {/* KPI du jour */}
      {data && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
          {kpiTile("Encaissé aujourd'hui", fmtEuros(paidDay), th.mode === 'floodlit' ? th.accent : SETTLED_COLOR, `${encCount} encaissement${encCount > 1 ? 's' : ''}`)}
          {kpiTile('Reste à encaisser', fmtEuros(restDay), CORAL, `${dueCount} réservation${dueCount > 1 ? 's' : ''}`, pctDay)}
          {kpiTile('Total du jour', fmtEuros(totalDay), th.text, `${kpiRows.length} réservation${kpiRows.length > 1 ? 's' : ''} · ${groups.length} terrain${groups.length > 1 ? 's' : ''}`)}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <label style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, display: 'flex', alignItems: 'center', gap: 8 }}>
          Jour
          <DateField value={date} onChange={setDate} size="sm" />
        </label>
        {date && <button onClick={() => setDate('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.accent }}>Tout afficher</button>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Rechercher un client…" style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 14, minWidth: 220 }} />
        {(['all', 'due', 'paid'] as OutstandingMode[]).map((m) => (
          <button key={m} type="button" onClick={() => setOut(m)} style={{ border: `1px solid ${outMode === m ? th.accent : th.line}`, background: outMode === m ? `${th.accent}22` : 'transparent', color: th.text, borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
            {m === 'all' ? 'Tout' : m === 'due' ? 'À encaisser' : 'Payées'}
          </button>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
          De
          <select value={fromHour ?? ''} onChange={(e) => setFrom(e.target.value === '' ? null : Number(e.target.value))} style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '6px 8px' }}>
            <option value="">—</option>
            {Array.from({ length: closeH - openH }, (_, i) => openH + i).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>)}
          </select>
          à
          <select value={toHour ?? ''} onChange={(e) => setTo(e.target.value === '' ? null : Number(e.target.value))} style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '6px 8px' }}>
            <option value="">—</option>
            {Array.from({ length: closeH - openH + 1 }, (_, i) => openH + i).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>)}
          </select>
        </span>
        <button type="button" onClick={() => { setDate(todayISO()); setFrom(Math.min(Math.max(nowHour(), openH), closeH - 1)); setTo(closeH); }} style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>En ce moment</button>
        {(fromHour != null || toHour != null || outMode !== 'all' || query) && (
          <button type="button" onClick={() => { setFrom(null); setTo(null); setOut('all'); setQuery(''); }} style={{ border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 }}>Effacer</button>
        )}
      </div>

      {error && <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : (
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          {/* liste groupée par terrain */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {groups.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint, background: th.surface, borderRadius: 16, boxShadow: `inset 0 0 0 1px ${th.line}` }}>Aucune réservation</div>
            ) : groups.map((g) => {
              const gRows = g.rows.filter((r) => r.status !== 'CANCELLED');
              const gDue = gRows.reduce((s, r) => s + dueOf(r), 0);
              const gPaid = gRows.reduce((s, r) => s + toCents(r.paidAmount), 0);
              const gRem = Math.max(0, gDue - gPaid);
              const gPct = gDue > 0 ? Math.round((gPaid / gDue) * 100) : 100;
              const gDueN = gRows.filter(isCollectable).length;
              return (
                <section key={g.resource.id} style={{ marginBottom: 22 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.2, color: th.text }}>{g.resource.name}</span>
                    <span style={{ flex: 1, maxWidth: 200, height: 6, borderRadius: 999, background: th.surfaceHi, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${gPct}%`, background: SETTLED_COLOR }} /></span>
                    <span style={{ fontSize: 12.5, color: th.textMute, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                      {gDueN === 0 ? <span style={{ color: SETTLED_COLOR }}>✓ tout soldé</span> : <>{gDueN} à encaisser · <b style={{ color: CORAL }}>{fmtEuros(gRem)}</b></>}
                    </span>
                  </div>
                  {g.rows.map(renderRow)}
                </section>
              );
            })}
          </div>

          {/* panneau d'encaissement (desktop) */}
          {wide && (
            <aside style={{ width: 344, flexShrink: 0, position: 'sticky', top: 18, alignSelf: 'flex-start' }}>
              {selectedRow ? (
                <PaymentPanel reservation={selectedRow} due={dueOf(selectedRow)} clubId={clubId!} token={token!} variant="side"
                  onPaid={onPanelPaid} onError={(m) => setError(m)} onOpenDetails={() => setSelected(selectedRow)} onCancel={() => setConfirmCancel(selectedRow)} />
              ) : (
                <div style={{ background: th.surface, borderRadius: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: 24, textAlign: 'center', fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint }}>
                  Sélectionne une réservation pour encaisser.
                </div>
              )}
            </aside>
          )}
        </div>
      )}

      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: 28, fontFamily: th.fontUI, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 25, letterSpacing: -0.3, color: th.text }}>{selected.resource.name}</div>
                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ fontFamily: th.fontMono, fontSize: 13, color: th.textMute }}>{fmt(selected.startTime)}</span>
                  <span style={statusStyle(selected.status)}>{STATUS_LABEL[selected.status]}</span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 11, width: 34, height: 34, color: th.textMute, fontSize: 16, flexShrink: 0 }}>✕</button>
            </div>

            {/* Bandeau d'état — reste à encaisser / soldé, lisible d'un coup d'œil */}
            {(() => {
              const dueC = dueOf(selected);
              const paidC = toCents(selected.paidAmount);
              const restC = Math.max(0, dueC - paidC);
              const pct = dueC > 0 ? Math.min(100, Math.round((paidC / dueC) * 100)) : 0;
              const done = dueC > 0 && restC <= 0;
              return (
                <div style={{ marginTop: 18, borderRadius: 16, padding: '16px 18px',
                  background: done ? 'rgba(52,184,136,0.10)' : th.surface2,
                  boxShadow: `inset 0 0 0 1px ${done ? 'rgba(52,184,136,0.30)' : th.line}` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textMute }}>
                        {dueC <= 0 ? 'Encaissé' : done ? 'Statut' : 'Reste à encaisser'}
                      </div>
                      {dueC <= 0 ? (
                        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, letterSpacing: -0.5, lineHeight: 1, marginTop: 6, color: th.text }}>{fmtEuros(paidC)}</div>
                      ) : done ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, lineHeight: 1, marginTop: 6, color: SETTLED_COLOR }}>
                          <Icon name="check" size={24} color={SETTLED_COLOR} />Soldé
                        </div>
                      ) : (
                        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 32, letterSpacing: -1, lineHeight: 1, marginTop: 6, color: CORAL }}>{fmtEuros(restC)}</div>
                      )}
                    </div>
                    {dueC > 0 && (
                      <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 13, color: th.textMute, lineHeight: 1.5 }}>
                        Payé <b style={{ color: th.text }}>{fmtEuros(paidC)}</b><br />sur {fmtEuros(dueC)}
                      </div>
                    )}
                  </div>
                  {dueC > 0 && (
                    <div style={{ marginTop: 14, height: 8, borderRadius: 999, background: th.surfaceHi, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: SETTLED_COLOR, transition: 'width .35s ease' }} />
                    </div>
                  )}
                </div>
              );
            })()}

            <div style={{ marginTop: 20 }}>
              <CollectPanel reservation={selected} due={dueOf(selected)} players={playersOf(selected)} members={members} clubId={clubId!} token={token!} onChanged={refreshSelected} onError={(msg) => setError(msg)} />
            </div>

            {selected.payments.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textMute }}>Encaissements</span>
                  <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>Total <b style={{ color: th.text }}>{fmtEuros(selected.payments.reduce((s, p) => s + toCents(p.amount), 0))}</b></span>
                </div>
                <div>
                  {selected.payments.map((p, i) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 2px', borderTop: i === 0 ? 'none' : `1px solid ${th.line}` }}>
                      <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={METHOD_ICON[p.method]} size={16} color={th.textMute} />
                      </span>
                      <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, minWidth: 62, color: th.text, fontVariantNumeric: 'tabular-nums' }}>{fmtEuros(toCents(p.amount))}</span>
                      <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>{METHOD_LABEL[p.method]}</span>
                      <span style={{ fontFamily: th.fontMono, fontSize: 12, color: th.textFaint }}>{fmtTime(p.createdAt)}</span>
                      <button type="button" onClick={() => setReceiptTarget({ payment: p, rv: selected })} style={{ border: 'none', boxShadow: `inset 0 0 0 1px ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 9, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600 }}>Reçu</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {receiptTarget && clubDetail && (
        <>
          <style>{`@media print { body * { visibility: hidden !important; } .receipt-print-overlay, .receipt-print-overlay * { visibility: visible !important; } .receipt-print-overlay { position: absolute; inset: 0; background: #fff !important; } .receipt-print-overlay .no-print { display: none !important; } }`}</style>
          <div className="receipt-print-overlay" onClick={() => setReceiptTarget(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: 18, boxShadow: '0 8px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
              <Receipt payment={toCaissePayment(receiptTarget.payment, receiptTarget.rv)} clubName={clubDetail.name} clubAddress={clubDetail.address} />
              <div className="no-print" style={{ display: 'flex', gap: 10, padding: '12px 24px 20px', background: '#fff' }}>
                <button type="button" onClick={() => window.print()} style={{ flex: 1, border: 'none', background: '#111', color: '#fff', borderRadius: 10, padding: '10px 0', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700 }}>Imprimer</button>
                <button type="button" onClick={() => setReceiptTarget(null)} style={{ border: '1px solid #ccc', background: 'transparent', color: '#555', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: 14 }}>Fermer</button>
              </div>
            </div>
          </div>
        </>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Annuler la réservation ?"
          detail={
            <>
              {confirmCancel.resource.name} · {confirmCancel.title?.trim() ? confirmCancel.title : confirmCancel.user ? `${confirmCancel.user.firstName} ${confirmCancel.user.lastName}` : 'Événement'}
              {' · '}{fmt(confirmCancel.startTime)}
            </>
          }
          message="Cette action est définitive et libère le créneau. Le client n'est pas notifié automatiquement."
          confirmLabel="Annuler la réservation"
          cancelLabel="Retour"
          busy={cancelling}
          onConfirm={() => cancel(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}
    </div>
  );
}
