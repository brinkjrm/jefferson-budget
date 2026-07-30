# Project inbox and daily SMS briefing

The daily job checks the dedicated project mailbox, extracts invoice drafts and owner action items, and sends a concise SMS briefing. Email bodies, attachments, action items, invoice drafts, and delivery logs are stored in private Supabase tables with no anonymous access.

## Vercel environment variables

- `PROJECT_EMAIL_ADDRESS` — dedicated project mailbox address
- `PROJECT_EMAIL_APP_PASSWORD` — mailbox app password, never the normal sign-in password
- `PROJECT_EMAIL_IMAP_HOST` — optional; defaults to `imap.mail.me.com`
- `PROJECT_EMAIL_IMAP_PORT` — optional; defaults to `993`
- `PROJECT_EMAIL_IMAP_SECURE` — optional; defaults to secure IMAP
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`
- `PROJECT_SMS_TO` — recipient in E.164 format
- `CRON_SECRET` — long random value used to authorize the scheduled function
- `SUPABASE_SERVICE_KEY`
- `ANTHROPIC_API_KEY` — optional fallback classification is used when absent
- `PUBLIC_APP_URL` — optional; defaults to the Jefferson Vercel URL

The Vercel schedule runs daily at 14:00 UTC, which is approximately 7–8 AM Mountain Time depending on daylight saving time. Duplicate delivery protection ensures only one summary is sent per local calendar day.

The system never authorizes payments, approves invoices, accepts change orders, or changes the construction schedule automatically.
