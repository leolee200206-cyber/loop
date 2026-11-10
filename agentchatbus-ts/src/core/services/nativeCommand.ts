import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface CommandLookupOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  isFile?: (candidate: string) => boolean;
}

/** Resolve a local executable without a shell or downloading a package. */
export function resolveLocalCommand(name: string, options: CommandLookupOptions = {}): string | null {
  if (!/^[a-z][a-z0-9-]*$/i.test(name)) return null;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const paths = platform === "win32" ? path.win32 : path.posix;
  const isFile = options.isFile ?? ((candidate: string) => {
    try { return existsSync(candidate) && statSync(candidate).isFile(); } catch { return false; }
  });
  const override = env[`AGENTCHATBUS_${name.toUpperCase().replace(/-/g, "_")}_COMMAND`];
  // Overrides are one executable path, never a shell command line. An invalid
  // explicit override must fail, rather than silently running another binary.
  if (override) return paths.isAbsolute(override) && isFile(override) ? override : null;
  const extensions = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const pathValue = env.PATH ?? env.Path ?? "";
  const directories = pathValue.split(platform === "win32" ? ";" : ":")
    .map(item => item.replace(/^"|"$/g, "")).filter(Boolean);
  directories.push(paths.join(home, ".local", "bin"));
  if (name === "grok") directories.push(paths.join(home, ".grok", "bin"));
  if (name === "codex") directories.push(paths.join(home, ".codex", "bin"));
  if (platform === "win32") {
    const roaming = env.APPDATA || paths.join(home, "AppData", "Roaming");
    directories.push(paths.join(roaming, "npm"));
  } else directories.push("/usr/local/bin", "/opt/homebrew/bin");
  for (const directory of [...new Set(directories)]) {
    // Never resolve against the service's current working directory.
    if (!paths.isAbsolute(directory)) continue;
    for (const extension of extensions) {
      const candidate = paths.join(directory, name + extension);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** Only native ACP contracts verified for this integration belong here. */
export function resolveNativeAcpCommand(agentId: string): { command: string; args: string[] } | null {
  if (agentId !== "grok") return null;
  const command = resolveLocalCommand("grok");
  return command ? { command, args: ["agent", "stdio"] } : null;
}
