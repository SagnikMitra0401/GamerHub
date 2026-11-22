# Phase 17 — account identity, recovery, and legal readiness

> **Status:** design proposal. Nothing in this document is implemented yet.
> **Scope owner:** product/engineering.
> **Legal drafts:** [`docs/legal/TERMS_OF_SERVICE_DRAFT.md`](legal/TERMS_OF_SERVICE_DRAFT.md) and [`docs/legal/PRIVACY_POLICY_DRAFT.md`](legal/PRIVACY_POLICY_DRAFT.md).
> **Not legal advice.** The drafts and this plan must be reviewed by qualified counsel in the operator's jurisdiction before publication.

## 0. Executive summary

Phase 17 replaces the current 24-hour verification **link** with a short-lived,
single-use **email code**, adds a verified **backup email** for recovery, adds a
handle + backup-email account-recovery flow, and makes Terms and Privacy
accessible and versioned at registration, sign-in, and settings.

The two non-negotiable security rules are:

1. **The code is never available to the browser or to application logs.** It is
   generated on the server, stored only as a keyed hash, sent only inside the
   email, and never returned in a response, rendered in the DOM, written to
   analytics, or captured by Sentry.
2. **A public handle is not a secret.** Recovery requires proof of control of
   the verified backup email, with enumeration-safe responses, strict rate
   limits, session revocation, notifications, and a cooling-off period after a
   recovery address changes.

The biggest unresolved items are legal, not technical: the legal entity,
registered address, governing law and minimum age. Availability is now settled
— the service is offered worldwide, English-only for the time being — so the
EU/UK GDPR, India DPDP and California CCPA/CPRA analysis is more likely to
apply, not less. Those items must be decided before the legal pages are
published.

## 1. Audit of the current implementation

| Area | Current state | Consequence |
|---|---|---|
| Registration | Creates a local account, sends a 24-hour verification **link**, auto-signs the user in, routes to onboarding. | A new user can use much of the app before proving control of the email. |
| Verification token | 32 random bytes, SHA-256 hash stored in `AccountToken`, one live token per purpose, atomic consume. | Good primitive, but it is a link token, not a 6/8-digit code. |
| Console email transport | Local `console` transport prints the entire email, including the verification link/code, to the server terminal. | Violates the requirement that codes must not be exposed in a console. Must be removed or fully redacted before codes ship. |
| Email transport | Gmail Apps Script bridge is configured and accepted a real test send on 2026-11-22. Production fails closed without it. | Delivery works now; quota is roughly 100 recipients/day on a consumer Gmail account. |
| Rate limits | Auth, email, and password limiters exist; Redis is optional and currently disabled. | Correctness survives Redis being off, but distributed limits are per-process. |
| Google | ID token verified server-side; account linking currently requires the Google email to equal the account email; unlink is blocked when no local password exists. | Safe default. It does not give a non-Gmail local account a Gmail sign-in method. |
| Backup email | Not implemented. | No self-service recovery if the primary inbox is lost. |
| Account recovery | Password reset by link only; no handle + backup-email path. | Losing the primary inbox means losing the account unless support intervenes. |
| Legal acceptance | No checkbox or version record. | No reliable evidence that a user accepted a particular Terms/Privacy version. |
| Legal pages | Routes `/terms` and `/privacy` exist, but no links from login, register, or settings. The copy is short and makes at least one inaccurate claim (it says Google profile pictures/avatars are collected). | Users cannot readily find the documents, and the documents do not describe the actual processing. |
| Age | No age gate or age attestation. | Cannot honestly state a minimum age or handle child-account obligations. |
| Data export | Exists, but is a product export rather than a complete subject-access export (it omits several categories such as DMs, attachments/media, and some community/audit data). | An access/portability request may not be fully answered by the current export. |
| Deletion | 30-day scheduled deletion; immediate deletion option; content/reference erasure and media cleanup are implemented. | Strong baseline; backups and provider-side copies still need a documented retention statement. |
| Email change | No primary-email change flow. | Users cannot correct a typo or replace a lost primary address safely. |

### Verified environment state (2026-11-22)

- Gmail bridge: `GET /exec` returned `{ ok: true, service: "gamerhub-email-bridge" }`; a real test message was accepted by the bridge.
- Redis: a set/read/delete round trip to Upstash succeeded. It was then switched off again with `REDIS_ENABLED=0` to conserve the free-tier quota.
- `.env` still contains unused `EMAIL_FROM` and `RESEND_API_KEY` values; the application does not read either. They should be removed or a Resend transport must be implemented deliberately.

## 2. Goals and non-goals

### Goals

- New local accounts confirm their primary email with an 8-digit code (6 digits
  is acceptable only if the stricter limits below are kept).
- No verification code is observable from browser DevTools, the DOM, network
  responses, server logs, Sentry, analytics, or a development console.
- A user can add a verified backup email (Gmail recommended, but any address the
  user controls should be allowed unless product explicitly restricts it).
- A user who loses access to the primary inbox can recover with their handle +
  proof of control of the verified backup email.
- A local account can connect a Google identity for sign-in, and can manage the
  backup address separately.
- Terms and Privacy are readable from login, registration, and settings, and
  registration records acceptance of a specific version.
- Every claim in the legal documents matches an implemented practice.

### Non-goals for this phase

- Passkeys/WebAuthn, SMS, authenticator apps, or a full MFA programme.
- A staffed 24/7 support desk or automated identity-document verification.
- End-to-end encrypted DMs.
- Marketing email or a newsletter.
- A custom-domain paid transactional-email provider. The Gmail bridge remains
  the low-volume option; migrate only if volume or deliverability requires it.

## 3. Threat model and holes in the current plan

