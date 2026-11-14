# Coach chat

The athlete asks the coach about their training in a chat at `/coach`. Without a saved key, the mock coach answers, starting with `This is the mock coach`. Chats are saved: the athlete can start a new one, reopen an earlier one from `Chats`, and delete it. Cost shows in Settings → Coach.

## Sub-features

- `chat-suggestion` a suggested question button sends it and gets a streamed answer.
- `chat-compose` the `Message the coach` textbox, then `Send`.
- `chat-new` `New chat` shows the empty `Ask the coach` state and keeps the earlier chat.
- `chat-reopen` `Chats` opens a dialog listing earlier chats by title, and choosing one reopens it.
- `chat-delete` the `Delete “<title>”` button in `Chats`, confirmed in the alert dialog with `Delete`.
- `chat-cost` `/settings/coach` shows `Coach chat <cost>`.
- `chat-activity` `Ask about this activity` on an activity page starts a chat about it.

## How to get to it (user POV)

- Phone: the `Coach` tab.
- Desktop: `Coach` in the sidebar.
- From an activity: `Ask about this activity`.

## Driving it with playwright-cli

Preconditions:

- The baseline athlete: no keys, so the mock coach answers.

Steps:

- **Ask.** Run `RUN=$(scripts/open.sh coach-chat phone /coach)` and `scripts/pw.sh click "getByRole('button', { name: 'How did my last run go?' })"`. Then run `scripts/settle.sh "getByText(/This is the mock coach/)"`, and wait until `getByRole('button', { name: 'Send' })` is back, which means the reply finished. Take `01-answer.png`.
- **Side effect.** Run `scripts/db.sh 02-chats "select title, jsonb_array_length(messages) from coach_chats"`. One row titled with the question, with at least two messages.
- **New chat and reopen.** Click `New chat`. `Ask the coach` shows. Run `scripts/pw.sh reload`, then click `Chats`. In `getByRole('dialog', { name: 'Chats' })`, click the link named after the question. The mock answer is back.
- **Delete.** Open `Chats` and click `Delete “How did my last run go?”` (curly quotes). Then click `getByRole('alertdialog').getByRole('button', { name: 'Delete' })`. The link is gone. Run `scripts/db.sh 03-after-delete "select count(*) from coach_chats"`.
- **Cost.** Go to `/settings/coach`. Text matching `/Coach chat (< \$0\.01|\$\d+\.\d\d)/` is visible.

## Gotchas

- Never save a real key in `/settings/coach` while verifying. Once a key is saved, the coach calls the real provider instead of the mock. If a journey saves a test key, remove it (`Remove`) before you ask the coach anything.
- The reply streams. Judge the chat only after `Send` comes back. A snapshot taken mid-stream shows a partial reply.
- While the reply streams, the chat's `Scroll to end` button can float over the last message in screenshots.
