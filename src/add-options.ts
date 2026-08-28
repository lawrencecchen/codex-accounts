export interface AddOptions {
  deviceAuth: boolean;
}

export function parseAddArgs(args: string[]): AddOptions {
  const options: AddOptions = { deviceAuth: false };

  for (const arg of args) {
    switch (arg) {
      case "--device-auth":
        options.deviceAuth = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown add option: ${arg}`);
        }
        throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }

  return options;
}

/** Args passed to the `codex` binary for login. */
export function codexLoginArgs(options: AddOptions): string[] {
  return options.deviceAuth ? ["login", "--device-auth"] : ["login"];
}