| # | Hole / attack | Impact | Required control |
|---|---|---|---|
| 1 | Code printed by the `console` transport or any `console.log` | Anyone with terminal/log access can verify an address they do not own. | Remove body logging from every transport. In development, use the real bridge or a test-only in-memory outbox. Add a CI grep/test that fails on code/token logging. |
| 2 | Code returned in the registration/verification JSON | A user or attacker can read it in DevTools and bypass email. | Response contains only `{ sent, expiresAt, resendAfter }`; never `code`, `devCode`, `token`, or a debug field. |
| 3 | Code placed in a URL | Leaks through Referer, browser history, proxy logs, screenshots, and link scanners. | Code is POSTed in a request body. The email may link to `/verify-email`, but the URL carries no code or token. |
| 4 | Six-digit code brute force | 1,000,000 possibilities; an unthrottled endpoint is guessable. | Prefer 8 digits. Five failed attempts per challenge, then invalidate. Per-account and per-IP limits on verify and resend. Constant-time compare. |
| 5 | Replay / race | Two requests consume one code, or an old code still works after resend. | Atomic consume (`findOneAndUpdate` with `usedAt: null`), invalidate the previous challenge on resend, expiry checked server-side. |
| 6 | Code stored in plaintext | Database or backup leak reveals live codes. | Store HMAC-SHA-256 with a server-only pepper (`EMAIL_CODE_PEPPER`), bind user + purpose + email, never store the raw code. |
| 7 | Weak random generation | Predictable codes. | `crypto.randomInt` or `crypto.randomBytes` with rejection sampling; never `Math.random`. |
| 8 | Account enumeration | Attackers learn which handles/emails exist. | Uniform status, body, and timing for register/resend/forgot/recovery start. Do not reveal whether the handle, primary email, or backup email matched. |
| 9 | Email cannon / resend abuse | Gmail quota exhaustion and inbox flooding. | 60-second resend cooldown, 5 sends/hour/account, per-IP cap, one live challenge, generic `202` after the limit. |
| 10 | Unverified accounts spam | Throwaway accounts post, DM, or create communities before proving the address. | Define and enforce a verification gate matrix (below). Reading can stay open; write surfaces are gated. |
| 11 | Email delivery failure traps the user | User cannot finish registration or recovery. | Non-fatal registration response, visible “resend” with cooldown, support path, and a clear “check spam” message. Do not claim delivery, only provider acceptance. |
| 12 | Backup email added from a stolen session | Attacker adds their inbox, waits, then recovers the account. | Re-authenticate immediately before adding/changing/removing backup email. Verify the new address. Notify the primary address. Apply a 7-day recovery cooling-off period after any backup-email change. |
| 13 | Handle treated as a secret | Handles are public, so “handle + backup email” is only as strong as the backup inbox. | UI and copy must say the handle identifies the account; the backup inbox is the proof. Never use handle + public data as sole proof. |
| 14 | Backup email typo | Recovery codes go to a stranger; account cannot be recovered. | Require two entries or a confirmation step; send a verification code to the new address; show a masked confirmation and a “not you?” link. |
| 15 | Backup email equals primary | Pointless duplicate and confusing recovery. | Reject case-insensitive equality; explain why. |
| 16 | Backup email is compromised | Attacker can recover the account. | This cannot be fully prevented by the app. Notify both addresses on every recovery event, let the owner remove the backup after re-authentication, and give a support path. Recommend a unique, MFA-protected backup inbox in the UI. |
| 17 | Recovery bypasses suspension/deletion | A suspended or deletion-pending account is restored. | Recovery may set a password but must not clear `suspended`, `restricted`, or deletion state. `deleted` accounts cannot be recovered. |
| 18 | Old sessions survive recovery | Attacker retains access after the owner recovers. | Increment `sessionVersion`, clear the auth cookie, disconnect sockets, invalidate all account tokens, and require a fresh sign-in. |
| 19 | Recovery code is phished | Attacker obtains the code in real time. | Short TTL, one use, no code in URL, generic responses, rate limits, notify both addresses, and never ask for a code by email/chat/support. |
| 20 | Google link collision | Two accounts claim the same Google subject or an identity is linked to the wrong account. | Re-authenticate, verify the ID token audience/issuer, enforce a unique provider subject at the database level, refuse if another account owns it, and audit the link. |
| 21 | Google email differs from primary | Confusing identity and possible account mix-up. | Keep the current same-email rule for Google **sign-in** linking unless a separate, explicit “backup email” feature is chosen. A backup Gmail address covers the recovery use case without mixing sign-in identities. |
| 22 | CSRF / cross-origin verification | An attacker submits a code or recovery request from another site. | Same-origin validation on mutations, `SameSite` cookies, origin checks, and no state-changing GET. |
| 23 | XSS reads the code from the page | A malicious script can read a code displayed in the DOM or stored in JS. | Do not store the code in client state longer than the input; never put it in `localStorage`; add/verify a CSP; HttpOnly auth cookie. |
| 24 | Email HTML injection | User-controlled username appears in HTML email. | Escape every interpolated value; use a fixed template; test with `<script>` and quote characters. |
| 25 | Rate limits with Redis off | Multi-instance deployments bypass per-process limits. | Redis is optional for correctness but required for shared enforcement at scale. Document that production should enable Redis or enforce limits at the edge. |
| 26 | Recovery request reveals timing | Existence oracle through slow database work. | Constant-ish response path; queue delivery after the response; minimum response time. |
| 27 | Primary email change is unguarded | Attacker changes the address and locks the owner out. | Require current password/re-auth, verify the new address, notify the old address, add a cooling-off period, and revoke sessions. |
| 28 | Legal acceptance is not recorded | Cannot prove which version a user accepted. | Versioned `LegalAcceptance` records with user ID, document type, version, timestamp, and a non-secret request identifier. |
| 29 | Legal pages make false claims | Regulatory and consumer-protection risk. | Rewrite from the data inventory; remove unverified claims (e.g. “profile picture avatar”); list actual processors and retention. |
| 30 | Age gate absent | Child privacy obligations cannot be assessed or enforced. | Decide minimum age and implement an age attestation before collecting account data; block under-age registration and document the policy. |
| 31 | Export is incomplete | Access/portability request may be only partly satisfied. | Extend export or add a documented subject-access process that includes DMs, media metadata, community data, reports, and audit data attributable to the user. |
| 32 | Deleted data remains in backups | “Deleted” claim is inaccurate. | Document backup retention and provider deletion schedules; state that backups are isolated and expire on a schedule. |
| 33 | Legal links missing | Users cannot inspect terms before accepting. | Add a shared legal footer/link component to Login, Register, and Settings; make acceptance a required, unbundled checkbox at registration. |
| 34 | Legal version changes silently | Users are bound to new terms without notice. | Store a version; show a re-acceptance prompt for material changes; keep prior versions accessible. |

