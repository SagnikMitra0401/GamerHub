# Gmail Apps Script email bridge

This is the free email option for GamerHub when the host blocks outbound SMTP
(Render free blocks ports `25`, `465` and `587`). The server makes an HTTPS
request to a Google Apps Script web app, and that script sends the message from
your Gmail account with `MailApp`.

It needs no domain, no paid provider and no SMTP ports. It is intended for
low-volume account email (verification and password reset), not marketing.

## What you need

- A Google/Gmail account.
- The GamerHub server running locally or deployed.
- About five minutes.

## 1. Create the Apps Script project

1. Open <https://script.google.com>.
2. Click **New project**.
3. Rename it to `GamerHub Email Bridge`.

## 2. Paste the bridge code

Open [`scripts/gmail-bridge.gs`](../scripts/gmail-bridge.gs) and copy its
contents into the Apps Script editor, replacing the default `myFunction` code.

Set `SECRET` near the top to a long random value. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep that value. You will put the same value in `GMAIL_BRIDGE_SECRET`.

> The script contains the secret, so keep the Apps Script project private. The
> deployed URL is public; the secret is what protects it.

## 3. Deploy the web app

1. Click **Deploy** → **New deployment**.
2. Click the gear icon and choose **Web app**.
3. Set:
   - **Description:** `GamerHub email bridge`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
4. Click **Deploy**.
5. Google asks for authorization. Choose your account, click **Advanced** →
   **Go to GamerHub Email Bridge (unsafe)** → **Allow**. The warning is normal
   for your own unpublished script; it needs permission to send email.
6. Copy the **Web app URL**. It must end in `/exec`, not `/dev`.

Test the deployment in a browser. Opening the `/exec` URL should show:

```json
{"ok":true,"service":"gamerhub-email-bridge"}
```

If it asks you to sign in, the access setting is wrong. Set it to **Anyone** and
deploy again.

## 4. Configure the server locally

Add these lines to `.env` (never commit this file):

```env
EMAIL_TRANSPORT=apps-script
GMAIL_BRIDGE_URL=https://script.google.com/macros/s/PASTE_YOUR_DEPLOYMENT_ID/exec
GMAIL_BRIDGE_SECRET=paste-the-same-secret-you-put-in-the-script
```

`EMAIL_TRANSPORT` is optional when `GMAIL_BRIDGE_URL` is set. The sender is the
Google account that owns the script, and the display name is set in the script
as `GamerHub`.

## 5. Send a test email

From the project root:

```bash
node -e "require('dotenv').config(); const { sendEmail } = require('./server/utils/email'); sendEmail({ to: 'YOUR_ADDRESS@gmail.com', subject: 'GamerHub bridge test', text: 'The bridge works.' }).then(r => console.log(r)).catch(e => { console.error(e.message); process.exit(1); });"
```

Replace `YOUR_ADDRESS@gmail.com` with the inbox you can open. A successful send
prints something like:

```json
{ "id": "apps-script" }
```

Then run the real flow: register a new account, open the verification email and
confirm the link works. Also test **Forgot password** once.

## 6. Configure Render

In the Render dashboard, open your service → **Environment** and add:

```text
EMAIL_TRANSPORT=apps-script
GMAIL_BRIDGE_URL=https://script.google.com/macros/s/.../exec
GMAIL_BRIDGE_SECRET=the-same-secret
```

Save and redeploy. The bridge uses HTTPS, so Render's SMTP port block does not
apply.

## Quotas and limits

Google Apps Script quotas apply to the Google account that owns the script:

- Consumer `@gmail.com` accounts: roughly **100 recipients per day**.
- Google Workspace accounts: a higher quota.

See [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).
GamerHub's own bridge also limits requests to **30 per minute** per script.

If you outgrow this, move to a provider with a verified custom domain. The bridge
is a demo/small-project solution, not a bulk mail service.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Email bridge rejected the message (200: forbidden)` | `GMAIL_BRIDGE_SECRET` does not match `SECRET` in the script | Make them identical, then deploy a new version |
| `... : secret_not_set` | The placeholder was not replaced | Set `SECRET` in the script and deploy |
| `... : invalid` | Missing recipient, subject, or body | Check the request; this should not happen from GamerHub |
| `... : rate_limited` | More than 30 requests in one minute | Wait a minute |
| `... : failed` | Gmail quota, permission, or script error | Open **Executions** in the Apps Script editor and read the error |
| `Email bridge timed out` | Wrong URL, deployment asleep, or network issue | Open the `/exec` URL in a browser and check it returns JSON |
| HTML login page instead of JSON | Access is not **Anyone**, or you used the `/dev` URL | Set access to **Anyone** and use `/exec` |
| `404` | Deployment URL is wrong or was deleted | Copy the current `/exec` URL from **Manage deployments** |

### After editing the script

Editing the code is not enough. Deploy a new version:

**Deploy** → **Manage deployments** → pencil icon → **Version: New version** →
**Deploy**.

Using **New deployment** again also works, but it creates a new URL, so update
`GMAIL_BRIDGE_URL` if you do that.

## Security notes

- The `/exec` URL is public. The shared secret is the only gate, so use a long
  random value and keep it server-side.
- Do not put `GMAIL_BRIDGE_SECRET` in client code, `VITE_*` variables, logs, or
  the repository.
- If the secret leaks, change `SECRET` in the script, deploy a new version, and
  update the server environment variable.
- Rotate the secret if you share the Apps Script project or suspect abuse.
- This sends from your personal Gmail identity. Use it only for account email,
  and do not use it for unsolicited or bulk messages.
