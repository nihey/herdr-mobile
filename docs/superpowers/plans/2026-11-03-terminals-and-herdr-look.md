# Plain Terminals and Herdr Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the app open plain shells (in a project or the home folder) and run commands in them, and restyle the whole app to look like Herdr in the user's GNOME Terminal.

**Architecture:** The bridge gains `startTerminal`, a nullable `workspaceId` (null = the `phone` home workspace) on `startSession`, and `homeFolder`. The bridge never runs commands itself: terminals are Herdr panes the user types into with the existing `sendText`/`sendKeys`. The app gets a new palette, bundled Noto Sans Mono, Herdr status marks, a plain launch screen, a Run/Type composer for plain terminals, and Terminal/Home folder choices in the New session sheet.

**Tech Stack:** Node 22 ESM + graphql-yoga bridge (vitest, mock socket); Expo 57 / React Native 0.86 app; expo-font and expo-splash-screen config plugins.

**Spec:** `docs/superpowers/specs/2026-11-03-terminals-and-herdr-look-design.md` (read it first; the chosen mockup is option B in `.superpowers/brainstorm/336641-1793711216/content/look.html`).

## Global Constraints

- Palette, exactly: background `#171421`, terminal text `#D0CFCC`, panel `#1E1E2E`, surface/line `#313244`, text `#CDD6F4`, muted `#A6ADC8`, dim `#6C7086`, accent `#89B4FA`, needs input `#F38BA8`, working `#F9E2AF`, done `#A6E3A1`. No other hex colors outside `mobile/src/components/ui.tsx`.
- Status marks: blocked `●` needs-input color, working `◐` working color, done `✓` done color, idle `○` dim, anything else `·` dim.
- Monospace (Noto Sans Mono, fallback `monospace`) for all text; lowercase labels; corners about 4 px; highlighted rows = accent at 14 % opacity + 2 px accent left edge.
- Home workspace label: `phone`, matched by label alone. Terminal tab label: `terminal`.
- No retries of any mutation. Never resend a first command or a Run after an uncertain failure. Never focus the desktop (`focus: false`). Tabs are never closed automatically.
- Tests never send input to the user's sessions: mock socket, or a disposable named Herdr session with `SHELL=/bin/sh` and the restricted PATH (`scripts/integration.ts`), typing only `printf` markers.
- Branding stays "Herd Remote" (lowercase `herd remote` is fine in the B style); never "Herdr" as the app's name.
- Native config only through `mobile/app.json` and config plugins; never edit `mobile/android/`. Add Expo packages with `npx expo install`, then run `npx expo-doctor`. Read the SDK 57 docs before using an Expo API: https://docs.expo.dev/versions/v57.0.0/
- Version 0.5.0, Android versionCode 5.
- Before committing: `npm run lint:fix`, `npm run typecheck`, `npm test`.

## Review Focus

1. **Home terminal after the user `cd`s away or after a Herdr restart** — the next home terminal must reuse the `phone` workspace, not create another. Pinned in Task 1 (`reuses the phone workspace whatever its panes' folders`).
2. **New app against a 0.4.0 bridge** — the project list and agent sessions keep working; Terminal or Home folder shows the "update and restart the bridge" message. Pinned in Task 6 (`terminalsSupported` test) and checked on the emulator in Task 7.
3. **Run where the text arrives but Enter fails** — the draft is cleared, nothing is resent, and the notice says it was typed but not run. Pinned in Task 5 (`runFailureNotice` test) and checked on the emulator in Task 7.
4. **An agent starting inside a plain terminal while a draft is typed** — controls switch to Prompt/Type without losing the draft; leaving the agent switches back to Run/Type. Pinned in Task 5 (`effectiveMode` tests).
5. **Wide monospace text** — long project labels, paths and agent titles truncate on one line at Android font scale 1.3 instead of pushing buttons off screen. Checked on the emulator in Task 7.

---

### Task 1: Bridge: terminals and the home workspace