## 4. Decisions that must be made before implementation

These are blockers, not engineering preferences.

**Partly answered on 2026-11-22:** items 4, 5, 7 and 12 are settled in §4.1;
item 10 has a proposed schedule in §4.2. The remaining items, especially the
entity, address, governing law and minimum age, still block publication.

1. **Legal entity and contact details.** Legal name, registered address,
   country, support email, privacy email, and whether an EU/UK representative
   or DPO is required.
2. **Governing law and dispute process.** Which courts/arbitration, consumer
   carve-outs, and whether a class-action waiver is enforceable there.
3. **Minimum age.** 13+ globally, 16+ in the EU/UK unless parental consent, or
   16+/18+ globally. This changes the registration UI, retention, and privacy
   notice. Do not publish “13+” until the age gate exists.
4. **Territories.** Is the service intentionally offered in the EU/UK, India,
   California, or only where users find it? This determines GDPR/UK GDPR,
   DPDP Act 2023, and CCPA/CPRA work.
5. **Backup-email policy.** The request says Gmail; recommend “any email you
   control, Gmail recommended.” Restricting to `@gmail.com` excludes Google
   Workspace and users who prefer another provider, and Gmail is not inherently
   more secure. If product insists on Gmail-only, validate and document it.
6. **Google sign-in linking.** Keep the current same-email rule, or allow a
   verified Google identity with a different address. Recommendation: keep the
   same-email rule for sign-in; use backup email for recovery. This avoids
   identity collisions and account-linking confusion.
7. **Cooling-off period.** Recommendation: 7 days after adding/changing a
   backup email before it can recover the account. Shorter periods increase
   takeover risk; longer periods increase support burden.
8. **Code length.** Recommendation: 8 digits, 10-minute TTL, 5 attempts. A
   6-digit code is allowed only with the same limits and monitoring.
9. **Support-assisted recovery.** Decide whether it exists. If yes, require a
   documented, consistent, two-person review and never use public data as
   proof. If no, say so honestly in the help page.
10. **Retention and backup schedule.** Confirm MongoDB Atlas backup retention,
    Render/Vercel log retention, Cloudinary deletion behavior, and Upstash TTLs.
11. **Processors and contracts.** Confirm DPAs with MongoDB Atlas, Cloudinary,
    Google, Render, Vercel, Upstash (if enabled), Sentry (if enabled), IGDB
    (if enabled), and FreeToGame. Record hosting regions.
12. **Business verification data.** Confirm whether business verification
    collects documents or only domain/email evidence; the Privacy Policy must
    match.

### 4.1 Decisions confirmed by the owner (2026-11-22)

These are now product decisions; the remaining §4 items stay open.

| Question | Decision |
|---|---|
| Contact address | `sagnikmitra.tennis@gmail.com` is the operator, privacy and security contact until a dedicated address exists. |
| Availability | Worldwide. No country is intentionally blocked. The product remains English-only for now; localisation comes later, and the English text will govern until a reviewed translation exists. |
| Backup email provider | **Any address the user controls** — Gmail, Outlook/Hotmail, Yahoo, a work address or a custom domain. Gmail is recommended, not required. |
| Email verification delivery | The Gmail Apps Script bridge uses `MailApp.sendEmail`, which accepts any valid recipient domain. No provider allowlist is needed; the existing 30/minute bridge limit and ~100/day consumer Gmail quota still apply. |
| Google sign-in linking | Keep the same-email rule. A different-address Google identity is not linked for sign-in; the backup email covers recovery. |
| Recovery | Handle + verified backup email, 8-digit code, 10-minute TTL, 5 attempts, 7-day cooling-off after a backup-email change, session revocation. |
| Business verification | In-app application with evidence, an official contact and the creator's preferred contact method; staff review; contact is mandatory before demotion. See §4.3. |
| Minimum age | Still undecided. Do not publish an age in the Terms until the age gate and parental-consent position are implemented. |
| Legal entity, address, governing law | Still undecided. The drafts keep those placeholders and remain unpublishable until counsel and the owner fill them. |

**Consequences of “worldwide”.** Global availability does not create global
compliance by itself, but it makes it unsafe to assume only one regime applies.
The Privacy Policy must keep the GDPR/UK GDPR, DPDP and CCPA/CPRA sections, name
the actual processors and regions, and provide a complaint route. If the owner
later geo-blocks a region, that is a product and legal change, not a copy edit.

**Consequences of any-provider backup email.** Verification codes are sent to
the user-supplied address, so deliverability is the user's provider's problem,
not an identity check. Do not treat a `gmail.com` address as stronger proof than
another provider. The same anti-enumeration, cooldown and cooling-off rules apply
to every domain.

