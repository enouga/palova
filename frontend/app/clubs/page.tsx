'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api, ClubSummary, Sport } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Screen } from '@/components/ui/Screen';
import { Logotype, Chip, Placeholder, ThemeToggle, LogoutButton } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';

function ClubCard({ club }: { club: ClubSummary }) {
  const { th } = useTheme();
  return (
    <Link href={`/c/${club.slug}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{ background: th.surface, borderRadius: 22, overflow: 'hidden', boxShadow: `${th.shadowSoft}, inset 0 0 0 1px ${th.line}` }}>
        <div style={{ position: 'relative' }}>
          <Placeholder label={club.name} height={104} radius={0} />
          {/* pastille couleur du club */}
          <span style={{ position: 'absolute', top: 12, right: 12, width: 14, height: 14, borderRadius: '50%', background: club.accentColor, boxShadow: `0 0 0 2px ${th.surface}` }} />
        </div>
        <div style={{ padding: '15px 16px 17px' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, color: th.text, lineHeight: 1.05, letterSpacing: -0.3 }}>{club.name}</div>
          {club.city && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 5 }}>
              <Icon name="pin" size={13} color={th.textMute} />{club.city}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {club.sports.map((s) => <Chip key={s.key} tone="line">{s.icon ? `${s.icon} ` : ''}{s.name}</Chip>)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
            {club.resourceCount} terrain{club.resourceCount > 1 ? 's' : ''}
            <Icon name="chevR" size={16} color={th.textFaint} style={{ marginLeft: 'auto' }} />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function ClubsDirectory() {
  const { th } = useTheme();
  const [sports, setSports] = useState<Sport[]>([]);
  const [clubs, setClubs]   = useState<ClubSummary[]>([]);
  const [q, setQ]           = useState('');
  const [city, setCity]     = useState('');
  const [sport, setSport]   = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.getSports().then(setSports).catch(() => setSports([])); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setClubs(await api.listClubs({ q: q || undefined, city: city || undefined, sport: sport || undefined })); }
    catch { setClubs([]); }
    finally { setLoading(false); }
  }, [q, city, sport]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const inputStyle = { flex: 1, minWidth: 0, height: 46, padding: '0 14px', borderRadius: 12, background: th.surface, color: th.text, border: 'none', boxShadow: `inset 0 0 0 1.5px ${th.line}`, fontFamily: th.fontUI, fontSize: 15 } as const;

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <div style={{ padding: '28px 20px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Logotype size={22} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, marginTop: 22, letterSpacing: -0.5 }}>
            Trouvez votre<br />club.
          </div>
        </div>

        {/* recherche */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px 0' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom du club" style={inputStyle} />
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ville" style={inputStyle} />
          </div>
          <div className="sp-noscroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            <button onClick={() => setSport('')} style={chipBtn(th, sport === '')}>Tous</button>
            {sports.map((s) => (
              <button key={s.key} onClick={() => setSport(sport === s.key ? '' : s.key)} style={chipBtn(th, sport === s.key)}>
                {s.icon ? `${s.icon} ` : ''}{s.name}
              </button>
            ))}
          </div>
        </div>

        {/* résultats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 20px 0' }}>
          {loading ? (
            <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
          ) : clubs.length === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>Aucun club ne correspond.</div>
          ) : (
            clubs.map((c) => <ClubCard key={c.id} club={c} />)
          )}
        </div>
      </div>
    </Screen>
  );
}

function chipBtn(th: ReturnType<typeof useTheme>['th'], active: boolean): React.CSSProperties {
  return {
    flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 10, padding: '8px 14px',
    fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap',
    background: active ? th.ink : th.surface2,
    color: active ? (th.mode === 'floodlit' ? th.text : '#f7f5ee') : th.textMute,
  };
}
