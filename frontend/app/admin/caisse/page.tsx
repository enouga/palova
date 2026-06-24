'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, CaisseSummary, CaissePayment, Member, MemberPackage, PackageTemplate, PaymentMethod, CreateMemberBody, ClubAdminDetail, SubscriptionPlan } from '@/lib/api';
import { packageLabel } from '@/lib/packages';
import { toCents, fmtEuros, validatePaymentAmount } from '@/lib/caisse';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';
import { DateField } from '@/components/ui/DateField';
import { PlayerPicker } from '@/components/admin/PlayerPicker';
import { Receipt } from '@/components/admin/Receipt';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre',
  VOUCHER: 'Ticket CE', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre',
  SUBSCRIPTION: 'Abonnement',
};
// Méthodes qui font entrer de l'argent (les prépayés sont des consommations).
const MONEY_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'OTHER', 'VOUCHER'];
const SALE_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'VOUCHER', 'OTHER'];

function todayISO(): string { return new Date().toISOString().slice(0, 10); }
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

  const [date, setDate]         = useState(todayISO());
  const [caisse, setCaisse]     = useState<CaisseSummary | null>(null);
  const [outstanding, setOut]   = useState('0.00');
  const [vouchers, setVouchers] = useState<CaissePayment[]>([]);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [clubDetail, setClubDetail] = useState<ClubAdminDetail | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<CaissePayment | null>(null);

  // vente de carnet
  const [members, setMembers]     = useState<Member[]>([]);
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [buyer, setBuyer]         = useState<Member | null>(null);
  const [buyerPackages, setBuyerPackages] = useState<MemberPackage[]>([]);
  const [sellTplId, setSellTplId] = useState('');
  const [sellMethod, setSellMethod] = useState<PaymentMethod>('CASH');
  const [sellRef, setSellRef]     = useState('');
  const [sellIssuer, setSellIssuer] = useState('');

  // vente d'abonnement
  const [plans, setPlans]       = useState<SubscriptionPlan[]>([]);
  const [sellPlanId, setSellPlanId] = useState('');

  // remboursement d'un encaissement
  const [refundTarget, setRefundTarget] = useState<CaissePayment | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    try {
      setError(null);
      const [c, resv, v, mem, tpl, detail, pls] = await Promise.all([
        api.adminGetCaisse(clubId, date, token),
        api.adminGetReservations(clubId, { date }, token),
        api.adminGetVouchers(clubId, 'PENDING_REIMBURSEMENT', token),
        api.adminGetMembers(clubId, token),
        api.adminGetPackageTemplates(clubId, token),
        api.adminGetClub(clubId, token),
        api.adminGetSubscriptionPlans(clubId, token),
      ]);
      setCaisse(c);
      setOut(resv.summary.outstanding);
      setVouchers(v);
      setMembers(mem);
      setTemplates(tpl.filter((t) => t.isActive));
      setClubDetail(detail);
      setPlans(pls.filter((p) => p.isActive));
    } catch (e) { setError((e as Error).message); }
  }, [token, clubId, date]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const pickBuyer = async (m: Member) => {
    if (!token || !clubId) return;
    setBuyer(m);
    try { setBuyerPackages(await api.adminGetMemberPackages(clubId, m.userId, token)); }
    catch (e) { setError((e as Error).message); }
  };

  // Création d'un joueur à la volée : crée le compte+adhésion, recharge le
  // fichier-membres, puis sélectionne le nouvel acheteur.
  const createBuyer = async (body: CreateMemberBody) => {
    if (!token || !clubId) return { tempPassword: null, existed: false };
    const r = await api.adminCreateMember(clubId, body, token);
    const mem = await api.adminGetMembers(clubId, token);
    setMembers(mem);
    const created = mem.find((m) => m.email.toLowerCase() === body.email.toLowerCase());
    if (created) await pickBuyer(created);
    return r;
  };

  const sell = async () => {
    if (!token || !clubId || !buyer || !sellTplId) return;
    if (sellMethod === 'VOUCHER' && !sellRef.trim()) { setError('Référence du ticket CE requise.'); return; }
    setBusy(true);
    try {
      setError(null);
      await api.adminSellPackage(clubId, buyer.userId, {
        templateId: sellTplId, method: sellMethod,
        payerName: `${buyer.firstName} ${buyer.lastName}`,
        voucherRef: sellMethod === 'VOUCHER' ? sellRef.trim() : undefined,
        voucherIssuer: sellMethod === 'VOUCHER' ? sellIssuer.trim() || undefined : undefined,
      }, token);
      setSellRef(''); setSellIssuer('');
      await Promise.all([load(), pickBuyer(buyer)]);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const sellSub = async () => {
    if (!token || !clubId || !buyer || !sellPlanId) return;
    if (sellMethod === 'VOUCHER' && !sellRef.trim()) { setError('Référence du ticket CE requise.'); return; }
    setBusy(true);
    try {
      setError(null);
      await api.adminSellSubscription(clubId, buyer.userId, {
        planId: sellPlanId, method: sellMethod,
        payerName: `${buyer.firstName} ${buyer.lastName}`,
        voucherRef: sellMethod === 'VOUCHER' ? sellRef.trim() : undefined,
        voucherIssuer: sellMethod === 'VOUCHER' ? sellIssuer.trim() || undefined : undefined,
      }, token);
      await Promise.all([load(), pickBuyer(buyer)]);
    } catch (e) { setError((e as Error).message); }
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

  const moneyTotal = caisse
    ? MONEY_METHODS.reduce((s, m) => s + Number(caisse.totalsByMethod[m] ?? 0), 0)
    : 0;

  const input = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 } as const;
  const card = { background: th.surface, borderRadius: 16, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}` } as const;
  const sectionTitle = { fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 as const, color: th.text, marginBottom: 12 };
  const stat = (label: string, value: string) => (
    <div key={label}>
      <div style={{ fontFamily: th.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textFaint }}>{label}</div>
      <div style={{ fontFamily: th.fontDisplay, fontSize: 19, fontWeight: 600, color: th.text }}>{value}</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 0 18px', flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text }}>Caisse</h1>
        <DateField value={date} onChange={setDate} size="sm" />
      </div>

      {error && <div style={{ marginBottom: 16, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {/* totaux du jour */}
      <div style={{ ...card, marginBottom: 18 }}>
        <div style={sectionTitle}>Journée du {date}</div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {stat('Encaissé', euro(moneyTotal))}
          {stat('Reste dû (jour)', euro(outstanding))}
          {(Object.entries(caisse?.totalsByMethod ?? {}) as [PaymentMethod, string][]).map(([m, v]) => stat(METHOD_LABEL[m], euro(v)))}
        </div>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(caisse?.payments ?? []).map((p) => {
            const refunded = toCents(p.refundedAmount ?? '0');
            const isFullyRefunded = p.status === 'REFUNDED';
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 13, color: th.text, padding: '7px 0', borderTop: `1px solid ${th.line}` }}>
                <span style={{ flex: 1 }}>{paymentLabel(p)}</span>
                <span style={{ color: th.textMute }}>{METHOD_LABEL[p.method]}{p.voucherRef ? ` · ${p.voucherRef}` : ''}</span>
                {refunded > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#ff7a4d', background: '#ff7a4d22', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                    remboursé {fmtEuros(refunded)}
                  </span>
                )}
                <b style={{ color: isFullyRefunded ? th.textMute : th.text }}>{euro(p.amount)}</b>
                {!isFullyRefunded && (
                  <button type="button" onClick={() => openRefund(p)} disabled={busy}
                    style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9, padding: '4px 9px', cursor: busy ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Rembourser
                  </button>
                )}
                <button type="button" onClick={() => setReceiptTarget(p)}
                  style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 9, padding: '4px 9px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Reçu
                </button>
              </div>
            );
          })}
          {caisse && caisse.payments.length === 0 && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>Aucun encaissement ce jour.</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18 }}>
        {/* vente de carnet / porte-monnaie */}
        <div style={card}>
          <div style={sectionTitle}>Vendre une offre</div>
          <div style={{ marginBottom: 12 }}>
            <PlayerPicker
              members={members}
              value={buyer ? { firstName: buyer.firstName, lastName: buyer.lastName } : null}
              onSelect={pickBuyer}
              onClear={() => { setBuyer(null); setBuyerPackages([]); }}
              onCreate={createBuyer}
              placeholder="Cliquez pour voir les membres, ou tapez un nom…"
            />
          </div>

          {buyer && (
            <>
              {buyerPackages.length > 0 && (
                <div style={{ marginBottom: 12, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                  Soldes actuels : {buyerPackages.map((p) => packageLabel(p)).join(' · ')}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 }}>Offre
                  <select value={sellTplId} onChange={(e) => setSellTplId(e.target.value)} style={input}>
                    <option value="">Choisir…</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name} — {euro(t.price)}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Moyen
                  <select value={sellMethod} onChange={(e) => setSellMethod(e.target.value as PaymentMethod)} style={input}>
                    {SALE_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                  </select>
                </label>
                {sellMethod === 'VOUCHER' && (
                  <>
                    <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Référence
                      <input type="text" value={sellRef} onChange={(e) => setSellRef(e.target.value)} placeholder="N° du ticket" style={{ ...input, width: 120 }} />
                    </label>
                    <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Émetteur
                      <input type="text" value={sellIssuer} onChange={(e) => setSellIssuer(e.target.value)} placeholder="ANCV…" style={{ ...input, width: 100 }} />
                    </label>
                  </>
                )}
                <Btn type="button" icon="check" onClick={sell} disabled={busy || !sellTplId}>{busy ? '…' : 'Vendre'}</Btn>
              </div>
            </>
          )}
        </div>

        {/* vente d'abonnement */}
        <div style={card}>
          <div style={sectionTitle}>Vendre un abonnement</div>
          <div style={{ marginBottom: 12 }}>
            <PlayerPicker
              members={members}
              value={buyer ? { firstName: buyer.firstName, lastName: buyer.lastName } : null}
              onSelect={pickBuyer}
              onClear={() => { setBuyer(null); setBuyerPackages([]); }}
              onCreate={createBuyer}
              placeholder="Cliquez pour voir les membres, ou tapez un nom…"
            />
          </div>

          {buyer && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 }}>Abonnement
                <select value={sellPlanId} onChange={(e) => setSellPlanId(e.target.value)} style={input}>
                  <option value="">Choisir…</option>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {euro(p.monthlyPrice)}/mois</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Moyen
                <select value={sellMethod} onChange={(e) => setSellMethod(e.target.value as PaymentMethod)} style={input}>
                  {SALE_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                </select>
              </label>
              {sellMethod === 'VOUCHER' && (
                <>
                  <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Référence
                    <input type="text" value={sellRef} onChange={(e) => setSellRef(e.target.value)} placeholder="N° du ticket" style={{ ...input, width: 120 }} />
                  </label>
                  <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Émetteur
                    <input type="text" value={sellIssuer} onChange={(e) => setSellIssuer(e.target.value)} placeholder="ANCV…" style={{ ...input, width: 100 }} />
                  </label>
                </>
              )}
              <Btn type="button" icon="check" onClick={sellSub} disabled={busy || !sellPlanId}>{busy ? '…' : 'Vendre l’abonnement'}</Btn>
            </div>
          )}
        </div>

        {/* tickets CE à rembourser */}
        <div style={card}>
          <div style={sectionTitle}>Tickets CE à rembourser ({vouchers.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {vouchers.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 13, color: th.text, padding: '7px 0', borderTop: `1px solid ${th.line}` }}>
                <span style={{ flex: 1 }}>{paymentLabel(p)}</span>
                <span style={{ color: th.textMute }}>{p.voucherRef}{p.voucherIssuer ? ` · ${p.voucherIssuer}` : ''}</span>
                <b>{euro(p.amount)}</b>
                <button type="button" onClick={() => reimburse(p)} disabled={busy}
                  style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.text, borderRadius: 9, padding: '5px 10px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600 }}>
                  Remboursé
                </button>
              </div>
            ))}
            {vouchers.length === 0 && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>Aucun ticket en attente.</div>}
          </div>
        </div>
      </div>

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
