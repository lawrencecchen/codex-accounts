import { spawn } from "node:child_process";
import type { AddOptions } from "./add-options.js";
import { codexLoginArgs } from "./add-options.js";

export interface LoginCommandResult {
  code: number;
}

export type LoginRunner = (command: string, args: string[]) => Promise<LoginCommandResult>;

export async function runCodexLogin(
  options: AddOptions = { deviceAuth: false },
  runner: LoginRunner = spawnCodexLogin,
): Promise<void> {
  const args = codexLoginArgs(options);
  const displayed = `codex ${args.join(" ")}`;
  let result: LoginCommandResult;
  try {
    result = await runner("codex", args);
  } catch (err) {
    throw new Error(`Failed to run '${displayed}': ${(err as Error).message}. Is codex installed?`);
  }
  if (result.code !== 0) {
    throw new Error(`${displayed} exited with code ${result.code}`);
  }
}

function spawnCodexLogin(command: string, args: string[]): Promise<LoginCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", code => {
      resolve({ code: code ?? 1 });
    });
  });
}
