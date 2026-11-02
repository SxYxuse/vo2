# The coach chat loads running knowledge as skills

The coach chat answered and proposed plan changes from the written plan, the pace ranges, and the numbered rules alone. The running knowledge the plan writer reads (`principles.md`, `paces.md`, `sessions.md` in `src/coaching/running/`) never reached it, so a change could pass every rule and still be an odd session.

The chat now gets those three files as portable skills (`@tanstack/ai-skills`): one skill per file, a one-line catalog in the system prompt, and a `load_skill` tool. The model loads a file only when a question needs it: explaining a session, how a week is built, or a plan change. About 4,300 words in every message would cost more than most questions need.

Portable skills run on any tool-calling model, so they work on the athlete's OpenRouter model. Hosted provider skills would need Anthropic's or OpenAI's sandbox, which OpenRouter does not reach.

Plan writing keeps all three files in its prompt (ADR 0037): it asks for JSON with no tool loop and needs every file on every attempt.
