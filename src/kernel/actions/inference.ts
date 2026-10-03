import { type ActionDefinition } from "../action-registry.ts";
import { type CoreActionPorts } from "./ports.ts";
import { type JsonValue } from "../../spec/model.ts";
import {
  collectInferenceRun,
  type InferenceInput,
  type InferenceMessage,
} from "../inference-runtime.ts";
import { actionInputError, optionalActionObject, isJsonObject } from "./values.ts";

export function inferenceActions(
  ports: Pick<CoreActionPorts, "runInference">,
): readonly ActionDefinition[] {
  return [
    {
      key: "inference.run",
      run: async ({ context, input }) =>
        collectInferenceRun(await ports.runInference(context, actionInferenceInput(input))),
    },
  ];
}

function actionInferenceInput(input: Readonly<Record<string, JsonValue>>): InferenceInput {
  if (!Array.isArray(input.messages))
    throw actionInputError("Action input messages must be an array.");
  const messages: InferenceMessage[] = input.messages.map((value, index) => {
    if (!isJsonObject(value))
      throw actionInputError(`Action input messages.${index} must be an object.`);
    if (value.role !== "user" && value.role !== "assistant")
      throw actionInputError(`Action input messages.${index}.role must be user or assistant.`);
    if (typeof value.content !== "string" || !value.content.trim())
      throw actionInputError(`Action input messages.${index}.content must be a non-empty string.`);
    return value.role === "user"
      ? { role: "user", content: value.content }
      : { role: "assistant", content: value.content };
  });
  if (typeof input.instructions !== "undefined" && typeof input.instructions !== "string")
    throw actionInputError("Action input instructions must be a string.");
  const metadata = optionalActionObject(input.metadata, "metadata");
  return {
    messages,
    ...(input.instructions === undefined ? {} : { instructions: input.instructions as string }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}
