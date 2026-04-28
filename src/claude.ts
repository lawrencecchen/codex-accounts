import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  createProfile, listProfiles, findProfile, removeProfile,
  getActiveProfile, setActiveProfile, getInstancePath,
  detectClaudeCli, getAuthStatusAsync, getAuthStatusForPath,
  validateProfileName, createTempInstance, registerProfile,
  cleanupInstance, readCredential, fetchClaudeUsage,
} from "./claude-store.js";
import { displayClaudeProfiles, displayClaudeProfilesNumbered } from "./display.js";
import type { ClaudeProfileInfo } from "./types.js";

const HELP = `cx claude - Manage multiple Claude Code profiles

Usage:
  cx claude                     Show profiles and switch interactively
  cx claude add [name]          Add account (opens OAuth login, infers email)
  cx claude list                List all profiles with auth status
  cx claude switch [name]       Switch active profile
  cx claude remove <name>       Remove a profile
  cx claude env                 Print export CLAUDE_CONFIG_DIR=...
  cx claude run [name] [...]    Launch Claude with a specific profile
  cx claude <name> [...]        Shorthand for 'cx claude run <name>'
  cx claude help                Show this help

Shell integration (add to ~/.zshrc or ~/.bashrc):
  eval "$(cx claude env)"
`;

/** Fetch auth status, credentials, and usage for all profiles in parallel */
async function fetchInfos(): Promise<ClaudeProfileInfo[]> {
  const profiles = listProfiles();
  const active = getActiveProfile();

  // Phase 1: fetch auth status and credentials in parallel
  const withCreds = await Promise.all(
    profiles.map(async (p) => {
      try {
        const instancePath = getInstancePath(p.name);
        const [auth, credential] = await Promise.all([
          getAuthStatusAsync(p.name),
          readCredential(instancePath),
        ]);
        return { profile: p, auth, credential, error: undefined };
      } catch (err) {
        return { profile: p, auth: null, credential: null, error: (err as Error).message };
      }
    })
  );

  // Phase 2: fetch usage for all profiles with valid tokens in parallel
  const infos = await Promise.all(
    withCreds.map(async ({ profile: p, auth, credential, error }): Promise<ClaudeProfileInfo> => {
      let usage = null;
      if (credential?.accessToken && !error) {
        try {
          usage = await fetchClaudeUsage(credential.accessToken);
        } catch { /* ignore */ }
      }
      return { name: p.name, isActive: p.name === active, createdAt: p.createdAt, auth, credential, usage, error };
    })
  );

  return infos;
}

/** Create a new profile and open Claude for OAuth login.
 *  If name is provided, use it as the profile key.
 *  If not, login first in a temp dir, detect email, use email as key. */
async function cmdAdd(name?: string): Promise<void> {
  const claudePath = detectClaudeCli();
  if (!claudePath) {
    console.error("Claude CLI not found. Install from: https://claude.ai/download");
    process.exit(1);
  }

  // Named flow: validate + create profile dir upfront
  if (name) {
    const validationError = validateProfileName(name);
    if (validationError) {
      console.error(validationError);
      process.exit(1);
    }
    if (findProfile(name)) {
      console.error(`Profile "${name}" already exists. Remove first: cx claude remove ${name}`);
      process.exit(1);
    }
  }

  // Create instance directory — temp dir if no name (stable, never renamed)
  let instancePath: string;
  let dirName: string | undefined;
  if (name) {
    instancePath = createProfile(name);
  } else {
    const temp = createTempInstance();
    instancePath = temp.path;
    dirName = temp.dirName;
  }

  console.log("Starting Claude Code...");
  console.log("Complete the OAuth login in your browser, then exit Claude to finish setup.\n");

  return new Promise((resolve) => {
    // Trap SIGINT in parent so Ctrl+C doesn't kill us before we can
    // handle the child's exit (child gets SIGINT via process group)
    const ignoreInt = () => {};
    process.on("SIGINT", ignoreInt);

    const child = spawn(claudePath, [], {
      stdio: "inherit",
      env: { ...process.env, CLAUDE_CONFIG_DIR: instancePath },
    });

    child.on("error", (err) => {
      process.removeListener("SIGINT", ignoreInt);
      if (name) removeProfile(name); else cleanupInstance(dirName!);
      console.error(`Failed to start Claude: ${err.message}`);
      process.exit(1);
    });

    child.on("exit", async () => {
      process.removeListener("SIGINT", ignoreInt);

      // Always check auth status — credentials persist regardless of exit code
      let auth;
      try {
        auth = await getAuthStatusForPath(instancePath);
      } catch { /* ignore */ }

      if (auth?.loggedIn) {
        const profileName = name || auth.email || "default";

        // Unnamed flow: register the temp instance dir as a real profile (no rename)
        if (!name) {
          if (findProfile(profileName)) removeProfile(profileName);
          registerProfile(profileName, dirName!);
        }

        const displayEmail = auth.email ? ` (${auth.email})` : "";
        const displayPlan = auth.subscriptionType ? ` [${auth.subscriptionType}]` : "";
        console.log(`\nAdded Claude profile "${profileName}".${displayEmail}${displayPlan}`);
        console.log(`\n  cx claude switch ${profileName}   Set as active profile`);
        console.log(`  cx claude run ${profileName}      Launch Claude with this profile`);
        resolve();
      } else {
        // Not logged in — clean up
        if (name) removeProfile(name); else cleanupInstance(dirName!);
        console.error("\nLogin was not completed. No profile was created.");
        process.exit(1);
      }
    });
  });
}

