import { describe, expect, it, vi } from 'vitest';
import { createDiscovery, parseTailscaleStatus } from './discovery.js';

const status = {
  BackendState: 'Running',
  Self: {
    ID: 'self-id',
    HostName: 'desktop',
    DNSName: 'desktop.example.ts.net.',
    OS: 'linux',
    TailscaleIPs: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
    Online: true,
    PublicKey: 'private-field',
  },
  Peer: {
    first: {
      ID: 'peer-id',
      HostName: 'laptop',
      DNSName: 'laptop.example.ts.net.',
      OS: 'macOS',
      TailscaleIPs: ['100.70.1.2', '192.168.1.1'],
      Online: true,
      UserID: 123,
      Addrs: ['203.0.113.1:123'],
    },
    second: {
      ID: 'offline-id',
      HostName: 'server',
      TailscaleIPs: ['100.70.1.3'],
      Online: false,
    },
    invalid: {
      HostName: 'bad',
      TailscaleIPs: ['http://attacker', '127.0.0.1', '100.128.0.1'],
    },
  },
};
describe('Tailscale discovery', () => {
  it('projects only named peer fields and valid tailnet addresses', () => {
    const machines = parseTailscaleStatus(status);
    expect(machines).toHaveLength(3);
    expect(machines.find((m) => m.id === 'peer-id')).toEqual({
      id: 'peer-id',
      name: 'laptop',
      dnsName: 'laptop.example.ts.net',
      os: 'macOS',
      addresses: ['100.70.1.2'],
      online: true,
      self: false,
    });
    expect(JSON.stringify(machines)).not.toContain('private-field');
    expect(JSON.stringify(machines)).not.toContain('203.0.113');
  });
  it('includes the current host and offline devices', () => {
    const machines = parseTailscaleStatus(status);
    expect(machines[0]).toMatchObject({ self: true, name: 'desktop' });
    expect(machines.find((m) => m.id === 'offline-id')).toMatchObject({
      online: false,
    });
  });
  it('handles an empty peer list and missing optional fields', () => {
    expect(
      parseTailscaleStatus({
        BackendState: 'Running',
        Self: { TailscaleIPs: ['100.64.0.1'] },
      }),
    ).toEqual([
      {
        id: '100.64.0.1',
        name: '100.64.0.1',
        dnsName: null,
        os: null,
        addresses: ['100.64.0.1'],
        online: true,
        self: true,
      },
    ]);
  });
  it.each([
    null,
    [],
    {},
    { BackendState: 'NeedsLogin' },
    { BackendState: 'Running', Peer: [] },
  ])('rejects invalid/unavailable inventory %j', (value) => {
    expect(() => parseTailscaleStatus(value)).toThrow();
  });
  it('coalesces simultaneous requests and expires its success cache', async () => {
    let now = 0;
    const execute = vi.fn(async () => JSON.stringify(status));
    const discover = createDiscovery({ execute, now: () => now });
    await Promise.all([discover(), discover()]);
    await discover();
    expect(execute).toHaveBeenCalledTimes(1);
    now = 10001;
    await discover();
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('does not leak CLI errors or cache failures', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('sensitive stderr'))
      .mockResolvedValue(JSON.stringify(status));
    const discover = createDiscovery({ execute });
    await expect(discover()).rejects.toMatchObject({
      code: 'TAILSCALE_UNAVAILABLE',
    });
    await expect(discover()).resolves.toHaveLength(3);
  });
  it('reports malformed JSON safely', async () => {
    await expect(
      createDiscovery({ execute: async () => 'not json' })(),
    ).rejects.toMatchObject({ code: 'TAILSCALE_UNAVAILABLE' });
  });
});
