export type Agent = {
  paneId: string;
  workspaceId: string;
  tabId: string;
  name: string | null;
  kind: string | null;
  title: string | null;
  cwd: string | null;
  status: string;
  interactiveReady: boolean | null;
};
export type Pane = {
  id: string;
  workspaceId: string;
  tabId: string;
  label: string | null;
  title: string | null;
  cwd: string | null;
  kind: string | null;
  status: string;
};
export type Workspace = { id: string; label: string; status: string };
export type Session = {
  version: string;
  protocol: number;
  workspaces: Workspace[];
  tabs: { id: string; workspaceId: string; label: string }[];
  agents: Agent[];
  panes: Pane[];
};
export type Output = { text: string; fetchedAt: string };
export type DiscoveredMachine = {
  id: string;
  name: string;
  dnsName: string | null;
  os: string | null;
  addresses: string[];
  online: boolean;
  self: boolean;
};
export type Project = { id: string; label: string; cwd: string | null };
export type StartedSession = {
  paneId: string;
  tabId: string;
  workspaceId: string;
  name: string;
  kind: string;
  ready: boolean;
};
export type StartedTerminal = {
  paneId: string;
  tabId: string;
  workspaceId: string;
  ready: boolean;
};
export type HermesChip = {
  kind: 'READ' | 'SENT' | 'STARTED';
  paneId: string;
  title: string | null;
  /** The change may or may not have happened. */
  uncertain?: boolean;
};
export type HermesMessage = {
  id: string;
  role: 'USER' | 'HERMES';
  text: string;
  stopped: boolean;
  at: string;
  chips: HermesChip[];
};
export type Hermes = {
  status: 'OFF' | 'STARTING' | 'READY' | 'UNAVAILABLE';
  reason: string | null;
  model: string | null;
  modelNote: string | null;
  working: boolean;
  messages: HermesMessage[];
};
