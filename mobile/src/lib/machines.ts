import { normalizeConnection } from './connection';

export const INDEX_KEY = 'herdr.machines.v2';
export const LEGACY_KEY = 'herdr.connection.v1';
const PROFILE_PREFIX = 'herdr.machine.';
const LIMIT = 20;
export type Machine = { id: string; name: string; url: string; token: string };
export type MachineSummary = Omit<Machine, 'token'>;
export type MachineState = { machines: Machine[]; activeId: string | null };
export type MachineStorage = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};
const empty = (): MachineState => ({ machines: [], activeId: null });
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
function settings(name: string, url: string, token: string) {
  const connection = normalizeConnection(url, token);
  if (!name.trim() || name.trim().length > 64)
    throw new Error('Use a machine name between 1 and 64 characters.');
  if (connection.url.length > 384 || connection.token.length > 512)
    throw new Error('The bridge address or token is too long to save.');
  return { name: name.trim(), ...connection };
}

export class MachineStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly storage: MachineStorage,
    private readonly newId = () =>
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
  ) {}

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private async read(): Promise<MachineState> {
    const raw = await this.storage.getItemAsync(INDEX_KEY);
    if (raw) {
      let index: { version: number; ids: string[]; activeId: string | null };
      try {
        index = JSON.parse(raw);
        if (
          index.version !== 2 ||
          !Array.isArray(index.ids) ||
          index.ids.length > LIMIT ||
          !index.ids.every(validId)
        )
          return empty();
      } catch {
        return empty();
      }
      const machines: Machine[] = [];
      for (const id of [...new Set(index.ids)]) {
        const stored = await this.storage.getItemAsync(PROFILE_PREFIX + id);
        if (!stored) continue;
        try {
          const value: Machine = JSON.parse(stored);
          if (value.id !== id) continue;
          machines.push({
            id,
            ...settings(value.name, value.url, value.token),
          });
        } catch {
          /* Keep other valid profiles when one record is corrupt. */
        }
      }
      return {
        machines,
        activeId: machines.some((m) => m.id === index.activeId)
          ? index.activeId
          : (machines[0]?.id ?? null),
      };
    }
    const legacy = await this.storage.getItemAsync(LEGACY_KEY);
    if (!legacy) return empty();
    let value: { url: string; token: string };
    try {
      value = JSON.parse(legacy);
    } catch {
      return empty();
    }
    const connection = normalizeConnection(value.url, value.token);
    const migrated = await this.save(
      empty(),
      new URL(connection.url).hostname.slice(0, 64),
      connection.url,
      connection.token,
    );
    // The v2 index is now authoritative even if legacy cleanup is interrupted.
    await this.storage.deleteItemAsync(LEGACY_KEY).catch(() => {});
    return migrated;
  }
  private async commit(state: MachineState) {
    await this.storage.setItemAsync(
      INDEX_KEY,
      JSON.stringify({
        version: 2,
        ids: state.machines.map((m) => m.id),
        activeId: state.activeId,
      }),
    );
  }
  private async save(
    state: MachineState,
    name: string,
    url: string,
    token: string,
  ) {
    const normalized = settings(name, url, token);
    const previous = state.machines.find((m) => m.url === normalized.url);
    if (!previous && state.machines.length >= LIMIT)
      throw new Error(
        'You can save up to 20 machines. Remove one before adding another.',
      );
    const id = this.newId();
    if (!validId(id) || state.machines.some((m) => m.id === id))
      throw new Error('Could not create a machine profile. Please try again.');
    const machine: Machine = { id, ...normalized };
    const encoded = JSON.stringify(machine);
    let bytes = 0;
    for (const character of encoded) {
      const code = character.codePointAt(0)!;
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
    if (bytes > 1400)
      throw new Error(
        'This profile is too large to save. Shorten its name, address or token.',
      );
    const next = {
      machines: previous
        ? state.machines.map((m) => (m.id === previous.id ? machine : m))
        : [...state.machines, machine],
      activeId: id,
    };
    await this.storage.setItemAsync(PROFILE_PREFIX + id, encoded);
    try {
      await this.commit(next);
    } catch (error) {
      await this.storage.deleteItemAsync(PROFILE_PREFIX + id).catch(() => {});
      throw error;
    }
    if (previous)
      await this.storage
        .deleteItemAsync(PROFILE_PREFIX + previous.id)
        .catch(() => {});
    return next;
  }
  load() {
    return this.serialized(() => this.read());
  }
  add(name: string, url: string, token: string) {
    return this.serialized(async () =>
      this.save(await this.read(), name, url, token),
    );
  }
  activate(id: string) {
    return this.serialized(async () => {
      const state = await this.read();
      if (!state.machines.some((m) => m.id === id))
        throw new Error('This machine is no longer saved. Add it again.');
      const next = { ...state, activeId: id };
      await this.commit(next);
      return next;
    });
  }
  remove(id: string) {
    return this.serialized(async () => {
      const state = await this.read();
      const machines = state.machines.filter((m) => m.id !== id);
      const next = {
        machines,
        activeId:
          state.activeId === id ? (machines[0]?.id ?? null) : state.activeId,
      };
      await this.commit(next);
      if (state.machines.some((m) => m.id === id))
        await this.storage.deleteItemAsync(PROFILE_PREFIX + id).catch(() => {});
      return next;
    });
  }
}
