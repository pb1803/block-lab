#!/usr/bin/env node

import { runCli } from "./cli.js";

const controller = new AbortController();
const stop = (): void => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

runCli(process.argv.slice(2), {
  stderr: (value) => process.stderr.write(value),
  stdout: (value) => process.stdout.write(value),
  signal: controller.signal,
}).then((code) => {
  process.exitCode = code;
});
