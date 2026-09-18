# Errors

Framework failures use stable semantic codes and a safe, serializable envelope. Codes let hosts, agents, logs, tests, and alternative Spec consumers react consistently without depending on English message text or leaking internals.

## Code map

- Error codes and `FrameworkError`: [`src/errors/error.ts`](../src/errors/error.ts)
- Public entry point: [`src/errors/index.ts`](../src/errors/index.ts)
- Failure-path assertions: search `toMatchObject({ code:` in [`src`](../src)

Change a published code only when its semantic meaning changes. Add or update the smallest
failure-path test with any new public error.

## Code format

```text
CATEGORY.REASON
```

Examples:

```text
PERMISSION.DENIED
ATTACHMENT.REVOKED
SOURCE.CAPABILITY_UNSUPPORTED
PERSISTENCE.UNAVAILABLE
```

Categories and reasons are uppercase. A published code keeps one meaning. Messages may improve or be localized without changing the code.

Use a semantic reason rather than an allocated number. `ATTACHMENT.REVOKED` is useful without consulting a table; `ATTACHMENT-004` is not.

## Error envelope

Public boundaries expose plain JSON-compatible data:

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface ErrorEnvelope {
  code: string;
  message: string;
  details?: Record<string, JsonValue>;
  issues?: ValidationIssue[];
  retryable?: boolean;
  errorId?: string;
}

interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}
```

The TypeScript Kernel may use a `FrameworkError extends Error` internally, but its public representation follows this envelope. Other Spec consumers may use native exception types while producing equivalent boundary data.

Example:

```json
{
  "code": "ATTACHMENT.PERMISSIONS_EXCEEDED",
  "message": "The requested permissions exceed the available permissions.",
  "details": {
    "requested": ["read", "update"],
    "available": ["read"]
  },
  "retryable": false
}
```

## Expected and unexpected failures

Expected domain failures receive a precise stable code:

```text
VALIDATION.INVALID_INPUT
PERMISSION.DENIED
ATTACHMENT.REVOKED
ENVIRONMENT.CAPABILITY_UNAVAILABLE
```

Unexpected programming or infrastructure failures use:

```text
INTERNAL.UNEXPECTED
```

and receive an occurrence-specific `errorId` that support can correlate with internal logs. Do not create a permanent catalog code for every `TypeError`, impossible branch, or third-party stack trace.

## Base categories

Keep the base set small. Add a code only when a caller, UI, agent, test, support workflow, or alternative consumer benefits from distinguishing it.

| Category      | Meaning                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `SPEC`        | Invalid, unsupported, or unresolved portable definitions                 |
| `VALIDATION`  | Invalid user, Form, Rule, or Action input                                |
| `RESOURCE`    | Generic resource absence or state conflict                               |
| `PERMISSION`  | Membership, ACL, execution Actor, or `runAs` denial                      |
| `ATTACHMENT`  | Attached-resource permissions, availability, attenuation, and revocation |
| `SOURCE`      | Query and Source capability failures                                     |
| `ACTION`      | Action discovery and invocation contract failures                        |
| `RULE`        | Rule definition and execution failures                                   |
| `PERSISTENCE` | Adapter availability, conflicts, and unsupported operations              |
| `ENVIRONMENT` | Capability unavailable in the active EnvironmentProfile                  |
| `INTERNAL`    | Unexpected defect or unclassified internal failure                       |

## Initial codes

These codes define the initial shared meanings. Add narrower codes as implementation creates a real handling need.

| Code                                 | Meaning                                                         |
| ------------------------------------ | --------------------------------------------------------------- |
| `SPEC.INVALID`                       | The portable Spec is structurally or semantically invalid       |
| `SPEC.UNSUPPORTED_VERSION`           | The consumer does not implement this Spec version               |
| `SPEC.BINDING_REQUIRED`              | A semantic Source or Actor binding is unresolved                |
| `VALIDATION.INVALID_INPUT`           | One or more input values are invalid; use `issues`              |
| `RESOURCE.NOT_FOUND`                 | The addressed resource does not exist or is not visible         |
| `RESOURCE.CONFLICT`                  | Current resource state conflicts with the requested operation   |
| `PERMISSION.DENIED`                  | The execution Actor lacks the required permission               |
| `PERMISSION.RUN_AS_DENIED`           | The requested `runAs` Actor is not permitted for this operation |
| `ATTACHMENT.REVOKED`                 | The Attachment is no longer active                              |
| `ATTACHMENT.PERMISSIONS_EXCEEDED`    | Requested or derived permissions exceed available permissions   |
| `ATTACHMENT.RESHARE_DENIED`          | Re-sharing is disabled by policy or the received Attachment     |
| `SOURCE.UNAVAILABLE`                 | The Source cannot currently be read                             |
| `SOURCE.CAPABILITY_UNSUPPORTED`      | The Source does not support the requested operation             |
| `SOURCE.QUERY_UNSUPPORTED`           | The supplied query cannot be executed by this Source            |
| `ACTION.UNKNOWN`                     | No registered Action matches the key                            |
| `ACTION.INVALID_INPUT`               | Action input violates its declared contract                     |
| `RULE.INVALID`                       | The Rule definition is invalid                                  |
| `RULE.EXECUTION_FAILED`              | Rule execution failed without a more precise preserved code     |
| `RULE.WAIT_UNSUPPORTED`              | The environment cannot durably suspend this Rule                |
| `PERSISTENCE.UNAVAILABLE`            | The persistence adapter cannot currently serve the operation    |
| `PERSISTENCE.CONFLICT`               | Persistence rejected the operation because state changed        |
| `PERSISTENCE.UNSUPPORTED`            | The adapter cannot provide a required capability                |
| `ENVIRONMENT.CAPABILITY_UNAVAILABLE` | The deployment profile lacks a required capability              |
| `INTERNAL.UNEXPECTED`                | Unexpected failure; include an `errorId`                        |

## Validation issues

Use one top-level validation code and include specific issues:

```json
{
  "code": "VALIDATION.INVALID_INPUT",
  "message": "Some values need attention.",
  "issues": [
    {
      "path": "fields.email",
      "code": "VALIDATION.EMAIL",
      "message": "Enter a valid email address."
    }
  ]
}
```

Paths use the public input shape, not internal class names or database columns.

## Propagation and wrapping

- Preserve an existing framework code when adding context.
- Do not turn `ATTACHMENT.REVOKED` into the less useful `ACTION.FAILED` merely because it occurred inside an Action.
- Store safe code and details on failed RuleExecutions.
- Log internal causes and stack traces at the host boundary.
- Do not expose SQL, adapter paths, secrets, credentials, stack traces, or raw third-party responses.
- Set `retryable` from known semantics, not by guessing from message text.

## Hosts and transports

The framework error code is transport-independent. Hosts decide how to present or transport it:

- a Svelte host may render field issues or a safe toast;
- WebMCP returns structured failure data an agent can inspect;
- an HTTP host maps codes to appropriate status responses;
- a CLI may print the message plus code;
- support logs include code, `errorId`, and protected context.

HTTP status codes are not part of the Kernel error contract.

## Product extensions

Hosts and modules may add their own semantic namespaces:

```text
APPLICATION.TEMPLATE_INVALID
CONVERSATION.CHANNEL_ARCHIVED
BILLING.INVOICE_LOCKED
```

Do not overload `INTERNAL`, `ACTION`, or `PERSISTENCE` for business-rule failures. Product codes follow the same stability and safe-envelope rules.

## Tests

- Assert codes and structured details rather than full English messages.
- Conformance fixtures include expected error codes and issue paths.
- Every adapter maps equivalent semantic failures to the same framework code.
- Error envelopes must survive JSON serialization.
- Tests verify that public errors do not contain protected internal details.
