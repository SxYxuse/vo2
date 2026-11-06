# Coach features run on a key per provider, with a reasoning level

Supersedes, in part, [0036](0036-coach-features-run-only-on-the-athletes-own-openrouter-key.md) (only OpenRouter keys are accepted).

**Keys.** The athlete can save one key per provider: OpenRouter, and now OpenAI directly. Each is stored like the OpenRouter key always was: on the server, sealed with AES-256-GCM under a key derived from `BETTER_AUTH_SECRET` and the provider's id, never sent back to the app and never logged. OpenRouter keys saved before this ADR still open, because OpenRouter's derived key is the one used before. Settings → Coach lists every provider with its own Add, Replace, and Remove. Onboarding still asks only for an OpenRouter key, which reaches every model.

**Models.** Each coach feature still has its own model (ADR 0036), now saved with its provider: GPT-6 Luna through OpenRouter and GPT-6 Luna through OpenAI are two separate choices on two separate keys. The list stays curated in the code, every model checked for tool calls and structured JSON. Superseded by [0060](0060-the-coach-model-picker-offers-openrouters-whole-catalog.md): the curated models are now the recommended ones, ahead of OpenRouter's whole catalog. Picking a model whose provider has no key is allowed, and the feature shows "Add your OpenAI key" where it would run; VO2 never switches model or provider on its own. Choices saved before this ADR, bare OpenRouter model ids, read as OpenRouter choices.

**Reasoning.** Each feature also saves a reasoning level, from Off to Max, or Auto, which sends none so the provider's default applies. Auto is the default, so nothing changes for an athlete who never picks a level. The picker offers only the levels the model has; switching model keeps the level when the new model has it, else the nearest above it, else the nearest below. TanStack AI's adapters clamp the level the same way, so a curated list that falls behind the model never sends a level the provider rejects.

**The picker.** A feature's row in Settings → Coach shows its model, reasoning level, and provider, and opens one searchable list grouped by provider, with the reasoning level below it. It replaces the native select, which could not hold a growing list or a second setting per feature.

## Considered options

- **One model per model id, with a "via" choice when two keys reach it:** fewer rows, but a second control that only matters once an athlete has two keys.
- **The adapters' whole catalogs, filtered by what each model supports:** wider choice, but every new model would reach athletes untested.
- **A default reasoning level instead of Auto:** a predictable cost, but it would change what every existing athlete's coach does.
