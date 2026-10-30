# Coach features run only on the athlete's own OpenRouter key

Every coach feature (activity analysis, reading coach notes in the athlete's own words, and coach chat) runs only on the athlete's own OpenRouter key. VO2 keeps no server key and has no fallback: an athlete without a key sees an "Add your OpenRouter key" prompt where each coach feature would be, while saved analyses, the coach chat history, and quick-choice coach notes keep working. The athlete adds the key in a skippable last step of onboarding or in Settings → Coach.

The reasons are cost and choice. One shared key made VO2 pay for every athlete's model use, and one hard-coded model left athletes no say in what writes their analyses or answers their questions. With their own key, the athlete pays for what they use and picks a model per coach feature. The models come from one short list curated in the code, each checked for tool calls and structured JSON. The default is the model used before this change.

The key follows TanStack AI's BYOK pattern. It is encrypted on the device with a passkey (WebAuthn PRF) and sent as a header with each coach request, and the server never stores it. That means VO2 holds no third-party secret. The cost is that the athlete adds the key on each device, unlocks it with the passkey once per app session, and loses it when signing out or deleting the athlete, which also stops a second athlete on the same phone from using it. Devices without passkey support keep the key only until the app closes. To keep the unlock prompt off app open and calendar loads, the coach reads a note in the athlete's own words when it is added, not when the week is planned again. The chosen models are not secret, so they are stored on the server with the athlete's settings.

Only OpenRouter keys are accepted for now. One OpenRouter key reaches every model; direct OpenAI or Anthropic keys may come later.

## Considered options

- **The server key as a fallback:** nothing changes for athletes who add no key, but VO2 keeps paying for them.
- **Keys stored on the server, encrypted per athlete:** one entry for all of an athlete's devices and no unlock prompt, but VO2 would hold a secret that can spend the athlete's money and have to protect it at rest.
- **Any OpenRouter model, filtered by what it supports:** wider choice, but every new model would reach athletes untested.
