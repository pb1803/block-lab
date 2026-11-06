/**
 * Pure view model for the Studio Arkiv feature.
 *
 * No DOM here: tests exercise the mapping from a `StudioArkivState` to the
 * rows and lines the DOM renders, so wording and redaction decisions are unit
 * testable.
 */
import type { ExperimentMetadata } from "@blocklab/arkiv-metadata";
import { RABDI_BLOCK_TIME_MS, RABDI_CHAIN_ID_HEX } from "./config.js";
import {
  ownershipRole,
  transferCaveats,
  transferPreviewRows,
} from "./ownership.js";
import { publicDisclosure } from "./record.js";
import type {
  ArkivRecord,
  StudioArkivState,
  StudioError,
  WalletStatus,
} from "./types.js";
import { publishBlockReason } from "./types.js";

export type Tone = "ok" | "error" | "warn" | "neutral";

export type ViewRow = {
  readonly label: string;
  readonly value: string;
  readonly tone?: Tone | undefined;
};

export type WalletView = {
  readonly status: WalletStatus;
  readonly statusText: string;
  readonly addressLine: string;
  readonly chainLine: string;
  /**
   * Visibility of the wallet actions, decided here so the DOM cannot drift from
   * the state again (the Connect button used to be hidden as soon as any
   * provider was detected, which left a disconnected wallet with no action).
   *   missing      → Detect only (nothing to connect to yet)
   *   disconnected → Connect
   *   wrong-network → Switch (explicit) + Disconnect
   *   connected    → Disconnect
   */
  readonly showConnect: boolean;
  readonly showDetect: boolean;
  readonly showSwitch: boolean;
  readonly canDisconnect: boolean;
};

export type PublishView = {
  readonly phaseText: string;
  readonly phaseTone: Tone;
  readonly error: string | undefined;
  readonly errorTone: Tone;
  readonly canPublish: boolean;
  readonly disclosureShown: boolean;
  readonly resultRows: readonly ViewRow[];
  readonly readBackLine: string | undefined;
  readonly readBackTone: Tone | undefined;
};

export type HistoryView = {
  readonly phaseText: string;
  readonly phaseTone: Tone;
  readonly rows: readonly ViewRow[];
  readonly error: string | undefined;
};

export type DetailView = {
  readonly phaseText: string;
  readonly phaseTone: Tone;
  readonly rows: readonly ViewRow[];
  readonly error: string | undefined;
  readonly disclaimer: string;
};

export type CompareView = {
  readonly leftLabel: string | undefined;
  readonly rightLabel: string | undefined;
  readonly header: string;
  readonly rows: readonly ViewRow[];
  readonly summary: string;
};

export type TransferView = {
  readonly phaseText: string;
  readonly phaseTone: Tone;
  readonly roleLine: string;
  readonly roleTone: Tone;
  readonly rows: readonly ViewRow[];
  readonly caveats: readonly string[];
  readonly error: string | undefined;
  readonly errorTone: Tone;
  readonly canPreview: boolean;
  readonly canConfirm: boolean;
  readonly readBackLine: string | undefined;
  readonly readBackTone: Tone | undefined;
};

export type StudioArkivView = {
  readonly wallet: WalletView;
  readonly publish: PublishView;
  readonly history: HistoryView;
  readonly detail: DetailView;
  readonly transfer: TransferView;
};