### 4.2 Retention, logs and backups (plan)

Some periods are already enforced in code; the rest are the proposed policy to
configure and then publish. Provider-controlled periods must be confirmed in
the Atlas, Render/Vercel, Cloudinary and Google dashboards before the Privacy
Policy drops the word “confirm”.

| Data | Proposed retention | Enforcement |
|---|---|---|
| Email verification/reset links | 24 hours / 30 minutes, single use | Existing `AccountToken` TTL and consume logic |
| Email codes (Phase 17) | 10 minutes, 5 attempts, one live challenge per purpose | New `EmailChallenge`; delete/expire rows after 24 hours |
| Sessions | JWT lifetime; invalidated by `sessionVersion` on password change, recovery or sign-out-everywhere | Existing cookie + session version |
| Stories | 24 hours | Existing TTL/expiry |
| Squad chats | 15 days | Existing retention worker |
| Message requests | 14 days; declined opener text purged after 30 days unless attached to an open report | Existing DM retention |
| Ordinary notifications | 15 days; durable notices until no longer needed or account deletion | Existing TTL + worker |
| Product analytics events | 180 days | Existing TTL |
| Abandoned business applications | Closed after **90 days without activity**, or once open for **12 months**; evidence then follows the 24-month decision clock | Implemented: `expireAbandonedBusinessApplications()` sets `expired`, clears the DNS token, stamps `reviewDecidedAt`, writes an audit row and notifies the owner in-app and at the official contact (`businessRetentionNotices.js`) |
| Business verification evidence (contact, proof link, proof note, owner response) | While the application is open; **24 months after the decision**, then delete the evidence fields | Implemented: `purgeExpiredBusinessEvidence()` in the retention worker, calendar months from `reviewDecidedAt`; the owner is told when the window closes. Legacy rows have `reviewDecidedAt` backfilled from `verifiedAt`/`demotedAt` by the `20261122090000-business-review-clock` migration |
| Business review correspondence and decision audit | **3 years** after the decision, for impersonation and dispute defence | Implemented: `purgeExpiredBusinessAudits()` deletes rows older than 3 calendar years; contact/response rows store a 160-character excerpt, not the email body |
| Reports/moderation records | 24 months after resolution; longer only for an active safety or legal hold | Proposed; document the hold in the audit row |
| Legal acceptance records | Account lifetime plus **3 years** after closure (counsel to confirm limitation periods) | New `LegalAcceptance` |
| Application/HTTP logs | **14 days** where the host plan permits, request ID and status only — no bodies, codes, tokens, cookies or full email addresses | Configure host log drain; never rely on defaults |
| Error reports (Sentry, if enabled) | **30 days**, scrubbed of request bodies and account email | Configure project retention |
| Explicit MongoDB archives | **30 days**, encrypted, stored outside the repository; M0 has no automatic snapshots | See `docs/BACKUP_RESTORE.md`; run the restore drill quarterly |
| Deleted accounts | 30-day grace, then erasure; residual provider backups expire within **35 days** | Existing erasure + provider schedules |
| Gmail bridge copies | Google retains sent mail in the sending account under Google's terms; the operator must enable 2FA and periodically delete verification mail | Operational checklist |

**Business retention implemented 2026-11-22.** `reviewDecidedAt` is stamped by
DNS verification, a manual verify/reject and a demotion, and cleared when a new
application starts, so the evidence clock always follows the current decision.
A website/domain edit no longer clears that clock: the timestamp belongs to the
past decision, and letting a profile edit reset it would indefinitely postpone
deletion of the evidence the decision was based on. Only a new application
starts a new clock.
The sweep clears `contactEmail`, `contactDetail`, `proofUrl`, `proofNote` and
`reviewResponseNote`, sets `evidencePurgedAt` (shown to the owner and in the
admin queue), and leaves the public card, the decision reason and the audit
rows intact. Both jobs run every six hours with the other retention work and are `try/catch`-isolated so one failure cannot stall the worker. Cutoffs use
calendar arithmetic with day clamping (a leap-day decision expires on 28
February). The audit cutoff is applied per row, which is conservative: no audit
record survives more than three years past its own event. Businesses decided
before `reviewDecidedAt` existed fall back to `verifiedAt`/`demotedAt`, so the
sweep does not silently skip legacy rows; an application still in review is
never swept.

**Backup rules.** Never keep an archive in the repository or a public bucket. An
archive contains password hashes, private messages and now business contact
data. On M0, take an explicit encrypted archive before migrations; on a paid
tier, use Cloud Backup and record the retention window. Test a restore before
relying on it. The privacy copy may say “backups are isolated and expire on a
schedule” only after the actual window is set.

**Log rules.** Log the request ID, route, status, latency and a masked account
identifier. Never log a code, token, cookie, request body, full email address or
business proof note. The console email transport must be redacted before email
codes ship; it is currently the one place that prints a full message body.

### 4.3 Business accounts: application, review, contact, demotion

The existing business flow (profile, DNS/manual verification, audit, team inbox)
is extended rather than replaced. Implemented 2026-11-22:

**Application.** The business owner fills the public card plus a private review
block:

- official contact email (may differ from the public support email);
- preferred contact method — email, phone or other — and the phone/handle when
  it is not email;
- proof type — business registration, tax/VAT registration, domain email,
  official listing/profile, or other;
- a public HTTPS proof link and/or a short note explaining what the evidence
  shows.

Manual review is refused unless there is a reachable contact route and at least
one piece of evidence. The DNS path remains available for domains. Evidence and
contact details are never returned by the public business card.

