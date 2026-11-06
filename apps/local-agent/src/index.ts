import { createLocalAgent } from "./server.js";

const args = process.argv.slice(2);
const projectPaths: string[] = [];
const allowedOrigins: string[] = [];
let invalidArguments = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--allowed-origin") {
    const origin = args[index + 1];
    if (origin === undefined || origin.startsWith("--")) {
      invalidArguments = true;
      break;
    }
    allowedOrigins.push(origin);
    index += 1;
  } else if (argument?.startsWith("--")) {
    invalidArguments = true;
    break;
  } else if (argument !== undefined) {
    projectPaths.push(argument);
  }
}

if (invalidArguments || projectPaths.length !== 1) {
  process.stderr.write(
    "Usage: blocklab-agent [--allowed-origin <exact-origin>]... <explicit-project-directory>\n",
  );
  process.stderr.write(
    "Without --allowed-origin, only the exact local Studio development origins are allowed.\n",
  );
  process.exitCode = 2;
} else {
  const agent = await createLocalAgent({
    projectPaths,
    ...(allowedOrigins.length === 0 ? {} : { allowedOrigins }),
    onPairingCode: (code) => {
      process.stdout.write(`New one-time Studio pairing code: ${code}\n`);
    },
  });
  process.stdout.write(
    `BLOCKLAB Local Agent ready\nAgent: ${agent.agentId}\nURL: ${agent.url}\nPairing code: ${agent.pairingCode}\nProject authorization: explicit, inspect-only\n`,
  );
  const shutdown = (): void => {
    void agent.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export { createLocalAgent, pathIsWithinAuthorizedRoot } from "./server.js";
