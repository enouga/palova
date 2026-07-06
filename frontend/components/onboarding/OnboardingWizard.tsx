'use client';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ClubAdminDetail, AdminClubSport, AdminResource, Sport } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { STEP_ORDER, StepKey, PreviewState } from '@/lib/onboarding';
import { Logotype } from '@/components/ui/atoms';
import { LivePhonePreview } from './LivePhonePreview';
import { WIZ } from './wizardUi';
import { StepIdentity } from './StepIdentity';
import { StepSports } from './StepSports';
import { StepCourts } from './StepCourts';
import { StepRules } from './StepRules';
import { StepLaunch } from './StepLaunch';

/**
 * Wizard d'onboarding plein écran (« aperçu vivant ») : 5 étapes, chaque validation
 * enregistre immédiatement via les routes admin existantes. Ré-ouvrable et idempotent :
 * tout est pré-rempli depuis l'état réel du club.
 */
export function OnboardingWizard() {
  const router = useRouter();
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club: hostClub } = useClub();
  const clubId = hostClub?.id;

  const [club, setClub] = useState<ClubAdminDetail | null>(null);
  const [clubSports, setClubSports] = useState<AdminClubSport[]>([]);
  const [resources, setResources] = useState<AdminResource[]>([]);
  const [catalog, setCatalog] = useState<Sport[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [finished, setFinished] = useState(false);
  // Desktop par défaut (rendu SSR/premier client identiques) ; l'effet corrige au montage
  // via le vrai matchMedia — sur mobile il masque l'aperçu derrière un bouton.
  const [isDesktop, setIsDesktop] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 860px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!ready || !token || !clubId) return;
    Promise.all([
      api.adminGetClub(clubId, token),
      api.adminGetSports(clubId, token),
      api.adminGetResources(clubId, token),
      api.getSports(),
    ]).then(([c, cs, res, cat]) => {
      setClub(c); setClubSports(cs); setResources(res); setCatalog(cat);
    }).catch(() => setLoadError(true));
  }, [ready, token, clubId]);

  const preview: PreviewState | null = useMemo(() => {
    if (!club) return null;
    return {
      name: club.name, slug: club.slug, logoUrl: club.logoUrl, accentColor: club.accentColor,
      sports: clubSports.map((cs) => {
        const list = resources.filter((r) => r.clubSport.id === cs.id && r.isActive);
        const prices = list.map((r) => Number(r.price)).filter((n) => Number.isFinite(n) && n > 0);
        const cat = catalog.find((s) => s.id === cs.sport.id);
        return {
          key: cs.sport.key, name: cs.sport.name, icon: cat?.icon ?? null,
          noun: cs.sport.resourceNoun, courtCount: list.length,
          minPrice: prices.length ? Math.min(...prices) : null,
        };
      }),
    };
  }, [club, clubSports, resources, catalog]);

  if (!club || !clubId || !token || !preview) {
    return (
      <div style={{ minHeight: '100vh', background: WIZ.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: WIZ.mute, fontFamily: th.fontUI, fontSize: 14, padding: 24, textAlign: 'center' }}>
        {loadError ? 'Impossible de charger votre club. Rechargez la page.' : 'Chargement…'}
      </div>
    );
  }

  const advance = () => setStepIdx((i) => Math.min(i + 1, STEP_ORDER.length - 1));
  const step: StepKey = STEP_ORDER[stepIdx];
  const onLocal = (patch: Partial<ClubAdminDetail>) => setClub((c) => (c ? { ...c, ...patch } : c));

  let stepEl: ReactNode;
  if (step === 'identity') {
    stepEl = <StepIdentity club={club} clubId={clubId} token={token} onLocal={onLocal} onPatched={setClub} advance={advance} />;
  } else if (step === 'sports') {
    stepEl = <StepSports clubName={club.name} catalog={catalog} clubSports={clubSports} clubId={clubId} token={token}
      onAdded={(cs) => setClubSports((l) => [...l, cs])} advance={advance} />;
  } else if (step === 'courts') {
    stepEl = <StepCourts clubName={club.name} clubSports={clubSports} resources={resources} clubId={clubId} token={token}
      onCreated={(r) => setResources((l) => [...l, r])} advance={advance} />;
  } else if (step === 'rules') {
    stepEl = <StepRules club={club} clubId={clubId} token={token} onPatched={setClub} advance={advance} />;
  } else {
    stepEl = <StepLaunch club={club} preview={preview} clubId={clubId} token={token} onPatched={setClub} onFinished={() => setFinished(true)} />;
  }

  return (
    <div style={{ minHeight: '100vh', background: `linear-gradient(160deg, ${WIZ.bg} 0%, ${WIZ.bg2} 100%)`, display: 'flex', flexDirection: 'column' }}>
      <style>{`@keyframes ob-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        @media (max-width: 559px) { .ob-pip { display: none; } }`}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 26px', gap: 12 }}>
        <Logotype size={20} color="#fff" />
        {!finished && (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }} aria-label={`Étape ${stepIdx + 1} sur ${STEP_ORDER.length}`}>
            {STEP_ORDER.map((k, i) => (
              <span key={k} className="ob-pip" style={{ width: 34, height: 4, borderRadius: 2, background: i <= stepIdx ? club.accentColor : WIZ.line }} />
            ))}
            <span style={{ color: WIZ.faint, fontFamily: th.fontUI, fontSize: 11.5, marginLeft: 6 }}>{stepIdx + 1}/{STEP_ORDER.length}</span>
          </div>
        )}
        {!finished ? (
          <button type="button" onClick={() => router.push('/admin')}
            style={{ background: 'transparent', border: 'none', color: WIZ.mute, fontFamily: th.fontUI, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, whiteSpace: 'nowrap' }}>
            Configurer plus tard →
          </button>
        ) : <span />}
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 34, padding: '10px 34px 30px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
        {/* key = step SEULEMENT (pas `finished`) : StepLaunch gère lui-même sa transition
            form→done via son propre état local `phase` — remonter sur `finished` la perdrait
            (React détruirait l'instance juste après son setPhase('done')).
            Pas d'animation transform sur le conteneur du final : elle piégerait brièvement
            le layer confetti en position:fixed (transform = containing block). */}
        <div key={step}
          style={{ flex: '1 1 340px', maxWidth: finished ? 720 : 440, animation: finished ? undefined : 'ob-rise .35s ease both' }}>
          {stepEl}
        </div>
        {!finished && isDesktop && (
          <div style={{ flex: '1 1 280px', display: 'flex', justifyContent: 'center' }}>
            <LivePhonePreview preview={preview} />
          </div>
        )}
        {!finished && !isDesktop && (
          <div style={{ flexBasis: '100%' }}>
            <button type="button" onClick={() => setPreviewOpen((v) => !v)}
              style={{ background: 'transparent', border: `1px solid ${WIZ.line}`, color: WIZ.mute, borderRadius: 10, padding: '8px 14px', fontFamily: th.fontUI, fontSize: 12.5, cursor: 'pointer' }}>
              {previewOpen ? 'Masquer l’aperçu' : 'Voir l’aperçu ✨'}
            </button>
            {previewOpen && <div style={{ marginTop: 16 }}><LivePhonePreview preview={preview} /></div>}
          </div>
        )}
      </div>
    </div>
  );
}
