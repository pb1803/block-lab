#!/usr/bin/env node
/**
 * Real-browser check of the Studio comparison view.
 *
 * Opens the sample dApp with `?selftest=1`, waits for the self-test to publish
 * its payload, and then inspects the DOM that Studio's read-only view rendered.
 * No browser-automation dependency: it talks to the Chrome DevTools Protocol
 * over Node's built-in WebSocket.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter((value) => typeof value === "string" && value.length > 0);

function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No Chrome or Edge executable found. Set CHROME_PATH.");
}

function parseArgs(argv) {
  const options = {
    url: "http://127.0.0.1:5173/",
    timeoutMs: 200_000,
    port: 9466,
    afterClick: undefined,
    waitSelector: undefined,
    injectInvalid: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === "--url" && next !== undefined) options.url = next;
    if (flag === "--timeout" && next !== undefined) {
      options.timeoutMs = Number.parseInt(next, 10);
    }
    if (flag === "--port" && next !== undefined) {
      options.port = Number.parseInt(next, 10);
    }
    if (flag === "--after-click" && next !== undefined) {
      options.afterClick = next;
    }
    if (flag === "--wait-selector" && next !== undefined) {
      options.waitSelector = next;
    }
    if (flag === "--inject-invalid") options.injectInvalid = true;
  }
  return options;
}

class Cdp {
  #socket;
  #pending = new Map();
  #nextId = 0;

  static async connect(port) {
    const target = await Cdp.waitForPage(port);
    const cdp = new Cdp();
    cdp.#socket = new WebSocket(target.webSocketDebuggerUrl);
    cdp.#socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const resolve = cdp.#pending.get(message.id);
      if (resolve !== undefined) {
        cdp.#pending.delete(message.id);
        resolve(message);
      }
    };
    await new Promise((resolve, reject) => {
      cdp.#socket.onopen = resolve;
      cdp.#socket.onerror = () => reject(new Error("CDP socket failed"));
    });
    return cdp;
  }

  static async waitForPage(port) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((target) => target.type === "page");
        if (page !== undefined) return page;
      } catch {
        // DevTools endpoint is not ready yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Chrome DevTools endpoint did not become available.");
  }

  send(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return response.result?.result?.value;
  }

  close() {
    this.#socket.close();
  }
}

const options = parseArgs(process.argv.slice(2));
const browser = findBrowser();
const profile = `${process.env.TEMP ?? "/tmp"}/blocklab-studio-${Date.now()}`;
const child = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const cdp = await Cdp.connect(options.port);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: options.url });

  const deadline = Date.now() + options.timeoutMs;
  let status;
  while (Date.now() < deadline) {
    if (options.waitSelector === undefined) {
      status = await cdp.evaluate("window.__blocklabSelfTestStatus");
      if (status === "done") break;
    } else {
      status = await cdp.evaluate(
        `(() => { const node = document.querySelector(${JSON.stringify(options.waitSelector)}); return node !== null && node.disabled !== true ? "ready" : "waiting"; })()`,
      );
      if (status === "ready") break;
    }
    await sleep(500);
  }
  const expected = options.waitSelector === undefined ? "done" : "ready";
  if (status !== expected) {
    console.error(`Page did not reach ${expected} (status: ${String(status)}).`);
    process.exitCode = 4;
  } else {
    if (options.injectInvalid) {
      // Proves the view rejects an untrusted payload instead of guessing.
      await cdp.evaluate(`(() => {
        window.__blocklabStudioSnapshot = { schemaVersion: "1.0", comparison: null };
        window.dispatchEvent(new Event("blocklab:comparison"));
        return true;
      })()`);
      await sleep(500);
    }
    const result = await cdp.evaluate(`(() => {
      const container = document.querySelector('#comparison');
      if (container === null) return { error: 'comparison container missing' };
      const tables = [...container.querySelectorAll('table')];
      const rows = [...container.querySelectorAll('tbody tr')].map((row) =>
        [...row.children].map((cell) => cell.textContent?.trim() ?? '')
      );
      const facts = [...container.querySelectorAll('dt')].map((term, index) => [
        term.textContent?.trim() ?? '',
        container.querySelectorAll('dd')[index]?.textContent?.trim() ?? '',
      ]);
      return {
        url: location.href,
        snapshotPublished: window.__blocklabStudioSnapshot !== undefined,
        tableCount: tables.length,
        rows,
        facts,
        headings: [...container.querySelectorAll('h3, h4')].map((node) => node.textContent?.trim() ?? ''),
        text: container.innerText,
        hasAlert: container.querySelector('[role="alert"]') !== null,
        hasWarning: container.querySelector('.studio-warning') !== null,
      };
    })()`);
    if (options.afterClick !== undefined && result !== undefined) {
      // Live-update check: the page must re-render when it publishes a new
      // snapshot, without a reload and without polling inside Studio.
      const before = await cdp.evaluate(
        "document.querySelector('#comparison')?.innerText ?? ''",
      );
      const clicked = await cdp.evaluate(
        `(() => { const node = document.querySelector(${JSON.stringify(options.afterClick)}); if (node === null) return false; node.click(); return true; })()`,
      );
      let after = before;
      const updateDeadline = Date.now() + 60_000;
      while (clicked === true && Date.now() < updateDeadline) {
        await sleep(1000);
        after = await cdp.evaluate(
          "document.querySelector('#comparison')?.innerText ?? ''",
        );
        if (after !== before) break;
      }
      result.afterState = await cdp.evaluate(`(() => {
        const container = document.querySelector('#comparison');
        if (container === null) return null;
        return {
          rows: [...container.querySelectorAll('tbody tr')].length,
          headings: [...container.querySelectorAll('h3, h4')].map((node) => node.textContent?.trim() ?? ''),
          hasAlert: container.querySelector('[role="alert"]') !== null,
          text: container.innerText,
        };
      })()`);
      result.liveUpdate = {
        clicked,
        changed: after !== before,
        beforeLength: before.length,
        afterLength: after.length,
      };
    }
    console.log(JSON.stringify(result, null, 2));
  }
  cdp.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  child.kill();
  await sleep(500);
}
