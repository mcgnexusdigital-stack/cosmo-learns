/**
 * auth.ts — Firebase Auth Triggers & User Management
 *
 * Functions:
 *  - onUserCreated        : sets up Firestore profile on new registration
 *  - onUserDeleted        : cleans up all user data on account deletion
 *  - createKidProfile     : callable — parent creates a child profile
 *  - deleteKidProfile     : callable — parent removes a child profile
 *  - updateKidSettings    : callable — parent updates child grade/avatar
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: New user registered (email or Google)
// Creates the Firestore user document and, for parents, a parent doc.
// ─────────────────────────────────────────────────────────────────────────────
export const onUserCreated = functions.auth.user().onCreate(async (user) => {
  const { uid, email, displayName, photoURL } = user;

  // Default profile — role is set by the client during sign-up
  // For Google sign-ins that skip the sign-up form we default to 'parent'
  const userDoc = {
    uid,
    email: email ?? "",
    name: displayName ?? "New User",
    photoURL: photoURL ?? null,
    role: "parent",          // client updates this immediately after creation
    avatar: "🦊",
    stars: 0,
    streak: 0,
    lastActive: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();

  // users/{uid}
  batch.set(db.doc(`users/${uid}`), userDoc, { merge: true });

  // parents/{uid}  — created for everyone; ignored for kid accounts
  batch.set(db.doc(`parents/${uid}`), {
    uid,
    kidIds: [],
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();
  functions.logger.info(`✅ User profile created for ${uid}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: User deleted — cascade clean up
// ─────────────────────────────────────────────────────────────────────────────
export const onUserDeleted = functions.auth.user().onDelete(async (user) => {
  const { uid } = user;
  const batch = db.batch();

  // Remove user & parent docs
  batch.delete(db.doc(`users/${uid}`));
  batch.delete(db.doc(`parents/${uid}`));

  // Remove all sessions this user created
  const sessions = await db.collection("sessions")
    .where("kidId", "==", uid).get();
  sessions.forEach((doc) => batch.delete(doc.ref));

  // Remove quiz results
  const results = await db.collection("quizResults")
    .where("kidId", "==", uid).get();
  results.forEach((doc) => batch.delete(doc.ref));

  await batch.commit();
  functions.logger.info(`🗑️  Cleaned up data for deleted user ${uid}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: createKidProfile
// Parent calls this to add a child; returns the new kidId.
// ─────────────────────────────────────────────────────────────────────────────
export const createKidProfile = functions.https.onCall(
  async (data: { name: string; grade: number; avatar: string }, context) => {
    // Auth check
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    const parentId = context.auth.uid;

    // Validate
    if (!data.name || typeof data.grade !== "number" || data.grade < 3 || data.grade > 9) {
      throw new functions.https.HttpsError("invalid-argument", "name and grade (3–9) required.");
    }

    // Verify caller is a parent
    const parentDoc = await db.doc(`users/${parentId}`).get();
    if (parentDoc.data()?.role !== "parent") {
      throw new functions.https.HttpsError("permission-denied", "Only parents can create kid profiles.");
    }

    // Enforce max 5 kids per parent
    const parentRef = db.doc(`parents/${parentId}`);
    const parentSnap = await parentRef.get();
    const kidIds: string[] = parentSnap.data()?.kidIds ?? [];
    if (kidIds.length >= 5) {
      throw new functions.https.HttpsError("resource-exhausted", "Maximum 5 child profiles per account.");
    }

    // Create kid document
    const kidRef = db.collection("kids").doc();
    const kidId = kidRef.id;

    const batch = db.batch();
    batch.set(kidRef, {
      id: kidId,
      parentId,
      name: data.name.trim(),
      grade: data.grade,
      avatar: data.avatar ?? "🦊",
      stars: 0,
      streak: 0,
      lastActive: FieldValue.serverTimestamp(),
      subjects: { science: 0, math: 0, english: 0, social: 0 },
      createdAt: FieldValue.serverTimestamp(),
    });

    // Add kidId to parent's list
    batch.update(parentRef, {
      kidIds: FieldValue.arrayUnion(kidId),
    });

    await batch.commit();
    functions.logger.info(`👶 Kid profile created: ${kidId} for parent ${parentId}`);
    return { kidId };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: deleteKidProfile
// ─────────────────────────────────────────────────────────────────────────────
export const deleteKidProfile = functions.https.onCall(
  async (data: { kidId: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    const parentId = context.auth.uid;
    const { kidId } = data;

    // Verify ownership
    const kidSnap = await db.doc(`kids/${kidId}`).get();
    if (!kidSnap.exists || kidSnap.data()?.parentId !== parentId) {
      throw new functions.https.HttpsError("permission-denied", "Not your kid profile.");
    }

    const batch = db.batch();
    batch.delete(db.doc(`kids/${kidId}`));
    batch.update(db.doc(`parents/${parentId}`), {
      kidIds: FieldValue.arrayRemove(kidId),
    });

    // Delete their sessions and quiz results
    const [sessions, quizResults] = await Promise.all([
      db.collection("sessions").where("kidId", "==", kidId).get(),
      db.collection("quizResults").where("kidId", "==", kidId).get(),
    ]);
    sessions.forEach((d) => batch.delete(d.ref));
    quizResults.forEach((d) => batch.delete(d.ref));

    await batch.commit();
    return { success: true };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: updateUserRole
// Called immediately after sign-up to set role + grade (for kids)
// ─────────────────────────────────────────────────────────────────────────────
export const updateUserRole = functions.https.onCall(
  async (data: { role: "parent" | "kid"; grade?: number; name?: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    if (!["parent", "kid"].includes(data.role)) {
      throw new functions.https.HttpsError("invalid-argument", "role must be parent or kid.");
    }

    const update: Record<string, unknown> = { role: data.role };
    if (data.name) update.name = data.name.trim();
    if (data.role === "kid" && data.grade) {
      if (data.grade < 3 || data.grade > 9) {
        throw new functions.https.HttpsError("invalid-argument", "Grade must be 3–9.");
      }
      update.grade = data.grade;
    }

    await db.doc(`users/${context.auth.uid}`).update(update);
    return { success: true };
  }
);
