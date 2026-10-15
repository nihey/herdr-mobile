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
