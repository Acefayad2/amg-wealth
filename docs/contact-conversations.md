# Contact conversations and first-message notice

The first accepted CRM message to a contact now includes:

> This is Anointed Money Group's communications number. You can reply here to reach our team. Reply STOP to opt out.

The notice is part of the same SMS request, not a separate automatic text. Existing first-accepted tracking is retained. Contacts already marked as having received an accepted CRM message are not sent another introduction. A notice already authored in the message is not duplicated. The final message, including the notice and any optional name greeting, must fit the existing 1,600-character limit.

## Conversations

- Each contact has a **Conversation** button. Incoming and outgoing one-to-one Quo messages appear together, ordered by time with timestamps and provider status.
- **Refresh** requests current provider history. **Load more messages** follows the provider's opaque pagination token, deduplicating by message ID. The UI reports how many messages are loaded, not an unverified total.
- Messages render as plain text. Media messages are identified, but attachments and provider media URLs are not loaded.
- **Reply** opens the existing composer and its separate Send now confirmation. A successful accepted reply refreshes the open thread.
- Pending or opted-out contacts remain viewable but cannot be replied to. Individual Texts, emergency lock, storage readiness, provider STOP history, duplicate-request and uncertain-outcome safeguards still apply.
- An incoming opt-out keyword in the loaded thread immediately disables Reply even if the cached CRM consent still says opted in. START does not change consent. The server continues to check the full provider history before any attempted send.
- The phone shown when an individual recipient is selected is included as `expectedPhone`. The send transaction refuses an updated phone mismatch and holds a shared contact-row lock while preparing the recipient snapshot.
- Closing, switching contacts, or signing out clears displayed history and invalidates outstanding requests. A mismatched contact or phone response is rejected.

## Server and rollout

The existing admin endpoint accepts `GET /api/admin/crm?conversationContactId=<uuid>&pageToken=<optional>`. It authenticates the user and calls the existing admin-only state RPC before resolving the contact's phone server-side. It then makes a read-only request to the configured Quo number's message API. Requests and responses use the existing no-store headers. It does not trust a phone number or provider URL supplied by the browser.

No schema migration, webhook, new credential, consent edit, delivery-control change, or automatic SMS is required. Deploy the frontend bundle, HTML/CSS, conversation helper, and existing CRM function together through the normal reviewed release process. Do not use a partial directory as a whole-site deploy.

Provider contract checked on November 3, 2026: https://www.quo.com/docs/mdx/api-reference/messages/list-messages. Quo requires `phoneNumberId`, repeated `participants` query keys without brackets, and `maxResults`; pagination uses `nextPageToken`. Its reported total is not reliable, so the UI does not use it.

## Validation

`npm run check`, `npm run build`, and the full synthetic Node test suite are required. Conversation tests cover admin authentication, server-resolved contact scope, provider failures, pagination, malformed and unrelated messages, safe rendering, stale responses, reply locks, and first-contact copy. All tests use synthetic contacts and mocked network responses.

Real desktop/mobile rendering, authenticated provider history, simultaneous real admin sessions, and carrier delivery require release-environment QA. No real SMS should be sent without separate authorization.
