'use client';
import type { MemberPackage, MyPayment, Subscription } from '@/lib/api';
import { WalletSection } from '@/components/profile/WalletSection';
import { PaymentMethodSection } from '@/components/profile/PaymentMethodSection';
import { PaymentsHistory } from '@/components/profile/PaymentsHistory';
import { useProfileStyles } from '@/components/profile/shared';

interface Props {
  slug: string;
  token: string;
  packages: MemberPackage[];
  subscriptions: Subscription[];
  payments: MyPayment[];
}

export function ProfileWallet({ slug, token, packages, subscriptions, payments }: Props) {
  const { card, cardTitle } = useProfileStyles();
  return (
    <>
      <section style={card} aria-label="Portefeuille">
        <div style={cardTitle}>Portefeuille</div>
        <WalletSection packages={packages} subscriptions={subscriptions} />
      </section>

      <section style={card} aria-label="Méthodes de paiement">
        <div style={cardTitle}>Méthodes de paiement</div>
        <PaymentMethodSection slug={slug} token={token} />
      </section>

      <section style={card} aria-label="Mes paiements">
        <div style={cardTitle}>Mes paiements</div>
        <PaymentsHistory payments={payments} />
      </section>
    </>
  );
}