**Files:**
- Modify: `bridge/src/schema.ts`, `bridge/src/server.ts`
- Test: `bridge/src/server.test.ts`
- Docs: `bridge/AGENTS.md`

**Interfaces:**
- Produces (GraphQL):
  - `Query.homeFolder: String` — the bridge user's home directory.
  - `Mutation.startTerminal(workspaceId: ID): StartedTerminal!`, `type StartedTerminal { paneId: ID! tabId: ID! workspaceId: ID! ready: Boolean! }`.
  - `Mutation.startSession(workspaceId: ID, kind: String!, name: String!)` — `workspaceId` now nullable; null = home workspace.
- Produces (TS): `createBridge({ ..., homeDir?: string })`; `buildSchema(request, discover?, timing?, homeDir = os.homedir())`; `export const HOME_WORKSPACE_LABEL = 'phone'` in `schema.ts`.
- `waitForShell(paneId)` now returns `Promise<boolean | null>`: `true` settled alone at the prompt, `false` timed out, `null` process info unavailable.

- [ ] **Step 1: Extend `sessionSetup()` in `server.test.ts`**

Add options `homeWorkspace?: boolean` (snapshot includes `{ workspace_id: 'w7', label: 'phone' }` with one pane `w7:p1`, `cwd: '/work/elsewhere'`) and pass `homeDir: '/home/tester'` to `createBridge`. The mock answers `workspace.create` with `{ type: 'workspace_created', workspace: { workspace_id: 'w8', label: params.label }, tab: { tab_id: 'w8:t1' }, root_pane: { pane_id: 'w8:p1' } }`.

- [ ] **Step 2: Write the failing tests**

```ts
it('reports the home folder', async () => {
  const { query } = sessionSetup();
  const { body } = await query('{ homeFolder }');
  expect(body.data.homeFolder).toBe('/home/tester');
});
it('opens a plain terminal in a new unfocused tab in the project folder', async () => {
  const { query, calls } = sessionSetup();
  const { body } = await query('mutation { startTerminal(workspaceId:"w1") { paneId tabId workspaceId ready } }');
  expect(body.data.startTerminal).toEqual({ paneId: 'w1:p9', tabId: 'w1:t9', workspaceId: 'w1', ready: true });
  expect(calls.map((c) => c.method)).toEqual(['session.snapshot', 'tab.create', 'pane.process_info']);
  expect(calls[1].params).toEqual({ workspace_id: 'w1', label: 'terminal', focus: false, cwd: '/work/api' });
  expect(calls.some((c) => /agent\.|send_text|send_keys/.test(c.method))).toBe(false);
});
it('creates the phone workspace in the home folder for the first home terminal', async () => {
  const { query, calls } = sessionSetup();
  const { body } = await query('mutation { startTerminal { paneId tabId workspaceId ready } }');
  expect(body.data.startTerminal).toEqual({ paneId: 'w8:p1', tabId: 'w8:t1', workspaceId: 'w8', ready: true });
  expect(calls.find((c) => c.method === 'workspace.create')?.params).toEqual({ label: 'phone', cwd: '/home/tester', focus: false });
  expect(calls.some((c) => c.method === 'tab.create')).toBe(false);
});
it('reuses the phone workspace whatever its panes\' folders', async () => {
  const { query, calls } = sessionSetup({ homeWorkspace: true });
  const { body } = await query('mutation { startTerminal { workspaceId } }');
  expect(body.data.startTerminal.workspaceId).toBe('w7');
  expect(calls.some((c) => c.method === 'workspace.create')).toBe(false);
  expect(calls.find((c) => c.method === 'tab.create')?.params).toEqual({ workspace_id: 'w7', label: 'terminal', focus: false, cwd: '/home/tester' });
});
it('starts an agent session in the home workspace when no project is given', async () => {
  const { query, calls } = sessionSetup({ homeWorkspace: true });
  const { body } = await query('mutation { startSession(kind:"claude", name:"claude-9") { workspaceId ready } }');
  expect(body.data.startSession).toEqual({ workspaceId: 'w7', ready: true });
  expect(calls.find((c) => c.method === 'tab.create')?.params).toMatchObject({ workspace_id: 'w7', cwd: '/home/tester' });
});
it('reports a terminal whose shell is still busy as not ready', async () => {
  const { query } = sessionSetup({ shellBusyPolls: 100000 });
  const { body } = await query('mutation { startTerminal(workspaceId:"w1") { ready } }');
  expect(body.data.startTerminal.ready).toBe(false);
});
it('reports not ready when the shell cannot be checked', async () => {
  const { query } = sessionSetup({ processInfoFails: true });
  const { body } = await query('mutation { startTerminal(workspaceId:"w1") { ready } }');
  expect(body.data.startTerminal.ready).toBe(false);
});
it('rejects an unknown project before opening a terminal', async () => {
  const { query, calls } = sessionSetup();
  const { body } = await query('mutation { startTerminal(workspaceId:"w404") { paneId } }');
  expect(body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
  expect(calls.some((c) => c.method === 'tab.create')).toBe(false);
});
```