**Review.** The admin queue shows the proof link/note, contact address and
preferred method, request time and last-contact time. A reviewer can:

1. **Contact** — send a written message through the email bridge, or record a
   phone/other contact after making it. This sets `reviewContactedAt` and writes
   a `contacted` audit row with the channel. The owner's Settings page shows the
   contact date and the deadline, so the message is not invisible to them.
2. **Verify** or **reject** with a note; each writes an audit row.
3. **Demote** — only enabled after a contact logged *after the current review
   request* **and** the seven-day response window has elapsed. Demotion sets the
   account back to `profile_type=personal`, clears the verified badge and DNS
   state, cancels cold-outreach permission, removes all team-inbox memberships,
   records the reason and emails the official contact.

**Response.** The business owner can answer the review contact from Settings
(`POST /api/account/business-verification/respond`). The answer is stored with
the review (`reviewRespondedAt`, `reviewResponseNote`), audited as `responded`,
shown to the reviewer in the queue, and echoed back on the owner's page. This
closes the gap where “contact before demotion” depended on an email reply that
nobody recorded.

**Enforcement.** `demotionReadiness()` in `server/utils/business.js` is the one
rule used by both the endpoint and the admin queue: a conflict with
`BUSINESS_CONTACT_REQUIRED`, `BUSINESS_CONTACT_STALE` (the contact predates the
current request) or `BUSINESS_RESPONSE_WINDOW` (with `earliestDemotionAt`). The
queue renders a countdown and disables Demote with the same reason, so the UI
and API cannot disagree. A response does **not** shorten the window; the window
runs from contact, so a last-minute answer still has time to be read. The Terms
reserve immediate action for fraud or harm; the code currently has no override
flag, so urgent cases require a documented product change rather than a hidden
bypass.

**Re-application.** A new verification request resets `reviewContactedAt` and
the previous demotion notice, so an old conversation cannot authorise a new
decision. The audit history stays intact.

**Roles.** Business review routes currently require the platform `admin` role
(`requirePlatformAdmin`), matching the rest of the admin dashboard. If
moderators should handle first-line review, grant `requirePlatformStaff` to the
contact/list routes and keep verify/reject/demote admin-only; that is a
permission change, not just a UI change.

**Retention.** See §4.2: evidence 24 months after the decision, decision audit
3 years. A demoted account keeps its profile row for that audit window but
loses every permission immediately.

## 5. Proposed design

### 5.1 User and challenge data

Add to `User`:

```js
emailVerifiedAt: Date | null            // existing
recoveryEmail: String | null            // normalized, never public
recoveryEmailVerifiedAt: Date | null
recoveryEmailChangedAt: Date | null
recoveryEligibleAt: Date | null         // verifiedAt + cooling-off
emailChangedAt: Date | null
```

Do not put the backup address in public profile projections, exports visible to
other users, search, or notifications. Mask it in settings (`a•••@gmail.com`).

New `EmailChallenge` (or extend `AccountToken` with a `codeHash` type):

```js
{
  userId,
  purpose: 'verify_primary' | 'verify_recovery' | 'recover_account',
  email,                    // destination at issue time
  codeHash,                 // HMAC-SHA-256(pepper, userId|purpose|email|code)
  expiresAt,
  attempts: 0,
  maxAttempts: 5,
  consumedAt: null,
  createdAt
}
```

- TTL index on `expiresAt`; explicit expiry check on every consume.
- One live challenge per `(userId, purpose)`; issuing a new one invalidates the old.
- `crypto.randomInt(0, 100_000_000)` formatted to 8 digits.
- Constant-time comparison; attempt increment is atomic.
- Never log `email` in full; mask it if a log is necessary.
- New env: `EMAIL_CODE_PEPPER` (32+ random bytes, server-only, rotate with a
  version field if needed).

New `LegalAcceptance`:

```js
{
  userId,
  document: 'terms' | 'privacy',
  version: '2026-11-22',
  acceptedAt,
  requestId,       // non-secret correlation id
  ipHash?          // only if counsel requires it; hash, do not store raw IP
}
```

### 5.2 Primary email verification flow

1. `POST /api/auth/register` validates input, creates the user, issues an
   `EmailChallenge`, sends the code, and returns a session (or a limited
   session) **without the code**.
2. The client shows `/verify-email` with an 8-digit numeric input
   (`inputMode="numeric"`, `autocomplete="one-time-code"`).
3. `POST /api/auth/verify-email/code` `{ code }` requires the authenticated
   session, consumes the challenge atomically, and sets `emailVerifiedAt`.
4. `POST /api/auth/verify-email/resend` is rate-limited and always returns a
   generic success/timing response; a new code invalidates the old one.
5. Expired/too-many-attempts responses are generic: “That code is invalid or
   has expired. Request a new one.”
6. On success: record `email_verified` with method `code`; do not expose the
   code in a toast, URL, analytics event, or console.

**Email content:** “Your GamerHub confirmation code is 12345678. It expires in
10 minutes. If you did not create this account, ignore this email.” No link
with a token. Optionally link to `/verify-email` with no query string.

**Registration UX:** show the code screen immediately after account creation.
Do not describe the account as verified until the API confirms it. Keep
onboarding available only after verification, or gate the write actions listed
below.

### 5.3 Verification gate matrix

Recommended default (adjust after product review):

| Surface | Unverified local account | Verified account |
|---|---|---|
| Read feed/profiles/public channels | Allowed | Allowed |
| Onboarding and profile editing | Allowed | Allowed |
| Create post/comment/story | Blocked with “Confirm your email” | Allowed |
| Like/save/follow | Allowed (low abuse value) | Allowed |
| Send DM / message request | Blocked | Allowed |
| Create community/channel/squad | Blocked | Allowed |
| Report content | Allowed | Allowed |
| Settings/security/legal | Allowed | Allowed |
| Delete account | Allowed | Allowed |
| Google-created account | Treated as verified (Google verified email) | Allowed |

