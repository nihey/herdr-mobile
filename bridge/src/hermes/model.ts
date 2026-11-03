/**
 * Codex's default model: the top-level `model = "…"` in ~/.codex/config.toml,
 * before any [table] (profiles and providers set their own models there).
 */
export function codexModel(toml: string): string | null {
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) return null;
    const match = /^model\s*=\s*(?:"([^"]+)"|'([^']+)')/.exec(line);
    if (match) return match[1] ?? match[2] ?? null;
  }
  return null;
}