The busy-shell test needs `shellTimeoutMs` small enough; `sessionSetup` already uses 1000 ms.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run bridge/src/server.test.ts`
Expected: the new tests FAIL (`Cannot query field "homeFolder"`, `"startTerminal"`, or a required `workspaceId`); existing tests pass.

- [ ] **Step 4: Implement in `schema.ts` and `server.ts`**

- Add the types/fields above. Unknown `workspaceId` keeps the existing message ("That project is no longer open in Herdr. Refresh and choose another.").
- One helper used by both mutations: `async function placement(snapshot, workspaceId: string | null): Promise<{ workspaceId: string; cwd: string | null; opened?: { paneId: string; tabId: string } }>` — a project → its `projectCwd`; null → the workspace labelled `HOME_WORKSPACE_LABEL` with `cwd: homeDir`, or `workspace.create { label, cwd: homeDir, focus: false }` whose `root_pane`/`tab` become `opened` (no `tab.create` then). Neither mutation is retried.
- `startTerminal`: validate (`target()` when given) → snapshot → `placement` → `tab.create { workspace_id, label: 'terminal', focus: false, cwd? }` unless `opened` → `ready = (await waitForShell(paneId)) === true`. Missing pane/tab IDs → the existing `BRIDGE_ERROR` "Herdr did not report the new tab.".
- `startSession`: same `placement`, then the existing flow unchanged.
- `createBridge` passes `options.homeDir` through.

- [ ] **Step 5: Run the bridge tests**

Run: `npx vitest run bridge/src/server.test.ts`
Expected: all PASS, including every pre-existing `startSession` test.

- [ ] **Step 6: Update `bridge/AGENTS.md`** with `startTerminal`, `homeFolder`, the `phone` workspace rule, and replace "arbitrary shell execution are not exposed" with: the bridge never runs commands itself; terminals are Herdr panes the user types into through `sendText`/`sendKeys`.

- [ ] **Step 7: Commit** — `feat(bridge): open plain terminals and a home workspace`

---

### Task 2: App foundation: palette, font, status marks, launch screen

**Files:**
- Create: `mobile/src/lib/status.ts`, `mobile/src/lib/status.test.ts`, `mobile/assets/fonts/NotoSansMono-Regular.ttf`, `mobile/assets/fonts/NotoSansMono-Bold.ttf`, `mobile/assets/fonts/OFL.txt`, `mobile/assets/splash-blank.png`
- Modify: `mobile/app.json`, `mobile/package.json` (via `npx expo install expo-splash-screen`), `mobile/src/components/ui.tsx`, `mobile/src/app/_layout.tsx`

**Interfaces:**
- Produces: `c` tokens in `ui.tsx`: `bg '#171421'`, `panel '#1E1E2E'`, `line '#313244'`, `elevated '#313244'`, `text '#CDD6F4'`, `muted '#A6ADC8'`, `dim '#6C7086'`, `accent '#89B4FA'`, `ink '#171421'` (text on accent), `amber '#F9E2AF'` (working), `red '#F38BA8'` (needs input, danger), `green '#A6E3A1'` (done), `term '#D0CFCC'` (terminal text), `select 'rgba(137,180,250,0.14)'`, `scrim '#00000099'`.
- Produces: `mono` = the bundled Noto Sans Mono family name (bold via `fontWeight: '700'`), `s.*` styles all carrying `fontFamily: mono`.
- Produces: `statusMark(status: string): { glyph: '●' | '◐' | '✓' | '○' | '·'; tone: 'red' | 'amber' | 'green' | 'dim'; label: string }` in `mobile/src/lib/status.ts` (`label`: "needs input", "working", "done", "idle", or the raw status).

- [ ] **Step 1: Write the failing tests**

```ts
// status.test.ts
it.each([
  ['blocked', '●', 'red', 'needs input'],
  ['working', '◐', 'amber', 'working'],
  ['done', '✓', 'green', 'done'],
  ['idle', '○', 'dim', 'idle'],
  ['unknown', '·', 'dim', 'unknown'],
])('marks %s', (status, glyph, tone, label) => {
  expect(statusMark(status)).toEqual({ glyph, tone, label });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run mobile/src/lib/status.test.ts`: FAIL (module missing).

- [ ] **Step 3: Implement**
  - `status.ts` per the interface.
  - Fonts: copy `/usr/share/fonts/truetype/noto/NotoSansMono-{Regular,Bold}.ttf` (Debian `fonts-noto-mono`, OFL-1.1, the font the user's terminal resolves "Monospace" to) and the OFL text from `/usr/share/doc/fonts-noto-mono/copyright` into `mobile/assets/fonts/`. Register them with the `expo-font` config plugin as one Android family with weights 400 and 700 (check the SDK 57 expo-font docs for the `android.fonts` family form; if unavailable, use the per-file names and set `mono`/`monoBold` accordingly).
  - Launch screen: `npx expo install expo-splash-screen`; plugin config `backgroundColor: '#171421'` and `image: './assets/splash-blank.png'` (a fully transparent PNG), no dark variant needed (`userInterfaceStyle` is dark). Top-level `"backgroundColor": "#171421"`. Check the SDK 57 splash-screen docs for disabling the fade; the result must be a plain screen with nothing animating.
  - `ui.tsx`: new `c`, `mono`; `fontFamily: mono` in every `s.*` text style and in `Button`, `Field`, `Notice`, `LiveBadge`, `Loading`; `Status` renders `statusMark` glyph + label in its tone; radii ≈ 4 (Sheet top corners 8); `Sheet` scrim uses `c.scrim`; `Pulse` stays for the LIVE badge only.
  - `_layout.tsx`: unchanged except it already uses `c.bg`.

- [ ] **Step 4: Run tests** — `npx vitest run mobile/src/lib/status.test.ts` PASS; `npm run typecheck` PASS. Run `npx expo-doctor` (expect no new issues).

- [ ] **Step 5: Commit** — `feat(mobile): Herdr palette, Noto Sans Mono and a plain launch screen`

---

### Task 3: Screens in the B style (home, machines, connect, modals) and the pairing keyboard fix

**Files:**
- Modify: `mobile/src/screens/AgentsScreen.tsx`, `MachinesScreen.tsx`, `PairMachineModal.tsx`, `StartAgentModal.tsx`, `ConnectScreen.tsx`, `mobile/src/components/DictationControl.tsx`

**Interfaces:**
- Consumes: `c`, `mono`, `s`, `Status`, `statusMark` (Task 2).

- [ ] **Step 1: Restyle to option B** (mockup `look.html`, right-hand phones):
  - Home: header `herd remote` + machine line `name · connected`; counters as three panels labelled `all`, `◐ working`, `● input` (selected counter: 2 px accent bottom edge); section label `agents`; each agent is a row, not a card: status glyph in its tone, then heading, task line and meta line indented under it; the opened/selected row style is `c.select` + 2 px accent left edge; "Other terminals" becomes `terminals` with the same rows; the floating button reads `+ new`. Keep every existing behavior (filters, search, workspace chips, refresh, status guide, empty states).
  - Machines, pairing, start-agent and dictation: same tokens, lowercase labels, small radii. `DictationControl`'s `'#3A2420'` becomes a token.
- [ ] **Step 2: Fix the keyboard on `ConnectScreen`** — `KeyboardAvoidingView behavior="padding"` on both platforms (edge-to-edge Android does not resize), so the focused field and Connect stay visible inside the ScrollView.
- [ ] **Step 3: Verify** — `npm run typecheck`, `npm run lint`. (Visual checks happen in Task 7.)
- [ ] **Step 4: Commit** — `feat(mobile): Herdr-style home, machines and pairing; keep pairing fields above the keyboard`

---

### Task 4: Terminal screen in the B style

**Files:**
- Create: `mobile/src/lib/palette.test.ts`
- Modify: `mobile/src/screens/AgentScreen.tsx`

- [ ] **Step 1: Write the palette guard**

```ts
// palette.test.ts — walks mobile/src with node:fs
it('keeps colors in the theme', () => {
  for (const file of tsxFiles('mobile/src'))
    if (!file.endsWith('components/ui.tsx'))
      expect(readFileSync(file, 'utf8')).not.toMatch(/['"]#[0-9A-Fa-f]{3,8}['"]/);
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run mobile/src/lib/palette.test.ts`: FAIL on `AgentScreen.tsx` (`'#0B100C'`, `'#DBE5D6'`).
- [ ] **Step 3: Restyle** — terminal area background `c.bg` with `c.term` text in `mono`; header with `Status` glyph; key row stays one horizontally scrolling line (never wraps) with labels `esc`, `tab`, `↑`, `↓`, `←`, `→`, `enter`, `^C` (`^C` in `c.red`), `y`, `n`; small radii; the two hex literals become tokens.
- [ ] **Step 4: Verify** — `npx vitest run mobile/src/lib/palette.test.ts` PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(mobile): Herdr-style terminal screen`

---

### Task 5: Run/Type composer for plain terminals

**Files:**
- Modify: `mobile/src/lib/terminal.ts`, `mobile/src/screens/AgentScreen.tsx`
- Test: `mobile/src/lib/terminal.test.ts` (create if absent; keep existing `newLineCount` tests where they are)

**Interfaces:**
- Produces in `terminal.ts`: `type ComposerMode = 'prompt' | 'run' | 'type'`; `effectiveMode(mode: ComposerMode, hasAgent: boolean): ComposerMode`; `nextMode(mode: ComposerMode, hasAgent: boolean): ComposerMode`; `runFailureNotice(typed: boolean): string`.

- [ ] **Step 1: Write the failing tests**

```ts
it('offers Run/Type without an agent and Prompt/Type with one', () => {
  expect(effectiveMode('run', true)).toBe('prompt');
  expect(effectiveMode('prompt', false)).toBe('run');
  expect(effectiveMode('type', true)).toBe('type');
  expect(effectiveMode('type', false)).toBe('type');
  expect(nextMode('run', false)).toBe('type');
  expect(nextMode('type', false)).toBe('run');
  expect(nextMode('prompt', true)).toBe('type');
  expect(nextMode('type', true)).toBe('prompt');
});
it('says a typed command was not run when Enter failed', () => {
  expect(runFailureNotice(true)).toMatch(/typed.*not run/i);
  expect(runFailureNotice(false)).toMatch(/may not have reached/i);
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run mobile/src/lib/terminal.test.ts`: FAIL (exports missing).
- [ ] **Step 3: Implement**
  - `AgentScreen`: `hasAgent = !!agent`; state `mode` starts `'run'` for raw routes, `'prompt'` otherwise; shown mode is `effectiveMode(mode, hasAgent)`; the chip (always visible) toggles with `nextMode`. The draft is kept across mode changes.
  - Send: `prompt` → `PROMPT`; `type` → `SEND_TEXT`; `run` → `SEND_TEXT` then `KEYS ['enter'] raw:true`. If `SEND_TEXT` fails: existing uncertain-delivery error, draft kept. If `KEYS` fails after the text went through: draft cleared, `setActionError(runFailureNotice(true))`. Never retried.
  - Keys use `raw: !hasAgent || shownMode === 'type'`; `blocked` = `hasAgent && agent.status === 'blocked'`.
  - Placeholders: run `$ command · runs with enter`; type `text · no enter`; prompt `prompt · sends enter`. Sent confirmations: run `command sent.`, type `text sent. tap enter to submit it.`, prompt `prompt delivered.`
- [ ] **Step 4: Run tests** — `npx vitest run mobile/src/lib/terminal.test.ts` PASS; `npm run typecheck`.
- [ ] **Step 5: Update `mobile/AGENTS.md`** ("Prompt sends text + Enter; Type text deliberately sends no Enter" → add Run for plain terminals and the agent-detected switch).
- [ ] **Step 6: Commit** — `feat(mobile): run commands from plain terminals`

---

### Task 6: New session sheet: Terminal and Home folder

**Files:**
- Modify: `mobile/src/lib/graphql.ts`, `mobile/src/lib/types.ts`, `mobile/src/lib/sessions.ts`, `mobile/src/screens/NewSessionSheet.tsx`
- Test: `mobile/src/lib/sessions.test.ts`

**Interfaces:**
- Consumes: Task 1 GraphQL; Task 5 behavior of raw terminals.
- Produces: `HOME_FOLDER` (`query HomeFolder { homeFolder }`) and `START_TERMINAL` (`mutation StartTerminal($workspaceId: ID) { startTerminal(workspaceId: $workspaceId) { paneId tabId workspaceId ready } }`); `START_SESSION` variable becomes `$workspaceId: ID`; `type StartedTerminal = { paneId: string; tabId: string; workspaceId: string; ready: boolean }`.
- Produces in `sessions.ts`: `HOME_LABEL = 'phone'`; `HOME = '~home'` (sheet-only sentinel, never sent); `listedProjects(projects: Project[]): Project[]`; `terminalsSupported(error: unknown): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
it('hides the phone workspace from the project list', () => {
  const projects = [{ id: 'w1', label: 'api', cwd: '/a' }, { id: 'w7', label: 'phone', cwd: '/h' }];
  expect(listedProjects(projects).map((p) => p.id)).toEqual(['w1']);
});
it('treats an old bridge as not supporting terminals', () => {
  const old = new CombinedGraphQLErrors({ errors: [{ message: 'Cannot query field "homeFolder" on type "Query".' }] });
  expect(terminalsSupported(old)).toBe(false);
  expect(terminalsSupported(null)).toBe(true);
});
```

(Build the `CombinedGraphQLErrors` the way `@apollo/client/errors` constructs it in v4; adjust the constructor call to its actual signature.)

- [ ] **Step 2: Run to verify they fail** — `npx vitest run mobile/src/lib/sessions.test.ts`: FAIL.
- [ ] **Step 3: Implement**
  - Whole sheet in the B style: picker entries as highlighted rows (selected = `c.select` + 2 px accent left edge), lowercase labels, small-radius chips.
  - Sheet loads `HOME_FOLDER` in its own query alongside `NEW_SESSION_OPTIONS`; failure from an old bridge sets `terminalsSupported(...) === false`, any other failure is ignored (Home entry still shown).
  - Project picker: a `Home folder` row first (subtitle `shortPath(homeFolder) ?? '~'`), then `listedProjects`. Choosing it sets `workspaceId = HOME`; mutations send `workspaceId: null` for `HOME`.
  - Kind chips: a `terminal` chip after the primary kinds (TerminalSquare icon). With `terminal` chosen: no name row; label `first command · optional`, placeholder `e.g. git status`; button `open terminal` / busy `opening terminal…`; hint "opens a new tab in <project or home folder> with a plain shell."
  - Old bridge and (`terminal` chosen or `HOME`): show `outdatedBridge` notice and disable the button.
  - After `startTerminal`: command present and `ready` → `SEND_TEXT`, then `KEYS ['enter'] raw:true`; text failure → hand off the command as draft with "The terminal opened, but your command may not have reached it. Check the terminal before running it again."; Enter failure → hand off `''` draft with `runFailureNotice(true)`; not `ready` → hand off the command with "The shell was still starting, so your command was not run. It is in the box: tap send when you see the prompt." Then `onOpen(paneId, true)`. No retries; keep the `submitting` double-tap guard.
- [ ] **Step 4: Run tests** — `npm test` PASS, `npm run typecheck` PASS.
- [ ] **Step 5: Commit** — `feat(mobile): open terminals in a project or the home folder`

---

### Task 7: Live checks, docs, version, build

**Files:**
- Modify: `scripts/integration.ts`, `README.md`, `AGENTS.md`, `mobile/AGENTS.md`, `PRIVACY.md`, `docs/verification.md`, `docs/implementation-ledger.md`, `package.json`, `bridge/package.json`, `mobile/package.json`, `mobile/app.json`, `package-lock.json`

- [ ] **Step 1: Integration test** — in the disposable session, after the existing checks: `startTerminal(workspaceId: <test workspace>)` → `ready === true`, tab label `terminal`, pane cwd `/tmp`; create a bridge with `homeDir` = a fresh `mkdtemp` folder and call `startTerminal` twice with no workspace → first creates a `phone` workspace (pane cwd = the temp home), second reuses the same `workspaceId` with a new tab. Type `printf '%s\n' 'HERDR_'TERMINAL_OK` + Enter into the first terminal and wait for `HERDR_TERMINAL_OK`. Remove the temp home in `finally`. Run `npm run integration`; expected: passes and prints the summary line extended with "terminal tab → home workspace".
- [ ] **Step 2: Version 0.5.0 / versionCode 5** in all four package/app files and the lockfile (`npm install --package-lock-only`).
- [ ] **Step 3: Docs** — README (Terminal and Home folder usage; needs the 0.5.0 bridge), root `AGENTS.md` New sessions line, `mobile/AGENTS.md` (palette, font, launch screen, Run/Type), `PRIVACY.md` (commands typed into terminals go to the user's computer, like prompts; effective date 2026-11-03), `docs/verification.md` 0.5.0 section, ledger entry.
- [ ] **Step 4: Build and check on the emulator** (`emulator-5554` only; never the physical phone) against a disposable named Herdr session bridge, as in 0.4.0:
  - launch screen: plain `#171421`, no logo, nothing animating;
  - pairing screen: focus the token field → it and Connect stay above the keyboard; repeat at font scale 1.3;
  - home, machines, sheets match the B mockup; long labels truncate at font scale 1.3;
  - New session → Home folder → terminal with first command `printf ok` → it runs; second home terminal lands in the same `phone` workspace;
  - plain terminal: Run executes, Type does not press Enter, the key row scrolls sideways on one line;
  - against a 0.4.0 bridge build (git stash or the previous dist): projects load; Terminal/Home show the update message.
- [ ] **Step 5: Full checks** — `npm run lint:fix`, `npm run typecheck`, `npm test`, `npx expo-doctor`, `npm run build:android`.
- [ ] **Step 6: Commit** — `chore: release 0.5.0 with terminals and the Herdr look`
