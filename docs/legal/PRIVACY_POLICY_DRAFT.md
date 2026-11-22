# GamerHub Privacy Policy — DRAFT

> **DRAFT FOR COUNSEL REVIEW. NOT FOR PUBLICATION.**
>
> This draft describes the repository's actual data flows as of 2026-11-22. It is
> not legal advice and does not by itself establish GDPR, UK GDPR, DPDP, CCPA/CPRA,
> COPPA, or other compliance. Replace every `[BRACKETED]` item and have qualified
> counsel review the final text and the operator's contracts before publishing.
>
> Version: `[VERSION]` · Effective: `[EFFECTIVE DATE]` · Last updated: 2026-11-22
>
> Items marked **PLANNED** describe a designed feature that is not implemented
> yet. Remove the marker only after the feature ships and is tested.

## 1. Who is responsible for your data

**[LEGAL ENTITY NAME]** ("GamerHub", "we", "us", or "our") is the controller of
the personal data described in this policy, unless a specific feature says
otherwise. Our registered address is **[REGISTERED ADDRESS]**. Privacy contact:
**sagnikmitra.tennis@gmail.com**.

If required in your region, our EU/UK representative is **[NAME AND ADDRESS]**
and our Data Protection Officer is **[NAME AND CONTACT]**. If we have not
appointed one, do not claim that we have.

## 2. Scope

This policy covers the GamerHub website and API, including accounts, profiles,
posts, comments, stories, clips, broadcasts, communities, squads, direct
messages, notifications, game discovery, business profiles, and support
communications. It does not cover third-party sites, games, stores, or YouTube
channels you visit through links or embeds.

GamerHub is offered worldwide. The service and this policy are currently in
English only; if a translation is added, the English text governs until we say
otherwise. Offering the service globally means we do not assume that only one
country's privacy law applies; the rights section below describes the common
set and the regional additions.

## 3. Personal data we collect

### 3.1 Data you give us

| Category | Examples | Required? |
|---|---|---|
| Account | handle, email address, password (stored as a bcrypt hash), preferred platforms, profile type, onboarding answers | Required to create an account |
| Profile | bio, avatar, gamer passport, game IDs, active games, hardware/rig details, favourite games/genres, links you add | Optional |
| Content | posts, comments, stories, clips, broadcasts, community messages, squad messages, direct messages, uploads, reports, appeals | Optional when you choose to post |
| Communities | memberships, roles, invitations, join requests, moderation actions, audit records | Optional when you join or create a community |
| Business profile | business name, public description, website, public support email, category | Optional if you use business mode |
| Business verification | official contact email, preferred contact method and phone/handle if not email, proof type, public proof link and/or a short explanation, verification status, correspondence, your response to a review contact, and reviewer notes | Optional if you apply for verification |
| Communications | support messages, abuse reports, legal requests, email correspondence | When you contact us |
| Security | password-change events, session version, login/verification attempts, recovery events, acceptance of legal versions | Generated when you use security features |

We do not currently ask you to upload government identity documents for business
verification. The application collects an official contact route and a public
proof link (for example a business or tax registry entry, a domain email on the
official site, or an official listing) and/or a short explanation. If a future
process collects uploaded documents, this policy and the collection screen must
be updated before that collection begins.

### 3.2 Data collected automatically

| Category | Examples | Notes |
|---|---|---|
| Authentication | `jwt` HttpOnly cookie, session version | The cookie is required for sign-in. It is not an advertising cookie. |
| Technical/security | request ID, IP-derived rate-limit state, browser/user-agent data if logged, timestamps, error diagnostics | Exact log fields and retention must be confirmed with the hosting providers. |
| Product analytics | first-party events such as signup, onboarding completion, first post/follow, notification engagement | Events are linked to an account ID. The code deliberately strips message bodies, emails, tokens, IP addresses, and similar sensitive fields. Retained 180 days. |
| Local browser storage | video playback position, verification-banner dismissal | Stored in your browser; not used for advertising. |
| Cookies | `jwt` authentication cookie | Essential for the service. See section 11. |

We do not use third-party advertising cookies, cross-context behavioral
advertising, session replay, or a browser-side Sentry SDK. If that changes, this
policy and any required consent mechanism must be updated first.

### 3.3 Data from Google

