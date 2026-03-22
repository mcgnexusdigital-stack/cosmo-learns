"use strict";
/**
 * notifications.ts — Parent Alerts & Weekly Reports
 *
 * Functions:
 *  - onQuizCompleted      : Firestore trigger — notifies parent when kid finishes quiz
 *  - onAchievementEarned  : Firestore trigger — notifies parent of new badge
 *  - sendWeeklyReport     : scheduled — emails parent a weekly summary every Monday
 *  - getNotifications     : callable — returns parent's unread notifications
 *  - markNotificationsRead: callable — marks notifications as read
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
exports.markNotificationsRead = exports.getNotifications = exports.checkInactivity = exports.sendWeeklyReport = exports.onStreakMilestone = exports.onAchievementEarned = exports.onQuizCompleted = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const db = admin.firestore();
// ─────────────────────────────────────────────────────────────────────────────
// Helper: Push notification to parent's notification feed
// ─────────────────────────────────────────────────────────────────────────────
async function pushNotification(parentId, notification) {
    const ref = db.collection(`notifications/${parentId}/items`).doc();
    await ref.set(Object.assign(Object.assign({ id: ref.id }, notification), { read: false, createdAt: firestore_1.FieldValue.serverTimestamp() }));
}
// ─────────────────────────────────────────────────────────────────────────────
// Helper: Get parent ID for a given kid
// ─────────────────────────────────────────────────────────────────────────────
async function getParentId(kidId) {
    var _a, _b, _c, _d;
    // Check kids collection
    const kidSnap = await db.doc(`kids/${kidId}`).get();
    if (kidSnap.exists)
        return (_b = (_a = kidSnap.data()) === null || _a === void 0 ? void 0 : _a.parentId) !== null && _b !== void 0 ? _b : null;
    // Fallback: check users collection (for kid accounts linked to parent)
    const userSnap = await db.doc(`users/${kidId}`).get();
    return (_d = (_c = userSnap.data()) === null || _c === void 0 ? void 0 : _c.parentId) !== null && _d !== void 0 ? _d : null;
}
// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: Quiz result created → notify parent
// ─────────────────────────────────────────────────────────────────────────────
exports.onQuizCompleted = functions.firestore
    .document("quizResults/{resultId}")
    .onCreate(async (snap) => {
    var _a, _b, _c;
    const result = snap.data();
    const { kidId, subject, score, total, percentage } = result;
    const parentId = await getParentId(kidId);
    if (!parentId)
        return;
    const kidSnap = await db.doc(`kids/${kidId}`).get();
    const kidName = (_b = (_a = kidSnap.data()) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "Your child";
    const subjectEmojis = {
        science: "🔬", math: "🔢", english: "📖", social: "🌍"
    };
    const emoji = (_c = subjectEmojis[subject]) !== null && _c !== void 0 ? _c : "📚";
    const subjectLabel = subject.charAt(0).toUpperCase() + subject.slice(1);
    const praise = percentage >= 90 ? "Amazing work!" : percentage >= 70 ? "Good effort!" : "Keep practicing!";
    await pushNotification(parentId, {
        type: "quiz_completed",
        title: `${emoji} ${kidName} completed a quiz!`,
        body: `${kidName} scored ${score}/${total} (${percentage}%) on ${subjectLabel}. ${praise}`,
        kidId,
        kidName,
        read: false,
        data: { resultId: snap.id, subject, score, total, percentage },
    });
    // If score is poor (<60%), create an alert
    if (percentage < 60) {
        await pushNotification(parentId, {
            type: "quiz_completed",
            title: `📉 ${kidName} may need extra help`,
            body: `${kidName} scored ${percentage}% on the ${subjectLabel} quiz. Consider reviewing this subject together.`,
            kidId,
            kidName,
            read: false,
            data: { type: "low_score", subject, percentage },
        });
    }
    functions.logger.info(`📬 Quiz notification sent to parent ${parentId} for kid ${kidId}`);
});
// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: Achievement earned → notify parent
// ─────────────────────────────────────────────────────────────────────────────
exports.onAchievementEarned = functions.firestore
    .document("achievements/{kidId}/earned/{achievementId}")
    .onCreate(async (snap, context) => {
    var _a, _b;
    const { kidId } = context.params;
    const achievement = snap.data();
    const parentId = await getParentId(kidId);
    if (!parentId)
        return;
    const kidSnap = await db.doc(`kids/${kidId}`).get();
    const kidName = (_b = (_a = kidSnap.data()) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "Your child";
    await pushNotification(parentId, {
        type: "achievement_earned",
        title: `${achievement.icon} ${kidName} earned a badge!`,
        body: `${kidName} just unlocked "${achievement.name}" — ${achievement.desc}! 🎉`,
        kidId,
        kidName,
        read: false,
        data: Object.assign({ achievementId: snap.id }, achievement),
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: Kid streak milestone (5, 10, 30 days)
// ─────────────────────────────────────────────────────────────────────────────
exports.onStreakMilestone = functions.firestore
    .document("kids/{kidId}")
    .onUpdate(async (change, context) => {
    var _a, _b, _c;
    const before = change.before.data();
    const after = change.after.data();
    const { kidId } = context.params;
    const milestones = [5, 10, 14, 30, 60, 100];
    const prevStreak = (_a = before.streak) !== null && _a !== void 0 ? _a : 0;
    const newStreak = (_b = after.streak) !== null && _b !== void 0 ? _b : 0;
    const hitMilestone = milestones.find((m) => prevStreak < m && newStreak >= m);
    if (!hitMilestone)
        return;
    const parentId = await getParentId(kidId);
    if (!parentId)
        return;
    const kidName = (_c = after.name) !== null && _c !== void 0 ? _c : "Your child";
    await pushNotification(parentId, {
        type: "streak_milestone",
        title: `🔥 ${kidName} is on a ${hitMilestone}-day streak!`,
        body: `${kidName} has been learning every day for ${hitMilestone} days in a row. That's amazing dedication! 🚀`,
        kidId,
        kidName,
        read: false,
        data: { streak: hitMilestone },
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: Weekly Report — every Monday at 8am UTC
// ─────────────────────────────────────────────────────────────────────────────
exports.sendWeeklyReport = functions.pubsub
    .schedule("0 8 * * 1")
    .timeZone("UTC")
    .onRun(async () => {
    var _a, _b, _c;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    // Get all parents
    const parentsSnap = await db.collection("parents").get();
    functions.logger.info(`📧 Sending weekly reports to ${parentsSnap.size} parents`);
    for (const parentDoc of parentsSnap.docs) {
        const parentId = parentDoc.id;
        const kidIds = (_a = parentDoc.data().kidIds) !== null && _a !== void 0 ? _a : [];
        if (kidIds.length === 0)
            continue;
        // Gather stats for each kid
        const kidSummaries = [];
        for (const kidId of kidIds) {
            const kidSnap = await db.doc(`kids/${kidId}`).get();
            if (!kidSnap.exists)
                continue;
            const kid = kidSnap.data();
            const quizSnap = await db.collection("quizResults")
                .where("kidId", "==", kidId)
                .where("completedAt", ">=", oneWeekAgo)
                .get();
            const quizCount = quizSnap.size;
            const avgScore = quizCount > 0
                ? Math.round(quizSnap.docs.reduce((s, d) => { var _a; return s + ((_a = d.data().percentage) !== null && _a !== void 0 ? _a : 0); }, 0) / quizCount)
                : null;
            const summary = avgScore !== null
                ? `${kid.name}: ${quizCount} quiz${quizCount !== 1 ? "zes" : ""}, avg ${avgScore}%, ${(_b = kid.streak) !== null && _b !== void 0 ? _b : 0}-day streak 🔥`
                : `${kid.name}: ${(_c = kid.streak) !== null && _c !== void 0 ? _c : 0}-day streak 🔥 (no quizzes this week)`;
            kidSummaries.push(summary);
        }
        if (kidSummaries.length === 0)
            continue;
        await pushNotification(parentId, {
            type: "weekly_report",
            title: "📊 Weekly Learning Report",
            body: `Here's how your kids did this week:\n${kidSummaries.join("\n")}`,
            read: false,
            data: { week: oneWeekAgo.toISOString() },
        });
    }
    functions.logger.info("✅ Weekly reports complete.");
});
// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED: Inactivity check — runs every day at 9am UTC
// Alerts parent if a kid hasn't been active for 3+ days
// ─────────────────────────────────────────────────────────────────────────────
exports.checkInactivity = functions.pubsub
    .schedule("0 9 * * *")
    .timeZone("UTC")
    .onRun(async () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const inactiveSnap = await db.collection("kids")
        .where("lastActive", "<", threeDaysAgo)
        .get();
    for (const kidDoc of inactiveSnap.docs) {
        const kid = kidDoc.data();
        const parentId = kid.parentId;
        if (!parentId)
            continue;
        const daysInactive = Math.floor((Date.now() - kid.lastActive.toDate().getTime()) / (1000 * 60 * 60 * 24));
        // Only alert once (every 3 days to avoid spam)
        if (daysInactive % 3 !== 0)
            continue;
        await pushNotification(parentId, {
            type: "inactivity",
            title: `⏰ ${kid.name} hasn't logged in recently`,
            body: `${kid.name} hasn't been active for ${daysInactive} days. A gentle reminder might help them get back on track!`,
            kidId: kidDoc.id,
            kidName: kid.name,
            read: false,
            data: { daysInactive },
        });
    }
    functions.logger.info(`✅ Inactivity check complete. ${inactiveSnap.size} inactive kids found.`);
});
// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: getNotifications
// Returns parent's notifications (most recent 30, unread first)
// ─────────────────────────────────────────────────────────────────────────────
exports.getNotifications = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    const snap = await db.collection(`notifications/${context.auth.uid}/items`)
        .orderBy("createdAt", "desc")
        .limit(30)
        .get();
    const notifications = snap.docs.map((d) => {
        var _a;
        return (Object.assign(Object.assign({ id: d.id }, d.data()), { createdAt: (_a = d.data().createdAt) === null || _a === void 0 ? void 0 : _a.toDate().toISOString() }));
    });
    const unreadCount = notifications.filter((n) => !n.read).length;
    return { notifications, unreadCount };
});
// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: markNotificationsRead
// ─────────────────────────────────────────────────────────────────────────────
exports.markNotificationsRead = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    const uid = context.auth.uid;
    const batch = db.batch();
    if (data.ids && data.ids.length > 0) {
        // Mark specific notifications
        for (const id of data.ids.slice(0, 50)) {
            batch.update(db.doc(`notifications/${uid}/items/${id}`), { read: true });
        }
    }
    else {
        // Mark all unread
        const unreadSnap = await db.collection(`notifications/${uid}/items`)
            .where("read", "==", false)
            .limit(50)
            .get();
        unreadSnap.forEach((d) => batch.update(d.ref, { read: true }));
    }
    await batch.commit();
    return { success: true };
});
//# sourceMappingURL=notifications.js.map