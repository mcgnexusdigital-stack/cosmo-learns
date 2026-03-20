/**
 * quiz.ts — AI Quiz Generation & Result Persistence
 *
 * Functions:
 *  - generateQuiz    : callable — generates 5 questions via Anthropic API (server-side, key is safe)
 *  - saveQuizResult  : callable — persists result, updates progress, triggers achievements
 *  - getQuizHistory  : callable — returns paginated quiz history for a kid
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import Anthropic from "@anthropic-ai/sdk";

const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface QuizQuestion {
  q: string;
  options: string[];
  answer: number;           // 0-based index of correct option
  explanation: string;
}

interface QuizResultPayload {
  kidId: string;
  subject: "science" | "math" | "english" | "social";
  grade: number;
  score: number;
  total: number;
  questions: Array<QuizQuestion & { selected: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: generateQuiz
// Runs on the server — Anthropic key never touches the client.
// ─────────────────────────────────────────────────────────────────────────────
export const generateQuiz = functions
  .runWith({ secrets: ["ANTHROPIC_API_KEY"], timeoutSeconds: 60 })
  .https.onCall(
    async (
      data: { subject: string; grade: number; topic?: string },
      context
    ) => {
      if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
      }

      const { subject, grade, topic } = data;
      const validSubjects = ["science", "math", "english", "social"];
      if (!validSubjects.includes(subject) || grade < 3 || grade > 9) {
        throw new functions.https.HttpsError("invalid-argument", "Invalid subject or grade.");
      }

      const subjectLabels: Record<string, string> = {
        science: "Science",
        math: "Mathematics",
        english: "English Language Arts",
        social: "Social Studies",
      };

      const topicClause = topic ? ` focused on "${topic}"` : "";
      const prompt = `Generate a 5-question multiple choice quiz for Grade ${grade} ${subjectLabels[subject]}${topicClause}.

Return ONLY a valid JSON array with NO markdown, NO backticks, NO preamble. Use exactly this structure:
[
  {
    "q": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "answer": 0,
    "explanation": "Brief, encouraging explanation of the correct answer (1-2 sentences, friendly for a Grade ${grade} student)"
  }
]

Rules:
- answer is the 0-based index of the correct option
- All 4 options must be plausible (no obviously wrong distractors)
- Language must be age-appropriate for Grade ${grade}
- Questions should be engaging and curriculum-aligned
- Explanations must be warm and encouraging, never condescending`;

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      try {
        const message = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }],
        });

        const raw = (message.content[0] as { text: string }).text.trim();
        const questions: QuizQuestion[] = JSON.parse(raw);

        // Validate structure
        if (!Array.isArray(questions) || questions.length === 0) {
          throw new Error("Invalid quiz structure returned.");
        }

        functions.logger.info(`📝 Quiz generated: ${subject} Grade ${grade} for ${context.auth.uid}`);
        return { questions };
      } catch (err) {
        functions.logger.error("Quiz generation failed:", err);
        throw new functions.https.HttpsError("internal", "Failed to generate quiz. Please try again.");
      }
    }
  );

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: saveQuizResult
// Persists quiz result and updates kid's subject progress.
// ─────────────────────────────────────────────────────────────────────────────
export const saveQuizResult = functions.https.onCall(
  async (payload: QuizResultPayload, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = context.auth.uid;
    const { kidId, subject, grade, score, total, questions } = payload;

    // Security: ensure kid belongs to caller (or caller IS the kid)
    if (uid !== kidId) {
      const kidSnap = await db.doc(`kids/${kidId}`).get();
      if (!kidSnap.exists || kidSnap.data()?.parentId !== uid) {
        throw new functions.https.HttpsError("permission-denied", "Cannot save results for this kid.");
      }
    }

    const percentage = Math.round((score / total) * 100);

    // Save result document
    const resultRef = db.collection("quizResults").doc();
    await resultRef.set({
      id: resultRef.id,
      kidId,
      subject,
      grade,
      score,
      total,
      percentage,
      questions,
      completedAt: FieldValue.serverTimestamp(),
    });

    // Update kid's subject progress (weighted rolling average)
    const kidRef = db.doc(`kids/${kidId}`);
    const kidSnap = await kidRef.get();
    const kidData = kidSnap.data() ?? {};
    const currentProgress = kidData.subjects?.[subject] ?? 0;
    const newProgress = Math.min(100, Math.round(currentProgress * 0.7 + percentage * 0.3));

    // Stars earned based on score
    const starsEarned = percentage >= 90 ? 3 : percentage >= 70 ? 2 : 1;

    await kidRef.update({
      [`subjects.${subject}`]: newProgress,
      stars: FieldValue.increment(starsEarned),
      lastActive: FieldValue.serverTimestamp(),
    });

    // Check for achievements
    await checkAndAwardAchievements(kidId, subject, percentage, kidData);

    functions.logger.info(`✅ Quiz result saved: ${kidId} ${subject} ${score}/${total}`);
    return { resultId: resultRef.id, starsEarned, newProgress };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: getQuizHistory  
// Returns paginated quiz history for a kid, accessible by kid or parent.
// ─────────────────────────────────────────────────────────────────────────────
export const getQuizHistory = functions.https.onCall(
  async (data: { kidId: string; subject?: string; limit?: number }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }

    const { kidId, subject, limit = 20 } = data;
    const uid = context.auth.uid;

    // Verify access
    if (uid !== kidId) {
      const kidSnap = await db.doc(`kids/${kidId}`).get();
      if (!kidSnap.exists || kidSnap.data()?.parentId !== uid) {
        throw new functions.https.HttpsError("permission-denied", "Access denied.");
      }
    }

    let query = db.collection("quizResults")
      .where("kidId", "==", kidId)
      .orderBy("completedAt", "desc")
      .limit(Math.min(limit, 50));

    if (subject) {
      query = db.collection("quizResults")
        .where("kidId", "==", kidId)
        .where("subject", "==", subject)
        .orderBy("completedAt", "desc")
        .limit(Math.min(limit, 50));
    }

    const snap = await query.get();
    const results = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      completedAt: d.data().completedAt?.toDate().toISOString(),
    }));

    return { results };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Check and award achievements
// ─────────────────────────────────────────────────────────────────────────────
async function checkAndAwardAchievements(
  kidId: string,
  subject: string,
  percentage: number,
  kidData: FirebaseFirestore.DocumentData
) {
  const achievementsRef = db.collection(`achievements/${kidId}/earned`);
  const earned = await achievementsRef.get();
  const earnedIds = new Set(earned.docs.map((d) => d.id));

  const toAward: Array<{ id: string; name: string; icon: string; desc: string }> = [];

  // First lesson ever
  if (!earnedIds.has("first_quiz")) {
    toAward.push({ id: "first_quiz", name: "First Quiz!", icon: "🎓", desc: "Completed your first quiz" });
  }

  // Perfect score
  if (percentage === 100 && !earnedIds.has(`perfect_${subject}`)) {
    toAward.push({ id: `perfect_${subject}`, name: "Perfect Score!", icon: "💯", desc: `100% on ${subject} quiz` });
  }

  // Subject master (>= 80% progress)
  const subjectProgress = kidData.subjects?.[subject] ?? 0;
  if (subjectProgress >= 80 && !earnedIds.has(`master_${subject}`)) {
    toAward.push({ id: `master_${subject}`, name: `${subject} Master`, icon: "🏆", desc: `80% mastery in ${subject}` });
  }

  // Star collector (100+ stars)
  const stars = (kidData.stars ?? 0) + (percentage >= 90 ? 3 : percentage >= 70 ? 2 : 1);
  if (stars >= 100 && !earnedIds.has("star_collector")) {
    toAward.push({ id: "star_collector", name: "Star Collector", icon: "⭐", desc: "Earned 100+ stars" });
  }

  // Batch award
  if (toAward.length > 0) {
    const batch = db.batch();
    for (const ach of toAward) {
      batch.set(achievementsRef.doc(ach.id), {
        ...ach,
        earnedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    functions.logger.info(`🏅 Awarded ${toAward.length} achievement(s) to kid ${kidId}`);
  }
}
