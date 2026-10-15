import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import {
  ArrowLeft,
  Check,
  Laptop,
  Monitor,
  Network,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react-native';
import { useSession } from '@/lib/session-context';
import { DISCOVER_MACHINES } from '@/lib/graphql';
import { errorMessage } from '@/lib/errors';
import type { DiscoveredMachine } from '@/lib/types';
import type { MachineSummary } from '@/lib/machines';
import {
  Button,
  c,
  IconButton,
  mono,
  Notice,
  s,
  Screen,
  Sheet,
  Status,
} from '@/components/ui';
import { PairMachineModal } from './PairMachineModal';
import { useHomeBack } from '@/hooks/useHomeBack';

export function MachinesScreen() {
  useHomeBack();
  const {
    machines,
    activeMachine,
    activate,
    remove,
    client,
    busy,
    storageError,
    reload,
  } = useSession();
  const [pairing, setPairing] = useState<{ name: string; url: string } | null>(
    null,
  );
  const [removing, setRemoving] = useState<MachineSummary | null>(null);
  const [peers, setPeers] = useState<DiscoveredMachine[]>([]);
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [actionError, setActionError] = useState('');
  const alive = useRef(true);
  const scanPending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const discover = async () => {
    if (!client || scanPending.current) return;
    scanPending.current = true;
    setScanning(true);
    setScanError('');
    try {
      const result = await client.query<{
        discoveredMachines: DiscoveredMachine[];
      }>({ query: DISCOVER_MACHINES });
      if (!result.data) throw new Error('No device inventory returned.');
      if (alive.current) {
        setPeers(result.data.discoveredMachines);
        setScanned(true);
      }
    } catch (reason) {
      if (alive.current)
        setScanError(
          CombinedGraphQLErrors.is(reason) &&
            reason.errors.some((e) => e.message.includes('Cannot query field'))
            ? 'This bridge needs an update for discovery. Update and restart it, or add a machine manually.'
            : errorMessage(reason),
        );
    } finally {
      scanPending.current = false;
      if (alive.current) setScanning(false);
    }
  };
  const select = async (id: string) => {
    setActionError('');
    try {
      await activate(id);
      router.replace('/');
    } catch (reason) {
      if (alive.current)
        setActionError(
          reason instanceof Error
            ? reason.message
            : 'Could not switch machines.',
        );
    }
  };
  const confirmRemove = async () => {
    if (!removing) return;
    const wasActive = removing.id === activeMachine?.id;
    setActionError('');
    try {
      await remove(removing.id);
      if (alive.current) setRemoving(null);
      if (wasActive) router.replace('/');
    } catch {
      if (alive.current)
        setActionError('Could not remove the saved machine. Please try again.');
    }
  };
  const addPeer = (peer: DiscoveredMachine) => {
    const address =
      peer.addresses.find((item) => !item.includes(':')) ?? peer.addresses[0];
    if (!address) return;
    setPairing({
      name: peer.name.slice(0, 64),
      url: `http://${address.includes(':') ? `[${address}]` : address}:8787`,
    });
  };
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[s.page, { paddingTop: 12 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.between}>
          <IconButton
            label="Back to agents"
            onPress={() => router.replace('/')}
          >
            <ArrowLeft size={21} color={c.text} />
          </IconButton>
          <Text style={s.eyebrow}>YOUR PRIVATE NETWORK</Text>
          <Monitor size={22} color={c.accent} />
        </View>
        <View style={{ gap: 6 }}>
          <Text style={s.title}>
            Your machines<Text style={{ color: c.accent }}>.</Text>
          </Text>
          <Text style={s.muted}>
            A place for every agent. Switch computers while the work keeps
            running.
          </Text>
        </View>
        {storageError && (
          <>
            <Notice message={storageError} danger />
            <Button
              title="Retry saved machines"
              variant="secondary"
              busy={busy}
              onPress={() => {
                void reload().catch(() =>
                  setActionError(
                    'Secure storage is still unavailable. Please try again.',
                  ),
                );
              }}
            />
          </>
        )}
        {!!actionError && <Notice message={actionError} danger />}
        <View style={s.between}>
          <Text style={s.eyebrow}>SAVED / {machines.length}</Text>
          <Button
            title="Add manually"
            variant="secondary"
            disabled={busy || scanning}
            icon={<Plus size={15} color={c.text} />}
            onPress={() => setPairing({ name: '', url: '' })}
          />
        </View>
        {machines.map((machine) => {
          const current = machine.id === activeMachine?.id;
          return (
            <View
              key={machine.id}
              style={[s.card, { borderColor: current ? c.accent : c.line }]}
            >
              <View style={s.between}>
                <View style={[s.row, { flex: 1 }]}>
                  <Laptop color={current ? c.accent : c.muted} size={22} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text
                      numberOfLines={1}
                      style={[s.heading, { fontSize: 18 }]}
                    >
                      {machine.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[s.muted, { fontFamily: mono, fontSize: 10 }]}
                    >
                      {machine.url}
                    </Text>
                  </View>
                </View>
                <IconButton
                  label={`Remove ${machine.name}`}
                  onPress={() => {
                    if (!busy && !scanning) setRemoving(machine);
                  }}
                >
                  <Trash2 size={17} color={c.muted} />
                </IconButton>
              </View>
              {current ? (
                <View style={[s.row, { gap: 7 }]}>
                  <Check size={15} color={c.accent} />
                  <Text style={{ color: c.accent, fontSize: 12 }}>
                    Current machine
                  </Text>
                </View>
              ) : (
                <Button
                  title={`Use ${machine.name}`}
                  variant="secondary"
                  disabled={busy || scanning}
                  onPress={() => void select(machine.id)}
                />
              )}
            </View>
          );
        })}
        {!machines.length && (
          <View style={s.card}>
            <Text style={s.heading}>Your first connection</Text>
            <Text style={s.muted}>
              Add one computer manually. Its bridge can then discover other
              devices on your tailnet.
            </Text>
          </View>
        )}
        <View style={[s.divider, { marginVertical: 4 }]} />
        <View style={s.row}>
          <Network size={21} color={c.accent} />
          <Text style={s.heading}>Discover on Tailscale</Text>
        </View>
        <Text style={s.muted}>
          {activeMachine
            ? `Find devices visible to ${activeMachine.name}. Each computer needs its own Herdr Mobile bridge and pairing token.`
            : 'Discovery is available after you pair with a computer running the bridge.'}
        </Text>
        <Button
          title={scanned ? 'Refresh discovered devices' : 'Discover devices'}
          variant="secondary"
          disabled={!client || busy}
          busy={scanning}
          icon={<RefreshCw size={17} color={c.text} />}
          onPress={() => void discover()}
        />
        {!!scanError && <Notice message={scanError} danger />}
        {scanned && (
          <Text style={s.eyebrow}>VISIBLE DEVICES / {peers.length}</Text>
        )}
        {peers.map((peer) => (
          <View key={peer.id} style={s.card}>
            <View style={s.between}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text numberOfLines={1} style={[s.heading, { fontSize: 17 }]}>
                  {peer.name}
                </Text>
                <Text style={s.muted}>
                  {peer.os ?? 'Device'}
                  {peer.self ? ' · Connected computer' : ''}
                </Text>
              </View>
              <Status status={peer.online ? 'online' : 'offline'} />
            </View>
            <Text
              selectable
              style={[s.muted, { fontFamily: mono, fontSize: 11 }]}
            >
              {peer.addresses.join('\n')}
            </Text>
            {!!peer.dnsName && (
              <Text numberOfLines={1} style={[s.muted, { fontSize: 11 }]}>
                {peer.dnsName}
              </Text>
            )}
            <Button
              title={`Add ${peer.name}`}
              variant="secondary"
              disabled={busy || scanning}
              onPress={() => addPeer(peer)}
            />
          </View>
        ))}
        {scanned && !peers.length && (
          <Notice message="No visible devices were returned. Check Tailscale on the connected computer, or add a machine manually." />
        )}
        {scanned && (
          <Text style={s.muted}>
            Online means connected to Tailscale. It does not confirm a Herdr
            bridge is installed or reachable from your phone. Discovery never
            installs anything remotely.
          </Text>
        )}
      </ScrollView>
      {pairing && (
        <PairMachineModal
          initialName={pairing.name}
          initialUrl={pairing.url}
          onClose={() => setPairing(null)}
        />
      )}
      <Sheet
        visible={!!removing}
        title="Remove saved machine?"
        onClose={() => {
          if (!busy) setRemoving(null);
        }}
      >
        <Text style={s.body}>{removing?.name}</Text>
        <Text style={s.muted}>
          This removes the saved connection from this phone. Agents on the
          computer keep running.
        </Text>
        {!!actionError && <Notice message={actionError} danger />}
        <Button
          title="Remove machine"
          variant="danger"
          busy={busy}
          onPress={() => void confirmRemove()}
        />
        <Button
          title="Keep machine"
          variant="secondary"
          disabled={busy}
          onPress={() => setRemoving(null)}
        />
      </Sheet>
    </Screen>
  );
}
