#!/usr/bin/env node
/**
 * scripts/inject-config.js
 *
 * Reads hosting/index.html and replaces config placeholders with
 * real environment-specific values at CI build time.
 *
 * Usage:
 *   node scripts/inject-config.js --env staging
 *   node scripts/inject-config.js --env production
 *
 * Required environment variables (set as GitHub Secrets):
 *   STRIPE_PUBLISHABLE_KEY   pk_test_... or pk_live_...
 *   GOOGLE_CLIENT_ID         xxxx.apps.googleusercontent.com
 *   FIREBASE_PROJECT_ID      cosmo-learns-staging or cosmo-learns-prod
 */

const fs   = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
const env = envFlag !== -1 ? args[envFlag + 1] : 'staging';

console.log(`\n🔧 Injecting ${env} config into hosting/index.html\n`);

// ── Read the HTML file ──────────────────────────────────────────────────────
const htmlPath = path.join(process.cwd(), 'hosting', 'index.html');
if (!fs.existsSync(htmlPath)) {
  // Also try root for single-file projects
  const rootPath = path.join(process.cwd(), 'cosmo-learns.html');
  if (fs.existsSync(rootPath)) {
    fs.mkdirSync(path.join(process.cwd(), 'hosting'), { recursive: true });
    fs.copyFileSync(rootPath, htmlPath);
    console.log('📋 Copied cosmo-learns.html → hosting/index.html');
  } else {
    console.error('❌ Could not find hosting/index.html or cosmo-learns.html');
    process.exit(1);
  }
}

let html = fs.readFileSync(htmlPath, 'utf8');
const originalSize = html.length;

// ── Define replacements ──────────────────────────────────────────────────────
const replacements = [
  {
    // Stripe publishable key
    pattern: /pk_test_YOUR_STRIPE_PUBLISHABLE_KEY|pk_live_YOUR_STRIPE_PUBLISHABLE_KEY|pk_(test|live)_[A-Za-z0-9]{10,}/g,
    value:   process.env.STRIPE_PUBLISHABLE_KEY,
    name:    'Stripe Publishable Key',
    required: true,
  },
  {
    // Google OAuth Client ID
    pattern: /YOUR_GOOGLE_CLIENT_ID\.apps\.googleusercontent\.com/g,
    value:   process.env.GOOGLE_CLIENT_ID,
    name:    'Google Client ID',
    required: false,            // optional — Google Sign-In will fall back to demo
  },
  {
    // Firebase project ID in config objects
    pattern: /YOUR_PROJECT_ID|cosmo-learns-placeholder/g,
    value:   process.env.FIREBASE_PROJECT_ID,
    name:    'Firebase Project ID',
    required: false,
  },
  {
    // Firebase auth domain
    pattern: /YOUR_PROJECT\.firebaseapp\.com/g,
    value:   `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
    name:    'Firebase Auth Domain',
    required: false,
  },
  {
    // Firebase storage bucket
    pattern: /YOUR_PROJECT\.appspot\.com/g,
    value:   `${process.env.FIREBASE_PROJECT_ID}.appspot.com`,
    name:    'Firebase Storage Bucket',
    required: false,
  },
];

// ── Apply replacements ───────────────────────────────────────────────────────
let replacedCount = 0;
for (const { pattern, value, name, required } of replacements) {
  if (!value) {
    if (required) {
      console.error(`❌ Required env var missing for: ${name}`);
      process.exit(1);
    } else {
      console.warn(`⚠️  Skipping ${name} (env var not set)`);
      continue;
    }
  }

  const before = html.length;
  html = html.replace(pattern, value);
  const matches = (before !== html.length) || html.includes(value);
  if (matches) {
    console.log(`✅ ${name} injected`);
    replacedCount++;
  } else {
    console.log(`ℹ️  ${name} — placeholder not found (may already be set)`);
  }
}

// ── Add environment meta tag ─────────────────────────────────────────────────
html = html.replace(
  '</head>',
  `  <meta name="cosmo-env" content="${env}">\n  <meta name="cosmo-build" content="${new Date().toISOString()}">\n</head>`
);

// ── Write back ───────────────────────────────────────────────────────────────
fs.writeFileSync(htmlPath, html, 'utf8');
console.log(`\n📄 Written: hosting/index.html`);
console.log(`   Original: ${originalSize} bytes`);
console.log(`   Modified: ${html.length} bytes`);
console.log(`   Replacements applied: ${replacedCount}\n`);

// ── Validate no placeholder keys remain ──────────────────────────────────────
const dangerousPatterns = [
  /pk_test_YOUR_STRIPE/,
  /YOUR_GOOGLE_CLIENT_ID/,
  /YOUR_API_KEY.*(?:sk|pk)_/,
];

for (const pattern of dangerousPatterns) {
  if (pattern.test(html)) {
    console.error(`❌ Placeholder still present matching: ${pattern}`);
    console.error('   This would expose a dev placeholder in production!');
    if (env === 'production') process.exit(1);
  }
}

console.log(`✅ Config injection complete for ${env} environment\n`);
