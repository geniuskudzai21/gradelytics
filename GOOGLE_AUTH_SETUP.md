# Google Sign-In Setup (Supabase + Google Cloud)

Google sign-in is 100% configured **outside the code** — nothing in this repo
needs editing. The flow is:

```
auth.html → Supabase /authorize → Google → Supabase callback → auth.html
```

Both dashboards must know about each other's URLs. If any URL below is wrong,
Google refuses with `redirect_uri_mismatch`, or Supabase bounces you back to
the sign-in page with an error in the URL (the app now shows that error on the
auth page instead of silently doing nothing).

Your project ref is `rqpnpvqasnutgqzbgmsq`
(project URL `https://rqpnpvqasnutgqzbgmsq.supabase.co`).

---

## Part 1 — Google Cloud Console

Go to <https://console.cloud.google.com>.

### 1. Create the OAuth client (one time)

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Name it (e.g. `Gradelytics Google Sign-In`)
4. **Authorised JavaScript origins** — add exactly:

   ```
   https://genius-pa.vercel.app
   http://localhost:3000
   ```

   Add `https://gradelytics.com` too if that domain is live.
   Do **not** add a trailing slash or path.

5. **Authorised redirect URIs** — add exactly:

   ```
   https://rqpnpvqasnutgqzbgmsq.supabase.co/auth/v1/callback
   ```

   This is Supabase's callback, **not** your site. This is the single most
   common mistake — putting your own domain here breaks the flow.

6. Click **Create** and copy the **Client ID** and **Client Secret**.

### 2. Consent screen (required or sign-in is blocked for everyone)

1. **APIs & Services → OAuth consent screen**
2. User type: **External**, fill in app name + your email.
3. Scopes: leave the defaults (`email`, `profile`, `openid` are enough).
4. **Test users → Add users** → add every Google account you will sign in
   with. While the app is in **Testing** status, any account that is not on
   this list is rejected with `access_denied`.
5. (Optional) click **Publish app** to leave Testing status permanently.

---

## Part 2 — Supabase Dashboard

Open <https://supabase.com/dashboard> → your project (`gradelytics`).

### 1. Enable the Google provider

1. **Authentication → Providers → Google** (in newer dashboards:
   **Sign In / Providers → Google**)
2. Toggle **Enable Sign in with Google**
3. Paste the **Client ID** and **Client Secret** from Part 1
4. **Save**

### 2. Set the URLs

**Authentication → URL Configuration**:

| Field | Value |
|---|---|
| **Site URL** | `https://genius-pa.vercel.app` |
| **Redirect URLs** | `https://genius-pa.vercel.app/pages/auth.html` |
| | `https://genius-pa.vercel.app/**` |
| | `http://localhost:3000/pages/auth.html` |
| | `https://gradelytics.com/pages/auth.html` (if that domain is live) |

Click **Save** after adding them.

Notes:

- The redirect URL the app sends is `origin + pathname` of the page you start
  from — i.e. `.../pages/auth.html`. The `**` wildcard covers any other page
  you later start the flow from.
- Localhost entries are only needed while developing with `node server.js`.
- Unknown/unlisted redirect URLs fall back to the **Site URL**, which looks
  like "it just went back to the sign-in page".

---

## Part 3 — Verify

1. Commit + push (the fix is in `js/supabase.js`; the service-worker cache was
   bumped to `v7`, so returning users pick it up on the next visit).
2. Open <https://genius-pa.vercel.app/pages/auth.html> (hard refresh:
   `Ctrl+Shift+R`).
3. Click **Continue with Google**, pick an account, approve.
4. You should land on `pages/dashboard.html` signed in.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Google shows `redirect_uri_mismatch` | Wrong URI in Google Cloud | Part 1 step 4/5 — must be the Supabase `/auth/v1/callback` |
| Bounces back to sign-in, page shows a red error | Supabase rejected the redirect URL | Part 2 step 2 — URL must match the page you started from exactly |
| `access_denied` / "access blocked" | Google consent screen in *Testing*, account not a test user | Part 1 step 2 — add the account or publish the app |
| Button spins, then "provider not enabled" | Google provider off / missing secret in Supabase | Part 2 step 1 |
| Works on localhost, fails on Vercel | Domain missing from redirect URLs | Add the Vercel domain in **both** dashboards |
| "Sorry, something went wrong" from Google | Origin not in Authorised JavaScript origins | Part 1 step 4 |

Dashboard settings can take up to a minute to propagate — retry after saving.

---

## What the code does (for reference)

- `js/supabase.js → signInWithGoogle()` calls `signInWithOAuth({ provider:
  'google', redirectTo: <current page> })` with `prompt: 'select_account'` so
  the Google account chooser always appears.
- On return, `supabase-js` reads the session out of the URL (`detectSessionInUrl`,
  implicit flow) and `pages/auth.html` redirects to the dashboard.
- If Google/Supabase returns an error in the URL, `surfaceOAuthError()` in
  `js/supabase.js` prints a readable message on the auth page and clears the
  URL.