If you choose **Sign in with Google**, Google provides an ID token containing
identifiers such as your Google subject ID, email address, email-verification
status, and name. We use the subject ID to identify the linked account, the email
to match or create an account under the rules shown in the product, and the name
to suggest a handle. We do not request Gmail, Drive, Contacts, or other Google
Workspace scopes. We do not store a Google profile picture in the current code.

If you add a **backup email**, we send a verification code to that address. It
can be any address you control — Gmail, Outlook/Hotmail, Yahoo, a work address or
a custom domain. We do not use it for sign-in, marketing, or public display. It
is used only for account recovery and security notices. **PLANNED — confirm
before publication.** A newly added or changed backup address cannot be used for
recovery until a cooling-off period (currently seven days) has passed; we notify
the primary address when it changes.

### 3.4 Data from other people

Other users may mention you, send you a message or invitation, report your
content, or include your handle in a post. We receive that information as part of
operating the service.

## 4. Why we use personal data and our legal bases

| Purpose | Data | Legal basis (GDPR/UK GDPR) |
|---|---|---|
| Create and operate your account | Account, profile, authentication, preferences | Performance of a contract / steps before entering a contract |
| Provide social features, communities, messaging, and content | Content, memberships, messages, interactions | Performance of a contract |
| Verify email, secure accounts, recover access, prevent abuse | Email, backup email, security events, rate-limit data | Performance of a contract; legitimate interests in security |
| Moderate content and enforce Terms | Content, reports, moderation records | Legitimate interests in safety and community integrity; legal obligation where applicable |
| Respond to support and legal requests | Communications, account and content records | Legitimate interests; legal obligation |
| First-party product analytics | Product events, account ID, non-content properties | Legitimate interests in improving the service, subject to a balancing test and any consent required locally |
| Send essential account email | Email address, verification/recovery content | Performance of a contract; legitimate interests in security |
| Comply with law, respond to valid legal process, establish or defend claims | Relevant records | Legal obligation; legitimate interests |
| Business verification | Official contact and preferred method, proof link/note, review correspondence | Performance of a contract; legitimate interests in preventing impersonation |

We do not sell personal data. We do not use personal data for third-party
interest-based advertising. We do not use Google user data to train generalized
AI/ML models or for advertising.

**Counsel decision required:** confirm the lawful basis for product analytics in
each target market. If consent is required, add a consent control before the
event is recorded and make withdrawal as easy as consent.

## 5. Google API Services User Data Policy

Our use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use Google user data only to provide
or improve the user-facing sign-in and account features described in this
policy. We do not sell it, use it for advertising, or transfer it except as
necessary to provide those features, comply with law, or as part of a merger or
acquisition with notice.

You can revoke GamerHub's access in your Google Account permissions. Revoking
Google access does not delete your GamerHub account; use Settings or contact us.

**Counsel/Google console task:** publish this policy at a stable URL and use the
same URL in the Google OAuth consent screen.

## 6. How we share information

### 6.1 Service providers

We use processors to run the service. The current code references:

| Provider | Purpose | Notes |
|---|---|---|
| MongoDB Atlas | Primary database | Hosting region and backup retention must be confirmed. |
| Cloudinary | Image/video storage, transforms, delivery | Media may be processed and cached by Cloudinary. |
| Google | Google Sign-In; Gmail Apps Script email bridge; YouTube API/embeds | Google receives authentication requests and the email content needed to send account mail. |
| Render | API hosting | Logs and regional processing must be confirmed. |
| Vercel | Web frontend hosting | Logs and regional processing must be confirmed. |
| Upstash | Optional Redis cache/rate-limit store | Currently disabled by default. No message bodies are cached. |
| Sentry | Optional server-side error reporting | Configured with PII sending disabled; error messages are redacted. |
| IGDB/Twitch | Optional game metadata | Only game-search data is requested. |
| FreeToGame | Game catalog data | Public catalog data; no user account is sent. |

We require processors to protect personal data and use it only for the services
they provide, where required by law. The final policy should link to each
provider's privacy policy and identify processing regions.

### 6.2 Other users

Your handle, profile, posts, comments, community memberships visible to members,
and content you publish are visible to other users according to your settings.
Do not post information you want to keep private. Direct messages are visible to
the people in the conversation and are not end-to-end encrypted.

### 6.3 Legal, safety, and business transfers

