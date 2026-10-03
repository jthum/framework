import type { ActionDefinition } from "../action-registry.ts";
import type { CoreActionPorts } from "./ports.ts";
import { rulesActions } from "./rules.ts";
import { sourcesActions } from "./sources.ts";
import { viewsActions } from "./views.ts";
import { recordsActions } from "./records.ts";
import { inferenceActions } from "./inference.ts";

export function coreActions(ports: CoreActionPorts): readonly ActionDefinition[] {
  return [
    ...rulesActions(ports),
    ...sourcesActions(ports),
    ...viewsActions(ports),
    ...recordsActions(ports),
    ...inferenceActions(ports),
  ];
}