Implement the gate in one server helper (`requireVerifiedEmail`) rather than
scattering checks. Return `403 { code: 'EMAIL_NOT_VERIFIED' }` so the client can
show the verification screen. Do not rely on hiding buttons.

### 5.4 Backup email flow

1. In Settings → Security, require a recent password or Google re-auth.
2. Ask for the backup address (confirm it twice or use a second confirmation
   step). Reject the primary address.
3. Send a code to the backup address (purpose `verify_recovery`).
4. On success: set `recoveryEmail`, `recoveryEmailVerifiedAt`, and
   `recoveryEligibleAt = now + 7 days`; notify the primary address and the new
   backup address.
5. Show a masked address, “Recovery available from [date]”, and a remove button.
6. Changing/removing the backup requires re-auth, notifies both addresses, and
   resets `recoveryEligibleAt` (removal sets it to null).
7. Never use the backup address for login, marketing, public profile, search,
   or support identity. It is recovery-only.

**If the primary address is unverified:** require primary verification before a
backup can be added. Otherwise a typo account can attach an address and become a
recovery path.

### 5.5 Account recovery flow

Endpoint names are illustrative; use one consistent prefix.

1. `POST /api/auth/recovery/start` `{ username, recoveryEmail }`
   - Normalize both.
   - Always return `202` with the same body and similar timing.
   - If the account exists, is active (or restricted/suspended/frozen but not
     deleted), has a verified backup, and the backup address matches
     case-insensitively, and `recoveryEligibleAt <= now`, issue a
     `recover_account` challenge to the backup address.
   - Never reveal which condition failed.
2. `POST /api/auth/recovery/verify` `{ challengeId, code, newPassword }`
   - Validate password policy before consuming the code? Validate first, but do
     not reveal whether the challenge exists.
   - Consume atomically; on success set a new password, `hasLocalPassword: true`,
     increment `sessionVersion`, clear the cookie, disconnect sockets, invalidate
     all account tokens, and record a security event.
   - Do **not** mark the primary email verified or change it. The backup proves
     control of the backup address, not the primary.
   - Preserve `suspended`, `restricted`, `frozen`, or `deletion_pending` status.
     `deleted` is never recoverable.
3. Notify both the primary and backup addresses: “Your password was reset via
   account recovery. If this was not you, contact …”. Do not include the code.
4. Require a fresh login. Do not auto-issue a session in the recovery response.
5. Apply per-IP, per-handle, per-backup, and global rate limits. Add a CAPTCHA
   or managed challenge after repeated failures if needed.
6. If the account is Google-linked and the user still controls Google, offer
   Google sign-in as the primary recovery path. Backup recovery is for when
   Google is also unavailable.

**Cooling-off rule:** a backup address cannot recover the account until
`recoveryEligibleAt`. This blocks the “stolen session adds attacker inbox, then
immediately recovers” takeover. The owner sees the new address and the available
date in Settings and receives an email at the primary address.

**Handle privacy:** the UI must say “Your handle identifies the account; it is
not a password.” Do not use security questions, last-4 digits, or other
publicly discoverable facts.

### 5.6 Google linking

The current `linkGoogle` requirement that the Google email equal the account
email is a safe default. Keep it for **sign-in linking** unless product
explicitly accepts the identity-collision risk of a different address.

Add:

- Re-authentication immediately before linking/unlinking (password or a fresh
  Google proof).
- A database-level uniqueness guarantee for
  `authIdentities.providerSubject` across users, not just an application query.
- An audit/security event and a notification to the primary email.
- A clear distinction in the UI:
  - **Google sign-in** = a login method.
  - **Backup email** = a recovery destination, not a login method.

A local account whose primary address is not Gmail can still add a Gmail backup
address. This satisfies the “link Gmail or set up a Gmail backup” requirement
without allowing two identities to collide.

### 5.7 Email changes

Add a primary-email change flow because a typo or lost primary address is a
real support burden:

1. Require re-auth.
2. Send a code to the new address; keep the old address active until proven.
3. Notify the old address with a reversal link/instructions.
4. On success, set `email`, clear `emailVerifiedAt`, set `emailChangedAt`,
   revoke sessions, and require verification.
5. Apply a cooling-off period before the new primary can be used for recovery.

### 5.8 API and response rules

- All mutations: same-origin check, JSON body, CSRF-safe cookie settings.
- All account-email endpoints: `Cache-Control: no-store`, generic responses,
  rate limits, no email addresses in response payloads.
- Never return `challengeId`? It is not secret, but treat it as an opaque
  identifier; bind it to the purpose and do not let it authorize anything
  without the code.
- Do not use GET for verification, resend, recovery, or email changes.
- Error shape: `{ message, code? }`; do not include whether an account exists.
- Add request IDs to logs, but never request bodies, codes, tokens, cookies, or
  full email addresses.

### 5.9 UI surfaces

- **Register:** Terms checkbox (unchecked), Privacy acknowledgement, links open
  in-app or a new tab; no pre-checked consent.
- **Verify email:** code input, resend timer, “use a different email” (only if
  the email-change flow exists), “sign out”, accessible error text, `role=status`
  for sent/verified messages.
- **Login:** legal footer links; unverified users can sign in and see the banner.
- **Settings → Security:** primary email status, backup email card, Google card,
  recovery availability date, “remove backup” with re-auth, security activity.
- **Recovery:** `/recover` (handle + backup email) and `/recover/verify`
  (code + new password). Generic copy; no account-existence hints.
