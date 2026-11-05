#!/usr/bin/env node
/**
 * Real-browser verification driver for the BLOCKLAB sample dApp.
 *
 * Uses the Chrome DevTools Protocol over Node's built-in WebSocket client, so it
 * needs no Playwright/Puppeteer dependency. It opens a page with `?selftest=1`,
 * waits for the sample dApp to finish both routes, and prints the resulting
 * comparison payload as JSON.
 *
 * Usage:
 *   node scripts/browser-selftest.mjs --url http://127.0.0.1:5173/ [--timeout 180000]
 *
 * Exits 0 when a result was produced (inspect `ok` in the payload), 1 when the
 * browser could not be driven, 4 when the self-test did not finish in time.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((candidate) => typeof candidate === "string" && candidate.length > 0);

function parseArgs(argv) {
  const args = { url: undefined, timeoutMs: 180_000, port: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--url") args.url = value;
    else if (flag === "--timeout") args.timeoutMs = Number(value);
    else if (flag === "--port") args.port = Number(value);
  }
  if (args.url === undefined) {
    throw new Error("--url is required");
  }
  return args;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "No Chrome/Edge binary found. Set CHROME_PATH to a Chromium-based browser executable.",
  );
}

async function launch(chromePath, port, profileDir) {
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Browser exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page !== undefined) return { child, page };
    } catch {
      // DevTools endpoint is not listening yet.
    }
    await wait(250);
  }
  throw new Error("Timed out waiting for the DevTools endpoint.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromePath = await findChrome();
  const port = args.port ?? 9400 + Math.floor(Math.random() * 400);
  const profileDir = await mkdtemp(join(tmpdir(), "blocklab-selftest-"));

  let child;
  let socket;
  try {
    const launched = await launch(chromePath, port, profileDir);
    child = launched.child;

    socket = new WebSocket(launched.page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });

    let nextId = 0;
    const pending = new Map();
    const exceptions = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        exceptions.push(
          message.params?.exceptionDetails?.exception?.description ??
            message.params?.exceptionDetails?.text ??
            "unknown exception",
        );
      }
    });

    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });

    const evaluate = async (expression) => {
      const response = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      return response.result?.result?.value;
    };

    await send("Page.enable");
    await send("Runtime.enable");
    const separator = args.url.includes("?") ? "&" : "?";
    await send("Page.navigate", { url: `${args.url}${separator}selftest=1` });

    const deadline = Date.now() + args.timeoutMs;
    let result;
    while (Date.now() < deadline) {
      const status = await evaluate(
        "window.__blocklabSelfTestStatus ?? 'pending'",
      );
      if (status === "done") {
        result = await evaluate("window.__blocklabSelfTest ?? null");
        break;
      }
      await wait(500);
    }

    if (result === undefined || result === null) {
      const status = await evaluate(
        "document.querySelector('#status')?.textContent ?? 'no status element'",
      );
      console.error(
        JSON.stringify(
          {
            error: "self-test did not finish before the timeout",
            pageStatus: status,
            exceptions,
          },
          null,
          2,
        ),
      );
      process.exitCode = 4;
      return;
    }

    console.log(JSON.stringify({ result, exceptions }, null, 2));
  } finally {
    try {
      socket?.close();
    } catch {
      // Ignore close failures during shutdown.
    }
    if (child !== undefined && child.exitCode === null) child.kill();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
