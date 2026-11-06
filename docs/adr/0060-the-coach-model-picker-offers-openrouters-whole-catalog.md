# The coach model picker offers OpenRouter's whole catalog

Supersedes, in part, [0036](0036-coach-features-run-only-on-the-athletes-own-openrouter-key.md) and [0059](0059-coach-features-run-on-a-key-per-provider-with-a-reasoning-level.md) (the models come from one short list curated in the code).

The athlete pays for the coach with their own key, so VO2 has no reason to limit which model that key runs. The picker now lists every OpenRouter model whose catalog entry, as TanStack AI's OpenRouter adapter ships it, supports tools, tool choice, and structured outputs together, which chat and plan writing need. Each model's reasoning levels come from the same catalog. `:batch` variants are left out because they queue requests and the coach streams.

The curated list stays as the recommended models, each checked with every coach feature. They come first, and the rest follow under "Not tested with VO2". A model that claims a capability can still handle it badly; the athlete sees the feature's usual error and can pick another. Updating the adapter updates the catalog. A stored model that leaves the catalog keeps running and shows as no longer offered, as before (ADR 0036).

The catalog is served by the server when the picker needs it, not bundled into the app: it is about a third of a megabyte. Until it loads, or while offline, the picker shows the recommended models.

OpenAI's adapter exports no capability data, so direct OpenAI keys keep the recommended models only.

## Considered options

- **Keep the curated list only:** every model tested, but athletes cannot use models VO2 has not got to yet, on a key they pay for.
- **Every chat model in the catalog:** wider still, but models without tools or structured outputs cannot run chat or plan writing at all.
