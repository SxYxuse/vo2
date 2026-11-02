# Coach chats are kept on the server and reopened from a list

The coach chat was one conversation kept in the browser it happened in: another device never saw it, signing out deleted it, and **New chat** deleted it too. Now the server keeps every chat, through TanStack AI's server persistence (`withPersistence` writing to `coach_chats`, `coach_chat_runs`, and `coach_chat_interrupts`, and `reconstructChat` loading one back). **New chat** starts another and keeps the rest. **Chats** lists them newest first, by the athlete's first question, to reopen or delete. The open chat's id is in the address, so a reload or a return keeps it.

Athletes asked to look back at what the coach said about a run or a week, which one deletable conversation per device couldn't give. The server already holds every activity the coach read; the chat about them is no more sensitive, and keeping it there is what lets a phone and a desktop show the same chats. Deleting the athlete deletes their chats.

A plan change waiting on Apply or Decline is kept with the chat, so any device offers it again until answered (ADR 0038). A reply still streaming when the app closes is not rejoined: the chat shows what was saved when it opened again. Offline, the chat opened last still reads from the copy kept on the device (ADR 0031); others open once back online. Replies to a note on a day of the plan stay in memory and never become a chat.

This supersedes, for the coach chat, keeping it only on the device.