- **Legal:** shared `LegalLinks` component used by Login, Register, and Settings;
  `/terms` and `/privacy` render versioned documents with effective date.

## 6. Legal and compliance workstream

### 6.1 Current legal-page problems

The existing pages are not safe to publish as-is. At minimum:

- They omit the legal entity, address, governing law, effective date/version,
  age policy, cookies/local storage, processors, international transfers,
  retention schedule, data-subject rights, complaint route, and security
  incident contact.
- The Privacy Policy says Google profile picture/avatar is collected. The
  code uses Google name/email/subject for identity and does not store a Google
  avatar. Remove or correct this.
- “Authentication tokens and passwords are cryptographically hashed” is too
  broad; describe bcrypt password hashes, hashed one-time tokens, HttpOnly
  cookies, TLS, and access controls accurately.
- The Terms have no user-content licence, moderation/termination process,
  third-party content, copyright/DMCA process, disclaimers/liability, or
  governing-law clause.
- There is no acceptance record and no link from the auth screens.

### 6.2 Data inventory to disclose

| Category | Examples | Purpose | Retention / recipient |
|---|---|---|---|
| Account | handle, email, password hash, Google subject, verified timestamps, preferences, passport/game IDs, hardware specs | Provide account, sign-in, personalization | Account lifetime; deleted/anonymized on erasure |
| User content | posts, comments, stories, channel messages, community messages, DMs, uploads, reports | Provide the service, moderation, safety | Until user deletes or account erasure; some channel/squad retention |
| Technical | request ID, IP-derived security signals, user agent if logged, auth cookie, rate-limit keys | Security, reliability, abuse prevention | Short-lived logs/keys; document actual periods |
| Product events | signup, onboarding, first follow/post, notification engagement; no message bodies/emails/tokens/IP | Product analytics | 180 days |
| Legal/security records | acceptance version, security events, audit rows | Compliance, safety, dispute resolution | Document period; minimize metadata |
| Media | Cloudinary public IDs, URLs, transforms | Hosting and delivery | Until content/account deletion; orphan cleanup 30 days |
| Business verification | official contact and preferred method, proof type, public proof link/note, correspondence, status, reviewer note | Verify business profiles | Evidence 24 months after the decision; decision audit 3 years; no document uploads |

Processors to list with links and regions (confirm contracts/regions before
publication): MongoDB Atlas, Cloudinary, Google (Identity/Gmail bridge/YouTube),
Render, Vercel, Upstash (if enabled), Sentry (if enabled), IGDB/Twitch (if
enabled), FreeToGame (catalog data). No sale of personal data; no third-party
advertising or cross-context behavioral advertising.

### 6.3 Legal pages and acceptance

- Publish `Terms` and `Privacy` at stable URLs with a version and effective date.
- Put links in Login, Register, and Settings. At registration, require an
  unchecked checkbox: “I agree to the Terms of Service and have read the Privacy
  Policy.” Consent to marketing must be separate and optional; do not bundle it.
- Record acceptance server-side with version and timestamp. On material changes,
  show a re-acceptance prompt and keep prior versions available.
- Link the Privacy Policy in the Google OAuth consent screen and keep it
  consistent with the published page. Disclose Google user data access/use,
  storage, sharing, and Limited Use compliance; do not use Google data for ads,
  sale, or unrelated purposes.
- Add a cookie/local-storage section: `jwt` HttpOnly auth cookie; video playback
  position and verification-banner dismissal in browser storage; no advertising
  cookies. If analytics/cookies are added later, implement consent where needed.
- Add an age attestation before account creation and state the actual minimum
  age. Do not claim COPPA/GDPR child compliance until the flow and parental
  consent process (if required) exist.
- Confirm whether GDPR/UK GDPR, DPDP Act 2023, CCPA/CPRA, or other regimes apply
  with counsel. The drafts are structured to cover the common disclosure set but
  cannot establish applicability or adequacy.

## 7. Delivery plan

Each step should be a reviewable change with its own tests. Do not ship the code
flow and legal copy as one giant unreviewable change.

### PR 1 — Security primitives and no-log guarantee

- Add `EmailChallenge`/code helpers, `EMAIL_CODE_PEPPER`, HMAC storage, atomic
  consume, attempt counts, TTL.
- Remove body logging from the console transport; add a test that scans captured
  logs for codes/tokens.
- Add email-safe HTML escaping and a template snapshot test.
- Add `Cache-Control: no-store` and request-ID-only logging for account email
  routes.
- **Exit:** unit tests prove code never appears in responses/logs/outbox beyond
  the test-only in-memory store.

### PR 2 — Primary email code verification

- Generate/send 8-digit codes on registration and resend.
- Add `/auth/verify-email/code`; keep the old link endpoint for a deprecation
  window or migrate all clients atomically.
- New `/verify-email` UI, code input, cooldown, accessible states.
- Add `requireVerifiedEmail` and the write-gate matrix.
- Migration: existing unverified accounts receive a code on next resend; do not
  invalidate verified accounts.
- **Exit:** e2e test registers, reads code from test outbox only, verifies,
  and proves the code is absent from HTTP responses/DOM/console.

### PR 3 — Backup email and Google link hardening

- User fields, add/change/remove endpoints, re-auth, notifications, masked UI.
- 7-day eligibility calculation; no recovery before it.
- Google re-auth, unique provider-subject constraint, audit/notification.
- **Exit:** two-account isolation tests; adding a backup cannot recover
  immediately; changing it notifies the primary; Google collision is rejected.

### PR 4 — Account recovery