We may disclose information if required by law, legal process, or a valid
government request; to investigate fraud, abuse, or security incidents; to
protect users or the public; or to establish or defend legal claims. We may
transfer data as part of a merger, acquisition, financing, or sale of assets,
subject to appropriate notice and safeguards.

We do not sell personal data or share it for cross-context behavioral advertising.

## 7. International transfers

GamerHub and its processors may process data in countries other than yours. If
we transfer personal data from the EU/UK/Switzerland, we will use an appropriate
transfer mechanism (for example, an adequacy decision or Standard Contractual
Clauses) and provide additional safeguards where required.

**Counsel/provider task:** confirm the actual hosting regions for Atlas, Render,
Vercel, Cloudinary, Google, Upstash, and Sentry and insert the correct transfer
mechanism. Do not claim an adequacy decision that does not exist.

## 8. How long we keep data

The periods below combine what the current code enforces with the proposed
policy for records that are not yet on a timer. Provider backups and logs may
have their own schedules and must be confirmed before publication.

| Data | Retention |
|---|---|
| Account and profile | Until you delete your account; scheduled deletion has a 30-day grace period, then the account is anonymized and personal content is erased. |
| Posts, comments, uploads, community content | Until you delete the content or your account is erased, subject to community retention settings and copies others may have made. |
| Stories | 24 hours, then removed by expiry/TTL. |
| Ordinary notifications | 15 days; important/durable notices may remain until no longer needed or account deletion. |
| Temporary squad chats | 15 days, then messages are purged. |
| Message requests | 14 days to respond; declined requests may have a 90-day cooldown. |
| Invitations | 7 days. |
| Product analytics events | 180 days. |
| Email verification/reset links | 24 hours for verification, 30 minutes for password reset; single-use and invalidated on use or resend. |
| Email confirmation codes (**PLANNED**) | 10 minutes, five attempts, one live code per purpose; the challenge row is removed or expires within 24 hours. |
| Business verification evidence | While the application is open; normally 24 months after the decision, then the contact and proof fields are deleted. |
| Business review correspondence and decision audit | 3 years after the decision, limited to the contact channel, decision, reason, reviewer and timestamps. |
| Legal acceptance records | For the life of the account and 3 years after closure, so we can show which version you accepted. |
| Support, reports, moderation and audit records | As long as needed for safety, dispute resolution, and legal obligations; exact periods to be confirmed by counsel. |
| Security and HTTP logs | Proposed 14 days where the host plan permits; request ID, route, status and latency only — no bodies, codes, tokens, cookies or full email addresses. |
| Error reports (if Sentry is enabled) | Proposed 30 days, with request bodies and account email scrubbed. |
| Backups | Explicit encrypted archives are proposed to be kept 30 days; deleted-account data in provider backups is expected to expire within 35 days. M0 Atlas has no automatic snapshots. Confirm the actual plan and window. |
| Orphaned media | Pending/rejected uploads after 24 hours; unreferenced ready media after 30 days. |

When data is no longer needed, we delete it or anonymize it. Some records may be
retained where required by law or to prevent fraud/abuse; we will not retain data
merely because it might be useful later.

## 9. Security

We use measures appropriate to the service, including:

- bcrypt password hashing, not reversible password storage;
- hashed, single-use account tokens/codes;
- HttpOnly authentication cookies with `SameSite` protections;
- TLS/HTTPS in production;
- server-side validation, rate limits, and origin checks;
- access controls and redaction of sensitive values in logs/error reporting;
- session-version revocation for “sign out everywhere” and password changes;
- encrypted transport to processors where supported.

No system is completely secure. We cannot guarantee that unauthorized access,
loss, or misuse will never occur. If you believe your account is compromised,
change your password, sign out everywhere, and contact
**sagnikmitra.tennis@gmail.com**.

## 10. Your privacy rights

Depending on where you live, you may have some or all of the following rights:

- **Access** — receive a copy of the personal data we hold about you.
- **Correction** — correct inaccurate or incomplete data.
- **Deletion** — ask us to delete your account and personal data, subject to
  legal retention.
- **Restriction/Objection** — ask us to restrict or stop certain processing,
  including direct marketing (we do not currently send marketing).
- **Portability** — receive eligible data in a structured, machine-readable form.
- **Withdraw consent** — where processing is based on consent, withdraw it at any
  time without affecting prior processing.
