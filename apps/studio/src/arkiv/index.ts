/**
 * Public surface of the Studio Arkiv feature.
 *
 * Pure data (state model, reducer, view model, record validation/redaction,
 * metadata comparison) is exported for hosts and tests. The DOM modules are
 * mountable panels; only `apps/studio/src/main.ts` wires them to a real
 * gateway and wallet.
 */

export {
  type CompareModel,
  type CompareRow,
  type CompareSide,
  compareRecords,
  sourceLabel,
} from "./compare.js";
export {
  ARKIV_ACCESS_KEY,
  HISTORY_LIMIT,
  HISTORY_SEARCH_FIELDS,
  type HistorySearchField,
  isRabdiChainId,
  RABDI_BLOCK_TIME_MS,
  RABDI_CHAIN_ID,
  RABDI_CHAIN_ID_HEX,
  RABDI_CURRENCY,
  RABDI_EXPLORER_URL,
  RABDI_NAME,
  RABDI_RPC_URL,
} from "./config.js";
export {
  ArkivController,
  type ControllerDeps,
  type StateListener,
} from "./controller.js";
export {
  type ArkivWalletActions,
  type MountArkivCompareOptions,
  type MountedArkivCompare,
  type MountedStudioArkiv,
  type MountStudioArkivOptions,
  mountArkivCompare,
  mountStudioArkiv,
} from "./dom.js";
export {
  type ArkivGateway,
  createRabdiGateway,
  MalformedRecordError,
  type PublishResult,
  type RabdiGatewayOptions,
  summaryFromRow,
} from "./gateway.js";
export {
  arkivRecordFromRow,
  decodePayloadHex,
  findSensitiveContent,
  isExpiredAt,
  publicDisclosure,
  type RawEntityRow,
  type ReadBackVerification,
  redactSensitive,
  verifyReadBack,
} from "./record.js";
export {
  type ArkivEvent,
  reduce,
} from "./state.js";
export {
  type ArkivRecord,
  type DetailPhase,
  type ErrorCategory,
  type HistoryPhase,
  type HistoryQuery,
  type HistoryState,
  initialState,
  type PublishPhase,
  type PublishState,
  publishBlockReason,
  type ReadBackOutcome,
  type RecordSummary,
  type StudioArkivState,
  type StudioError,
  type WalletState,
  type WalletStatus,
} from "./types.js";
export {
  DETAIL_DISCLAIMER,
  type DetailView,
  detailRows,
  detailView,
  disclosureRows,
  type HistoryView,
  historyView,
  type PublishView,
  publishView,
  type StudioArkivView,
  studioArkivView,
  type Tone,
  type ViewRow,
  type WalletView,
  walletView,
} from "./view.js";
export {
  attachWalletEvents,
  classifyError,
  connectWallet,
  type Eip1193Provider,
  getProvider,
  hasEip1193Provider,
  readChainId,
  type SwitchResult,
  switchToRabdi,
  type WalletEvents,
} from "./wallet.js";
