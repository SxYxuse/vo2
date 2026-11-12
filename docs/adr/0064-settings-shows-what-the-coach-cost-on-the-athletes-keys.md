# Settings shows what the coach cost on the athlete's keys

The athlete pays for every coach feature on their own provider key (ADR 0036, ADR 0059), so VO2 records what each model call used and Settings → Coach shows the total for this month and last month, split by coach feature. Months start in the athlete's timezone.

Each call is a row: the coach feature, provider, model, input and output tokens, and the cost in US dollars as the provider reported it. VO2 keeps no price list. OpenRouter reports each call's cost, so its calls are counted exactly. OpenAI reports no cost, so its calls are listed by count and tokens, never priced by VO2. The provider's own dashboard stays the final bill: a call cut off before the provider reported usage still costs the athlete, and VO2 never sees it.

A failed write of a usage row is logged and never stops the coach. Deleting the athlete deletes the rows.

## Considered options

- **Price OpenAI calls from a list of per-token prices in the code:** a dollar figure for every call, but a list that falls behind the provider's prices shows a wrong bill as if it were right.
- **Read spending from the provider's account API:** the real bill, but only for the whole key, which the athlete may also use outside VO2.
- **A monthly budget that stops the coach:** protects the athlete, but the provider's own key limits already do that, on the bill that counts.
