"use strict";
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
exports.updateUserRole = exports.deleteKidProfile = exports.createKidProfile = exports.onUserDeleted = exports.onUserCreated = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const db = admin.firestore();
// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: New user registered (email or Google)
// Creates the Firestore user document and, for parents, a parent doc.
// ─────────────────────────────────────────────────────────────────────────────
exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
    const { uid, email, displayName, photoURL } = user;
    // Default profile — role is set by the client during sign-up
    // For Google sign-ins that skip the sign-up form we default to 'parent'
    const userDoc = {
        uid,
        email: email !== null && email !== void 0 ? email : "",
        name: displayName !== null && displayName !== void 0 ? displayName : "New User",
        photoURL: photoURL !== null && photoURL !== void 0 ? photoURL : null,
        role: "parent", // client updates this immediately after creation
        avatar: "🦊",
        stars: 0,
        streak: 0,
        lastActive: firestore_1.FieldValue.serverTimestamp(),
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    };
    const batch = db.batch();
    // users/{uid}
    batch.set(db.doc(`users/${uid}`), userDoc, { merge: true });
    // parents/{uid}  — created for everyone; ignored for kid accounts
    batch.set(db.doc(`parents/${uid}`), {
        uid,
        kidIds: [],
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    functions.logger.info(`✅ User profile created for ${uid}`);
});
// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: User deleted — cascade clean up
// ─────────────────────────────────────────────────────────────────────────────
exports.onUserDeleted = functions.auth.user().onDelete(async (user) => {
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
exports.createKidProfile = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
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
    if (((_a = parentDoc.data()) === null || _a === void 0 ? void 0 : _a.role) !== "parent") {
        throw new functions.https.HttpsError("permission-denied", "Only parents can create kid profiles.");
    }
    // Enforce max 5 kids per parent
    const parentRef = db.doc(`parents/${parentId}`);
    const parentSnap = await parentRef.get();
    const kidIds = (_c = (_b = parentSnap.data()) === null || _b === void 0 ? void 0 : _b.kidIds) !== null && _c !== void 0 ? _c : [];
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
        avatar: (_d = data.avatar) !== null && _d !== void 0 ? _d : "🦊",
        stars: 0,
        streak: 0,
        lastActive: firestore_1.FieldValue.serverTimestamp(),
        subjects: { science: 0, math: 0, english: 0, social: 0 },
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    // Add kidId to parent's list
    batch.update(parentRef, {
        kidIds: firestore_1.FieldValue.arrayUnion(kidId),
    });
    await batch.commit();
    functions.logger.info(`👶 Kid profile created: ${kidId} for parent ${parentId}`);
    return { kidId };
});
// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: deleteKidProfile
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteKidProfile = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    const parentId = context.auth.uid;
    const { kidId } = data;
    // Verify ownership
    const kidSnap = await db.doc(`kids/${kidId}`).get();
    if (!kidSnap.exists || ((_a = kidSnap.data()) === null || _a === void 0 ? void 0 : _a.parentId) !== parentId) {
        throw new functions.https.HttpsError("permission-denied", "Not your kid profile.");
    }
    const batch = db.batch();
    batch.delete(db.doc(`kids/${kidId}`));
    batch.update(db.doc(`parents/${parentId}`), {
        kidIds: firestore_1.FieldValue.arrayRemove(kidId),
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
});
// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: updateUserRole
// Called immediately after sign-up to set role + grade (for kids)
// ─────────────────────────────────────────────────────────────────────────────
exports.updateUserRole = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    if (!["parent", "kid"].includes(data.role)) {
        throw new functions.https.HttpsError("invalid-argument", "role must be parent or kid.");
    }
    const update = { role: data.role };
    if (data.name)
        update.name = data.name.trim();
    if (data.role === "kid" && data.grade) {
        if (data.grade < 3 || data.grade > 9) {
            throw new functions.https.HttpsError("invalid-argument", "Grade must be 3–9.");
        }
        update.grade = data.grade;
    }
    await db.doc(`users/${context.auth.uid}`).update(update);
    return { success: true };
});
//# sourceMappingURL=auth.js.map