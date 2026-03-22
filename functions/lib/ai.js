"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCheck = exports.cosmoMemory = exports.cosmoQuiz = exports.cosmoChat = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const ANTHROPIC_API_KEY = (0, params_1.defineSecret)("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-20250514";
const ALLOWED_ORIGINS = [
    "https://cosmo-learns-staging.web.app",
    "https://cosmo-learns-staging.firebaseapp.com",
    "https://cosmo-learns-prod.web.app",
    "https://cosmolearns.ca",
    "https://www.cosmolearns.ca",
    "http://localhost:5000",
];
function setCORS(req, res) {
    const origin = req.headers.origin || "";
    const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    res.set("Access-Control-Allow-Origin", allowed);
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
}
function isOptions(req, res) {
    setCORS(req, res);
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return true;
    }
    return false;
}
exports.cosmoChat = (0, https_1.onRequest)({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 30, memory: "256MiB", region: "us-central1", cors: false }, async (req, res) => {
    if (isOptions(req, res))
        return;
    setCORS(req, res);
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    try {
        const { system, messages, max_tokens } = req.body;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            res.status(400).json({ error: "messages array is required" });
            return;
        }
        const client = new sdk_1.default({ apiKey: ANTHROPIC_API_KEY.value() });
        const response = await client.messages.create({
            model: MODEL, max_tokens: max_tokens || 1000,
            system: system || "You are Cosmo, a friendly AI tutor for kids.",
            messages: messages.slice(-10),
        });
        res.status(200).json({ content: response.content });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.cosmoQuiz = (0, https_1.onRequest)({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 30, memory: "256MiB", region: "us-central1", cors: false }, async (req, res) => {
    if (isOptions(req, res))
        return;
    setCORS(req, res);
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    try {
        const { prompt } = req.body;
        if (!prompt) {
            res.status(400).json({ error: "prompt required" });
            return;
        }
        const client = new sdk_1.default({ apiKey: ANTHROPIC_API_KEY.value() });
        const response = await client.messages.create({
            model: MODEL, max_tokens: 1000,
            messages: [{ role: "user", content: prompt }],
        });
        const text = response.content[0].type === "text" ? response.content[0].text : "[]";
        res.status(200).json({ content: text });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.cosmoMemory = (0, https_1.onRequest)({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 30, memory: "256MiB", region: "us-central1", cors: false }, async (req, res) => {
    if (isOptions(req, res))
        return;
    setCORS(req, res);
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    try {
        const { prompt } = req.body;
        if (!prompt) {
            res.status(400).json({ error: "prompt required" });
            return;
        }
        const client = new sdk_1.default({ apiKey: ANTHROPIC_API_KEY.value() });
        const response = await client.messages.create({
            model: MODEL, max_tokens: 400,
            messages: [{ role: "user", content: prompt }],
        });
        const text = response.content[0].type === "text" ? response.content[0].text : "{}";
        res.status(200).json({ content: text });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.healthCheck = (0, https_1.onRequest)({ region: "us-central1", cors: true }, async (req, res) => {
    res.status(200).json({ status: "ok", service: "Cosmo Learns AI", timestamp: new Date().toISOString() });
});
//# sourceMappingURL=ai.js.map