async function cmdList(): Promise<void> {
  const infos = await fetchInfos();
  displayClaudeProfiles(infos);
}

async function cmdSwitch(name?: string): Promise<void> {
  if (!name) return cmdPromptSwitch();

  if (!findProfile(name)) {
    // Try partial match
    const all = listProfiles();
    const matches = all.filter(p => p.name.toLowerCase().includes(name.toLowerCase()));
    if (matches.length === 0) {
      console.error(`No profile matching "${name}".`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`Multiple matches for "${name}":`);
      for (const m of matches) console.error(`  ${m.name}`);
      process.exit(1);
    }
    return cmdSwitch(matches[0]!.name);
  }

  setActiveProfile(name);
  const instancePath = getInstancePath(name);
  console.log(`Active Claude profile: ${name}`);
  console.log(`\n  export CLAUDE_CONFIG_DIR=${instancePath}`);
  console.log(`\nOr add to shell rc: eval "$(cx claude env)"`);
}

async function cmdPromptSwitch(): Promise<void> {
  const infos = await fetchInfos();
  if (infos.length === 0) {
    console.log("No profiles. Run 'cx claude add' to create one.");
    return;
  }
  displayClaudeProfilesNumbered(infos);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question("Switch to (#): ", resolve));
  rl.close();

  const trimmed = answer.trim();
  if (!trimmed) return;

  const idx = parseInt(trimmed, 10) - 1;
  if (idx >= 0 && idx < infos.length) return cmdSwitch(infos[idx]!.name);
  return cmdSwitch(trimmed);
}

async function cmdRemove(name: string): Promise<void> {
  if (!name) {
    console.error("Usage: cx claude remove <name>");
    process.exit(1);
  }
  if (!findProfile(name)) {
    console.error(`Profile "${name}" not found.`);
    process.exit(1);
  }
  removeProfile(name);
  console.log(`Removed Claude profile: ${name}`);
}

/** Print export command for active profile (safe for eval) */
function cmdEnv(): void {
  const active = getActiveProfile();
  if (!active) return;
  console.log(`export CLAUDE_CONFIG_DIR=${getInstancePath(active)}`);
}

/** Launch Claude with a specific profile, passing through extra args */
async function cmdRun(name: string | undefined, extraArgs: string[]): Promise<void> {
  const profileName = name || getActiveProfile();
  if (!profileName) {
    console.error("No profile specified and no active profile set.");
    console.error("Usage: cx claude run <name>");
    process.exit(1);
  }
  if (!findProfile(profileName)) {
    console.error(`Profile "${profileName}" not found.`);
    process.exit(1);
  }

  const claudePath = detectClaudeCli();
  if (!claudePath) {
    console.error("Claude CLI not found. Install from: https://claude.ai/download");
    process.exit(1);
  }

  setActiveProfile(profileName);
  const instancePath = getInstancePath(profileName);

  const child = spawn(claudePath, extraArgs, {
    stdio: "inherit",
    env: { ...process.env, CLAUDE_CONFIG_DIR: instancePath },
  });

  child.on("error", (err) => {
    console.error(`Failed to start Claude: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => process.exit(code ?? 0));

  // Keep alive until child exits
  return new Promise(() => {});
}

/** Interactive default: list profiles + prompt to switch */
async function cmdDefault(): Promise<void> {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    console.log("No Claude profiles. Run 'cx claude add' to create one.");
    return;
  }
  return cmdPromptSwitch();
}

/** Main router for 'cx claude ...' subcommands */
export async function claudeMain(args: string[]): Promise<void> {
  const cmd = args[0];
  if (!cmd) return cmdDefault();

  switch (cmd) {
    case "add":
    case "login":
      return cmdAdd(args[1] || undefined);
    case "list":
    case "ls":
      return cmdList();
    case "switch":
    case "use":
      return cmdSwitch(args[1]);
    case "remove":
    case "rm":
      return cmdRemove(args[1] || "");
    case "env":
      cmdEnv();
      return;
    case "status":
      return cmdList();
    case "run":
      return cmdRun(args[1], args.slice(2));
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      // If arg matches a profile name, launch Claude with it
      if (findProfile(cmd)) {
        return cmdRun(cmd, args.slice(1));
      }
      console.error(`Unknown command: cx claude ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
}
