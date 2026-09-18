# YAIR OpenAI provider

`@jthum/yair-openai` implements YAIR's `ModelProvider` contract using the OpenAI-compatible Chat
Completions protocol. It has no model SDK dependency and supports custom base URLs, headers,
credential resolution, streaming, and non-streaming endpoints.

```ts
import { ModelProviderRegistry, yair } from "@jthum/yair";
import { openAI } from "@jthum/yair-openai";

const provider = openAI({
  apiKey: process.env.OPENAI_API_KEY,
  // baseUrl: "http://localhost:11434/v1",
});

const inference = yair({
  provider: new ModelProviderRegistry([{ key: "openai", provider }]),
});
```

Run the opt-in live contract against any compatible provider:

```bash
YAIR_LIVE=1 \
MINIMAX_API_KEY=... \
YAIR_OPENAI_BASE_URL=https://api.minimax.io/v1 \
YAIR_OPENAI_MODEL=MiniMax-M3 \
vp test src/openai-provider.live.spec.ts
```

The live suite exercises streamed thinking/text, tool calls across two user turns, dynamic tool
discovery, and recovery from a structured tool error. `YAIR_OPENAI_API_KEY` overrides
`MINIMAX_API_KEY`. These are opt-in behavioral checks, separate from deterministic protocol tests.

Provider settings are passed through `ModelConfig.settings`. For MiniMax M3, use
`reasoning_split: true` and `thinking: { type: "adaptive" }` to separate thinking from answer text.
The provider emits `reasoning_delta` and preserves `reasoning_details` or `reasoning_content` in
assistant `providerState` for replay. YAIR returns the full replayable history as
`completed.messages`; append the next user message to it for subsequent turns. Providers without
separate reasoning fields simply emit answer text.

`credentialRef` remains opaque to Framework and YAIR. A trusted host can resolve it just in time:

```ts
const provider = openAI({
  resolveApiKey: (credentialRef) => secrets.get(credentialRef),
});
```