function short(address: string): string {
  return address.length <= 10
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function errorLine(
  error: StudioError | undefined,
  tone: Tone,
): { text: string | undefined; tone: Tone } {
  return error === undefined
    ? { text: undefined, tone }
    : { text: `[${error.category}] ${error.message}`, tone: "error" };
}

export function walletView(state: StudioArkivState): WalletView {
  const wallet = state.wallet;
  const base: WalletView = {
    status: wallet.status,
    statusText: "Wallet not found.",
    addressLine: "",
    chainLine: "No chain reported yet.",
    showConnect: false,
    showDetect: false,
    showSwitch: false,
    canDisconnect: false,
  };
  if (wallet.status === "missing") {
    return {
      ...base,
      statusText: "No EIP-1193 wallet (window.ethereum) detected.",
      showDetect: true,
    };
  }
  if (wallet.status === "disconnected") {
    return {
      ...base,
      statusText: "Wallet not connected.",
      showConnect: true,
    };
  }
  const address = wallet.address ?? "unknown";
  if (wallet.status === "wrong-network") {
    return {
      ...base,
      statusText: `Connected as ${short(address)} — wrong network (${wallet.chainIdHex ?? "unknown"}).`,
      addressLine: address,
      chainLine: `The wallet is on ${wallet.chainIdHex ?? "unknown"}; publish needs ${RABDI_CHAIN_ID_HEX}.`,
      showSwitch: true,
      canDisconnect: true,
    };
  }
  return {
    ...base,
    statusText: `Connected as ${short(address)}. Signing happens in the wallet; Studio never sees a key.`,
    addressLine: address,
    chainLine: `Rabdi detected (${RABDI_CHAIN_ID_HEX}).`,
    canDisconnect: true,
  };
}

const PHASE_TEXT: Record<string, string> = {
  idle: "Ready. No record has been published yet.",
  preflight: "Checking for an existing record with this experimentId…",
  "awaiting-signature": "Duplicate check passed. Waiting for wallet approval…",
  confirming:
    "Transaction signed; waiting for on-chain confirmation (nothing is shown as written until a receipt exists).",
  confirmed: "Confirmed in a block. The entity key comes from the receipt.",
  existing:
    "An entity with this experimentId already exists. No new transaction was sent.",
  failed: "Publish failed; nothing was written.",
};

export function publishView(state: StudioArkivState): PublishView {
  const publish = state.publish;
  const reason = publishBlockReason(state);
  const phaseTone: Tone =
    publish.phase === "confirmed" || publish.phase === "existing"
      ? "ok"
      : publish.phase === "failed"
        ? "error"
        : publish.phase === "preflight" ||
            publish.phase === "awaiting-signature" ||
            publish.phase === "confirming"
          ? "warn"
          : "neutral";
  const resultRows: ViewRow[] = [];
  if (publish.entityKey !== undefined) {
    resultRows.push({
      label: "Entity key",
      value: publish.entityKey,
      tone: "ok",
    });
  }
  if (publish.txHash !== undefined) {
    resultRows.push({ label: "Transaction hash", value: publish.txHash });
  }
  if (publish.expiresAtBlock !== undefined) {
    resultRows.push({
      label: "Expires at block",
      value: publish.expiresAtBlock.toString(),
    });
  }
  const readBack = publish.readBack;
  const publishErrorLine = errorLine(
    publish.phase === "existing" || publish.phase === "confirmed"
      ? undefined
      : publish.error,
    "error",
  );
  const error = publishErrorLine.text;
  return {
    phaseText: PHASE_TEXT[publish.phase] ?? publish.phase,
    phaseTone,
    error,
    errorTone: "error",
    canPublish: reason === null,
    disclosureShown: publish.metadata !== undefined,
    resultRows,
    readBackLine: readBack?.detail,
    readBackTone:
      readBack === undefined
        ? undefined
        : readBack.outcome === "verified"
          ? "ok"
          : "error",
  };
}

export function disclosureRows(
  metadata: ExperimentMetadata,
): readonly string[] {
  return publicDisclosure(metadata);
}

export function historyView(state: StudioArkivState): HistoryView {
  const history = state.history;
  const phaseText =
    history.phase === "idle"
      ? "No history queried yet."
      : history.phase === "searching"
        ? `Searching by ${history.query?.field ?? "?"} = "${history.query?.value ?? ""}"…`
        : history.phase === "empty"
          ? `No records match ${history.query?.field ?? "?"} = "${history.query?.value ?? ""}".`
          : history.phase === "ok"
            ? `${history.records.length} record${history.records.length === 1 ? "" : "s"} matched.`
            : "The history query could not be completed.";
  const phaseTone: Tone =
    history.phase === "ok"
      ? "ok"
      : history.phase === "failed"
        ? "error"
        : history.phase === "empty"
          ? "warn"
          : "neutral";
  return {
    phaseText,
    phaseTone,
    rows: history.records.map((record) => ({
      label: record.experimentId,
      value: `${record.scenarioName} · ${record.status} · ${record.entityKey}`,
      tone: record.status === "passed" ? "ok" : "neutral",
    })),
    error: errorLine(history.error, "error").text,
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function detailRows(record: ArkivRecord): readonly ViewRow[] {
  const m = record.metadata;
  const rows: ViewRow[] = [
    { label: "Experiment id", value: m.experimentId },
    { label: "Experiment type", value: m.experimentType },
    { label: "Scenario", value: m.scenarioName },
    { label: "Status", value: m.status },
    { label: "Target chain id", value: String(m.targetChainId) },
    { label: "Started at", value: iso(m.startedAtMs) },
    {
      label: "Completed at",
      value: m.completedAtMs === undefined ? "—" : iso(m.completedAtMs),
    },
    {
      label: "Duration",
      value:
        m.completedAtMs === undefined
          ? "—"
          : `${m.completedAtMs - m.startedAtMs} ms`,
    },
    {
      label: "Requests / succeeded / failed",
      value: `${m.requestCount} / ${m.succeededCount} / ${m.failedCount} (${m.rpcFailureCount} RPC failures)`,
    },
    {
      label: "Latency",
      value:
        m.latency === undefined
          ? "—"
          : `avg ${m.latency.averageMs} / p50 ${m.latency.p50Ms} / p95 ${m.latency.p95Ms} / max ${m.latency.maxMs} ms`,
    },
    { label: "Evidence digest (sha256)", value: m.evidenceDigest },
    { label: "Evidence ref", value: m.evidenceRef ?? "—" },
    { label: "Requested lifetime", value: `${m.expiryDays} days` },
    { label: "Entity key", value: record.entityKey },
    { label: "Owner", value: record.owner },
    { label: "Creator", value: record.creator },
    { label: "Created at block", value: record.createdAtBlock.toString() },
    { label: "Updated at block", value: record.updatedAtBlock.toString() },
    { label: "Expires at block", value: record.expiresAtBlock.toString() },
    { label: "Readonly flag", value: String(record.readonlyFlag) },
    {
      label: "Lifetime (blocks)",
      value: `${record.expiresAtBlock - record.createdAtBlock} ≈ ${(
        (Number(record.expiresAtBlock - record.createdAtBlock) *
          RABDI_BLOCK_TIME_MS) /
          86_400_000
      ).toFixed(1)} days`,
    },
    {
      label: "Network",
      value: `Rabdi testnet (chain id ${RABDI_CHAIN_ID_HEX})`,
    },
  ];
  return rows;
}

export const DETAIL_DISCLAIMER =
  "The evidence digest is a hash of local evidence only: it does not prove the execution was trustworthy on its own. The detailed traces and evidence remain local and are not on Arkiv.";

export function detailView(state: StudioArkivState): DetailView {
  const detail = state.detail;
  const phaseText =
    detail.phase === "idle"
      ? "No record opened."
      : detail.phase === "loading"
        ? "Loading the record from Arkiv…"
        : detail.phase === "ok"
          ? "Record retrieved from Arkiv and validated."
          : detail.phase === "missing"
            ? "No live entity with that key: it was never created, or it has been deleted or has expired."
            : detail.phase === "malformed"
              ? "The entity exists but its stored payload is not a valid BLOCKLAB record. Nothing is displayed as fact."
              : "The record could not be retrieved.";
  const phaseTone: Tone =
    detail.phase === "ok"
      ? "ok"
      : detail.phase === "missing" || detail.phase === "malformed"
        ? "warn"
        : detail.phase === "failed"
          ? "error"
          : "neutral";
  return {
    phaseText,
    phaseTone,
    rows: detail.record === undefined ? [] : detailRows(detail.record),
    error: errorLine(detail.error, "error").text,
    disclaimer: DETAIL_DISCLAIMER,
  };
}

export function studioArkivView(state: StudioArkivState): StudioArkivView {
  return {
    wallet: walletView(state),
    publish: publishView(state),
    history: historyView(state),
    detail: detailView(state),
    transfer: transferView(state),
  };
}

/**
 * The ownership-transfer panel. Role wording distinguishes creator from owner
 * explicitly, because the two are easy to conflate and only the owner can sign a
 * transfer. Confirming is possible only from a fresh preview on an entity the
 * connected account owns.
 */
function transferView(state: StudioArkivState): TransferView {
  const transfer = state.transfer;
  const record = state.detail.record;
  const signer = state.wallet.address;
  const role =
    record === undefined
      ? undefined
      : ownershipRole({ owner: record.owner, creator: record.creator }, signer);
  const phaseText: Record<typeof transfer.phase, string> = {
    idle: "No transfer staged. Open an entity, enter a recipient and preview.",
    preview: "Previewed against a live read. Nothing has been signed yet.",
    submitting: "Waiting for the wallet to sign the transfer…",
    confirming: "Signed; waiting for the mined receipt…",
    confirmed: "Transfer confirmed by the receipt.",
    failed: "The transfer did not complete.",
  };
  const phaseTone: Record<typeof transfer.phase, Tone> = {
    idle: "neutral",
    preview: "warn",
    submitting: "warn",
    confirming: "warn",
    confirmed: "ok",
    failed: "error",
  };
  const staged = transfer.phase === "preview";
  const rows: ViewRow[] =
    staged &&
    transfer.before !== undefined &&
    transfer.newOwner !== undefined &&
    signer !== undefined
      ? transferPreviewRows({
          snapshot: transfer.before,
          signer,
          newOwner: transfer.newOwner,
        }).map((row) => ({ label: row.label, value: row.value }))
      : [];
  const readBack = transfer.readBack;
  return {
    phaseText: phaseText[transfer.phase],
    phaseTone: phaseTone[transfer.phase],
    roleLine:
      role === undefined
        ? "Open an entity to see whether the connected account may transfer it."
        : role.summary,
    roleTone: role === undefined ? "neutral" : role.isOwner ? "ok" : "warn",
    rows,
    caveats: transfer.phase === "preview" ? transferCaveats() : [],
    error: transfer.error?.message,
    errorTone: "error",
    canPreview:
      record !== undefined &&
      state.wallet.status === "connected" &&
      transfer.phase !== "submitting" &&
      transfer.phase !== "confirming",
    canConfirm: staged && state.wallet.status === "connected",
    readBackLine:
      readBack === undefined
        ? undefined
        : readBack.ok
          ? "Read-back passed: owner moved, creator/expiry/payload unchanged."
          : `Read-back failed: ${readBack.checks
              .filter((check) => !check.ok)
              .map((check) => check.name)
              .join("; ")}.`,
    readBackTone:
      readBack === undefined ? undefined : readBack.ok ? "ok" : "error",
  };
}
