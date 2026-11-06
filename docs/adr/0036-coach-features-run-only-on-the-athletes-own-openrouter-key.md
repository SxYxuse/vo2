# Coach features run only on the athlete's own OpenRouter key

Every coach feature (activity analysis, reading coach notes in the athlete's own words, and coach chat) runs only on the athlete's own OpenRouter key. VO2 keeps no server key and has no fallback: an athlete without a key sees an "Add your OpenRouter key" prompt where each coach feature would be, while saved analyses, the coach chat history, and quick-choice coach notes keep working. The athlete adds the key in a skippable last step of onboarding or in Settings → Coach.

The reasons are cost and choice. One shared key made VO2 pay for every athlete's model use, and one hard-coded model left athletes no say in what writes their analyses or answers their questions. With their own key, the athlete pays for what they use and picks a model per coach feature. The models come from one short list curated in the code, each checked for tool calls and structured JSON. The default is the model used before this change. A model later dropped from the list keeps running for athletes who picked it, shown as no longer offered, until they pick another: VO2 never switches model or key on its own.

The key is stored on the server with the athlete's account, following TanStack AI's server-side key storage, so it works on every device the athlete opens VO2 on, with nothing to unlock. It is encrypted at rest with AES-256-GCM under a key derived from `BETTER_AUTH_SECRET`, which lives in the server's environment and never in the database. Only the server decrypts it, to call OpenRouter; it is never sent back to the app, not even masked, and never logged. Deleting the athlete deletes it. The cost is that VO2 now holds a secret that can spend the athlete's money, and rotating `BETTER_AUTH_SECRET` makes stored keys unreadable, so athletes add theirs again. To keep opening the calendar from spending the athlete's credit, the coach reads a note in the athlete's own words when it is added, not when the week is planned again. The chosen models are stored with the athlete's settings too.

Only OpenRouter keys are accepted for now. One OpenRouter key reaches every model; direct OpenAI or Anthropic keys may come later. Superseded by [0059](0059-coach-features-run-on-a-key-per-provider-with-a-reasoning-level.md): OpenAI keys are accepted too, and each feature has a reasoning level.

## Considered options

- **The server key as a fallback:** nothing changes for athletes who add no key, but VO2 keeps paying for them.
- **The key kept on the device, encrypted with a passkey (TanStack AI's browser BYOK):** VO2 would hold no secret, but the athlete would add the key again on every device, unlock it once per session, and some phones' passkeys can't encrypt it at all.
- **A separate encryption key in its own environment variable or a KMS:** rotates independently of sign-in, at the cost of one more secret to provision for every deployment and preview.
- **Any OpenRouter model, filtered by what it supports:** wider choice, but every new model would reach athletes untested.
