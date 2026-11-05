import type { Project } from "@blocklab/core";

export interface StudioShell {
  readonly name: "BLOCKLAB Studio";
  readonly localAgentRequired: true;
  readonly project: Project | null;
}

export const studioShell: StudioShell = {
  name: "BLOCKLAB Studio",
  localAgentRequired: true,
  project: null,
};
