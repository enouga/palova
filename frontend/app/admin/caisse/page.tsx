'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, CaissePayment, CaisseSummary, Member, MemberPackage, PackageTemplate, PaymentMethod, CreateMemberBody, ClubAdminDetail, SubscriptionPlan } from '@/lib/api';
import { toCents, fmtEuros, validatePaymentAmount, trendSeries, TrendModel } from '@/lib/caisse';
import { addDaysKey, frLongLabel, frWeekday, todayKey } from '@/lib/calendar';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Btn } from '@/components/ui/atoms';
import { DateField } from '@/components/ui/DateField';
import { Receipt } from '@/components/admin/Receipt';
import { TrendKpis } from '@/components/admin/ventes/TrendKpis';
import { DayJournal, JournalFilter } from '@/components/admin/ventes/DayJournal';
import { SellPanel, SellSelection } from '@/components/admin/ventes/SellPanel';
import { SectionTitle } from '@/components/admin/ventes/SectionTitle';

const euro = (s: string | number) => `${Number(s).toFixed(2).replace('.', ',')} €`;

function paymentLabel(p: CaissePayment): string {
  if (p.memberPackage) return `${p.memberPackage.user.firstName} ${p.memberPackage.user.lastName} · ${p.memberPackage.template.name}`;
  if (p.reservation) {
    const who = p.reservation.user ? `${p.reservation.user.firstName} ${p.reservation.user.lastName}` : 'Réservation';
    return `${who} · ${p.reservation.resource.name}`;
  }
  return p.payerName ?? 'Encaissement';
}

