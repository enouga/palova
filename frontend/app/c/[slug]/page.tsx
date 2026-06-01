'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ClubDetail } from '@/lib/api';
import { ThemeProvider, useTheme } from '@/lib/ThemeProvider';
import { ThemeMode } from '@/lib/theme';
import { Screen } from '@/components/ui/Screen';
import { Chip, LiveDot, Placeholder, ThemeToggle, LogoutButton } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';

interface FlatResource { id: string; name: string; surface?: string; pricePerHour: string; openHour: number; closeHour: number; sportName: string; }

function ResourceCard({ r }: { r: FlatResource }) {
  const { th } = useTheme();
  const indoor = r.surface !== 'outdoor';
  return (
    <Link href={`/courts/${r.id}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{ background: th.surface, borderRadius: 20, overflow: 'hidden', boxShadow: `${th.shadowSoft}, inset 0 0 0 1px ${th.line}` }}>
        <div style={{ position: 'relative' }}>
          <Placeholder label={r.name} height={96} radius={0} />
          <div style={{ position: 'absolute', top: 10, left: 10 }}>
            <Chip tone="accent" icon={indoor ? 'indoor' : 'sun'}>{indoor ? 'Indoor' : 'Plein air'}</Chip>
          </div>
        </div>
        <div style={{ padding: '13px 15px 15px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 21, color: th.text, lineHeight: 1 }}>{r.name}</div>
            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 4 }}>{r.openHour}h – {r.closeHour}h</div>
          </div>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, color: th.text, lineHeight: 1 }}>
            {Number(r.pricePerHour)}€<span style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textMute, fontWeight: 500 }}> /h</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function ClubContent({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const router = useRouter();
  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <div style={{ padding: '24px 20px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button onClick={() => router.push('/clubs')} aria-label="Annuaire" style={{ border: 'none', cursor: 'pointer', width: 38, height: 38, borderRadius: 12, background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chevL" size={19} color={th.text} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>

          {/* en-tête club brandé */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 22 }}>
            {club.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={club.logoUrl} alt={club.name} style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 14, background: th.accent, color: th.onAccent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 26, flexShrink: 0 }}>
                {club.name.slice(0, 1)}
              </div>
            )}
            <div>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, lineHeight: 1.02, color: th.text, letterSpacing: -0.5 }}>{club.name}</div>
              {club.city && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 4 }}>
                  <Icon name="pin" size={13} color={th.textMute} />{club.city}
                </div>
              )}
            </div>
          </div>

          {club.description && (
            <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: th.textMute, lineHeight: 1.5, marginTop: 14 }}>{club.description}</p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <LiveDot /><span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text }}>Disponibilités en direct</span>
          </div>
        </div>

        {/* ressources par sport */}
        {club.clubSports.map((cs) => (
          <div key={cs.id} style={{ padding: '22px 20px 0' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
              <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>{cs.sport.icon ? `${cs.sport.icon} ` : ''}{cs.sport.name}</span>
              <span style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>· {cs.resources.length}</span>
            </div>
            {cs.resources.length === 0 ? (
              <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint }}>Aucun terrain disponible.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                {cs.resources.map((r) => (
                  <ResourceCard key={r.id} r={{
                    id: r.id, name: r.name,
                    surface: typeof r.attributes?.surface === 'string' ? r.attributes.surface : undefined,
                    pricePerHour: r.pricePerHour, openHour: r.openHour, closeHour: r.closeHour, sportName: cs.sport.name,
                  }} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Screen>
  );
}

export default function ClubPage() {
  const params = useParams();
  const { th } = useTheme();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const [club, setClub] = useState<ClubDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!slug) return;
    api.getClub(slug).then(setClub).catch(() => setError(true));
  }, [slug]);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textMute }}>
        Club introuvable.
      </div>
    );
  }
  if (!club) {
    return (
      <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI, color: th.textFaint }}>
        Chargement…
      </div>
    );
  }

  // Branding du club : accent + thème par défaut appliqués à tout le sous-arbre.
  return (
    <ThemeProvider accent={club.accentColor} defaultMode={club.defaultThemeMode as ThemeMode}>
      <ClubContent club={club} />
    </ThemeProvider>
  );
}
