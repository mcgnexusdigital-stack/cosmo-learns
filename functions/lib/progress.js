"use strict";
/**
 * progress.ts — Learning Progress & Session Tracking
 *
 * Functions:
 *  - startSession     : callable — creates a new chat session document
 *  - appendMessage    : callable — appends a message to an active session
 *  - endSession       : callable — closes a session, computes summary
 *  - getKidProgress   : callable — full progress report for parent/kid
 *  - updateStreak     : scheduled — runs daily to update login streaks
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.incrementStreaks = exports.updateStreaks = exports.getKidProgress = exports.endSession = exports.appendMessage = exports.startSession = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const db = admin.firestore();
// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: startSession
// ─────────────────────────────────────────────────────────────────────────────
exports.startSession = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    const validSubjects = ["science", "math", "english", "social"];
    if (!validSubjects.includes(data.subject)) {
        throw new functions.https.HttpsError("invalid-argument", "Invalid subject.");
    }
    const sessionRef = db.collection("sessions").doc();
    await sessionRef.set({
        id: sessionRef.id,
        kidId: context.auth.uid,
        subject: data.subject,
        grade: data.grade,
        messages: [],
        starCount: 0,
        startedAt: firestore_1.FieldValue.serverTimestamp(),
        endedAt: null,
        active: true,
    });
    // Update lastActive on user doc
    await db.doc(`users/${context.auth.uid}`).update({
        lastActive: firestore_1.FieldValue.serverTimestamp(),
    });
    return { sessionId: sessionRef.id };
});
// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: appendMessage
// Appends a single message to the session (keeps server as source of truth).
// Limited to 100 messages per session to prevent runaway costs.
// ─────────────────────────────────────────────────────────────────────────────
exports.appendMessage = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    const sessionSnap = await db.doc(`sessions/${data.sessionId}`).get();
    if (!sessionSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Session not found.");
    }
    const session = sessionSnap.data();
    if (session.kidId !== context.auth.uid) {
        throw new functions.https.HttpsError("permission-denied", "Not your session.");
    }
    if (!session.active) {
        throw new functions.https.HttpsError("failed-precondition", "Session already ended.");
    }
    const messages = (_a = session.messages) !== null && _a !== void 0 ? _a : [];
    if (messages.length >= 100) {
        throw new functions.https.HttpsError("resource-exhausted", "Session message limit reached. Start a new session.");
    }
    // Sanitize content length
    const content = String(data.content).slice(0, 4000);
    await db.doc(`sessions/${data.sessionId}`).update({
        messages: firestore_1.FieldValue.arrayUnion({
            role: data.role,
            content,
            timestamp: new Date().toISOString(),
        }),
    });
    return { success: true };
});
// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: endSession
// Closes the session and increments subject progress slightly.
// ─────────────────────────────────────────────────────────────────────────────
exports.endSession = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    const sessionSnap = await db.doc(`sessions/${data.sessionId}`).get();
    if (!sessionSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Session not found.");
    }
    const session = sessionSnap.data();
    if (session.kidId !== context.auth.uid) {
        throw new functions.https.HttpsError("permission-denied", "Not your session.");
    }
    const stars = Math.min(Math.max(0, (_a = data.starsEarned) !== null && _a !== void 0 ? _a : 0), 20);
    const batch = db.batch();
    // Mark session complete
    batch.update(db.doc(`sessions/${data.sessionId}`), {
        active: false,
        endedAt: firestore_1.FieldValue.serverTimestamp(),
        starCount: stars,
    });
    // Update kid's stars and subject progress
    const subject = session.subject;
    batch.update(db.doc(`users/${context.auth.uid}`), {
        stars: firestore_1.FieldValue.increment(stars),
        [`subjects.${subject}`]: firestore_1.FieldValue.increment(Math.min(stars, 5)),
        lastActive: firestore_1.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { success: true };
});
// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: getKidProgress
// Returns a full progress report: subject scores, quiz history summary,
// achievements, recent sessions. Accessible by kid or their parent.
// ─────────────────────────────────────────────────────────────────────────────
exports.getKidProgress = functions.https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    const { kidId } = data;
    const uid = context.auth.uid;
    // Verify access (self or parent)
    if (uid !== kidId) {
        const kidSnap = await db.doc(`kids/${kidId}`).get();
        const userSnap = await db.doc(`users/${uid}`).get();
        const isParent = ((_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.role) === "parent" && ((_b = kidSnap.data()) === null || _b === void 0 ? void 0 : _b.parentId) === uid;
        if (!isParent) {
            throw new functions.https.HttpsError("permission-denied", "Access denied.");
        }
    }
    // Fetch in parallel
    const [kidSnap, quizSnap, achievSnap, sessionSnap] = await Promise.all([
        db.doc(`kids/${kidId}`).get(),
        db.collection("quizResults")
            .where("kidId", "==", kidId)
            .orderBy("completedAt", "desc")
            .limit(10)
            .get(),
        db.collection(`achievements/${kidId}/earned`).get(),
        db.collection("sessions")
            .where("kidId", "==", kidId)
            .orderBy("startedAt", "desc")
            .limit(5)
            .get(),
    ]);
    const kid = Object.assign({ id: kidId }, kidSnap.data());
    const quizHistory = quizSnap.docs.map((d) => {
        var _a;
        return ({
            id: d.id,
            subject: d.data().subject,
            score: d.data().score,
            total: d.data().total,
            percentage: d.data().percentage,
            completedAt: (_a = d.data().completedAt) === null || _a === void 0 ? void 0 : _a.toDate().toISOString(),
        });
    });
    // Compute per-subject quiz averages
    const subjectAverages = {};
    for (const q of quizHistory) {
        if (!subjectAverages[q.subject])
            subjectAverages[q.subject] = { count: 0, avgScore: 0 };
        subjectAverages[q.subject].count++;
        subjectAverages[q.subject].avgScore += q.percentage;
    }
    for (const key of Object.keys(subjectAverages)) {
        subjectAverages[key].avgScore = Math.round(subjectAverages[key].avgScore / subjectAverages[key].count);
    }
    const achievements = achievSnap.docs.map((d) => {
        var _a;
        return (Object.assign(Object.assign({ id: d.id }, d.data()), { earnedAt: (_a = d.data().earnedAt) === null || _a === void 0 ? void 0 : _a.toDate().toISOString() }));
    });
    const recentSessions = sessionSnap.docs.map((d) => {
        var _a, _b;
        return ({
            id: d.id,
            subject: d.data().subject,
            grade: d.data().grade,
            starCount: d.data().starCount,
            messageCount: ((_a = d.data().messages) !== null && _a !== void 0 ? _a : []).length,
            startedAt: (_b = d.data().startedAt) === null || _b === void 0 ? void 0 : _b.toDate().toISOString(),
        });
    });
    return { kid, quizHistory, subjectAverages, achievements, recentSessions };
});
// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: updateStreaks
// Runs every day at midnight UTC. Resets streak to 0 if no activity yesterday.
// ─────────────────────────────────────────────────────────────────────────────
exports.updateStreaks = functions.pubsub
    .schedule("0 0 * * *")
    .timeZone("UTC")
    .onRun(async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Find users/kids whose lastActive is before yesterday
    const staleSnap = await db.collection("kids")
        .where("lastActive", "<", yesterday)
        .get();
    if (staleSnap.empty) {
        functions.logger.info("✅ No streaks to reset today.");
        return;
    }
    const batch = db.batch();
    staleSnap.forEach((doc) => {
        batch.update(doc.ref, { streak: 0 });
    });
    await batch.commit();
    functions.logger.info(`🔄 Reset streaks for ${staleSnap.size} inactive kids.`);
});
// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: incrementStreaks
// Runs at 11:59 PM UTC to increment streak for kids active today.
// ─────────────────────────────────────────────────────────────────────────────
exports.incrementStreaks = functions.pubsub
    .schedule("59 23 * * *")
    .timeZone("UTC")
    .onRun(async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const activeSnap = await db.collection("kids")
        .where("lastActive", ">=", startOfToday)
        .get();
    if (activeSnap.empty)
        return;
    const batch = db.batch();
    activeSnap.forEach((doc) => {
        batch.update(doc.ref, { streak: firestore_1.FieldValue.increment(1) });
    });
    await batch.commit();
    functions.logger.info(`🔥 Incremented streaks for ${activeSnap.size} active kids.`);
});
//# sourceMappingURL=progress.js.map