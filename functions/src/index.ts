/**
 * Cosmo Learns — Cloud Functions Entry Point
 * All functions are imported and re-exported here.
 */

import * as admin from "firebase-admin";

// Initialize Firebase Admin once
admin.initializeApp();

// ── Export all function groups ──────────────────────────────────────────────
export * from "./auth";
export * from "./quiz";
export * from "./progress";
export * from "./notifications";