export default function AdminCaissePage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const tz = club?.timezone ?? 'Europe/Paris';

  const [date, setDate]       = useState(todayKey());
  const [caisse, setCaisse]   = useState<CaisseSummary | null>(null);
  const [outstanding, setOut] = useState('0.00');
  const [vouchers, setVouchers] = useState<CaissePayment[]>([]);
  const [trend, setTrend]     = useState<TrendModel | null>(null);
  const [filter, setFilter]   = useState<JournalFilter>('all');
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [clubDetail, setClubDetail] = useState<ClubAdminDetail | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<CaissePayment | null>(null);
  const [members, setMembers]     = useState<Member[]>([]);
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [plans, setPlans]         = useState<SubscriptionPlan[]>([]);
  const [buyer, setBuyer]         = useState<Member | null>(null);
  const [buyerPackages, setBuyerPackages] = useState<MemberPackage[]>([]);
  const [refundTarget, setRefundTarget] = useState<CaissePayment | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  // Busy dédié au picker acheteur (distinct de `busy` = encaissement de la vente) : feedback
  // immédiat pendant l'aller-retour réseau de la sélection/création d'un acheteur.
  const [pickingBuyer, setPickingBuyer] = useState(false);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    try {
      setError(null);
      const startKey = addDaysKey(date, -7);
      const mEnd = { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) };
      const mStart = { y: Number(startKey.slice(0, 4)), m: Number(startKey.slice(5, 7)) };
      const sameMonth = mEnd.y === mStart.y && mEnd.m === mStart.m;
      const [c, resv, v, mem, tpl, detail, pls, ...sums] = await Promise.all([
        api.adminGetCaisse(clubId, date, token),
        api.adminGetReservations(clubId, { date }, token),
        api.adminGetVouchers(clubId, 'PENDING_REIMBURSEMENT', token),
        api.adminGetMembers(clubId, token),
        api.adminGetPackageTemplates(clubId, token),
        api.adminGetClub(clubId, token),
        api.adminGetSubscriptionPlans(clubId, token),
        api.adminAccountingSummary(clubId, mEnd.y, mEnd.m, token),
        ...(sameMonth ? [] : [api.adminAccountingSummary(clubId, mStart.y, mStart.m, token)]),
      ]);
      setCaisse(c);
      setOut(resv.summary.outstanding);
      setVouchers(v);
      setMembers(mem);
      setTemplates(tpl.filter((t) => t.isActive));
      setClubDetail(detail);
      setPlans(pls.filter((p) => p.isActive));
      setTrend(trendSeries(sums.flatMap((s) => s.byDay), date));
    } catch (e) { setError((e as Error).message); }
  }, [token, clubId, date]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const pickBuyer = async (m: Member) => {
    if (!token || !clubId) return;
    setPickingBuyer(true);
    setBuyer(m);
    try { setBuyerPackages(await api.adminGetMemberPackages(clubId, m.userId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setPickingBuyer(false); }
  };

  // Création d'un joueur à la volée : crée le compte+adhésion (le back renvoie directement
  // la ligne membre — pas de `adminGetMembers` complet pour la retrouver), l'ajoute au
  // fichier-membres local, puis sélectionne le nouvel acheteur.
  const createBuyer = async (body: CreateMemberBody) => {
    if (!token || !clubId) return { tempPassword: null, existed: false };
    const r = await api.adminCreateMember(clubId, body, token);
    setMembers((cur) => [...cur, r.member]);
    await pickBuyer(r.member);
    return r;
  };

  const onSell = async (sel: SellSelection): Promise<boolean> => {
    if (!token || !clubId || !buyer) return false;
    setBusy(true);
    try {
      setError(null);
      const common = {
        method: sel.method, payerName: `${buyer.firstName} ${buyer.lastName}`,
        voucherRef: sel.voucherRef, voucherIssuer: sel.voucherIssuer,
      };
      if (sel.kind === 'package') await api.adminSellPackage(clubId, buyer.userId, { templateId: sel.id, ...common }, token);
      else await api.adminSellSubscription(clubId, buyer.userId, { planId: sel.id, ...common }, token);
      await load(); // le panneau réinitialise l'acheteur lui-même (onClear) après une vente réussie
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };

  const reimburse = async (p: CaissePayment) => {
    if (!token || !clubId) return;
    setBusy(true);
    try { setError(null); await api.adminSetVoucherStatus(clubId, p.id, 'REIMBURSED', token); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const openRefund = (p: CaissePayment) => {
    const remainingCents = Math.max(0, toCents(p.amount) - toCents(p.refundedAmount ?? '0'));
    setRefundTarget(p);
    setRefundAmount(remainingCents > 0 ? String(remainingCents / 100) : '');
    setRefundReason('');
    setError(null);
  };

  const doRefund = async () => {
    if (!token || !clubId || !refundTarget) return;
    const cents = toCents(refundAmount);
    const remainingCents = Math.max(0, toCents(refundTarget.amount) - toCents(refundTarget.refundedAmount ?? '0'));
    if (!validatePaymentAmount(cents, remainingCents)) { setError('Montant invalide ou supérieur au remboursable.'); return; }
    setBusy(true);
    try {
      setError(null);
      await api.refundPayment(clubId, refundTarget.id, { amount: cents / 100, reason: refundReason.trim() || undefined }, token);
      setRefundTarget(null);
      await load();
    } catch (e) {
      const msg = (e as Error).message;
      setError(
        msg === 'REFUND_EXCEEDS_PAID' ? 'Le remboursement dépasse le montant encaissé.' :
        msg === 'ALREADY_REFUNDED'    ? 'Ce paiement est déjà intégralement remboursé.' :
        msg === 'PAYMENT_NOT_FOUND'   ? 'Paiement introuvable.' :
        msg
      );
    }
    finally { setBusy(false); }
  };

  const input = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 } as const;

  const collectedCents = caisse
    ? (['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER'] as PaymentMethod[])
        .reduce((s, m) => s + toCents(caisse.totalsByMethod[m] ?? '0'), 0)
    : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 0 18px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text }}>Ventes &amp; journée</h1>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 2, textTransform: 'capitalize' }}>{frLongLabel(date)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" aria-label="Jour précédent" onClick={() => setDate(addDaysKey(date, -1))}
            style={{ border: `1px solid ${th.line}`, background: th.surface, color: th.text, borderRadius: 9, width: 34, height: 34, cursor: 'pointer', fontSize: 16 }}>‹</button>
          <DateField value={date} onChange={setDate} size="sm" />
          <button type="button" aria-label="Jour suivant" onClick={() => setDate(addDaysKey(date, 1))}
            style={{ border: `1px solid ${th.line}`, background: th.surface, color: th.text, borderRadius: 9, width: 34, height: 34, cursor: 'pointer', fontSize: 16 }}>›</button>
        </div>
      </div>

      {error && <div style={{ marginBottom: 16, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {trend && <TrendKpis collectedCents={collectedCents} outstanding={outstanding} count={caisse?.payments.length ?? 0} trend={trend} weekday={frWeekday(date)} />}

      <div className="ventes-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(300px, 1fr)', gap: 18, alignItems: 'start' }}>
        <DayJournal
          payments={caisse?.payments ?? []}
          tz={tz}
          totalsByMethod={caisse?.totalsByMethod ?? {}}
          filter={filter}
          onFilter={setFilter}
          onReceipt={setReceiptTarget}
          onRefund={openRefund}
          busy={busy}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SellPanel
            members={members} templates={templates} plans={plans}
            buyer={buyer} buyerPackages={buyerPackages} busy={busy} pickerBusy={pickingBuyer}
            onPickBuyer={pickBuyer} onClear={() => { setBuyer(null); setBuyerPackages([]); }}
            onCreate={createBuyer} onSell={onSell}
          />
          <div style={{ background: th.surface, borderRadius: 16, padding: 18, boxShadow: th.shadow }}>
            <SectionTitle icon="ticket" accent={ACCENTS.apricot} right={
              <span style={{
                fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px',
                background: vouchers.length > 0 ? (th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}33`) : th.surface2,
                color: vouchers.length > 0 ? (th.mode === 'floodlit' ? ACCENTS.coral : '#b23c17') : th.textMute,
              }}>{vouchers.length}</span>
            }>Tickets CE à rembourser</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 340, overflowY: 'auto' }}>
              {vouchers.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, padding: '9px 0', borderTop: `1px solid ${th.line}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{paymentLabel(p)}</div>
                    {p.voucherRef && (
                      <div style={{ fontFamily: th.fontMono, fontSize: 11, color: th.textFaint, marginTop: 1 }}>{p.voucherRef}{p.voucherIssuer ? ` · ${p.voucherIssuer}` : ''}</div>
                    )}
                  </div>
                  <b style={{ fontFamily: th.fontDisplay, fontSize: 13.5, fontWeight: 700, color: th.text, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{euro(p.amount)}</b>
                  <button type="button" onClick={() => reimburse(p)} disabled={busy}
                    style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9, padding: '5px 10px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Remboursé
                  </button>
                </div>
              ))}
              {vouchers.length === 0 && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>Aucun ticket en attente.</div>}
            </div>
          </div>
        </div>
      </div>

      <style>{`@media (max-width: 860px) { .ventes-grid { grid-template-columns: 1fr !important; } .ventes-grid > div:last-child { order: -1; } }`}</style>

      {/* modale reçu imprimable */}
      {receiptTarget && clubDetail && (
        <>
          {/* Style print : masque tout sauf la modale reçu (pattern visibility) */}
          <style>{`@media print { body * { visibility: hidden !important; } .receipt-print-overlay, .receipt-print-overlay * { visibility: visible !important; } .receipt-print-overlay { position: absolute; inset: 0; background: #fff !important; } .receipt-print-overlay .no-print { display: none !important; } }`}</style>
          <div
            className="receipt-print-overlay"
            onClick={() => setReceiptTarget(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          >
            <div onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: 18, boxShadow: '0 8px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
              <Receipt payment={receiptTarget} clubName={clubDetail.name} clubAddress={clubDetail.address} />
              <div className="no-print" style={{ display: 'flex', gap: 10, padding: '12px 24px 20px', background: '#fff' }}>
                <button type="button" onClick={() => window.print()}
                  style={{ flex: 1, border: 'none', background: '#111', color: '#fff', borderRadius: 10, padding: '10px 0', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700 }}>
                  Imprimer
                </button>
                <button type="button" onClick={() => setReceiptTarget(null)}
                  style={{ border: '1px solid #ccc', background: 'transparent', color: '#555', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: 14 }}>
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* modale remboursement */}
      {refundTarget && (
        <div onClick={() => { setRefundTarget(null); setError(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 420, background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: 26, fontFamily: th.fontUI }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, color: th.text }}>Rembourser / corriger</div>
              <button onClick={() => { setRefundTarget(null); setError(null); }} aria-label="Fermer"
                style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 9, width: 32, height: 32, color: th.textMute, fontSize: 16 }}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: th.textMute, marginBottom: 16 }}>
              {paymentLabel(refundTarget)} · <b style={{ color: th.text }}>{euro(refundTarget.amount)}</b>
              {toCents(refundTarget.refundedAmount ?? '0') > 0 && (
                <span style={{ marginLeft: 8, color: '#ff7a4d' }}>déjà remboursé {fmtEuros(toCents(refundTarget.refundedAmount ?? '0'))}</span>
              )}
            </div>
            {error && <div style={{ marginBottom: 14, background: '#ff7a4d', color: '#fff', borderRadius: 10, padding: '9px 13px', fontSize: 13, fontWeight: 600 }}>{error}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Montant à rembourser (€)
                <input
                  type="number" min={0.01} step="0.01" value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  style={{ ...input, width: '100%', boxSizing: 'border-box',
                    border: `1px solid ${!validatePaymentAmount(toCents(refundAmount), Math.max(0, toCents(refundTarget.amount) - toCents(refundTarget.refundedAmount ?? '0'))) && refundAmount !== '' ? '#ff7a4d' : th.line}` }}
                />
              </label>
              <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Motif (optionnel)
                <input
                  type="text" value={refundReason} onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Annulation, erreur de montant…"
                  style={{ ...input, width: '100%', boxSizing: 'border-box' }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button type="button" onClick={() => { setRefundTarget(null); setError(null); }}
                style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 10, padding: '9px 16px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>
                Annuler
              </button>
              <Btn type="button" onClick={doRefund}
                disabled={busy || !validatePaymentAmount(toCents(refundAmount), Math.max(0, toCents(refundTarget.amount) - toCents(refundTarget.refundedAmount ?? '0')))}>
                {busy ? '…' : 'Confirmer le remboursement'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
