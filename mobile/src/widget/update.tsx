import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ServerError } from '@apollo/client/errors';
import {
  getWidgetInfo,
  requestPinWidget,
  requestWidgetUpdate,
  type WidgetInfo,
  type WidgetTaskHandler,
} from 'react-native-android-widget';
import { createClient, WIDGET_AGENTS } from '@/lib/graphql';
import { MachineStore } from '@/lib/machines';
import {
  snapshotOf,
  WIDGET_NAME,
  type Snapshot,
  type WidgetMachine,
  type WidgetSession,
  type WidgetState,
} from '@/lib/widget';
import { AgentsWidget } from './AgentsWidget';

// Read-only: the widget never migrates or writes saved machines.
const store = new MachineStore(SecureStore);
// The last snapshot per machine, in memory only: never stored or logged.
const last = new Map<string, Snapshot>();
const pushed = { key: '', at: 0 };
let reading: Promise<WidgetState> | null = null;

const draw = (state: WidgetState, info: WidgetInfo) => (
  <AgentsWidget
    state={state}
    width={info.width}
    height={info.height}
    fontScale={info.screenInfo?.fontScale}
  />
);

async function activeMachine(): Promise<
  WidgetMachine | 'unpaired' | 'unreadable'
> {
  try {
    const machine = await store.peek();
    return machine ? { id: machine.id, name: machine.name } : 'unpaired';
  } catch {
    return 'unreadable';
  }
}

/** What to show while reading: the last snapshot, marked as refreshing. */
async function pending(): Promise<WidgetState> {
  const machine = await activeMachine();
  if (typeof machine === 'string') return { kind: machine };
  return {
    kind: 'machine',
    machine,
    snapshot: last.get(machine.id) ?? null,
    problem: null,
    refreshing: true,
  };
}

async function read(): Promise<WidgetState> {
  let machine;
  try {
    machine = await store.peek();
  } catch {
    return { kind: 'unreadable' };
  }
  if (!machine) return { kind: 'unpaired' };
  const summary = { id: machine.id, name: machine.name };
  // Inside the widget task's 30 s limit; no retries.
  const client = createClient(machine, 15000);
  try {
    const result = await client.query<{ session: WidgetSession }>({
      query: WIDGET_AGENTS,
    });
    if (!result.data) throw new Error('No session returned.');
    const snapshot = snapshotOf(result.data.session, Date.now());
    last.set(machine.id, snapshot);
    return {
      kind: 'machine',
      machine: summary,
      snapshot,
      problem: null,
      refreshing: false,
    };
  } catch (error) {
    return {
      kind: 'machine',
      machine: summary,
      snapshot: last.get(machine.id) ?? null,
      problem:
        ServerError.is(error) && error.statusCode === 401
          ? 'rejected'
          : 'offline',
      refreshing: false,
    };
  } finally {
    client.stop();
  }
}

/** A read that ends after a machine switch must not draw the old machine. */
async function stillActive(state: WidgetState) {
  if (state.kind !== 'machine') return true;
  const machine = await activeMachine();
  return typeof machine !== 'string' && machine.id === state.machine.id;
}

/** One read shared by every widget drawn at the same time. */
function readShared() {
  reading ??= read().finally(() => {
    reading = null;
  });
  return reading;
}

/** Android's widget events: added, resized, every 30 minutes, ↻. */
export const widgetTaskHandler: WidgetTaskHandler = async ({
  widgetInfo,
  widgetAction,
  clickAction,
  renderWidget,
}) => {
  if (widgetAction === 'WIDGET_DELETED') return;
  if (widgetAction === 'WIDGET_CLICK' && clickAction !== 'REFRESH') return;
  const now = await pending();
  // A periodic update without a snapshot in memory keeps the drawn agents
  // until the read ends instead of flashing "checking…".
  const asked =
    widgetAction === 'WIDGET_ADDED' || widgetAction === 'WIDGET_CLICK';
  if (asked || now.kind !== 'machine' || now.snapshot)
    renderWidget(draw(now, widgetInfo));
  if (now.kind !== 'machine') return;
  const result = await readShared();
  if (!(await stillActive(result))) return;
  // The app's next poll redraws even when its agents look unchanged, so an
  // offline state drawn here never outlasts a working connection.
  pushed.key = '';
  renderWidget(draw(result, widgetInfo));
};

function redraw(state: WidgetState) {
  return requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: (info) => draw(state, info),
  });
}

/**
 * Redraws placed widgets from a snapshot the app just polled: at once when
 * the agents changed, otherwise at most once a minute (the shown time).
 */
export function syncAgentWidget(
  machine: WidgetMachine,
  session: WidgetSession,
) {
  if (Platform.OS !== 'android') return;
  const now = Date.now();
  const snapshot = snapshotOf(session, now);
  const key = JSON.stringify([machine, snapshot.rows]);
  if (key === pushed.key && now - pushed.at < 60000) return;
  pushed.key = key;
  pushed.at = now;
  last.set(machine.id, snapshot);
  redraw({
    kind: 'machine',
    machine,
    snapshot,
    problem: null,
    refreshing: false,
  }).catch(() => {});
}

/**
 * Reads the active machine again after the app changed machines. Not shared
 * with a read that may have started before the change.
 */
export function refreshAgentWidget() {
  if (Platform.OS !== 'android') return;
  pushed.key = '';
  void getWidgetInfo(WIDGET_NAME)
    .then(async (widgets) => {
      if (!widgets.length) return;
      const state = await read();
      if (await stillActive(state)) await redraw(state);
    })
    .catch(() => {});
}

/**
 * Asks the launcher to add the widget. False when it can't pin widgets; true
 * means the launcher showed its prompt, not that the user accepted.
 */
export async function pinAgentWidget() {
  if (Platform.OS !== 'android') return false;
  try {
    return await requestPinWidget({ widgetName: WIDGET_NAME });
  } catch {
    return false;
  }
}
