'use client';
import type { MemberPackage, MyPayment, Subscription } from '@/lib/api';
import { WalletSection } from '@/components/profile/WalletSection';
import { PaymentMethodSection } from '@/components/profile/PaymentMethodSection';
import { PaymentsHistory } from '@/components/profile/PaymentsHistory';
import { CardKicker } from '@/components/profile/CardKicker';
import { useProfileStyles } from '@/components/profile/shared';

interface Props {
  slug: string;
  token: string;
  packages: MemberPackage[];
  subscriptions: Subscription[];
  payments: MyPayment[];
}

export function ProfileWallet({ slug, token, packages, subscriptions, payments }: Props) {
  const { card } = useProfileStyles();
  return (
    <>
      <section style={card} aria-label="Portefeuille">
        <CardKicker>Portefeuille</CardKicker>
        <WalletSection packages={packages} subscriptions={subscriptions} />
      </section>

      <section style={card} aria-label="Méthodes de paiement">
        <CardKicker>Méthodes de paiement</CardKicker>
        <PaymentMethodSection slug={slug} token={token} />
      </section>

      <section style={card} aria-label="Mes paiements">
        <CardKicker>Mes paiements</CardKicker>
        <PaymentsHistory payments={payments} />
      </section>
    </>
  );
}
