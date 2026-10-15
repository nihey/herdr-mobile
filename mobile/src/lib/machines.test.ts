import { describe, expect, it } from 'vitest';
import { MachineStore, INDEX_KEY, LEGACY_KEY } from './machines';

function setup() {
  const data = new Map<string, string>();
  let failingKey = '';
  const storage = {
    getItemAsync: async (key: string) => data.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      if (key === failingKey) throw new Error('Storage full');
      data.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      data.delete(key);
    },
  };
  let sequence = 0;
  const store = new MachineStore(storage, () => `machine-${++sequence}`);
  return {
    store,
    data,
    storage,
    failOn: (key: string) => {
      failingKey = key;
    },
  };
}
describe('saved machine profiles', () => {
  it('migrates a long valid legacy DNS name without truncating its address', async () => {
    const { store, data } = setup();
    const hostname = `${'a'.repeat(60)}.my-tailnet.ts.net`;
    data.set(
      LEGACY_KEY,
      JSON.stringify({ url: `https://${hostname}`, token: 'old-token' }),
    );
    const state = await store.load();
    expect(state.machines[0]?.url).toBe(`https://${hostname}`);
    expect(state.machines[0]?.name).toBe(hostname.slice(0, 64));
  });
  it('migrates an existing v1 connection without losing pairing', async () => {
    const { store, data } = setup();
    data.set(
      LEGACY_KEY,
      JSON.stringify({ url: 'http://100.64.0.1:8787/', token: 'old-token' }),
    );
    const state = await store.load();
    expect(state.machines).toHaveLength(1);
    expect(state.machines[0]).toMatchObject({
      url: 'http://100.64.0.1:8787',
      token: 'old-token',
    });
    expect(state.activeId).toBe(state.machines[0]?.id);
    expect(data.has(LEGACY_KEY)).toBe(false);
    expect(data.get(INDEX_KEY)).not.toContain('old-token');
  });
  it('saves independent profiles and switches/removes the active host', async () => {
    const { store } = setup();
    await store.add('Desktop', 'http://100.64.0.1:8787', 'first-token');
    const two = await store.add(
      'Laptop',
      'http://100.64.0.2:8787',
      'second-token',
    );
    expect(two.machines.map((m) => m.token)).toEqual([
      'first-token',
      'second-token',
    ]);
    const firstId = two.machines[0]!.id;
    expect((await store.activate(firstId)).activeId).toBe(firstId);
    const after = await store.remove(firstId);
    expect(after.activeId).toBe(after.machines[0]?.id);
    const empty = await store.remove(after.activeId!);
    expect(empty).toEqual({ machines: [], activeId: null });
  });
  it('updates the same normalized origin without adding duplicates', async () => {
    const { store } = setup();
    await store.add('Desktop', 'http://100.64.0.1:8787', 'first-token');
    const updated = await store.add(
      'Renamed',
      'http://100.64.0.1:8787/graphql',
      'replacement-token',
    );
    expect(updated.machines).toHaveLength(1);
    expect(updated.machines[0]).toMatchObject({
      name: 'Renamed',
      token: 'replacement-token',
    });
  });
  it('preserves a previous token when the index commit fails', async () => {
    const { store, data, failOn } = setup();
    await store.add('Desktop', 'http://100.64.0.1:8787', 'first-token');
    const original = data.get(INDEX_KEY);
    failOn(INDEX_KEY);
    await expect(
      store.add('Renamed', 'http://100.64.0.1:8787', 'replacement-token'),
    ).rejects.toThrow('Storage full');
    expect(data.get(INDEX_KEY)).toBe(original);
    failOn('');
    expect((await store.load()).machines[0]?.token).toBe('first-token');
  });
  it('retains legacy pairing if migration cannot commit', async () => {
    const { store, data, failOn } = setup();
    data.set(
      LEGACY_KEY,
      JSON.stringify({ url: 'http://100.64.0.1:8787', token: 'old-token' }),
    );
    failOn(INDEX_KEY);
    await expect(store.load()).rejects.toThrow();
    expect(data.has(LEGACY_KEY)).toBe(true);
    failOn('');
    expect((await store.load()).machines[0]?.token).toBe('old-token');
  });
  it('serializes concurrent changes so additions are not lost', async () => {
    const { store } = setup();
    await Promise.all([
      store.add('A', 'http://100.64.0.1', 'one'),
      store.add('B', 'http://100.64.0.2', 'two'),
    ]);
    expect((await store.load()).machines).toHaveLength(2);
  });
  it('recovers remaining valid profiles when one record is missing', async () => {
    const { store, data } = setup();
    await store.add('A', 'http://100.64.0.1', 'one');
    const state = await store.add('B', 'http://100.64.0.2', 'two');
    for (const [key, value] of data)
      if (key !== INDEX_KEY && value.includes('"token":"two"'))
        data.delete(key);
    const recovered = await store.load();
    expect(recovered.activeId).toBe(state.machines[0]?.id);
    expect(recovered.machines).toHaveLength(1);
  });
  it('bounds saved record sizes and rejects an unknown selection', async () => {
    const { store } = setup();
    await expect(
      store.add('x'.repeat(100), 'http://host', 'token'),
    ).rejects.toThrow();
    await expect(
      store.add('A', 'http://host', 'x'.repeat(1000)),
    ).rejects.toThrow();
    await expect(store.activate('missing')).rejects.toThrow();
  });
  it('bounds encoded bytes for Unicode credentials and profile counts', async () => {
    const { store, data } = setup();
    await expect(
      store.add('A', 'http://host', '漢'.repeat(512)),
    ).rejects.toThrow();
    for (let i = 0; i < 20; i++)
      await store.add(`Host ${i}`, `http://100.64.0.${i + 1}`, 'token');
    await expect(
      store.add('One too many', 'http://100.64.1.1', 'token'),
    ).rejects.toThrow('20 machines');
    expect(data.get(INDEX_KEY)!.length).toBeLessThan(2048);
  });
  it('leaves an existing active profile intact when a failed removal cannot commit', async () => {
    const { store, failOn } = setup();
    const state = await store.add('Host', 'http://100.64.0.1', 'token');
    failOn(INDEX_KEY);
    await expect(store.remove(state.activeId!)).rejects.toThrow();
    failOn('');
    expect((await store.load()).activeId).toBe(state.activeId);
  });
});
