/**
 * tests/firestore-rules.test.js
 *
 * Tests Firestore security rules using the Firebase emulator.
 * Run with: firebase emulators:exec --only firestore "npm run test:rules"
 *
 * Covers:
 *  - Users can only read/write their own documents
 *  - Kids can only be created by parents
 *  - Quiz results are immutable after creation
 *  - Achievements are write-protected (functions only)
 *  - Sessions belong to the creating user
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');

const PROJECT_ID = 'demo-cosmo';
let testEnv;

// ─────────────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const aliceAuth   = { uid: 'alice',   email: 'alice@test.com'   };
const bobAuth     = { uid: 'bob',     email: 'bob@test.com'     };
const unauthed    = null;

const aliceDb  = (env) => env.authenticatedContext('alice', aliceAuth).firestore();
const bobDb    = (env) => env.authenticatedContext('bob', bobAuth).firestore();
const anonDb   = (env) => env.unauthenticatedContext().firestore();

// Seed helper — bypass rules for test setup
async function seed(env, path, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// USERS COLLECTION
// ─────────────────────────────────────────────────────────────────────────────
describe('users/{uid}', () => {
  test('user can read their own document', async () => {
    await seed(testEnv, 'users/alice', { name: 'Alice', role: 'parent' });
    await assertSucceeds(aliceDb(testEnv).doc('users/alice').get());
  });

  test('user cannot read another user\'s document', async () => {
    await seed(testEnv, 'users/bob', { name: 'Bob', role: 'parent' });
    await assertFails(aliceDb(testEnv).doc('users/bob').get());
  });

  test('unauthenticated user cannot read any user document', async () => {
    await seed(testEnv, 'users/alice', { name: 'Alice', role: 'parent' });
    await assertFails(anonDb(testEnv).doc('users/alice').get());
  });

  test('user can create their own document with required fields', async () => {
    await assertSucceeds(aliceDb(testEnv).doc('users/alice').set({
      name: 'Alice', email: 'alice@test.com', role: 'parent', createdAt: new Date()
    }));
  });

  test('user cannot change their role', async () => {
    await seed(testEnv, 'users/alice', { name: 'Alice', role: 'parent', email: 'a@t.com', createdAt: new Date() });
    await assertFails(aliceDb(testEnv).doc('users/alice').update({ role: 'admin' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KIDS COLLECTION
// ─────────────────────────────────────────────────────────────────────────────
describe('kids/{kidId}', () => {
  test('parent can read their own kid\'s document', async () => {
    await seed(testEnv, 'users/alice', { role: 'parent' });
    await seed(testEnv, 'kids/kid1',  { parentId: 'alice', name: 'TestKid', grade: 5 });
    await assertSucceeds(aliceDb(testEnv).doc('kids/kid1').get());
  });

  test('parent cannot read another parent\'s kid', async () => {
    await seed(testEnv, 'kids/kid1', { parentId: 'bob', name: 'BobKid', grade: 5 });
    await assertFails(aliceDb(testEnv).doc('kids/kid1').get());
  });

  test('parent can create a kid with their parentId', async () => {
    await seed(testEnv, 'users/alice', { role: 'parent' });
    await assertSucceeds(aliceDb(testEnv).doc('kids/newkid').set({
      parentId: 'alice', name: 'NewKid', grade: 5, avatar: '🦊',
      stars: 0, streak: 0
    }));
  });

  test('parent cannot create kid with someone else\'s parentId', async () => {
    await seed(testEnv, 'users/alice', { role: 'parent' });
    await assertFails(aliceDb(testEnv).doc('kids/newkid').set({
      parentId: 'bob', name: 'StolenKid', grade: 5, avatar: '🦊',
      stars: 0, streak: 0
    }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSIONS COLLECTION
// ─────────────────────────────────────────────────────────────────────────────
describe('sessions/{sessionId}', () => {
  test('user can create a session for themselves', async () => {
    await assertSucceeds(aliceDb(testEnv).collection('sessions').add({
      kidId: 'alice', subject: 'science', grade: 5, startedAt: new Date()
    }));
  });

  test('user cannot create a session for another user', async () => {
    await assertFails(aliceDb(testEnv).collection('sessions').add({
      kidId: 'bob', subject: 'math', grade: 6, startedAt: new Date()
    }));
  });

  test('session owner can read their session', async () => {
    await seed(testEnv, 'sessions/sess1', { kidId: 'alice', subject: 'science' });
    await assertSucceeds(aliceDb(testEnv).doc('sessions/sess1').get());
  });

  test('non-owner cannot read a session', async () => {
    await seed(testEnv, 'sessions/sess1', { kidId: 'alice', subject: 'science' });
    await assertFails(bobDb(testEnv).doc('sessions/sess1').get());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ RESULTS — IMMUTABLE
// ─────────────────────────────────────────────────────────────────────────────
describe('quizResults/{resultId}', () => {
  test('user can create their own quiz result', async () => {
    await assertSucceeds(aliceDb(testEnv).collection('quizResults').add({
      kidId: 'alice', subject: 'math', grade: 5, score: 8, total: 10, completedAt: new Date()
    }));
  });

  test('quiz results cannot be updated (immutable)', async () => {
    await seed(testEnv, 'quizResults/qr1', { kidId: 'alice', score: 8, total: 10 });
    await assertFails(aliceDb(testEnv).doc('quizResults/qr1').update({ score: 10 }));
  });

  test('quiz results cannot be deleted', async () => {
    await seed(testEnv, 'quizResults/qr1', { kidId: 'alice', score: 8 });
    await assertFails(aliceDb(testEnv).doc('quizResults/qr1').delete());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ACHIEVEMENTS — WRITE-PROTECTED (Cloud Functions only)
// ─────────────────────────────────────────────────────────────────────────────
describe('achievements/{kidId}/earned/{achievementId}', () => {
  test('user can read their own achievements', async () => {
    await seed(testEnv, 'achievements/alice/earned/ach1', { name: 'First Quiz', icon: '🎓' });
    await assertSucceeds(aliceDb(testEnv).doc('achievements/alice/earned/ach1').get());
  });

  test('user cannot write achievements directly (Cloud Functions only)', async () => {
    await assertFails(aliceDb(testEnv).doc('achievements/alice/earned/fake').set({
      name: 'Hacked Badge', icon: '💀'
    }));
  });
});
