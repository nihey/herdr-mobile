import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { HerdrError } from './socket.js';

export type DiscoveredMachine = {
  id: string;
  name: string;
  dnsName: string | null;
  os: string | null;
  addresses: string[];
  online: boolean;
  self: boolean;
};
const executeFile = promisify(execFile);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const label = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) || null : null;
function tailnetAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (isIP(value) === 4) {
    const parts = value.split('.').map(Number);
    return parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
  }
  return isIP(value) === 6 && value.toLowerCase().startsWith('fd7a:115c:a1e0:');
}

export function parseTailscaleStatus(value: unknown): DiscoveredMachine[] {
  if (!record(value) || value.BackendState !== 'Running')
    throw new HerdrError(
      'TAILSCALE_UNAVAILABLE',
      'Tailscale is not connected on this computer. Sign in and connect it, then try discovery again.',
    );
  if (value.Peer !== undefined && !record(value.Peer))
    throw new HerdrError(
      'TAILSCALE_UNAVAILABLE',
      'Tailscale returned an unsupported device inventory. Update Tailscale or add a machine manually.',
    );
  const candidates = [
    { value: value.Self, self: true },
    ...Object.values(value.Peer ?? {}).map((peer) => ({
      value: peer,
      self: false,
    })),
  ];
  const machines = new Map<string, DiscoveredMachine>();
  for (const item of candidates) {
    if (!record(item.value)) continue;
    const peer = item.value;
    const addresses = Array.isArray(peer.TailscaleIPs)
      ? [...new Set(peer.TailscaleIPs.filter(tailnetAddress))]
      : [];
    if (!addresses.length) continue;
    const dnsName = label(peer.DNSName, 253)?.replace(/\.$/, '') ?? null;
    const id = label(peer.ID, 128) ?? addresses[0]!;
    if (machines.has(id)) continue;
    machines.set(id, {
      id,
      name: label(peer.HostName, 128) ?? dnsName ?? addresses[0]!,
      dnsName,
      os: label(peer.OS, 32),
      addresses,
      online: item.self || peer.Online === true,
      self: item.self,
    });
  }
  return [...machines.values()].sort(
    (a, b) =>
      Number(b.self) - Number(a.self) ||
      Number(b.online) - Number(a.online) ||
      a.name.localeCompare(b.name),
  );
}

export function createDiscovery(
  options: { execute?: () => Promise<string>; now?: () => number } = {},
) {
  const now = options.now ?? Date.now;
  const execute =
    options.execute ??
    (async () =>
      (
        await executeFile('tailscale', ['status', '--json'], {
          encoding: 'utf8',
          timeout: 4000,
          maxBuffer: 2 * 1024 * 1024,
        })
      ).stdout);
  let cached: { machines: DiscoveredMachine[]; expires: number } | undefined;
  let pending: Promise<DiscoveredMachine[]> | undefined;
  return async (): Promise<DiscoveredMachine[]> => {
    if (cached && cached.expires > now()) return cached.machines;
    if (pending) return pending;
    pending = (async () => {
      try {
        const machines = parseTailscaleStatus(JSON.parse(await execute()));
        cached = { machines, expires: now() + 10000 };
        return machines;
      } catch (error) {
        if (error instanceof HerdrError) throw error;
        throw new HerdrError(
          'TAILSCALE_UNAVAILABLE',
          'Could not read Tailscale devices on this computer. Check that Tailscale is installed and connected, or add a machine manually.',
        );
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  };
}
