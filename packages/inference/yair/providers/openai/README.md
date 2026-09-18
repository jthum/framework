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

`credentialRef` remains opaque to Framework and YAIR. A trusted host can resolve it just in time:

```ts
const provider = openAI({
  resolveApiKey: (credentialRef) => secrets.get(credentialRef),
});
```
