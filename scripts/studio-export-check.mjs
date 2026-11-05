#!/usr/bin/env node
/**
 * Real-browser check of the Studio export action (ANON-09).
 *
 * Drives headless Chrome over CDP (no browser-automation dependency), performs a
 * real comparison, clicks Export JSON, and then inspects the file Chrome
 * actually downloaded. It also records every network request made after the
 * click to prove the export does not trigger RPC traffic.
 *
 * Exit codes: 0 all checks passed, 1 browser driver error, 4 page never reached
 * the expected state, 5 downloaded artifact failed a check.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter((value) => typeof value === "string" && value.length > 0);

const FORBIDDEN_KEYS = [
  "params",
  "headers",
  "authorization",
  "cookie",
  "cookies",
  "apiKey",
  "privateKey",
  "accounts",
  "localStorage",
  "sessionStorage",
  "walletAddress",
];

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const options = {
    url: "http://127.0.0.1:5173/?selftest=1",
    timeoutMs: 240_000,
    port: 9480,
    mode: "selftest",
    label: "run",
    expectCompleteness: undefined,
    out: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const next = argv[index + 1];
    if (argv[index] === "--url" && next !== undefined) options.url = next;
    if (argv[index] === "--timeout" && next !== undefined) {
      options.timeoutMs = Number.parseInt(next, 10);
    }
    if (argv[index] === "--port" && next !== undefined) {
      options.port = Number.parseInt(next, 10);
    }
    if (argv[index] === "--mode" && next !== undefined) options.mode = next;
    if (argv[index] === "--label" && next !== undefined) options.label = next;
    if (argv[index] === "--expect-completeness" && next !== undefined) {
      options.expectCompleteness = next;
    }
    if (argv[index] === "--out" && next !== undefined) options.out = next;
  }
  return options;
}

class Cdp {
  #socket;
  #pending = new Map();
  #listeners = new Map();
  #nextId = 0;
  requests = [];

  static async connect(port) {
    const target = await Cdp.waitForPage(port);
    const cdp = new Cdp();
    cdp.#socket = new WebSocket(target.webSocketDebuggerUrl);
    cdp.#socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const resolve = cdp.#pending.get(message.id);
        if (resolve !== undefined) {
          cdp.#pending.delete(message.id);
          resolve(message);
        }
        return;
      }
      for (const listener of cdp.#listeners.get(message.method) ?? []) {
        listener(message.params);
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
      await sleep(250);
    }
    throw new Error("Chrome DevTools endpoint did not become available.");
  }

  on(method, listener) {
    const current = this.#listeners.get(method) ?? [];
    current.push(listener);
    this.#listeners.set(method, current);
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

function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No Chrome or Edge executable found. Set CHROME_PATH.");
}

async function waitForDownload(directory, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = await readdir(directory).catch(() => []);
    const finished = entries.filter(
      (entry) => entry.endsWith(".json") && !entry.endsWith(".crdownload"),
    );
    if (finished.length > 0) return join(directory, finished[0]);
    await sleep(250);
  }
  throw new Error("Chrome did not finish a download in time.");
}

const options = parseArgs(process.argv.slice(2));
const downloadDir = join(
  tmpdir(),
  `blocklab-export-${options.label}-${process.pid}-${Date.now()}`,
);
await mkdir(downloadDir, { recursive: true });
const profile = join(downloadDir, "profile");
const browser = findBrowser();
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

try {
  const cdp = await Cdp.connect(options.port);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  const download = await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir,
    eventsEnabled: true,
  });
  check(
    download.error === undefined,
    `Browser.setDownloadBehavior failed: ${JSON.stringify(download.error)}`,
  );

  cdp.on("Network.requestWillBeSent", (params) => {
    cdp.requests.push(params.request.url);
  });

  await cdp.send("Page.navigate", { url: options.url });

  // Phase A: before any comparison exists, the action must be rendered but
  // disabled. Wait for the panel to mount rather than racing module loading.
  let initialButton;
  const mountDeadline = Date.now() + 30_000;
  while (Date.now() < mountDeadline) {
    initialButton = await cdp.evaluate(`(() => {
      const button = document.querySelector('[data-blocklab-export]');
      if (button === null) return { found: false };
      return {
        found: true,
        disabled: button.disabled === true,
        ariaDisabled: button.getAttribute('aria-disabled'),
        hasSnapshot: window.__blocklabStudioSnapshot !== undefined,
      };
    })()`);
    if (initialButton?.found === true) break;
    await sleep(250);
  }
  check(initialButton?.found === true, "Export button was not rendered.");
  check(
    initialButton?.hasSnapshot !== true,
    "A comparison already existed before the disabled-state check.",
  );
  check(
    initialButton?.disabled === true,
    "Export button was enabled before any comparison existed.",
  );

  // Phase B: wait for the comparison (self-test) or click Compare routes.
  const deadline = Date.now() + options.timeoutMs;
  if (options.mode === "manual") {
    let ready = false;
    while (Date.now() < deadline) {
      ready = await cdp.evaluate(
        `(() => { const node = document.querySelector('#compare'); return node !== null && node.disabled !== true; })()`,
      );
      if (ready) break;
      await sleep(500);
    }
    if (!ready) {
      console.error("Compare button never became usable.");
      process.exitCode = 4;
      throw new Error("page not ready");
    }
    await cdp.evaluate(`document.querySelector('#compare').click()`);
  }

  let status;
  while (Date.now() < deadline) {
    status =
      options.mode === "manual"
        ? await cdp.evaluate(
            `(() => { const node = document.querySelector('[data-blocklab-export]'); return node !== null && node.disabled !== true ? 'ready' : 'waiting'; })()`,
          )
        : await cdp.evaluate("window.__blocklabSelfTestStatus");
    if (options.mode === "manual" ? status === "ready" : status === "done") break;
    await sleep(500);
  }
  const expected = options.mode === "manual" ? "ready" : "done";
  if (status !== expected) {
    console.error(`Page never reached ${expected} (status: ${String(status)}).`);
    process.exitCode = 4;
    throw new Error("page not ready");
  }

  // Capture the visible comparison and the in-memory payload before exporting.
  const before = await cdp.evaluate(`(() => {
    const container = document.querySelector('#comparison');
    const button = document.querySelector('[data-blocklab-export]');
    return {
      rows: [...container.querySelectorAll('tbody tr')].map((row) =>
        [...row.children].map((cell) => cell.textContent?.trim() ?? '')
      ),
      facts: [...container.querySelectorAll('dt')].map((term, index) => [
        term.textContent?.trim() ?? '',
        container.querySelectorAll('dd')[index]?.textContent?.trim() ?? '',
      ]),
      buttonDisabled: button.disabled === true,
      comparison: JSON.stringify(window.__blocklabComparison ?? null),
      snapshot: JSON.stringify(window.__blocklabStudioSnapshot ?? null),
      text: container.innerText,
    };
  })()`);
  check(
    before?.buttonDisabled === false,
    "Export button stayed disabled after a valid comparison was displayed.",
  );

  const requestsBefore = cdp.requests.length;

  // Phase C: click Export JSON and let Chrome write the file.
  const clicked = await cdp.evaluate(`(() => {
    const button = document.querySelector('[data-blocklab-export]');
    if (button === null) return false;
    button.click();
    return true;
  })()`);
  check(clicked === true, "Export button could not be clicked.");

  const downloadedPath = await waitForDownload(downloadDir, 30_000);
  const raw = await readFile(downloadedPath, "utf8");
  let exported;
  try {
    exported = JSON.parse(raw);
  } catch (error) {
    failures.push(`Downloaded file is not valid JSON: ${String(error)}`);
    exported = null;
  }

  // Give the page a moment to finish any post-click work, then verify that
  // exporting did not mutate the displayed comparison or the payload.
  await sleep(500);
  const after = await cdp.evaluate(`(() => {
    const container = document.querySelector('#comparison');
    return {
      comparison: JSON.stringify(window.__blocklabComparison ?? null),
      snapshot: JSON.stringify(window.__blocklabStudioSnapshot ?? null),
      text: container.innerText,
    };
  })()`);
  const requestsAfter = cdp.requests.slice(requestsBefore);

  check(
    after?.comparison === before?.comparison,
    "Exporting changed window.__blocklabComparison.",
  );
  check(
    after?.snapshot === before?.snapshot,
    "Exporting changed window.__blocklabStudioSnapshot.",
  );
  check(
    after?.text.includes("Exported blocklab-rpc-comparison-"),
    "The panel did not confirm the export.",
  );

  const remoteRequests = requestsAfter.filter((url) =>
    /^https?:/i.test(url),
  );

  if (exported !== null) {
    check(
      exported.schemaVersion === "1.0" &&
        exported.kind === "blocklab.rpc-comparison",
      "Export schema version or kind is wrong.",
    );
    check(
      typeof exported.run?.runId === "string" &&
        /^rpc-[0-9a-f]{16}$/.test(exported.run.runId),
      "Export has no stable run identifier.",
    );
    check(
      ["complete", "incomplete", "failed"].includes(exported.run?.completeness),
      "Export has no usable completeness label.",
    );
    check(
      Array.isArray(exported.direct?.attempts) && exported.direct.attempts.length === 4,
      "Export does not contain four direct attempts.",
    );
    check(
      exported.coverage?.eligibleMethods === undefined &&
        Array.isArray(exported.methods?.eligible) &&
        exported.methods.eligible.length === 4,
      "Export does not list the four eligible methods.",
    );

    const json = JSON.stringify(exported);
    for (const key of FORBIDDEN_KEYS) {
      check(
        !(key in exported) && !json.includes(`"${key}"`),
        `Export contains forbidden key "${key}".`,
      );
    }
    check(!json.includes("publicnode"), "Export contains the RPC endpoint host.");
    check(
      !json.includes("Bearer ") &&
        !json.includes("should-not-appear") &&
        !/(apikey|token|password)=/i.test(json),
      "Export contains credential-like text.",
    );
    check(
      typeof exported.runtime?.origin === "string",
      "Export has no redacted runtime origin.",
    );

    // Compare the artifact with what the table showed.
    const rows = before?.rows ?? [];
    const directAttempts = exported.direct?.attempts ?? [];
    check(
      rows.length === directAttempts.length,
      `Table shows ${rows.length} rows but export has ${directAttempts.length} direct attempts.`,
    );
    for (const [index, row] of rows.entries()) {
      const attempt = directAttempts[index];
      if (attempt === undefined) continue;
      check(
        row[0] === attempt.method,
        `Row ${index} method ${row[0]} does not match export ${attempt.method}.`,
      );
      const expectedDirect =
        attempt.success === true
          ? "succeeded"
          : attempt.success === false
            ? "failed"
            : "not attempted";
      check(
        row[1] === expectedDirect,
        `Row ${attempt.method} direct state "${row[1]}" does not match export "${expectedDirect}".`,
      );
    }
    const anonAttempts = exported.anonRpc?.attempts ?? [];
    for (const [index, row] of rows.entries()) {
      const attempt = anonAttempts[index];
      if (attempt === undefined) continue;
      const expectedAnon =
        attempt.success === true
          ? "succeeded"
          : attempt.success === false
            ? "failed"
            : "not attempted";
      check(
        row[2] === expectedAnon,
        `Row ${attempt.method} anon state "${row[2]}" does not match export "${expectedAnon}".`,
      );
    }
    const coverageFact = (before?.facts ?? []).find(
      ([term]) => term === "Routing coverage",
    );
    check(
      coverageFact !== undefined &&
        `${exported.coverage.coveragePct}%` === coverageFact[1],
      `Coverage ${exported.coverage.coveragePct}% does not match the rendered ${coverageFact?.[1]}.`,
    );
    if (options.expectCompleteness !== undefined) {
      check(
        exported.run.completeness === options.expectCompleteness,
        `Expected completeness ${options.expectCompleteness}, got ${exported.run.completeness}.`,
      );
    }
  }

  check(
    remoteRequests.length === 0,
    `Export triggered ${remoteRequests.length} network request(s): ${remoteRequests.join(", ")}`,
  );

  if (options.out !== undefined) {
    await mkdir(join(options.out, ".."), { recursive: true }).catch(
      () => undefined,
    );
    await writeFile(options.out, raw, "utf8");
  }

  const report = {
    label: options.label,
    url: options.url,
    downloadedFile: downloadedPath.replace(/\\/g, "/").split("/").pop(),
    bytes: Buffer.byteLength(raw, "utf8"),
    buttonDisabledBeforeComparison: initialButton?.disabled,
    buttonEnabledAfterComparison: before?.buttonDisabled === false,
    downloadConfirmedInPanel: after?.text.includes("Exported blocklab-rpc-comparison-"),
    requestsDuringExport: requestsAfter.length,
    remoteRequestsDuringExport: remoteRequests,
    changedComparison: after?.comparison !== before?.comparison,
    changedSnapshot: after?.snapshot !== before?.snapshot,
    export: exported === null ? null : {
      schemaVersion: exported.schemaVersion,
      kind: exported.kind,
      runId: exported.run?.runId,
      completeness: exported.run?.completeness,
      completenessReasons: exported.run?.completenessReasons,
      worker: exported.run?.worker,
      directTotals: exported.direct?.totals,
      anonTotals: exported.anonRpc?.totals ?? null,
      anonInitializationError: exported.anonRpc?.initializationError ?? null,
      coverage: exported.coverage,
      viem: exported.viem === null ? null : {
        directRan: exported.viem?.direct?.ran,
        anonRan: exported.viem?.anonRpc?.ran,
      },
      runtime: exported.runtime,
      topLevelKeys: Object.keys(exported),
    },
    visibleRows: before?.rows,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  cdp.close();
  if (failures.length > 0) process.exitCode = 5;
} catch (error) {
  if (process.exitCode === undefined) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} finally {
  child.kill();
  await sleep(300);
  await rm(downloadDir, { recursive: true, force: true }).catch(() => undefined);
}
