/**
 * Browser-only RPC routing for BLOCKLAB.
 *
 * Node.js packages (CLI, runner, core) must not import this module: it owns
 * the browser-only `@anon-rpc/browser-harness` dependency.
 */
export {
  type AnonRpcOptions,
  AnonRpcTransport,
  type WorkerFactory,
  type WorkerInitLike,
  type WorkerInstance,
} from "./anon.js";
export {
  type BuildComparisonInput,
  buildComparison,
  EXCLUDED_METHOD_EXAMPLES,
  type RouteComparison,
  type RouteWorkload,
  type RunWorkloadOptions,
  runWorkload,
  type SummarizeOptions,
  summarizeRoute,
  type WorkloadEntry,
} from "./compare.js";
export { type DirectRpcOptions, DirectRpcTransport } from "./direct.js";
export {
  assertReadOnlyMethod,
  BrowserRpcError,
  EXCLUDED_METHOD_PREFIXES,
  findWorker,
  isExcludedMethod,
  isReadOnlyMethod,
  OFFICIAL_WORKERS,
  paramsForMethod,
  previewValue,
  READ_ONLY_METHODS,
  type ReadOnlyMethod,
  type RequestOptions,
  type RouteKind,
  type RpcErrorCategory,
  type RpcObservation,
  type RpcTransport,
  redactMessage,
  type TransportState,
  type WorkerDescriptor,
  type WorkerKind,
} from "./types.js";
