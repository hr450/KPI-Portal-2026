# Rankviz KPI Portal

Proper web portal - **Google Apps Script / Google Sheet ki zaroorat nahi**.

| Part | Technology |
|---|---|
| Frontend | `public/index.html` (aapka dashboard design, same UI) |
| Backend | Vercel Serverless Functions (`api/`, Node 20+) |
| Database | PostgreSQL (Neon via Vercel Marketplace recommended) |
| Login | Google Sign-In, sirf `@rankviz.com`; server-side verify + secure HttpOnly cookie (12 ghante) |

Permissions server par check hoti hain (browser par nahi): HR sab kuch, CEO poori company dekh sakta hai, Scorer apni team (+ HR ne jo departments diye) dekh/score kar sakta hai, Employee sirf apna dashboard.

## Setup (ek baar)

### 1. Database
Vercel project > **Storage > Create Database > Neon (Postgres)** > project se connect karein. `DATABASE_URL` khud env vars me add ho jata hai.
Phir Neon **SQL Editor** me `db/schema.sql` ka poora content paste karke **Run** karein.
(Ya apne computer se: `DATABASE_URL=... npm run db:setup`)

### 2. Google login (OAuth Client ID)
1. console.cloud.google.com > project > **APIs & Services > OAuth consent screen** > User type **Internal** (Workspace) > Create.
2. **Credentials > Create credentials > OAuth client ID > Web application**.
3. **Authorized JavaScript origins**: apna Vercel URL `https://your-app.vercel.app` (aur custom domain ho to wo bhi, aur testing ke liye `http://localhost:3000`). Redirect URI ki zaroorat nahi.
4. Client ID copy karein.

### 3. Vercel Environment Variables
| Name | Value |
|---|---|
| `DATABASE_URL` | Neon ne khud add kiya hoga |
| `GOOGLE_CLIENT_ID` | step 2 wali Client ID |
| `ALLOWED_DOMAIN` | `rankviz.com` |
| `SESSION_SECRET` | random lamba text (`openssl rand -hex 32`) |
| `BOOTSTRAP_HR_EMAIL` | `hr@rankviz.com` (pehla HR account) |
| `BOOTSTRAP_HR_NAME` | `HR Manager` |

### 4. Deploy
Is folder ko GitHub repo me push karein > vercel.com > **Add New > Project** > repo import > Framework **Other** > Deploy.
(CLI: `npm i -g vercel && vercel --prod`)
Deploy ke baad final URL ko Google OAuth ke *Authorized JavaScript origins* me add karna na bhulein.

### 5. Pehla login
`BOOTSTRAP_HR_EMAIL` wale account se sign in karein: wo khud HR ban jata hai (sirf tab jab employees table khali ho).
Phir **Admin > Employees** se baqi staff add karein (Role: Staff / CEO / HR), "Scored by" set karein, aur **Department Access** / **KPIs & Sub-metrics** configure karein.
Jo email employees list me nahi, wo login nahi kar sakta.

## Local run
```
npm install
cp .env.example .env      # values bharein
npx vercel dev            # http://localhost:3000
```

## Backup / Restore
Admin > Backup & Restore: poora data ek `.json` file me download; restore par pehle database me khud ek safety copy (`backups` table, last 10) ban jati hai. Neon ka point-in-time restore bhi available hai. Har badlav `audit_log` me likha jata hai.

## Purana data (Google Sheet) lana
Is portal ka database format alag hai, isliye purana data import ke liye ek chhota converter chahiye. Sheet ka export (ya sirf har tab ki header row) bhej dein to main exact importer bana deta hoon.

## Files
```
public/index.html   dashboard UI          public/api.js   login + server calls
api/rpc.js          saari app calls       api/auth/*      google login, logout, config
lib/service.js      business logic + permissions
lib/auth.js, lib/db.js     session, database
db/schema.sql       tables                scripts/setup-db.mjs
```
