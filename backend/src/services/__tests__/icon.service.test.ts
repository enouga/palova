import dns from 'dns/promises';
import { fetchLogo } from '../icon.service';

jest.mock('dns/promises');
const dnsLookup = dns.lookup as jest.Mock;

describe('fetchLogo — garde SSRF', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('rejette un protocole non http(s)', async () => {
    await expect(fetchLogo('file:///etc/passwd')).rejects.toThrow('LOGO_URL_INVALID');
  });

  it('rejette une IP littérale privée/loopback/link-local (metadata cloud)', async () => {
    await expect(fetchLogo('http://127.0.0.1/x')).rejects.toThrow('LOGO_URL_INVALID');
    await expect(fetchLogo('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('LOGO_URL_INVALID');
    await expect(fetchLogo('http://10.0.0.5/x')).rejects.toThrow('LOGO_URL_INVALID');
    await expect(fetchLogo('http://192.168.1.1/x')).rejects.toThrow('LOGO_URL_INVALID');
    await expect(fetchLogo('http://[::1]/x')).rejects.toThrow('LOGO_URL_INVALID');
  });

  it('rejette localhost et un host qui résout vers une IP privée', async () => {
    await expect(fetchLogo('http://localhost/x')).rejects.toThrow('LOGO_URL_INVALID');
    dnsLookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    await expect(fetchLogo('http://internal.evil.example/x')).rejects.toThrow('LOGO_URL_INVALID');
  });

  it('accepte un host public et suit les redirections avec revalidation, refuse un rebond vers l interne', async () => {
    dnsLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    global.fetch = jest.fn().mockResolvedValue({
      status: 302,
      headers: new Map([['location', 'http://169.254.169.254/latest/meta-data/']]),
    }) as any;
    await expect(fetchLogo('http://cdn.example.com/logo.png')).rejects.toThrow('LOGO_URL_INVALID');
  });

  it('télécharge normalement une image publique', async () => {
    dnsLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Map(),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as any;
    const buf = await fetchLogo('http://cdn.example.com/logo.png');
    expect(buf.byteLength).toBe(3);
  });
});
