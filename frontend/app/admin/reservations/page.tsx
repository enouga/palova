'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, ClubReservation, ClubReservationsResponse, PaymentMethod, AdminResource, OffPeakHours, Member, ClubAdminDetail, Payment, CaissePayment } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { DateField } from '@/components/ui/DateField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CollectPanel } from '@/components/admin/CollectPanel';
import { Receipt } from '@/components/admin/Receipt';
import { dueCents, toCents, fmtEuros } from '@/lib/caisse';
import { playerCount } from '@/lib/courtType';
import { overlapsHourWindow, outstandingFilter, matchesQuery, OutstandingMode } from '@/lib/collect';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

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
};

export default function AdminReservationsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
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
  const [selected, setSelected]       = useState<ClubReservation | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<{ payment: Payment; rv: ClubReservation } | null>(null);

  const [query, setQuery]   = useState('');
  const [outMode, setOut]   = useState<OutstandingMode>('all');
  const [fromHour, setFrom] = useState<number | null>(null);
  const [toHour, setTo]     = useState<number | null>(null);
  const [solderMethod, setSolderMethod] = useState<PaymentMethod>('CASH');
  // moyen « Solder » par défaut mémorisé
  useEffect(() => { const v = typeof window !== 'undefined' ? window.localStorage.getItem('palova:solder-method') : null; if (v) setSolderMethod(v as PaymentMethod); }, []);
  const pickSolder = (m: PaymentMethod) => { setSolderMethod(m); try { window.localStorage.setItem('palova:solder-method', m); } catch { /* stockage indispo */ } };

  const cell: CSSProperties = { padding: '12px 16px', fontFamily: th.fontUI, fontSize: 14, color: th.text };

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

  const refreshSelected = useCallback(async (updated?: ClubReservation) => {
    const list = await load();
    setSelected((cur) => (updated ?? (cur ? list.find((r) => r.id === cur.id) ?? cur : cur)));
  }, [load]);

  const openH  = resources.length ? Math.min(...resources.map((r) => r.openHour)) : 8;
  const closeH = resources.length ? Math.max(...resources.map((r) => r.closeHour)) : 22;
  const visible = (data?.reservations ?? []).filter((r) =>
    matchesQuery(r, query) &&
    outstandingFilter(outMode, dueOf(r), toCents(r.paidAmount), r.status === 'CANCELLED') &&
    (fromHour == null || toHour == null || overlapsHourWindow(r, fromHour, toHour, tz)),
  );
  const sumDue  = visible.reduce((s, r) => s + dueOf(r), 0);
  const sumPaid = visible.reduce((s, r) => s + toCents(r.paidAmount), 0);
  const nowHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date()));

  return (
    <div>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 20px', color: th.text }}>Réservations & paiements</h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <label style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, display: 'flex', alignItems: 'center', gap: 8 }}>
          Jour
          <DateField value={date} onChange={setDate} size="sm" />
        </label>
        {date && <button onClick={() => setDate('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.accent }}>Tout afficher</button>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
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
        <button type="button" onClick={() => { setDate(todayISO()); setFrom(nowHour()); setTo(closeH); }} style={{ border: `1px solid ${th.line}`, background: th.surface2, color: th.text, borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>En ce moment</button>
        {(fromHour != null || toHour != null || outMode !== 'all' || query) && (
          <button type="button" onClick={() => { setFrom(null); setTo(null); setOut('all'); setQuery(''); }} style={{ border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 }}>Effacer</button>
        )}
      </div>

      {error &&<div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {data && (
        <div style={{ display: 'flex', gap: 24, marginBottom: 16, fontFamily: th.fontUI, fontSize: 14, flexWrap: 'wrap' }}>
          <span style={{ color: th.textMute }}>Total dû : <b style={{ color: th.text }}>{fmtEuros(sumDue)}</b></span>
          <span style={{ color: th.textMute }}>Encaissé : <b style={{ color: th.mode === 'floodlit' ? th.accent : th.ink }}>{fmtEuros(sumPaid)}</b></span>
          <span style={{ color: th.textMute }}>Reste dû : <b style={{ color: '#ff7a4d' }}>{fmtEuros(Math.max(0, sumDue - sumPaid))}</b></span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 18, background: th.surface, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${th.line}`, textAlign: 'left' }}>
                {['Ressource', 'Client', 'Début', 'Montant', 'Payé', 'Statut', ''].map((h, i) => (
                  <th key={i} style={{ padding: '12px 16px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, color: th.textMute }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={7} style={{ ...cell, textAlign: 'center', color: th.textFaint, padding: '32px 16px' }}>Aucune réservation</td></tr>
              )}
              {visible.map((r) => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${th.line}` }}>
                  <td style={{ ...cell, fontWeight: 600 }}>{r.resource.name}</td>
                  <td style={cell}>{r.title?.trim() ? r.title : r.user ? `${r.user.firstName} ${r.user.lastName}` : 'Événement'}{r.user && <div style={{ fontSize: 12, color: th.textFaint }}>{r.user.email}</div>}</td>
                  <td style={{ ...cell, fontFamily: th.fontMono, fontSize: 13 }}>{fmt(r.startTime)}</td>
                  <td style={cell}>{fmtEuros(dueOf(r))}</td>
                  <td style={cell}>
                    {(() => {
                      const rest = Math.max(0, dueOf(r) - toCents(r.paidAmount));
                      const fullyPaid = rest <= 0 && r.status !== 'CANCELLED' && dueOf(r) > 0;
                      return (<>
                        <span style={{ fontWeight: 600, color: fullyPaid ? (th.mode === 'floodlit' ? th.accent : th.ink) : th.text }}>{fmtEuros(toCents(r.paidAmount))}</span>
                        {r.status !== 'CANCELLED' && rest > 0 && <span style={{ fontSize: 12, color: '#ff7a4d', marginLeft: 6 }}>reste {fmtEuros(rest)}</span>}
                        {fullyPaid && <span style={{ fontSize: 12, color: th.textMute, marginLeft: 6 }}>✓</span>}
                      </>);
                    })()}
                  </td>
                  <td style={cell}><span style={statusStyle(r.status)}>{STATUS_LABEL[r.status]}</span></td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    {(() => { const rest = Math.max(0, dueOf(r) - toCents(r.paidAmount)); if (r.status === 'CANCELLED' || rest <= 0) return null;
                      const solder = async () => { if (!token || !clubId) return; try { setError(null); await api.adminAddPayment(clubId, r.id, { amount: rest / 100, method: solderMethod }, token); await load(); } catch (e) { setError((e as Error).message); } };
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8 }}>
                          <button onClick={solder} title={`Solder ${fmtEuros(rest)} en ${METHOD_LABEL[solderMethod]}`} style={{ border: `1px solid ${th.line}`, background: th.surface2, cursor: 'pointer', borderRadius: 9, padding: '6px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>Solder</button>
                          <select value={solderMethod} onChange={(e) => pickSolder(e.target.value as PaymentMethod)} title="Moyen par défaut" style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '5px 4px', fontSize: 12 }}>
                            {(['CASH', 'CARD', 'TRANSFER'] as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                          </select>
                        </span>
                      ); })()}
                    {r.status !== 'CANCELLED' && (
                      <button onClick={() => setSelected(r)} style={{ border: 'none', cursor: 'pointer', borderRadius: 9, padding: '6px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, background: th.accent, color: th.onAccent, marginRight: 8 }}>
                        Encaisser{r.payments.length ? ` (${r.payments.length})` : ''}
                      </button>
                    )}
                    {r.status !== 'CANCELLED' && (
                      <button onClick={() => setConfirmCancel(r)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 9, padding: '6px 11px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: '#ff7a4d' }}>Annuler</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: 28, fontFamily: th.fontUI, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, color: th.text }}>{selected.resource.name}</div>
                <div style={{ fontFamily: th.fontMono, fontSize: 13, color: th.textMute, marginTop: 2 }}>{fmt(selected.startTime)} · {STATUS_LABEL[selected.status]}</div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 9, width: 32, height: 32, color: th.textMute, fontSize: 16 }}>✕</button>
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 18, fontFamily: th.fontUI, fontSize: 13 }}>
              <span style={{ color: th.textMute }}>Total : <b style={{ color: th.text }}>{fmtEuros(dueOf(selected))}</b></span>
              <span style={{ color: th.textMute }}>Payé : <b style={{ color: th.text }}>{fmtEuros(toCents(selected.paidAmount))}</b></span>
              <span style={{ color: th.textMute }}>Reste : <b style={{ color: '#ff7a4d' }}>{fmtEuros(Math.max(0, dueOf(selected) - toCents(selected.paidAmount)))}</b></span>
            </div>
            <div style={{ marginTop: 16 }}>
              <CollectPanel reservation={selected} due={dueOf(selected)} players={playersOf(selected)} members={members} clubId={clubId!} token={token!} onChanged={refreshSelected} onError={(msg) => setError(msg)} />
            </div>
            {selected.payments.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: th.textMute, marginBottom: 8 }}>Encaissements</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selected.payments.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
                      <span style={{ fontWeight: 700, minWidth: 64 }}>{fmtEuros(toCents(p.amount))}</span>
                      <span style={{ color: th.textMute }}>{METHOD_LABEL[p.method]}</span>
                      <button type="button" onClick={() => setReceiptTarget({ payment: p, rv: selected })} style={{ marginLeft: 'auto', border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 9, padding: '4px 9px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600 }}>Reçu</button>
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
