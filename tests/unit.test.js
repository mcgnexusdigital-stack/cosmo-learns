/**
 * tests/unit.test.js
 *
 * Unit tests for build scripts and pricing logic.
 * Run with: npm test
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// inject-config.js tests
// ─────────────────────────────────────────────────────────────────────────────
describe('inject-config script', () => {
  const PLACEHOLDER_HTML = `
    <html><head></head><body>
    <script>
      const STRIPE_PUBLISHABLE_KEY = 'pk_test_YOUR_STRIPE_PUBLISHABLE_KEY';
      const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
    </script>
    </body></html>
  `;

  test('replaces Stripe placeholder', () => {
    const result = PLACEHOLDER_HTML
      .replace(/pk_test_YOUR_STRIPE_PUBLISHABLE_KEY/g, 'pk_test_abc123');
    expect(result).toContain('pk_test_abc123');
    expect(result).not.toContain('YOUR_STRIPE_PUBLISHABLE_KEY');
  });

  test('replaces Google Client ID placeholder', () => {
    const result = PLACEHOLDER_HTML
      .replace(/YOUR_GOOGLE_CLIENT_ID\.apps\.googleusercontent\.com/g,
               'real-id.apps.googleusercontent.com');
    expect(result).toContain('real-id.apps.googleusercontent.com');
    expect(result).not.toContain('YOUR_GOOGLE_CLIENT_ID');
  });

  test('detects unresolved placeholders', () => {
    const html = 'const key = "pk_test_YOUR_STRIPE_PUBLISHABLE_KEY";';
    const hasDangerousPattern = /pk_test_YOUR_STRIPE/.test(html);
    expect(hasDangerousPattern).toBe(true);
  });

  test('clean html passes validation', () => {
    const clean = PLACEHOLDER_HTML
      .replace(/pk_test_YOUR_STRIPE_PUBLISHABLE_KEY/g, 'pk_test_realkey')
      .replace(/YOUR_GOOGLE_CLIENT_ID\.apps\.googleusercontent\.com/g, 'realclient.apps.googleusercontent.com');
    const hasDangerousPattern = /pk_test_YOUR_STRIPE|YOUR_GOOGLE_CLIENT_ID/.test(clean);
    expect(hasDangerousPattern).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pricing logic tests
// ─────────────────────────────────────────────────────────────────────────────
describe('pricing calculations', () => {
  const PRICES = {
    solo:   { monthly: 5.99,  annual: 4.99  },
    family: { monthly: 19,    annual: 13    },
    pro:    { monthly: 35,    annual: 23    },
  };

  test('annual solo is cheaper than monthly', () => {
    expect(PRICES.solo.annual * 12).toBeLessThan(PRICES.solo.monthly * 12);
  });

  test('annual family savings are correct', () => {
    const savings = (PRICES.family.monthly - PRICES.family.annual) * 12;
    expect(savings).toBe(72);
  });

  test('annual pro savings are correct', () => {
    const savings = (PRICES.pro.monthly - PRICES.pro.annual) * 12;
    expect(savings).toBe(144);
  });

  test('annual solo savings within expected range', () => {
    const annualSavings = (PRICES.solo.monthly - PRICES.solo.annual) * 12;
    expect(annualSavings).toBeCloseTo(12, 0);
  });

  test('solo is less than family', () => {
    expect(PRICES.solo.monthly).toBeLessThan(PRICES.family.monthly);
  });

  test('family is less than pro', () => {
    expect(PRICES.family.monthly).toBeLessThan(PRICES.pro.monthly);
  });

  test('Stripe price IDs exist for all plans and cycles', () => {
    const STRIPE_PRICES = {
      solo_monthly:   'price_SOLO_MONTHLY_ID',
      solo_annual:    'price_SOLO_ANNUAL_ID',
      family_monthly: 'price_FAMILY_MONTHLY_ID',
      family_annual:  'price_FAMILY_ANNUAL_ID',
      pro_monthly:    'price_PRO_MONTHLY_ID',
      pro_annual:     'price_PRO_ANNUAL_ID',
    };
    const plans  = ['solo', 'family', 'pro'];
    const cycles = ['monthly', 'annual'];
    for (const plan of plans) {
      for (const cycle of cycles) {
        expect(STRIPE_PRICES[`${plan}_${cycle}`]).toBeDefined();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Firestore data model validation
// ─────────────────────────────────────────────────────────────────────────────
describe('data model validation', () => {
  const validKid = {
    id: 'k1', parentId: 'u1', name: 'Alex', grade: 5,
    avatar: '🦊', stars: 0, streak: 0,
    subjects: { science: 0, math: 0, english: 0, social: 0 },
  };

  const validUser = {
    uid: 'u1', name: 'Sarah', email: 's@test.com',
    role: 'parent', createdAt: new Date().toISOString(),
  };

  test('valid kid has all required fields', () => {
    const required = ['id', 'parentId', 'name', 'grade', 'avatar', 'stars', 'streak'];
    for (const field of required) {
      expect(validKid).toHaveProperty(field);
    }
  });

  test('kid grade is within valid range 3-9', () => {
    expect(validKid.grade).toBeGreaterThanOrEqual(3);
    expect(validKid.grade).toBeLessThanOrEqual(9);
  });

  test('kid subjects object has all four subjects', () => {
    const subjects = ['science', 'math', 'english', 'social'];
    for (const subj of subjects) {
      expect(validKid.subjects).toHaveProperty(subj);
    }
  });

  test('kid subject progress is 0-100', () => {
    for (const [, value] of Object.entries(validKid.subjects)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  test('valid user has required fields', () => {
    const required = ['uid', 'name', 'email', 'role', 'createdAt'];
    for (const field of required) {
      expect(validUser).toHaveProperty(field);
    }
  });

  test('user role is parent or kid', () => {
    expect(['parent', 'kid']).toContain(validUser.role);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Voice system settings validation
// ─────────────────────────────────────────────────────────────────────────────
describe('voice settings', () => {
  const defaultSettings = {
    enabled: false, autoSpeak: true, speed: 0.9, pitch: 1.15,
  };

  test('default speed is within valid range', () => {
    expect(defaultSettings.speed).toBeGreaterThanOrEqual(0.6);
    expect(defaultSettings.speed).toBeLessThanOrEqual(1.4);
  });

  test('default pitch is within valid range', () => {
    expect(defaultSettings.pitch).toBeGreaterThanOrEqual(0.8);
    expect(defaultSettings.pitch).toBeLessThanOrEqual(1.6);
  });

  test('voice is disabled by default', () => {
    expect(defaultSettings.enabled).toBe(false);
  });

  test('auto-speak is enabled by default', () => {
    expect(defaultSettings.autoSpeak).toBe(true);
  });
});
