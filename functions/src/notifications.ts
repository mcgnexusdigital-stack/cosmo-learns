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

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface Notification {
  id: string;
  type: "quiz_completed" | "achievement_earned" | "streak_milestone" | "weekly_report" | "inactivity";
  title: string;
  body: string;
  kidId?: string;
  kidName?: string;
  read: boolean;
  createdAt: FirebaseFirestore.FieldValue;
  data?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Push notification to parent's notification feed
// ─────────────────────────────────────────────────────────────────────────────
async function pushNotification(parentId: string, notification: Omit<Notification, "id" | "createdAt">) {
  const ref = db.collection(`notifications/${parentId}/items`).doc();
  await ref.set({
    id: ref.id,
    ...notification,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Get parent ID for a given kid
// ─────────────────────────────────────────────────────────────────────────────
async function getParentId(kidId: string): Promise<string | null> {
  // Check kids collection
  const kidSnap = await db.doc(`kids/${kidId}`).get();
  if (kidSnap.exists) return kidSnap.data()?.parentId ?? null;

  // Fallback: check users collection (for kid accounts linked to parent)
  const userSnap = await db.doc(`users/${kidId}`).get();
  return userSnap.data()?.parentId ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: Quiz result created → notify parent
// ─────────────────────────────────────────────────────────────────────────────
export const onQuizCompleted = functions.firestore
  .document("quizResults/{resultId}")
  .onCreate(async (snap) => {
    const result = snap.data();
    const { kidId, subject, score, total, percentage } = result;

    const parentId = await getParentId(kidId);
    if (!parentId) return;

    const kidSnap = await db.doc(`kids/${kidId}`).get();
    const kidName = kidSnap.data()?.name ?? "Your child";

    const subjectEmojis: Record<string, string> = {
      science: "🔬", math: "🔢", english: "📖", social: "🌍"
    };
    const emoji = subjectEmojis[subject] ?? "📚";
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
export const onAchievementEarned = functions.firestore
  .document("achievements/{kidId}/earned/{achievementId}")
  .onCreate(async (snap, context) => {
    const { kidId } = context.params;
    const achievement = snap.data();

    const parentId = await getParentId(kidId);
    if (!parentId) return;

    const kidSnap = await db.doc(`kids/${kidId}`).get();
    const kidName = kidSnap.data()?.name ?? "Your child";

    await pushNotification(parentId, {
      type: "achievement_earned",
      title: `${achievement.icon} ${kidName} earned a badge!`,
      body: `${kidName} just unlocked "${achievement.name}" — ${achievement.desc}! 🎉`,
      kidId,
      kidName,
      read: false,
      data: { achievementId: snap.id, ...achievement },
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: Kid streak milestone (5, 10, 30 days)
// ─────────────────────────────────────────────────────────────────────────────
export const onStreakMilestone = functions.firestore
  .document("kids/{kidId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const { kidId } = context.params;

    const milestones = [5, 10, 14, 30, 60, 100];
    const prevStreak = before.streak ?? 0;
    const newStreak = after.streak ?? 0;

    const hitMilestone = milestones.find((m) => prevStreak < m && newStreak >= m);
    if (!hitMilestone) return;

    const parentId = await getParentId(kidId);
    if (!parentId) return;

    const kidName = after.name ?? "Your child";

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
export const sendWeeklyReport = functions.pubsub
  .schedule("0 8 * * 1")
  .timeZone("UTC")
  .onRun(async () => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Get all parents
    const parentsSnap = await db.collection("parents").get();
    functions.logger.info(`📧 Sending weekly reports to ${parentsSnap.size} parents`);

    for (const parentDoc of parentsSnap.docs) {
      const parentId = parentDoc.id;
      const kidIds: string[] = parentDoc.data().kidIds ?? [];
      if (kidIds.length === 0) continue;

      // Gather stats for each kid
      const kidSummaries: string[] = [];
      for (const kidId of kidIds) {
        const kidSnap = await db.doc(`kids/${kidId}`).get();
        if (!kidSnap.exists) continue;

        const kid = kidSnap.data()!;
        const quizSnap = await db.collection("quizResults")
          .where("kidId", "==", kidId)
          .where("completedAt", ">=", oneWeekAgo)
          .get();

        const quizCount = quizSnap.size;
        const avgScore = quizCount > 0
          ? Math.round(quizSnap.docs.reduce((s, d) => s + (d.data().percentage ?? 0), 0) / quizCount)
          : null;

        const summary = avgScore !== null
          ? `${kid.name}: ${quizCount} quiz${quizCount !== 1 ? "zes" : ""}, avg ${avgScore}%, ${kid.streak ?? 0}-day streak 🔥`
          : `${kid.name}: ${kid.streak ?? 0}-day streak 🔥 (no quizzes this week)`;
        kidSummaries.push(summary);
      }

      if (kidSummaries.length === 0) continue;

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
export const checkInactivity = functions.pubsub
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
      if (!parentId) continue;

      const daysInactive = Math.floor(
        (Date.now() - kid.lastActive.toDate().getTime()) / (1000 * 60 * 60 * 24)
      );

      // Only alert once (every 3 days to avoid spam)
      if (daysInactive % 3 !== 0) continue;

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
export const getNotifications = functions.https.onCall(
  async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }

    const snap = await db.collection(`notifications/${context.auth.uid}/items`)
      .orderBy("createdAt", "desc")
      .limit(30)
      .get();

    const notifications = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate().toISOString(),
    }));

    const unreadCount = notifications.filter((n) => !n.read).length;
    return { notifications, unreadCount };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: markNotificationsRead
// ─────────────────────────────────────────────────────────────────────────────
export const markNotificationsRead = functions.https.onCall(
  async (data: { ids?: string[] }, context) => {
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
    } else {
      // Mark all unread
      const unreadSnap = await db.collection(`notifications/${uid}/items`)
        .where("read", "==", false)
        .limit(50)
        .get();
      unreadSnap.forEach((d) => batch.update(d.ref, { read: true }));
    }

    await batch.commit();
    return { success: true };
  }
);
