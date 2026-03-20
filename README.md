# 🚀 Cosmo Learns — CI/CD Setup Guide

Complete CI/CD pipeline from GitHub → Firebase Hosting + Cloud Functions.

---

## 📐 Pipeline Overview

```
Pull Request opened
       │
       ├─► 🔍 CI (lint + tests + Lighthouse)
       └─► 🔭 Preview deploy → unique URL posted as PR comment

PR merged to main
       │
       ├─► 🔍 CI (runs again)
       └─► 🚧 Staging deploy → staging.cosmolearns.ca + Slack alert

git tag v1.2.0
       │
       └─► 🚀 Production deploy (requires manual approval in GitHub)
                   │
                   ├─► Smoke tests
                   ├─► GitHub Release created
                   └─► Slack alert + changelog
```

---

## ✅ One-Time Setup (do this once)

### Step 1 — Create your GitHub repo

```bash
git clone https://github.com/YOUR_USERNAME/cosmo-learns.git
cd cosmo-learns

# Copy project files
cp /path/to/cosmo-learns.html hosting/index.html
cp -r /path/to/cosmo-backend/functions ./
cp /path/to/cosmo-backend/firestore.rules ./
cp /path/to/cosmo-backend/firestore.indexes.json ./
cp /path/to/cosmo-backend/storage.rules ./
cp /path/to/cosmo-backend/firebase.json ./

# Copy CI/CD files (these files)
cp -r .github/ cosmo-learns/
cp package.json vitest.config.ts .lighthouse-budget.json cosmo-learns/
cp -r scripts/ tests/ cosmo-learns/

git add . && git commit -m "ci: initial CI/CD setup"
git push origin main
```

### Step 2 — Create Firebase projects

```bash
npm install -g firebase-tools
firebase login

firebase projects:create cosmo-learns-prod    --display-name "Cosmo Learns Production"
firebase projects:create cosmo-learns-staging --display-name "Cosmo Learns Staging"

# Enable required services in Firebase Console for BOTH projects:
# Authentication → Email/Password + Google
# Firestore → production mode
# Hosting, Storage, Functions
```

### Step 3 — Get Firebase Service Account keys

For each project:
1. Firebase Console → Project Settings → Service accounts
2. Click "Generate new private key"
3. Download the JSON file

### Step 4 — Add ALL GitHub Secrets

**GitHub repo → Settings → Secrets and variables → Actions**

| Secret | Value | Notes |
|--------|-------|-------|
| `FIREBASE_TOKEN` | `firebase login:ci` output | Run in terminal |
| `FIREBASE_PROJECT_PROD` | `cosmo-learns-prod` | |
| `FIREBASE_PROJECT_STAGING` | `cosmo-learns-staging` | |
| `FIREBASE_SERVICE_ACCOUNT_PROD` | Contents of prod service account JSON | Paste the entire JSON |
| `FIREBASE_SERVICE_ACCOUNT_STAGING` | Contents of staging service account JSON | Paste the entire JSON |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | console.anthropic.com |
| `STRIPE_PUBLISHABLE_KEY_PROD` | `pk_live_...` | Stripe Dashboard |
| `STRIPE_PUBLISHABLE_KEY_STAGING` | `pk_test_...` | Stripe Dashboard |
| `STRIPE_SECRET_KEY_PROD` | `sk_live_...` | Stripe Dashboard (for backend) |
| `STRIPE_SECRET_KEY_STAGING` | `sk_test_...` | Stripe Dashboard |
| `GOOGLE_CLIENT_ID` | `xxxx.apps.googleusercontent.com` | Google Cloud Console |
| `SLACK_WEBHOOK_URL` | `https://hooks.slack.com/...` | Optional — for alerts |

### Step 5 — Configure GitHub Environments

**GitHub repo → Settings → Environments**

**`staging`** — no protection rules

**`production`**
- ✅ Required reviewers: add yourself
- ✅ Deployment branches: `main` only

### Step 6 — Enable branch protection

**GitHub repo → Settings → Branches → Add rule → `main`**
- ✅ Require pull request reviews before merging
- ✅ Require status checks: `lint`, `test`, `lighthouse`
- ✅ Include administrators

### Step 7 — Set up Dependabot

Edit `.github/dependabot.yml` and replace `your-github-username` with yours.

---

## 🔄 Daily Workflow

```bash
# Start a feature
git checkout -b feature/add-art-subject
# ... code ...
git push origin feature/add-art-subject
# → Opens PR → CI runs → Preview URL posted

# Merge PR → auto-deploys to staging
# Verify at staging.cosmolearns.ca

# Release to production
git tag v1.1.0 -m "v1.1.0: Add art subject"
git push origin v1.1.0
# → Triggers production deploy → requires your approval in GitHub
```

## 🚨 Emergency Rollback

```
GitHub → Actions → "Emergency Rollback" → Run workflow
Select: environment=production, target=previous
```

Or via CLI:
```bash
firebase hosting:rollback --project cosmo-learns-prod
```

---

## 📁 File Structure

```
cosmo-learns/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 # Lint, test, Lighthouse on every push/PR
│   │   ├── preview.yml            # Preview URL for every PR
│   │   ├── deploy-staging.yml     # Auto-deploy to staging on merge to main
│   │   ├── deploy-production.yml  # Production deploy on tag push
│   │   ├── rollback.yml           # Emergency rollback
│   │   └── maintenance.yml        # Weekly deps + monthly audits
│   ├── dependabot.yml             # Auto dependency updates
│   └── PULL_REQUEST_TEMPLATE.md   # PR checklist
├── hosting/
│   └── index.html                 # Your cosmo-learns.html goes here
├── functions/                     # Firebase Cloud Functions
├── scripts/
│   └── inject-config.js           # Injects API keys at build time
├── tests/
│   ├── unit.test.js               # Vitest unit tests
│   └── firestore-rules.test.js    # Firestore security rules tests
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── firebase.json
├── package.json
├── vitest.config.ts
└── .lighthouse-budget.json        # Performance thresholds
```
