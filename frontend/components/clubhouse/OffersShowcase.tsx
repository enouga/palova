'use client';
import { CSSProperties, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { api, assetUrl, ClubDetail, PublicOffers, PublicPlan, PublicPackageTemplate } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { sportTag, clubIsMultiSport } from '@/lib/sportBadge';
import { offerTint, sportOfferTint, sportKeyColor, sportGroupLabel, groupOffersBySport } from '@/lib/adminOffers';
import { Btn } from '@/components/ui/atoms';
import { SectionHeader, cardStyle } from '@/components/clubhouse/SectionHeader';
import { inkOn } from '@/lib/theme';
import { CgvGate } from '@/components/CgvGate';

const StripePaymentStep = dynamic(() => import('@/components/StripePaymentStep'), { ssr: false });

const euros = (v: string) => `${Number(v).toFixed(2).replace('.', ',')} €`;

type Target = { kind: 'plan'; plan: PublicPlan } | { kind: 'package'; tpl: PublicPackageTemplate };
type Stage = 'details' | 'payment' | 'done';

const planBenefits = (p: PublicPlan, club: ClubDetail | null): string[] => {
  const tag = sportTag(club, p.sportKeys);
  return [
    ...(tag ? [tag] : []),
    p.offPeakOnly ? 'Heures creuses' : 'Toutes heures',
    p.benefit === 'INCLUDED' ? 'Réservations incluses' : `−${p.discountPercent ?? 0} % sur les réservations`,
    ...(p.dailyCap ? [`${p.dailyCap} résa/jour max`] : []),
    ...(p.weeklyCap ? [`${p.weeklyCap} résa/sem. max`] : []),
    `Engagement ${p.commitmentMonths} mois`,
  ];
};

const packageBenefits = (t: PublicPackageTemplate, club: ClubDetail | null): string[] => {
  const tag = sportTag(club, t.sportKeys);
  return [
    ...(tag ? [tag] : []),
    t.kind === 'ENTRIES' ? `${t.entriesCount} entrées` : `${euros(t.walletAmount ?? '0')} crédités`,
    t.validityDays ? `Valable ${t.validityDays} jours` : 'Sans expiration',
  ];
};

type CardEntry = {
  id: string;
  name: string;
  price: string;
  suffix: string | null;
  lines: string[];
  kindLabel: string;
  typeTint: string;
  sportKeys: string[];
  onOpen: () => void;
};

// Vitrine des formules : cartes abonnements + carnets, groupées par sport sur un club multi-sport
// (sections avec kicker coloré, ordre des sports du club). Le bouton « Souscrire » ouvre une
// modale de détail (description complète + caractéristiques) ; le paiement en ligne n'y est
// proposé que si le club l'a activé, sinon la modale invite à régler à l'accueil.
export function OffersShowcase({ offers, token, onAuthPrompt, onPurchased }: {
  offers: PublicOffers;
  token: string | null;
  onAuthPrompt: () => void;
  onPurchased: () => void;
}) {
  const { th } = useTheme();
  const { slug, club } = useClub();
  const [target, setTarget] = useState<Target | null>(null);
  const [stage, setStage] = useState<Stage>('details');

  // Affordance de défilement : on affiche un dégradé + un chevron à gauche/droite seulement
  // quand il reste des cartes cachées de ce côté (signale clairement « il y a plus à voir »).
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [offers.plans.length, offers.packages.length]);

  // Les abonnements sont TOUJOURS affichés, même si le joueur est déjà abonné (choix produit :
  // sur un club multi-sport, un abonné padel doit pouvoir voir/souscrire l'abonnement squash).
  const plans = offers.plans;
  if (plans.length === 0 && offers.packages.length === 0) return null;

  const openDetails = (t: Target) => { setStage('details'); setTarget(t); };
  const close = () => setTarget(null);

  const multiSport = clubIsMultiSport(club);

  const cardEntries: CardEntry[] = [
    ...plans.map((p): CardEntry => ({
      id: `plan-${p.id}`, name: p.name, price: euros(p.monthlyPrice), suffix: '/ mois',
      lines: planBenefits(p, club), kindLabel: 'Abonnement', typeTint: offerTint('SUBSCRIPTION'),
      sportKeys: p.sportKeys, onOpen: () => openDetails({ kind: 'plan', plan: p }),
    })),
    ...offers.packages.map((t): CardEntry => ({
      id: `tpl-${t.id}`, name: t.name, price: euros(t.price), suffix: null,
      lines: packageBenefits(t, club), kindLabel: t.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie',
      typeTint: offerTint(t.kind), sportKeys: t.sportKeys, onOpen: () => openDetails({ kind: 'package', tpl: t }),
    })),
  ];

  const groups = multiSport
    ? groupOffersBySport(cardEntries, club?.clubSports ?? [])
    : [{ key: null as string | null, items: cardEntries }];

  const scrollByPage = (dir: number) => railRef.current?.scrollBy({ left: dir * railRef.current.clientWidth * 0.8, behavior: 'smooth' });
  const navBtn = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute', [side]: 8, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38,
    borderRadius: 99, border: `2px solid ${th.surface}`, background: th.accent, color: inkOn(th.accent),
    boxShadow: '0 3px 12px rgba(0,0,0,0.28)', fontSize: 20, fontWeight: 800, lineHeight: 1, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, fontFamily: th.fontUI,
  });
  const fade = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute', [side]: 0, top: 0, bottom: 14, width: 48, pointerEvents: 'none',
    background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, ${th.bg}, transparent)`,
  });

  // Carte compacte du rail : prix en chiffre vedette, bénéfices en 2 lignes, CTA fin.
  // sportTint colore le bandeau du haut (couleur de sport ; couleur de type si le club n'a qu'un
  // sport) ; typeTint colore le badge et le bouton (abonnement/carnet/porte-monnaie), inchangé.
  const OfferCard = ({ name, price, suffix, lines, kindLabel, sportTint, typeTint, onOpen }: {
    name: string; price: string; suffix: string | null; lines: string[]; kindLabel: string;
    sportTint: string; typeTint: string; onOpen: () => void;
  }) => (
    <div className="of-card" style={{ ...cardStyle(th), flex: '0 0 236px', padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', overflow: 'hidden' }}>
      <span aria-hidden="true" data-testid="offer-stripe" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: sportTint }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: 999, padding: '3px 8px', background: th.mode === 'floodlit' ? `${typeTint}26` : `${typeTint}40`, color: th.mode === 'floodlit' ? typeTint : th.ink }}>
          {kindLabel}
        </span>
      </div>
      <div style={{ position: 'relative', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text, marginTop: 6 }}>{name}</div>
      <div style={{ position: 'relative', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 27, letterSpacing: -0.5, color: th.text }}>
        <span>{price}</span>{suffix && <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, letterSpacing: 0 }}> {suffix}</span>}
      </div>
      <div style={{ position: 'relative', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, lineHeight: 1.55, flex: 1 }}>
        {lines.join(' · ')}
      </div>
      <button onClick={onOpen} style={{
        marginTop: 10, border: `1.5px solid ${typeTint}`, background: 'transparent', color: th.mode === 'floodlit' ? typeTint : th.ink,
        borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, cursor: 'pointer',
      }}>
        Souscrire
      </button>
    </div>
  );

  const targetName = target?.kind === 'plan' ? target.plan.name : target?.tpl.name ?? '';
  const targetKindLabel = target?.kind === 'plan' ? 'Abonnement' : target?.kind === 'package' ? (target.tpl.kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie') : '';
  const targetDescription = target?.kind === 'plan' ? target.plan.description : target?.kind === 'package' ? target.tpl.description : null;
  const targetImageUrl = target?.kind === 'plan' ? target.plan.imageUrl : target?.kind === 'package' ? target.tpl.imageUrl : null;
  const targetLines = target?.kind === 'plan' ? planBenefits(target.plan, club) : target?.kind === 'package' ? packageBenefits(target.tpl, club) : [];
  const targetPrice = target?.kind === 'plan' ? `${euros(target.plan.monthlyPrice)} / mois` : target ? euros(target.tpl.price) : '';
  const amountLabel = target?.kind === 'plan'
    ? `1re mensualité · ${euros(target.plan.monthlyPrice)}`
    : target ? euros(target.tpl.price) : '';

  const souscrire = () => {
    if (!token) { onAuthPrompt(); return; }
    setStage('payment');
  };

  return (
    <section>
      <SectionHeader title="Abonnements & offres" />
      <style>{`.of-card{transition:transform .18s ease}.of-card:hover{transform:translateY(-3px)}`}</style>
      {/* Un seul rail horizontal : chaque sport est un bloc vertical — étiquette EN HAUT + sa
          rangée de cartes dessous —, les blocs posés côte à côte dans le rail qui défile. Le sport
          reste au-dessus de ses cartes sans jamais forcer un saut de ligne entre sports. Dégradé de
          bord + chevron ‹ › quand il reste des cartes cachées → « on ne voit pas tout ». */}
      <div style={{ position: 'relative', margin: '0 -20px' }}>
        <div ref={railRef} className="sp-scroll-x" style={{ display: 'flex', gap: 24, padding: '4px 20px 14px', scrollSnapType: 'x proximity', scrollPaddingLeft: 20 }}>
          {groups.map((g) => (
            <div key={g.key ?? '_other'} style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8, scrollSnapAlign: 'start' }}>
              {multiSport && (
                <div data-testid="offer-sport-kicker" style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 2, fontFamily: th.fontUI, fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: th.textMute }}>
                  <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: sportKeyColor(g.key) }} />
                  {sportGroupLabel(g.key, club)}
                </div>
              )}
              {/* flex:1 → la rangée remplit la colonne-sport (étirée par le rail à la hauteur du
                  plus grand groupe) ; les cartes s'égalisent donc en hauteur d'un sport à l'autre
                  et les boutons « Souscrire » s'alignent (align-items:stretch fait le reste). */}
              <div style={{ display: 'flex', gap: 12, flex: 1, alignItems: 'stretch' }}>
                {g.items.map((entry) => (
                  <OfferCard key={entry.id} name={entry.name} price={entry.price} suffix={entry.suffix}
                    kindLabel={entry.kindLabel} typeTint={entry.typeTint}
                    sportTint={multiSport ? sportOfferTint(entry.sportKeys) : entry.typeTint}
                    lines={entry.lines} onOpen={entry.onOpen} />
                ))}
              </div>
            </div>
          ))}
        </div>
        {edges.left && <span aria-hidden style={fade('left')} />}
        {edges.right && <span aria-hidden style={fade('right')} />}
        {edges.left && <button type="button" aria-label="Offres précédentes" onClick={() => scrollByPage(-1)} style={navBtn('left')}>‹</button>}
        {edges.right && <button type="button" aria-label="Voir plus d’offres" onClick={() => scrollByPage(1)} style={navBtn('right')}>›</button>}
      </div>

      {target && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
          <div role="dialog" aria-modal="true" style={{ position: 'relative', width: '100%', maxWidth: 520, margin: '0 auto', background: th.bgElev, borderRadius: '0 0 28px 28px', padding: '20px 20px 30px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)', maxHeight: '86vh', overflowY: 'auto' }}>
            {stage === 'done' ? (
              <div style={{ textAlign: 'center', fontFamily: th.fontUI }}>
                <div style={{ fontSize: 30 }}>✓</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: th.text, marginTop: 6 }}>C&rsquo;est fait !</div>
                <p style={{ fontSize: 13.5, color: th.textMute }}>Votre {target.kind === 'plan' ? 'abonnement est actif' : 'solde est disponible'} — retrouvez-le dans votre profil.</p>
                <Btn onClick={() => { close(); onPurchased(); }}>Fermer</Btn>
              </div>
            ) : stage === 'payment' ? (
              <CgvGate>
                <StripePaymentStep
                  type="payment"
                  amountLabel={amountLabel}
                  createIntent={async () => {
                    const r = target.kind === 'plan'
                      ? await api.createOfferPlanIntent(slug ?? '', target.plan.id, token!)
                      : await api.createOfferPackageIntent(slug ?? '', target.tpl.id, token!);
                    return { clientSecret: r.clientSecret, stripeAccountId: r.stripeAccountId ?? null, customerSessionClientSecret: r.customerSessionClientSecret ?? null };
                  }}
                  confirm={async (ids) => {
                    if (ids.stripePaymentIntentId) await api.confirmOfferPayment(slug ?? '', ids.stripePaymentIntentId, token!);
                  }}
                  onSuccess={() => setStage('done')}
                  onCancel={close}
                />
              </CgvGate>
            ) : (
              <div>
                {targetImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(targetImageUrl) ?? ''} alt={targetName} style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 12, marginBottom: 14 }} />
                )}
                <div style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: th.accent, marginBottom: 4 }}>
                  {targetKindLabel}
                </div>
                <h3 style={{ margin: 0, fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 21, color: th.text }}>{targetName}</h3>
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 24, letterSpacing: -0.3, color: th.text, marginTop: 6 }}>{targetPrice}</div>

                {targetDescription && (
                  <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.text, lineHeight: 1.6, marginTop: 14, whiteSpace: 'pre-wrap' }}>
                    {targetDescription}
                  </p>
                )}

                <ul style={{ margin: '14px 0 0', padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {targetLines.map((l, i) => (
                    <li key={i} style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>{l}</li>
                  ))}
                </ul>

                <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Btn variant="ghost" onClick={close}>Fermer</Btn>
                  {offers.onlinePurchase ? (
                    <Btn onClick={souscrire}>Souscrire · {targetPrice}</Btn>
                  ) : (
                    <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
                      Cette offre se règle directement à l&rsquo;accueil du club.
                    </span>
                  )}
                </div>
              </div>
            )}
            <div style={{ width: 38, height: 5, borderRadius: 3, background: th.lineStrong, margin: '18px auto 0' }} />
          </div>
        </div>
      )}
    </section>
  );
}
