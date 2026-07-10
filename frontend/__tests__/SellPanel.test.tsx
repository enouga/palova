import { render, screen, fireEvent } from '@testing-library/react';
import { SellPanel } from '../components/admin/ventes/SellPanel';
import { ThemeProvider } from '../lib/ThemeProvider';
import type { Member, PackageTemplate, SubscriptionPlan, MemberPackage } from '@/lib/api';

jest.mock('../lib/api', () => ({ api: {}, assetUrl: (u: string | null) => u }));

const member: Member = { id: 'm1', userId: 'u1', firstName: 'Marie', lastName: 'Dupont', email: 'marie@x.fr' } as Member;
const templates: PackageTemplate[] = [
  { id: 't1', kind: 'ENTRIES', name: 'Carnet 10', price: '90.00', entriesCount: 10, isActive: true } as PackageTemplate,
];
const plans: SubscriptionPlan[] = [
  { id: 'pl1', name: 'Abo Or', monthlyPrice: '39.00', isActive: true } as SubscriptionPlan,
];

const base = {
  members: [member], templates, plans, buyer: member, buyerPackages: [] as MemberPackage[],
  busy: false, onPickBuyer: jest.fn(), onClear: jest.fn(), onCreate: jest.fn(), onSell: jest.fn(),
};
const renderPanel = (over = {}) => render(<ThemeProvider><SellPanel {...base} {...over} /></ThemeProvider>);

it('propose carnets ET abonnements dans le même panneau', () => {
  renderPanel();
  expect(screen.getByText(/Carnet 10/)).toBeInTheDocument();
  expect(screen.getByText(/Abo Or/)).toBeInTheDocument();
});

it('sélectionner une offre puis Encaisser remonte onSell avec la sélection', () => {
  const onSell = jest.fn();
  renderPanel({ onSell });
  fireEvent.click(screen.getByText(/Carnet 10/));
  fireEvent.click(screen.getByRole('button', { name: /Encaisser/ }));
  expect(onSell).toHaveBeenCalledWith(expect.objectContaining({ kind: 'package', id: 't1', method: 'CASH' }));
});

it('Ticket CE exige une référence avant de vendre', () => {
  const onSell = jest.fn();
  renderPanel({ onSell });
  fireEvent.click(screen.getByText(/Abo Or/));
  fireEvent.click(screen.getByRole('button', { name: 'Ticket CE' }));
  fireEvent.click(screen.getByRole('button', { name: /Encaisser/ }));
  expect(onSell).not.toHaveBeenCalled();               // bloqué : réf manquante
  fireEvent.change(screen.getByPlaceholderText(/N° du ticket/), { target: { value: 'ANCV-1' } });
  fireEvent.click(screen.getByRole('button', { name: /Encaisser/ }));
  expect(onSell).toHaveBeenCalledWith(expect.objectContaining({ kind: 'subscription', id: 'pl1', method: 'VOUCHER', voucherRef: 'ANCV-1' }));
});

it('sans acheteur, invite à choisir un membre', () => {
  renderPanel({ buyer: null });
  expect(screen.queryByText(/Carnet 10/)).not.toBeInTheDocument();
});