- `/recovery/start`, `/recovery/verify`, recovery UI, generic responses.
- Password set, session revocation, token invalidation, socket disconnect.
- Preserve moderation states; block deleted accounts.
- Security events and both-address notifications.
- Support runbook (manual review only if approved).
- **Exit:** recovery works after cooling-off; before cooling-off it fails
  generically; a suspended account stays suspended; old sessions are dead.

### PR 5 — Legal pages, acceptance, and links

- Replace the short pages with counsel-reviewed versions based on the drafts.
- Add version constants, acceptance records, registration checkbox, re-acceptance
  prompt, and shared links in Login/Register/Settings.
- Add Google OAuth privacy URL and processor disclosures.
- Confirm data export completeness or document the subject-access process.
- **Exit:** legal pages render on mobile, links are keyboard-accessible, and the
  accepted version is recorded and visible to the user.

### PR 6 — Hardening and verification

- Full e2e matrix, load/rate-limit checks, enumeration timing, Redis off/on,
  Gmail failure/timeout, quota exhaustion, email HTML injection, replay/race.
- Accessibility pass for code input, errors, focus, and legal links.
- Log/Sentry/analytics scan for codes, tokens, and full emails.
- Backup/restore and deletion verification.
- **Exit:** no critical/high findings; documented residual risks.

## 8. Test plan

### Unit

- Code generation length/charset; HMAC binding; constant-time compare.
- Expiry, attempts, resend invalidation, atomic consume.
- Email HTML escaping.
- Password policy and recovery state transitions.
- Legal acceptance version logic.
- Masking of backup address.

### Integration / e2e

- Register → code screen → wrong code ×5 → locked challenge → resend → correct
  code → verified.
- Code absent from response JSON, DOM, network response, server log, Sentry
  breadcrumb, product event, and browser storage.
- Resend cooldown and hourly cap.
- Login before verification; write gate returns `EMAIL_NOT_VERIFIED`.
- Google account is verified without a code.
- Add backup email → cannot recover until cooling-off → recover after eligibility.
- Wrong handle, wrong backup, unverified backup, suspended account, deleted
  account: identical generic response.
- Recovery revokes sessions and old cookies.
- Backup change notifies primary and resets eligibility.
- Google link collision and unlink-without-password refusal.
- Legal checkbox required; acceptance version stored; links visible on login,
  register, settings.
- Mobile 360px and keyboard-only flows.
- Gmail bridge down: registration still succeeds; resend returns a safe error.
- Redis off: flows still work with in-process limits; Redis on: shared limits
  behave.

### Abuse / security

- Distributed guessing simulation; CAPTCHA/threshold behavior.
- Account enumeration timing and body comparison.
- CSRF/foreign-origin mutation rejection.
- XSS payload in username/email template.
- Code replay and two-tab race.
- Log redaction test with a synthetic code and token.

## 9. Rollout and operations

- Feature flag: `EMAIL_CODE_VERIFICATION` and `ACCOUNT_RECOVERY` (server-side).
- Deploy the code path dark, migrate, then enable for new registrations.
- Keep link verification working during the migration window; do not break
  existing unverified accounts.
- Monitor: send success/failure, resend rate, verification conversion, recovery
  attempts, lockouts, Gmail quota errors, and 5xx rates. Never put codes or
  emails in metrics labels.
- Document the Gmail bridge quota and a fallback plan. If volume grows, migrate
  to a transactional provider with a verified domain; do not log bodies there
  either.
- Keep `REDIS_ENABLED=0` by default on the free tier; enable only with a quota
  alert and a documented rollback. Shared rate limits are weaker when off.

## 10. Open blockers / questions for the owner

**Answered 2026-11-22:** contact address, worldwide availability (English for
now), any-provider backup email, same-email Google linking, recovery settings,
and the business evidence/contact-before-demotion workflow. See §4.1–§4.3.

Still open:

1. Legal name, registered address, country, and whether a company entity exists.
2. Minimum age and whether parental consent is offered.
3. Governing law, venue and consumer/arbitration position (worldwide
   availability is settled; the law that governs the contract is not).
4. Whether manual support recovery will exist.
5. Whether an urgent demotion (fraud, harm) needs a documented override of the
   seven-day window, or whether admins may only contact-and-wait.
6. Actual backup/log retention from Atlas, Render, Vercel, Cloudinary, Upstash
   and Sentry — confirm the §4.2 proposal against each dashboard/plan.
7. Whether the project will be a personal/student project or a commercial
   service; this changes the legal entity, consumer terms and tax/privacy
   posture.
8. Whether moderators, rather than only admins, may handle business review.
9. Whether the response window should be configurable per region or plan; it is
   a fixed seven days in code today.

## 11. Sources consulted

- OWASP Email Validation and Verification Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html>
- OWASP Multifactor Authentication Cheat Sheet (OTP handling): <https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html>
- OWASP Forgot Password Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html>
- NIST SP 800-63B-4 (authenticator and recovery-code guidance): <https://pages.nist.gov/800-63-4/sp800-63b.html>
- ICO right to be informed checklist: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-be-informed>
- GDPR Article 13 (official text): <https://gdpr-info.eu/art-13-gdpr/>
- India DPDP Rules 2025 notice requirements (official PDF): <https://www.dpdpa.in/dpdpa_rules_2025/dpdpa_rules_english_2.pdf>
- CCPA statute/regulations (effective 2026): <https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf>
- Google API Services User Data Policy: <https://developers.google.com/terms/api-services-user-data-policy>
- Google OAuth verification / privacy-policy requirements: <https://support.google.com/cloud/answer/13464321>
- Account recovery controls (reauth, verify-before-change, notify, cooling-off): <https://safeguard.sh/resources/blog/account-recovery-is-your-weakest-authentication>
- Session/credential revocation after recovery: <https://learn.microsoft.com/en-us/defender-office-365/responding-to-a-compromised-email-account>
