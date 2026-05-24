# Security (Phase 4)

Inbound hardening at the SMTP edge and during async processing.

## SMTP edge

| Control | Config | Default (dev) |
|---------|--------|----------------|
| IP allowlist | `SECURITY_IP_ALLOWLIST` (comma-separated) | empty = allow all |
| IP blocklist | `SECURITY_IP_BLOCKLIST` | empty |
| Rate limit per IP | `SECURITY_RATE_LIMIT_IP_PER_MIN` | 120/min |
| Rate limit per tenant | `SECURITY_RATE_LIMIT_TENANT_PER_MIN` | 300/min |
| Greylist | `SECURITY_GREYLIST_ENABLED=true` | off |
| Greylist TTL | `SECURITY_GREYLIST_TTL_SEC` | 300 |
| STARTTLS | `SMTP_TLS_ENABLED` + key/cert paths | off |

Local connections (`127.0.0.1`, `::1`) skip greylist.

Rejected connections return SMTP errors (rate limit, blocklist, greylist deferral).

## Email authentication (SPF / DKIM / DMARC)

Runs in **parser-worker** on the raw MIME (via [mailauth](https://www.npmjs.com/package/mailauth)).

| Mode | Behavior |
|------|----------|
| `off` | No DNS checks (default for local dev) |
| `monitor` | Record results on message; never reject |
| `enforce` | Reject message if DMARC fails or SPF hard-fail without DKIM pass |

```env
SECURITY_AUTH_MODE=monitor   # recommended for staging
SECURITY_AUTH_MODE=enforce   # production after tuning
```

Results are stored on the message as `authResults` (visible in admin UI).

## Attachment policy

Blocks dangerous extensions (`.exe`, `.bat`, `.js`, …) and suspicious double extensions before upload to OCI. Logged as skipped attachments; message can still reach `processed`.

## Antivirus

Not included in this phase. Integrate ClamAV or a cloud scanner as a post-store hook before `event-dispatch` when required.

## Admin UI authentication

Protects `/admin/*` API routes and the operator console when credentials are configured.

| Variable | Purpose |
|----------|---------|
| `ADMIN_USERNAME` | Login username (default: `admin`) |
| `ADMIN_PASSWORD` | Login password |
| `ADMIN_SESSION_SECRET` | HMAC key for session tokens (`openssl rand -hex 32`) |

Auth is **enabled** only when **both** `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are set. If either is missing, admin routes remain open (local dev default).

The UI stores the session token in `sessionStorage` and sends `Authorization: Bearer <token>` on each request. Use **Sign out** in the sidebar to clear the session.

## Delete operations (admin)

For testing and cleanup, authenticated admins can delete:

| Resource | Endpoint | Notes |
|----------|----------|-------|
| Message | `DELETE /admin/messages/:id` | Removes MongoDB record, attachments, and OCI objects |
| Messages (bulk) | `DELETE /admin/messages?tenantId=&mailboxId=` | Requires at least one filter |
| Mailbox | `DELETE /admin/mailboxes/:id?tenantId=` | Blocked if messages exist |
| Tenant | `DELETE /admin/tenants/:id` | Blocked if mailboxes or messages exist |
| DLQ job | `DELETE /admin/dlq/:jobId` | Removes job from dead letter queue |

## Production checklist

1. Set `SECURITY_AUTH_MODE=monitor`, observe `authResults` for real mail.
2. Tune allowlist for known forwarders (Gmail, M365 egress IPs if needed).
3. Enable `enforce` when failure rate is acceptable.
4. Enable `SMTP_TLS_ENABLED` with valid certificates behind your MTA/LB.
5. Set conservative rate limits per expected volume.
6. Optional: `SECURITY_GREYLIST_ENABLED=true` for spam reduction (may delay legitimate retries).
7. Set `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` so the admin UI requires login.

## Related

- [Operator guide](./OPERATIONS.md)
- [OCI storage](./OCI-STORAGE.md)
