import type { JsonValue } from "../spec/model.ts";

export const ERROR_CODES = {
  inferenceCancelled: "INFERENCE.CANCELLED",
  inferenceInvalidStream: "INFERENCE.INVALID_STREAM",
  inferenceProviderError: "INFERENCE.PROVIDER_ERROR",
  inferenceStepLimit: "INFERENCE.STEP_LIMIT",
  environmentCapabilityUnavailable: "ENVIRONMENT.CAPABILITY_UNAVAILABLE",
  internalUnexpected: "INTERNAL.UNEXPECTED",
  inferenceRefused: "INFERENCE.REFUSED",
  permissionDenied: "PERMISSION.DENIED",
  persistenceUnsupported: "PERSISTENCE.UNSUPPORTED",
  resourceConflict: "RESOURCE.CONFLICT",
  resourceNotFound: "RESOURCE.NOT_FOUND",
  specInvalid: "SPEC.INVALID",
  validationInvalidInput: "VALIDATION.INVALID_INPUT",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES] | (string & {});

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ErrorEnvelope {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, JsonValue>>;
  readonly issues?: readonly ValidationIssue[];
  readonly retryable?: boolean;
  readonly errorId?: string;
}

export class FrameworkError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, JsonValue>> | undefined;
  readonly issues: readonly ValidationIssue[] | undefined;
  readonly retryable: boolean | undefined;
  readonly errorId: string | undefined;

  constructor(envelope: ErrorEnvelope, options?: ErrorOptions) {
    super(envelope.message, options);
    this.name = "FrameworkError";
    this.code = envelope.code;
    this.details = envelope.details;
    this.issues = envelope.issues;
    this.retryable = envelope.retryable;
    this.errorId = envelope.errorId;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.issues === undefined ? {} : { issues: this.issues }),
      ...(this.retryable === undefined ? {} : { retryable: this.retryable }),
      ...(this.errorId === undefined ? {} : { errorId: this.errorId }),
    };
  }
}

export function resourceNotFound(kind: string, id: string): FrameworkError {
  return new FrameworkError({
    code: ERROR_CODES.resourceNotFound,
    message: `${kind} was not found.`,
    details: { kind, id },
  });
}

export function resourceConflict(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.resourceConflict, message });
}
