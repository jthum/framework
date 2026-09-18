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
YAIR_OPENAI_API_KEY=... \
YAIR_OPENAI_BASE_URL=https://your-provider.example/v1 \
YAIR_OPENAI_MODEL=your-model \
vp test src/openai-provider.live.spec.ts
```

The live suite exercises streamed thinking/text, tool calls across two user turns, dynamic tool
discovery, and recovery from a structured tool error. A key and model are required; the base URL
defaults to OpenAI. These are opt-in behavioral checks, separate from deterministic protocol tests.

Provider settings are passed through `ModelConfig.settings`. Configure live tests through JSON
objects in `YAIR_OPENAI_SETTINGS` (all requests) and `YAIR_OPENAI_REASONING_SETTINGS` (thinking
scenarios). Set `YAIR_OPENAI_EXPECT_REASONING=1` to require streamed reasoning and its replay.
This is opt-in because compatible endpoints differ in their thinking settings and capabilities.
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
