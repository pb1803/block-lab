import { createLocalAgent } from "./server.js";

const projectPath = process.argv[2];
if (projectPath === undefined) {
  process.stderr.write("Usage: blocklab-agent <explicit-project-directory>\n");
  process.exitCode = 2;
} else {
  const agent = await createLocalAgent({ projectPaths: [projectPath] });
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
