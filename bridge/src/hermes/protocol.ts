/**
 * JSON-lines protocol between the bridge and bridge/hermes/host.py, which runs
 * a Hermes agent in-process with only the tools the bridge gives it.
 */
export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
export type HistoryTool = {
  name: string;
  args: Record<string, unknown>;
  result: string;
};
export type HistoryItem = {
  role: 'user' | 'hermes';
  text: string;
  tools: HistoryTool[];
  stopped: boolean;
};
export type HostIn =
  | {
      type: 'start';
      sessionId: string | null;
      model: string;
      provider: string;
      baseUrl?: string;
      apiKey?: string;
      reasoningEffort: 'medium';
      instructions: string;
      tools: ToolSpec[];
      probe: boolean;
    }
  | { type: 'turn'; turnId: string; text: string }
  | { type: 'cancel'; turnId: string }
  | { type: 'tool_result'; callId: string; ok: boolean; result: string }
  | { type: 'new' };
export type HostOut =
  | {
      type: 'ready';
      sessionId: string;
      tools: string[];
      history: HistoryItem[];
      defaultModel: string | null;
      defaultProvider: string | null;
      probe: { ok: boolean; modelMissing: boolean } | null;
    }
  | { type: 'delta'; turnId: string; text: string }
  | {
      type: 'tool_call';
      turnId: string;
      callId: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'turn_end';
      turnId: string;
      text: string;
      interrupted: boolean;
      error: string | null;
    }
  | {
      type: 'fatal';
      reason: 'signed_out' | 'incompatible' | 'other';
      message: string;
    };
