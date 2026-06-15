import { CaissePayment, PaymentMethod } from '@/lib/api';
import { fmtEuros, toCents } from '@/lib/caisse';

const METHOD_LABEL: Partial<Record<PaymentMethod, string>> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre',
  VOUCHER: 'Ticket CE', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre',
};

function paymentObject(p: CaissePayment): string {
  if (p.memberPackage) {
    return `Carnet / Offre : ${p.memberPackage.template.name}`;
  }
  if (p.reservation) {
    const slot = `${new Date(p.reservation.startTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    return `Terrain ${p.reservation.resource.name} – ${slot}`;
  }
  return p.note ?? 'Encaissement';
}

export interface ReceiptProps {
  payment: CaissePayment;
  clubName: string;
  clubAddress: string;
}

/** Rendu du reçu (utilisé dans une modale print-friendly ou une fenêtre dédiée). */
export function Receipt({ payment, clubName, clubAddress }: ReceiptProps) {
  const date = new Date(payment.createdAt).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const amountCents = toCents(payment.amount);

  return (
    <div style={{ fontFamily: 'Georgia, serif', color: '#111', maxWidth: 480, margin: '0 auto', padding: '32px 24px', background: '#fff' }}>
      {/* En-tête club */}
      <div style={{ textAlign: 'center', borderBottom: '2px solid #111', paddingBottom: 16, marginBottom: 20 }}>
        <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>{clubName}</div>
        {clubAddress && <div style={{ fontSize: 13, marginTop: 4, color: '#555' }}>{clubAddress}</div>}
      </div>

      {/* Titre reçu */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 16, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
          Reçu de paiement
        </div>
        {payment.receiptNo != null && (
          <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
            n° {payment.receiptNo}
          </div>
        )}
      </div>

      {/* Lignes de détail */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          <Row label="Date" value={date} />
          <Row label="Moyen de paiement" value={METHOD_LABEL[payment.method] ?? payment.method} />
          {payment.payerName && <Row label="Payeur" value={payment.payerName} />}
          <Row label="Objet" value={paymentObject(payment)} />
          {payment.voucherRef && <Row label="Référence ticket" value={payment.voucherRef} />}
        </tbody>
      </table>

      {/* Montant */}
      <div style={{ borderTop: '2px solid #111', marginTop: 20, paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 15, fontWeight: 700 }}>Total encaissé</span>
        <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 22, fontWeight: 700 }}>{fmtEuros(amountCents)}</span>
      </div>

      {/* Mention légale */}
      <div style={{ marginTop: 28, padding: '10px 14px', border: '1px solid #ccc', borderRadius: 6, fontSize: 11.5, color: '#555', fontStyle: 'italic', lineHeight: 1.5 }}>
        Reçu — vaut justificatif de paiement (non-facture). Ce document atteste du règlement de la somme
        indiquée au titre de la prestation mentionnée ci-dessus.
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '7px 0', color: '#666', width: '40%', verticalAlign: 'top' }}>{label}</td>
      <td style={{ padding: '7px 0', fontWeight: 600, verticalAlign: 'top' }}>{value}</td>
    </tr>
  );
}
