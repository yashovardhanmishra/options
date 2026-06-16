# Google (Gmail) sign-in with Supabase

The app can require a Google sign-in before anyone sees the data. It's **off by
default** — set the keys below and it turns on (login screen + backend token check).
Leave them unset and the app runs with no login (local dev).

## What you set
| Where | Variable | From |
|---|---|---|
| frontend (build) | `VITE_SUPABASE_URL` | Supabase → Settings → API → **Project URL** |
| frontend (build) | `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → **anon public key** |
| backend (runtime) | `SUPABASE_JWT_SECRET` | Supabase → Settings → API → **JWT Secret** |
| backend (optional) | `ALLOWED_EMAIL_DOMAINS` | e.g. `gmail.com` to allow **only** @gmail.com |

## One-time setup

### 1. Create a Supabase project
[supabase.com](https://supabase.com) → New project. Wait for it to finish.

### 2. Make a Google OAuth client
1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials**.
2. **Create credentials → OAuth client ID → Web application**.
3. Under **Authorized redirect URIs**, paste your Supabase callback (Supabase shows it on
   the Google provider page): `https://<your-project>.supabase.co/auth/v1/callback`.
4. Create → copy the **Client ID** and **Client secret**.

### 3. Enable Google in Supabase
Supabase → **Authentication → Providers → Google** → enable → paste the Client ID + Secret → save.

### 4. Set the app URLs in Supabase
Supabase → **Authentication → URL Configuration**:
- **Site URL**: your app's address — `http://YOUR_SERVER_IP` (or `https://your-domain`).
- **Redirect URLs**: add the same, plus `http://localhost:5173` if you want to test locally.
(Without this, Google login won't return to your app.)

### 5. Turn it on
On the VPS, create a file named **`.env`** next to `docker-compose.yml`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_JWT_SECRET=your-jwt-secret
# optional — restrict to plain Gmail accounts only:
# ALLOWED_EMAIL_DOMAINS=gmail.com
```
Then rebuild:
```bash
docker compose up -d --build
```
Now the app shows **"Continue with Google"** and the API rejects requests without a valid token.

## Local dev
Create `frontend/.env` with the two `VITE_*` values (see `frontend/.env.example`) and run
`npm run dev`. Add `http://localhost:5173` to Supabase Redirect URLs first.

## Who can get in?
- Google is the **only** sign-in method, so it's Gmail/Google accounts only.
- Want to allow **only** `@gmail.com` (not Google Workspace domains)? Set
  `ALLOWED_EMAIL_DOMAINS=gmail.com`.
- Want a hand-picked allow-list? Use `ALLOWED_EMAIL_DOMAINS`, or manage users in Supabase.