- **Non-discrimination** — we will not retaliate against you for exercising
  privacy rights.
- **Complaint** — complain to your local data-protection authority. In the EU/UK
  you can complain to your national supervisory authority. In India, you may
  first use our grievance process and then approach the Data Protection Board as
  the law allows.

You can use Settings to access and export much of your data and to delete your
account. For requests that are not self-service, contact **sagnikmitra.tennis@gmail.com**. We
may need to verify your identity before acting; we will not ask for more than is
necessary. Authorized agents may submit requests where local law allows.

We respond within the period required by applicable law. If we cannot fulfill a
request, we will explain why, subject to legal limits.

**India-specific:** if the DPDP Act 2023 applies, our grievance officer is
**[NAME/CONTACT]** and we aim to respond within the prescribed period (currently
capped at 90 days under the rules). **Counsel must confirm the current rules and
appointment.**

**California-specific:** we do not sell or share personal information for
cross-context behavioral advertising as those terms are defined by the CCPA/CPRA.
You may still submit an access/deletion/correction request at **sagnikmitra.tennis@gmail.com**.
We will not discriminate for exercising CCPA rights.

## 11. Cookies and local storage

| Name/type | Where | Purpose | Duration |
|---|---|---|---|
| `jwt` | HttpOnly cookie | Authenticate your session | Session/configured JWT lifetime; cleared on logout |
| video position | `localStorage` | Resume a video where you left off | Until you clear browser storage |
| verification banner dismissal | `sessionStorage` | Do not show the same reminder repeatedly in this browser session | Until the browser tab/session ends |

We do not currently use advertising cookies or third-party analytics cookies.
Essential authentication cookies do not require consent in many jurisdictions,
but they must be disclosed. If we add non-essential cookies or trackers, we will
update this policy and, where required, ask for consent before setting them.

## 12. Children

GamerHub is not intended for children below **[MINIMUM AGE]**. We do not
knowingly collect personal data from children below that age. If you believe a
child has created an account, contact **sagnikmitra.tennis@gmail.com** and we will
investigate and delete the account where appropriate.

**Counsel decision required:** the minimum age, age-assurance method, and
parental-consent process (if any) must match the target markets. Do not claim
COPPA or GDPR child-compliance until those controls exist.

## 13. Automated decisions and personalization

The feed ranks content using your preferences, follows, favourite channels, and
engagement signals. This is personalization, not an automated decision that
produces legal or similarly significant effects. You can reset feed
recommendations in Settings. We do not use solely automated processing to make
decisions about your access, credit, employment, or legal rights.

## 14. Changes to this policy

We may update this policy. If a change is material, we will provide reasonable
notice (for example, email or an in-app notice) and, where required, ask you to
re-accept. The version and effective date at the top identify the current text.
Prior versions will be archived.

## 15. Contact and complaints

Privacy questions or requests: **sagnikmitra.tennis@gmail.com**.

Postal contact: **[REGISTERED ADDRESS]**.

Security reports: **sagnikmitra.tennis@gmail.com**.

If you are not satisfied with our response, you may contact your local
data-protection authority. We will cooperate with competent authorities.

---

### Counsel/operations checklist before publication

- [ ] Replace every bracketed placeholder (entity, address, age, representative).
- [ ] Confirm the controller's legal identity and whether a representative/DPO
      is required for worldwide availability.
- [ ] Confirm the applicable legal bases, including analytics consent where
      required.
- [ ] Confirm actual hosting regions and transfer mechanisms.
- [ ] Confirm provider DPAs, subprocessors, and retention schedules.
- [ ] Confirm the proposed log (14-day), error-report (30-day), business
      evidence (24-month) and backup (30/35-day) windows against the real plans;
      remove “proposed” and “confirm” language only when configured.
- [ ] Confirm the minimum age and implement the age gate before publishing it.
- [ ] Confirm that business verification still collects only a contact route and
      a public proof link/note, not uploaded identity documents.
- [ ] Confirm the seven-day backup-email cooling-off and the business response
      window match the code and operations.
- [ ] Confirm the data export covers access/portability requests, or document a
      separate subject-access process.
- [ ] Add the same Privacy Policy URL to the Google OAuth consent screen.
- [ ] Add links to Login, Register, and Settings before launch.
- [ ] Record acceptance by version and keep prior versions.
