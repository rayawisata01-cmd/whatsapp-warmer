// index.ts
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  isJidGroup,
  isJidBroadcast
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { mkdir, writeFile, access, readdir, copyFile, rm } from "fs/promises";
import { rimraf } from "rimraf";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Groq from "groq-sdk";
import multer from "multer";
import * as XLSX from "xlsx";

// db.ts
import { PrismaClient } from "@prisma/client";
var globalForPrisma = globalThis;
var db = globalForPrisma.prisma ?? new PrismaClient({
  log: ["error", "warn"]
});
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

// index.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var app = express();
var httpServer = createServer(app);
var io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,
  transports: ["websocket", "polling"],
  // WebSocket first for better stability
  path: "/socket.io",
  // WebSocket-specific options
  pingTimeout: 6e4,
  // 60 seconds - longer timeout for mobile networks
  pingInterval: 25e3,
  // 25 seconds - keep connection alive
  upgradeTimeout: 3e4,
  // 30 seconds for upgrade
  maxHttpBufferSize: 1e7,
  // 10MB for large QR codes
  // Allow transport upgrade
  allowUpgrades: true,
  // Per-connection settings
  connectTimeout: 45e3
  // 45 seconds to establish connection
});
var PORT = 3030;
var SESSIONS_DIR = join(__dirname, "sessions");
var BACKUP_DIR = join(__dirname, "backups");
var logger = pino({
  level: process.env.BAILEYS_LOG_LEVEL || "debug"
});
var WARMING_PHASES = [
  { day: 1, maxMessagesPerDay: 3, maxMessagesPerHour: 1, description: "Day 1: Minimal activity (Safe Mode)" },
  { day: 2, maxMessagesPerDay: 5, maxMessagesPerHour: 2, description: "Day 2: Very limited (Safe Mode)" },
  { day: 3, maxMessagesPerDay: 7, maxMessagesPerHour: 2, description: "Day 3: Slow start (Safe Mode)" },
  { day: 4, maxMessagesPerDay: 10, maxMessagesPerHour: 3, description: "Day 4: Light activity (Safe Mode)" },
  { day: 5, maxMessagesPerDay: 12, maxMessagesPerHour: 3, description: "Day 5: Gradual increase (Safe Mode)" },
  { day: 6, maxMessagesPerDay: 15, maxMessagesPerHour: 4, description: "Day 6: Building up (Safe Mode)" },
  { day: 7, maxMessagesPerDay: 18, maxMessagesPerHour: 4, description: "Day 7: One week (Safe Mode)" },
  { day: 14, maxMessagesPerDay: 25, maxMessagesPerHour: 5, description: "Day 14: Two weeks (Safe Mode)" },
  { day: 21, maxMessagesPerDay: 30, maxMessagesPerHour: 6, description: "Day 21: Three weeks (Safe Mode)" },
  { day: 30, maxMessagesPerDay: 40, maxMessagesPerHour: 8, description: "Day 30: Full month (Safe Mode)" }
];
function getWarmingPhase(warmingDays) {
  let phase = WARMING_PHASES[0];
  for (const p of WARMING_PHASES) {
    if (warmingDays >= p.day) {
      phase = p;
    }
  }
  return phase;
}
var accounts = /* @__PURE__ */ new Map();
var messageQueue = /* @__PURE__ */ new Map();
var warmingIntervals = /* @__PURE__ */ new Map();
var chatPairs = /* @__PURE__ */ new Map();
var personalityPool = [];
var MAX_PERSONALITY_POOL = 50;
var isGeneratingPersonalities = false;
var connectionTimeouts = /* @__PURE__ */ new Map();
var CONNECTING_TIMEOUT_MS = 12e4;
var groqInstance = null;
var FALLBACK_RESPONSES = [
  "Oke siap!",
  "Baik, noted!",
  "Hmm iya bener",
  "Wah menarik ya",
  "Haha iya \u{1F604}",
  "Oh gitu ya",
  "Serius? Wkwkw",
  "Haha emang gitu",
  "Iya bener tuh",
  "Oh oke noted!",
  "Wkwkw lucu sih",
  "Hmm iya juga sih",
  "Bener juga ya",
  "Oh iya? Baru tau",
  "Haha biasa aja"
];
var aiApiSettings = {
  provider: "groq",
  groqApiKey: process.env.GROQ_API_KEY || "",
  groqModel: "llama-3.3-70b-versatile",
  lastUpdated: /* @__PURE__ */ new Date()
};
function getGroqInstance() {
  if (!groqInstance) {
    const apiKey = aiApiSettings.groqApiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.warn("\u26A0\uFE0F GROQ_API_KEY not set. Get free API key at https://console.groq.com/keys");
      return null;
    }
    try {
      groqInstance = new Groq({ apiKey });
      console.log("\u2705 Groq instance initialized with API key");
    } catch (error) {
      console.error("Failed to initialize Groq:", error);
      return null;
    }
  }
  return groqInstance;
}
function resetGroqInstance() {
  groqInstance = null;
}
var eventLogs = [];
var MAX_LOGS = 500;
var MAX_ACCOUNTS = 100;
var MAX_RECONNECT_ATTEMPTS = 5;
var reconnectAttempts = /* @__PURE__ */ new Map();
var everConnected = /* @__PURE__ */ new Map();
var pendingDeletion = /* @__PURE__ */ new Set();
var personalityRegistry = /* @__PURE__ */ new Map();
var SAFE_MODE_CONFIG = {
  // Safe Mode enabled by default untuk menghindari ban
  enabled: true,
  // Batas maksimal akun yang ONLINE bersamaan
  // DIANJURKAN: 5-10 untuk testing, bisa dinaikkan setelah 1 minggu aman
  maxConcurrentOnline: 5,
  // DITURUNKAN dari 10
  // Silent period (akun "istirahat" tanpa aktivitas)
  silentPeriodEnabled: true,
  silentPeriodMinMinutes: 60,
  // DINAIKKAN dari 30
  silentPeriodMaxMinutes: 240,
  // DINAIKKAN dari 180 (1-4 jam diam)
  // Probability untuk tidak merespon (seperti manusia sibuk)
  ignoreMessageChance: 0.4,
  // DINAIKKAN dari 0.3 (40% tidak merespon)
  // Delay lebih panjang dan random
  responseDelayMinMinutes: 10,
  // DINAIKKAN dari 5
  responseDelayMaxMinutes: 120,
  // DINAIKKAN dari 60 (10 menit - 2 jam)
  // Activity burst limits
  maxActivityMinutesPerSession: 20,
  // DITURUNKAN dari 30
  minRestMinutesBetweenSessions: 90
  // DINAIKKAN dari 60 (1.5 jam istirahat)
};
var rotationTimer = null;
var backupTimer = null;
var config = {
  warmerEnabled: true,
  warmerDelayMin: 6e5,
  // 10 menit minimum (dari 3 menit)
  warmerDelayMax: 18e5,
  // 30 menit maximum (dari 7 menit)
  autoPresenceUpdate: true,
  presenceUpdateInterval: 60,
  // 60 menit (dari 30 menit)
  typingSimulationEnabled: false,
  // DIMATIKAN - berisiko terdeteksi
  readReceiptsEnabled: true,
  aiSystemPrompt: `Kamu adalah orang Indonesia yang ramah dan santai.
Balas pesan dengan gaya chat WhatsApp yang natural, singkat (1-2 kalimat), dan kadang pakai emoji.
Jangan terlihat seperti bot atau AI. Gunakan bahasa casual seperti "gimana", "yaudah", "btw", dll.
PENTING: Jangan terlalu cepat merespon. Jangan terlalu aktif. Kadang tidak perlu balas.`,
  warmingIntensity: "low",
  // DITURUNKAN dari medium
  activePoolSize: 10,
  // DITURUNKAN dari 25
  idlePoolSize: 20,
  // DITURUNKAN dari 35
  rotationIntervalMin: 60 * 60 * 1e3,
  // 1 jam (dari 15 menit)
  rotationIntervalMax: 120 * 60 * 1e3,
  // 2 jam (dari 30 menit)
  chatSimulationEnabled: true,
  // AKTIF - tapi dengan aturan anti-spam
  // Conversation decay (natural ending)
  maxSilenceCount: 2,
  // DITURUNKAN dari 3 - lebih cepat ending
  conversationDecayEnabled: true,
  // Anti-detection features
  readReceiptRandomEnabled: true,
  readReceiptInstantChance: 30,
  // DITURUNKAN dari 50% - lebih jarang instant
  readReceiptDelayChance: 40,
  // DINAIKKAN - lebih sering delay
  readReceiptIgnoreChance: 30,
  // DINAIKKAN dari 15% - lebih sering ignore
  randomOfflineEnabled: true,
  minOnlineHours: 1,
  // DITURUNKAN dari 2 jam
  maxOnlineHours: 4,
  // DITURUNKAN dari 6 jam
  minOfflineMinutes: 30,
  // DINAIKKAN dari 10 menit
  maxOfflineMinutes: 240,
  // DINAIKKAN dari 120 menit (4 jam)
  burstPreventionEnabled: true,
  minDelayBetweenMessages: 12e4,
  // 2 menit (dari 30 detik)
  maxMessagesPerBurst: 2,
  // DITURUNKAN dari 3
  // Rate limiting - SAFE MODE
  rateLimitEnabled: true,
  maxMessagesPerHour: 5,
  // DITURUNKAN DRAMATIS dari 15
  maxMessagesPerDay: 30,
  // DITURUNKAN DRAMATIS dari 100
  // Warming schedule
  warmingScheduleEnabled: true,
  // Backup
  autoBackupEnabled: true,
  backupIntervalHours: 6
};
function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function shuffleArray(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function validateAccountId(accountId) {
  if (!accountId || typeof accountId !== "string") {
    return { valid: false, error: "accountId is required" };
  }
  if (accountId.length < 1 || accountId.length > 100) {
    return { valid: false, error: "accountId must be 1-100 characters" };
  }
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(accountId)) {
    return { valid: false, error: "accountId can only contain letters, numbers, dash, and underscore" };
  }
  if (accountId.includes("..") || accountId.includes("/") || accountId.includes("\\")) {
    return { valid: false, error: "Invalid accountId format" };
  }
  return { valid: true };
}
function validatePhoneNumber(phone) {
  if (!phone || typeof phone !== "string") {
    return { valid: false, error: "phoneNumber is required" };
  }
  const phonePattern = /^\+?[0-9]{8,15}$/;
  if (!phonePattern.test(phone.replace(/[\s-]/g, ""))) {
    return { valid: false, error: "Invalid phone number format" };
  }
  return { valid: true };
}
function isInSilentPeriod(account) {
  if (!SAFE_MODE_CONFIG.silentPeriodEnabled) return false;
  if (!account.silentPeriod?.isActive) return false;
  const now = /* @__PURE__ */ new Date();
  if (account.silentPeriod.endsAt && now < account.silentPeriod.endsAt) {
    return true;
  }
  account.silentPeriod.isActive = false;
  return false;
}
function startSilentPeriod(account) {
  if (!SAFE_MODE_CONFIG.silentPeriodEnabled) return;
  const durationMinutes = getRandomInt(
    SAFE_MODE_CONFIG.silentPeriodMinMinutes,
    SAFE_MODE_CONFIG.silentPeriodMaxMinutes
  );
  const durationMs = durationMinutes * 60 * 1e3;
  account.silentPeriod = {
    isActive: true,
    startedAt: /* @__PURE__ */ new Date(),
    endsAt: new Date(Date.now() + durationMs),
    duration: durationMs
  };
  addLog("info", `\u{1F634} Silent period started for ${durationMinutes} minutes`, account.id);
}
function shouldStartSilentPeriod(account) {
  if (!SAFE_MODE_CONFIG.silentPeriodEnabled) return false;
  if (account.silentPeriod?.isActive) return false;
  return Math.random() < 0.1;
}
function shouldIgnoreMessage() {
  if (!SAFE_MODE_CONFIG.enabled) return false;
  return Math.random() < SAFE_MODE_CONFIG.ignoreMessageChance;
}
function getSafeResponseDelay() {
  const minMs = SAFE_MODE_CONFIG.responseDelayMinMinutes * 60 * 1e3;
  const maxMs = SAFE_MODE_CONFIG.responseDelayMaxMinutes * 60 * 1e3;
  return getRandomInt(minMs, maxMs);
}
function getOnlineAccountCount() {
  return Array.from(accounts.values()).filter((a) => a.status === "online").length;
}
function canBringOnline() {
  if (!SAFE_MODE_CONFIG.enabled) return true;
  return getOnlineAccountCount() < SAFE_MODE_CONFIG.maxConcurrentOnline;
}
async function enforceMaxOnlineLimit() {
  if (!SAFE_MODE_CONFIG.enabled) return;
  const onlineAccounts = Array.from(accounts.values()).filter((a) => a.status === "online");
  const excess = onlineAccounts.length - SAFE_MODE_CONFIG.maxConcurrentOnline;
  if (excess > 0) {
    addLog("info", `\u26A0\uFE0F Safe Mode: Too many online accounts (${onlineAccounts.length}), disconnecting ${excess}...`);
    const sorted = onlineAccounts.sort((a, b) => {
      const aTime = a.warmingStats.lastActivity?.getTime() || 0;
      const bTime = b.warmingStats.lastActivity?.getTime() || 0;
      return aTime - bTime;
    });
    for (let i = 0; i < excess; i++) {
      const account = sorted[i];
      if (account.socket && account.status === "online") {
        await assignAccountToPool(account, "offline");
        addLog("info", `\u{1F4F4} Safe Mode: Moved ${account.id} to offline pool`, account.id);
      }
    }
  }
}
var BURNABLE_CONFIG = {
  // Akun yang sudah "mati" dan perlu diganti
  bannedAccounts: /* @__PURE__ */ new Map(),
  // Queue untuk akun pengganti
  replacementQueue: [],
  // Akun cadangan (fresh)
  reserveAccounts: [],
  // Stats tracking
  totalBans: 0,
  totalReplacements: 0,
  averageAccountLifespan: 0,
  // days
  // Warming configuration
  warmingRequired: true,
  warmingDaysMin: 3,
  warmingDaysMax: 7,
  // Health thresholds
  healthWarningThreshold: 30,
  healthCriticalThreshold: 15
};
function calculateBurnableHealth(account) {
  if (!account.warmingStats) return 0;
  let score = 100;
  const daysSinceActivity = account.warmingStats.lastActivity ? (Date.now() - account.warmingStats.lastActivity.getTime()) / (1e3 * 60 * 60 * 24) : 999;
  if (daysSinceActivity > 7) score -= 50;
  else if (daysSinceActivity > 3) score -= 25;
  else if (daysSinceActivity > 1) score -= 10;
  const ratio = account.warmingStats.messagesSent / Math.max(account.warmingStats.messagesReceived, 1);
  if (ratio > 3) score -= 30;
  else if (ratio > 2) score -= 15;
  const daysSinceStart = account.warmingStats.warmingStartTime ? (Date.now() - account.warmingStats.warmingStartTime.getTime()) / (1e3 * 60 * 60 * 24) : 0;
  if (daysSinceStart < 1) score -= 20;
  else if (daysSinceStart < 3) score -= 10;
  return Math.max(0, Math.min(100, score));
}
function updateAccountLifecycle(account) {
  const healthScore = calculateBurnableHealth(account);
  const daysActive = account.warmingStats.warmingStartTime ? Math.floor((Date.now() - account.warmingStats.warmingStartTime.getTime()) / (1e3 * 60 * 60 * 24)) : 0;
  let riskLevel = "low";
  if (healthScore < BURNABLE_CONFIG.healthCriticalThreshold) {
    riskLevel = "critical";
  } else if (healthScore < BURNABLE_CONFIG.healthWarningThreshold) {
    riskLevel = "high";
  } else if (healthScore < 50) {
    riskLevel = "medium";
  }
  let lifecycle = "active";
  if (daysActive < BURNABLE_CONFIG.warmingDaysMin) {
    lifecycle = "warming";
  } else if (riskLevel === "critical") {
    lifecycle = "warning";
  }
  return {
    warmingDays: daysActive,
    maxWarmingDays: BURNABLE_CONFIG.warmingDaysMax,
    activityScore: healthScore,
    riskLevel
  };
}
async function handleBannedAccount(accountId, reason) {
  const account = accounts.get(accountId);
  const stats = {
    accountId,
    createdAt: account?.warmingStats?.warmingStartTime || /* @__PURE__ */ new Date(),
    lifecycle: "banned",
    daysActive: account?.warmingStats?.warmingDays || 0,
    messagesSent: account?.warmingStats?.messagesSent || 0,
    messagesReceived: account?.warmingStats?.messagesReceived || 0,
    banCount: (BURNABLE_CONFIG.bannedAccounts.get(accountId)?.banCount || 0) + 1,
    lastBanDate: /* @__PURE__ */ new Date(),
    healthScore: 0
  };
  BURNABLE_CONFIG.bannedAccounts.set(accountId, stats);
  BURNABLE_CONFIG.totalBans++;
  addLog("error", `\u{1F6AB} Account BANNED: ${accountId}. Reason: ${reason || "Unknown"}`, accountId);
  if (BURNABLE_CONFIG.replacementQueue.length > 0) {
    const replacementId = BURNABLE_CONFIG.replacementQueue.shift();
    stats.replacement = replacementId;
    BURNABLE_CONFIG.totalReplacements++;
    addLog("info", `\u{1F504} Replacement account queued: ${replacementId} for banned ${accountId}`);
  }
  accounts.delete(accountId);
  reconnectAttempts.delete(accountId);
  io.emit("account-banned", { accountId, reason, replacement: stats.replacement });
}
function getBurnableStats() {
  const activeAccounts = Array.from(accounts.values()).filter((a) => a.status === "online");
  const warmingAccounts = activeAccounts.filter((a) => {
    const lifecycle = updateAccountLifecycle(a);
    return lifecycle.warmingDays < BURNABLE_CONFIG.warmingDaysMin;
  });
  const warningAccounts = activeAccounts.filter((a) => {
    const lifecycle = updateAccountLifecycle(a);
    return lifecycle.riskLevel === "high" || lifecycle.riskLevel === "critical";
  });
  return {
    totalAccounts: accounts.size,
    activeAccounts: activeAccounts.length,
    warmingAccounts: warmingAccounts.length,
    warningAccounts: warningAccounts.length,
    bannedAccounts: BURNABLE_CONFIG.bannedAccounts.size,
    totalBans: BURNABLE_CONFIG.totalBans,
    totalReplacements: BURNABLE_CONFIG.totalReplacements,
    replacementQueue: BURNABLE_CONFIG.replacementQueue.length,
    reserveAccounts: BURNABLE_CONFIG.reserveAccounts.length,
    averageLifespan: BURNABLE_CONFIG.averageAccountLifespan,
    config: {
      warmingDaysRequired: `${BURNABLE_CONFIG.warmingDaysMin}-${BURNABLE_CONFIG.warmingDaysMax}`,
      healthWarningThreshold: BURNABLE_CONFIG.healthWarningThreshold,
      healthCriticalThreshold: BURNABLE_CONFIG.healthCriticalThreshold
    }
  };
}
var TOPIC_CATEGORIES = {
  daily_life: {
    name: "Kehidupan Sehari-hari",
    topics: [
      "Lagi ngapain sekarang?",
      "Udah makan belum?",
      "Kemarin ngapain aja?",
      "Weekend ada rencana apa?",
      "Lagi sibuk ga sih?",
      "Cuaca hari ini gimana di tempatmu?",
      "Udah sarapan?",
      "Lagi di kantor atau di rumah?",
      "Hari ini lembur ga?",
      "Traffic tadi gimana?"
    ]
  },
  work_study: {
    name: "Kerja/Kuliah",
    topics: [
      "Kerjaan lagi banyak ga?",
      "Deadline ada ga?",
      "Boss nyebelin ga?",
      "Rekan kerja gimana?",
      "Ada meeting banyak ga hari ini?",
      "Kantor enak ga sih?",
      "Kuliah lagi sibuk?",
      "Tugas banyak?",
      "Ujian dah dekat?",
      "Dosen killer ada?"
    ]
  },
  entertainment: {
    name: "Hiburan",
    topics: [
      "Nonton film apa belakangan?",
      "Drama Korea ada rekomendasi?",
      "Film horor ada yang bagus?",
      "Lagu enak apa sekarang?",
      "Konser ada yang mau dateng?",
      "Netflix ada tontonan bagus?",
      "Anime ada rekomendasi?",
      "Game lagi main apa?",
      "YouTube sering nonton apa?",
      "Podcast dengerin apa?"
    ]
  },
  food: {
    name: "Makanan",
    topics: [
      "Makanan favorit apa?",
      "Restoran enak ada rekomendasi?",
      "Pedes suka ga?",
      "Suka masak?",
      "Mie ayam enak dimana?",
      "Kopi atau teh?",
      "Jajanan malam ada yang enak?",
      "Diet lagi ga?",
      "Suka makanan apa?",
      "Makan siang dimana tadi?"
    ]
  },
  travel: {
    name: "Traveling",
    topics: [
      "Liburan terakhir kemana?",
      "Destinasi impian?",
      "Pantai atau gunung?",
      "Naik pesawat suka?",
      "Wisata lokal ada rekomendasi?",
      "Staycation pernah?",
      "Jalan-jalan sendiri atau bareng?",
      "Backpacker pernah?",
      "Hotel favorit?",
      "Wisata kuliner pernah?"
    ]
  },
  technology: {
    name: "Teknologi",
    topics: [
      "HP baru ada yang bagus?",
      "iPhone atau Android?",
      "Laptop rekomendasi?",
      "ChatGPT pernah pake?",
      "Apps produktif ada rekomendasi?",
      "Gaming PC atau console?",
      "Smartwatch punya?",
      "Internet di rumah cepet?",
      "Sosmed apa yang sering?",
      "TikTok sering scroll?"
    ]
  },
  sports: {
    name: "Olahraga",
    topics: [
      "Olahraga apa yang suka?",
      "Gym atau jogging?",
      "Badminton main ga?",
      "Futsal sering?",
      "Nonton bola ga?",
      "Tim bola favorit?",
      "Olympics nonton ga?",
      "Renang bisa?",
      "Yoga pernah coba?",
      "Gym membership punya?"
    ]
  },
  personal: {
    name: "Pribadi",
    topics: [
      "Aku kemarin mimpi aneh",
      "Lagi mood apa hari ini?",
      "Resolusi tahun ini apa?",
      "Habit baru coba?",
      "Lagi belajar apa?",
      "Project pribadi ada?",
      "Impian jangka panjang?",
      "Kebiasaan pagi apa?",
      "Sleep schedule gimana?",
      "Me time kayak gimana?"
    ]
  },
  trending: {
    name: "Trending",
    topics: [
      "Berita hari ini baca?",
      "Viral lagi apa?",
      "Meme terbaru ada?",
      "Trending topic liat?",
      "Gosip artis dengar?",
      "Event lagi ada?",
      "Promo lagi ada?",
      "Black Friday ada?",
      "Sale besar ada?",
      "Tren fashion baru?"
    ]
  }
};
var RELATIONSHIP_STAGES = {
  stranger: { minMessages: 0, maxMessages: 5, description: "Baru kenal" },
  acquaintance: { minMessages: 5, maxMessages: 15, description: "Sudah kenal" },
  friend: { minMessages: 15, maxMessages: 30, description: "Teman" },
  close_friend: { minMessages: 30, maxMessages: 999, description: "Teman dekat" }
};
function findSharedInterests(p1, p2) {
  if (!p1?.hobbies || !p2?.hobbies) return [];
  return p1.hobbies.filter((h) => p2.hobbies.includes(h));
}
function getTopicCategoryForInterests(interests) {
  const interestToCategory = {
    "musik": "entertainment",
    "film": "entertainment",
    "gaming": "technology",
    "traveling": "travel",
    "kuliner": "food",
    "fotografi": "daily_life",
    "olahraga": "sports",
    "membaca": "entertainment",
    "nonton drama": "entertainment",
    "jalan-jalan": "travel"
  };
  for (const interest of interests) {
    const category = interestToCategory[interest.toLowerCase()];
    if (category) return category;
  }
  const categories = Object.keys(TOPIC_CATEGORIES);
  return getRandomItem(categories);
}
function generateNewTopic(pair, account1, account2) {
  const sharedInterests = findSharedInterests(account1.personality, account2.personality);
  let category;
  if (sharedInterests.length > 0 && Math.random() > 0.3) {
    category = getTopicCategoryForInterests(sharedInterests);
  } else {
    const availableCategories = Object.keys(TOPIC_CATEGORIES).filter((c) => !pair.topicsDiscussed.slice(-3).includes(c));
    category = availableCategories.length > 0 ? getRandomItem(availableCategories) : "daily_life";
  }
  const categoryData = TOPIC_CATEGORIES[category];
  const availableTopics = categoryData.topics.filter((t) => !pair.topicsDiscussed.includes(t));
  const topic = availableTopics.length > 0 ? getRandomItem(availableTopics) : getRandomItem(categoryData.topics);
  return { topic, category: categoryData.name };
}
function updateRelationshipStage(pair) {
  const msgCount = pair.messageCount;
  if (msgCount >= RELATIONSHIP_STAGES.close_friend.minMessages) {
    pair.relationshipStage = "close_friend";
  } else if (msgCount >= RELATIONSHIP_STAGES.friend.minMessages) {
    pair.relationshipStage = "friend";
  } else if (msgCount >= RELATIONSHIP_STAGES.acquaintance.minMessages) {
    pair.relationshipStage = "acquaintance";
  } else {
    pair.relationshipStage = "stranger";
  }
}
function getRelationshipStyle(stage) {
  switch (stage) {
    case "stranger":
      return "Masih baru kenal, jadi masih agak formal dan sopan. Tanya-tanya dulu.";
    case "acquaintance":
      return "Sudah kenal, mulai bisa bercanda sedikit. Lebih santai.";
    case "friend":
      return "Teman akrab, bisa ngomong apa aja. Sering bercanda.";
    case "close_friend":
      return "Teman dekat, bisa curhat, bercanda, dan saling support. Tidak ada batasan topik.";
  }
}
function buildConversationContext(pair, sender, receiver) {
  const sharedInterests = findSharedInterests(sender.personality, receiver.personality);
  const relStyle = getRelationshipStyle(pair.relationshipStage);
  let context = `Kamu sedang chat dengan ${receiver.personality?.name || "seseorang"}.
Topik pembicaraan sekarang: "${pair.currentTopic}"
Kategori: ${pair.topicCategory}
Tingkat hubungan: ${RELATIONSHIP_STAGES[pair.relationshipStage].description}
Gaya: ${relStyle}`;
  if (sharedInterests.length > 0) {
    context += `
Kalian punya hobi yang sama: ${sharedInterests.join(", ")}`;
  }
  if (pair.conversationContext.length > 0) {
    context += `
Percakapan terakhir:
${pair.conversationContext.slice(-3).join("\n")}`;
  }
  return context;
}
function addLog(type, message, accountId) {
  const log = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    accountId,
    message,
    timestamp: /* @__PURE__ */ new Date()
  };
  eventLogs.unshift(log);
  if (eventLogs.length > MAX_LOGS) {
    eventLogs.pop();
  }
  io.emit("log", log);
  if (accountId) {
    db.whatsAppAccount.findUnique({ where: { id: accountId } }).then((existingAccount) => {
      if (existingAccount) {
        return db.eventLog.create({
          data: { type, message, accountId, timestamp: /* @__PURE__ */ new Date() }
        });
      }
      return null;
    }).catch(() => {
    });
  }
}
function createDefaultRateLimit() {
  return {
    messagesPerHour: config.maxMessagesPerHour,
    messagesPerDay: config.maxMessagesPerDay,
    currentHourCount: 0,
    currentDayCount: 0,
    lastHourReset: /* @__PURE__ */ new Date(),
    lastDayReset: /* @__PURE__ */ new Date()
  };
}
function checkRateLimit(account) {
  if (!config.rateLimitEnabled) {
    return { allowed: true };
  }
  const rateLimit = account.warmingStats.rateLimit;
  const now = /* @__PURE__ */ new Date();
  const hourDiff = now.getTime() - rateLimit.lastHourReset.getTime();
  if (hourDiff >= 36e5) {
    rateLimit.currentHourCount = 0;
    rateLimit.lastHourReset = now;
  }
  const dayDiff = now.getTime() - rateLimit.lastDayReset.getTime();
  if (dayDiff >= 864e5) {
    rateLimit.currentDayCount = 0;
    rateLimit.lastDayReset = now;
  }
  let maxPerHour = rateLimit.messagesPerHour;
  let maxPerDay = rateLimit.messagesPerDay;
  if (config.warmingScheduleEnabled && account.warmingStats.warmingStartTime) {
    const warmingDays = Math.floor((now.getTime() - account.warmingStats.warmingStartTime.getTime()) / 864e5);
    const phase = getWarmingPhase(warmingDays);
    maxPerHour = phase.maxMessagesPerHour;
    maxPerDay = phase.maxMessagesPerDay;
    account.warmingStats.currentPhase = phase.day;
    account.warmingStats.warmingDays = warmingDays;
  }
  if (rateLimit.currentHourCount >= maxPerHour) {
    const waitTime = 36e5 - hourDiff;
    return {
      allowed: false,
      reason: `Hourly limit reached (${maxPerHour}/hour)`,
      waitTime
    };
  }
  if (rateLimit.currentDayCount >= maxPerDay) {
    const waitTime = 864e5 - dayDiff;
    return {
      allowed: false,
      reason: `Daily limit reached (${maxPerDay}/day)`,
      waitTime
    };
  }
  return { allowed: true };
}
function incrementRateLimit(account) {
  account.warmingStats.rateLimit.currentHourCount++;
  account.warmingStats.rateLimit.currentDayCount++;
}
async function ensureBackupDir() {
  try {
    await access(BACKUP_DIR);
  } catch {
    await mkdir(BACKUP_DIR, { recursive: true });
  }
}
async function backupSession(accountId) {
  try {
    const sessionDir = join(SESSIONS_DIR, accountId);
    const backupAccountDir = join(BACKUP_DIR, accountId);
    try {
      await access(sessionDir);
    } catch {
      return;
    }
    await mkdir(backupAccountDir, { recursive: true });
    const files = await readdir(sessionDir);
    for (const file of files) {
      const srcPath = join(sessionDir, file);
      const destPath = join(backupAccountDir, file);
      await copyFile(srcPath, destPath);
    }
    addLog("backup", `\u2705 Session backed up successfully`, accountId);
  } catch (error) {
    addLog("error", `\u274C Backup failed: ${error}`, accountId);
  }
}
async function backupAllSessions() {
  addLog("backup", "\u{1F504} Starting scheduled backup for all sessions...");
  const accountList = Array.from(accounts.keys());
  let successCount = 0;
  for (const accountId of accountList) {
    await backupSession(accountId);
    successCount++;
    await delay(100);
  }
  addLog("backup", `\u2705 Backup complete: ${successCount} sessions backed up`);
}
function scheduleAutoBackup() {
  if (backupTimer) {
    clearInterval(backupTimer);
  }
  if (config.autoBackupEnabled) {
    const interval = config.backupIntervalHours * 60 * 60 * 1e3;
    backupTimer = setInterval(() => {
      backupAllSessions();
    }, interval);
    addLog("info", `\u{1F4BE} Auto-backup scheduled every ${config.backupIntervalHours} hours`);
  }
}
function getAccountsByPool(pool) {
  return Array.from(accounts.values()).filter((a) => a.pool === pool && a.status === "online");
}
function getActiveAccounts() {
  return getAccountsByPool("active");
}
function getIdleAccounts() {
  return getAccountsByPool("idle");
}
function getOfflinePoolAccounts() {
  return getAccountsByPool("offline");
}
async function assignAccountToPool(account, pool) {
  const oldPool = account.pool;
  account.pool = pool;
  account.poolSince = /* @__PURE__ */ new Date();
  addLog("pool", `\u{1F4E6} Account moved from ${oldPool} to ${pool}`, account.id);
  io.emit("pool-change", { accountId: account.id, pool, previousPool: oldPool });
  if (pool === "offline" && account.socket && account.status === "online") {
    try {
      account.socket.end?.();
      account.status = "offline";
      io.emit("account-status", { accountId: account.id, status: "offline" });
    } catch (e) {
    }
  }
  if (pool === "active" && config.chatSimulationEnabled) {
    await findChatPartner(account);
  }
  if (oldPool === "active" && pool !== "active") {
    clearChatPartner(account.id);
  }
}
async function rotatePools() {
  const onlineAccounts = Array.from(accounts.values()).filter((a) => a.status === "online");
  if (onlineAccounts.length === 0) {
    scheduleNextRotation();
    return;
  }
  addLog("info", `\u{1F504} Starting pool rotation for ${onlineAccounts.length} accounts`);
  const totalOnline = onlineAccounts.length;
  const targetActive = Math.min(config.activePoolSize, Math.ceil(totalOnline * 0.3));
  const targetIdle = Math.min(config.idlePoolSize, Math.ceil(totalOnline * 0.5));
  const shuffled = shuffleArray(onlineAccounts);
  let activeCount = 0;
  let idleCount = 0;
  for (const account of shuffled) {
    if (activeCount < targetActive) {
      if (account.pool !== "active") {
        await assignAccountToPool(account, "active");
      }
      activeCount++;
    } else if (idleCount < targetIdle) {
      if (account.pool !== "idle") {
        await assignAccountToPool(account, "idle");
      }
      idleCount++;
    } else {
      if (account.pool !== "offline") {
        await assignAccountToPool(account, "offline");
      }
    }
  }
  addLog("info", `\u2705 Pool rotation complete: ${activeCount} active, ${idleCount} idle, ${totalOnline - activeCount - idleCount} offline`);
  io.emit("pool-rotation", {
    active: activeCount,
    idle: idleCount,
    offline: totalOnline - activeCount - idleCount
  });
  scheduleNextRotation();
}
function scheduleNextRotation() {
  if (rotationTimer) {
    clearTimeout(rotationTimer);
  }
  const interval = getRandomInt(config.rotationIntervalMin, config.rotationIntervalMax);
  addLog("info", `\u23F0 Next pool rotation in ${Math.round(interval / 6e4)} minutes`);
  rotationTimer = setTimeout(() => {
    rotatePools();
  }, interval);
}
async function findChatPartner(account) {
  if (!config.chatSimulationEnabled) return null;
  const activeAccounts = getActiveAccounts().filter(
    (a) => a.id !== account.id && !a.currentChatPartner && account.socket?.user?.id && a.socket?.user?.id
  );
  if (activeAccounts.length === 0) return null;
  const partner = getRandomItem(activeAccounts);
  account.currentChatPartner = partner.id;
  partner.currentChatPartner = account.id;
  const sharedInterests = findSharedInterests(account.personality, partner.personality);
  const initialTopic = {
    topic: getRandomItem(TOPIC_CATEGORIES.daily_life.topics),
    category: TOPIC_CATEGORIES.daily_life.name
  };
  const pairId = `${account.id}-${partner.id}`;
  const newPair = {
    account1Id: account.id,
    account2Id: partner.id,
    startedAt: /* @__PURE__ */ new Date(),
    messageCount: 0,
    currentTopic: initialTopic.topic,
    topicCategory: initialTopic.category,
    topicStartedAt: /* @__PURE__ */ new Date(),
    topicsDiscussed: [],
    conversationContext: [],
    relationshipStage: "stranger",
    sharedInterests,
    // Anti-spam tracking
    unansweredMessages: 0,
    lastSenderId: "",
    // Natural decay
    silenceCount: 0,
    lastRespondedAt: void 0
  };
  chatPairs.set(pairId, newPair);
  addLog("warming", `\u{1F495} Chat pair created: ${account.personality?.name || account.id} \u2194 ${partner.personality?.name || partner.id} | Topic: "${initialTopic.topic}"`);
  setTimeout(() => {
    initiateChatSimulation(account, partner);
  }, getRandomInt(3e4, 12e4));
  return partner.id;
}
function clearChatPartner(accountId) {
  const account = accounts.get(accountId);
  if (!account) return;
  if (account.currentChatPartner) {
    const partner = accounts.get(account.currentChatPartner);
    if (partner) {
      partner.currentChatPartner = void 0;
    }
    for (const [pairId, pair] of chatPairs.entries()) {
      if (pair.account1Id === accountId || pair.account2Id === accountId) {
        chatPairs.delete(pairId);
      }
    }
    account.currentChatPartner = void 0;
  }
}
function shouldConversationEnd(pair, sender) {
  if (!config.conversationDecayEnabled) {
    return { end: false };
  }
  if (pair.silenceCount >= (config.maxSilenceCount || 3)) {
    return { end: true, reason: "Too many silences - conversation naturally ended" };
  }
  if (!isInActiveWindow(sender.personality)) {
    return { end: true, reason: `${sender.personality?.name || sender.id} is outside active hours` };
  }
  if (Math.random() < 0.05) {
    return { end: true, reason: "Random busy event - person got busy" };
  }
  let endChance = 0.02;
  switch (pair.relationshipStage) {
    case "stranger":
      endChance = 0.05;
      break;
    case "acquaintance":
      endChance = 0.03;
      break;
    case "friend":
      endChance = 0.02;
      break;
    case "close_friend":
      endChance = 0.01;
      break;
  }
  const messageCountFactor = Math.min(pair.messageCount / 50, 0.1);
  endChance += messageCountFactor;
  if (Math.random() < endChance) {
    return { end: true, reason: "Natural conversation decay" };
  }
  return { end: false };
}
async function endConversationNaturally(pair, account1, account2, reason) {
  addLog("warming", ` \u{1F51A} Conversation ended naturally: ${account1.personality?.name || account1.id} \u2194 ${account2.personality?.name || account2.id} | ${reason}`);
  const pairId = `${account1.id}-${account2.id}`;
  chatPairs.delete(pairId);
  account1.currentChatPartner = void 0;
  account2.currentChatPartner = void 0;
  const delay1 = getRandomInt(5 * 60 * 1e3, 30 * 60 * 1e3);
  const delay2 = getRandomInt(5 * 60 * 1e3, 30 * 60 * 1e3);
  setTimeout(async () => {
    if (account1.pool === "active" && account1.status === "online") {
      await findChatPartner(account1);
    }
  }, delay1);
  setTimeout(async () => {
    if (account2.pool === "active" && account2.status === "online") {
      await findChatPartner(account2);
    }
  }, delay2);
}
async function initiateChatSimulation(account1, account2) {
  if (account1.pool !== "active" || account2.pool !== "active") return;
  if (!account1.socket || !account2.socket) return;
  const jid1 = account1.socket.user?.id;
  const jid2 = account2.socket.user?.id;
  if (!jid1 || !jid2) return;
  const pairId = `${account1.id}-${account2.id}`;
  const pair = chatPairs.get(pairId);
  if (!pair) return;
  if (pair.unansweredMessages >= 3) {
    addLog("warming", `\u{1F6D1} [SPAM PREVENT] ${account1.personality?.name || account1.id} \u2194 ${account2.personality?.name || account2.id}: Already sent ${pair.unansweredMessages} unanswered messages. Waiting for reply...`);
    return;
  }
  const initiator = Math.random() > 0.5 ? account1 : account2;
  const receiver = initiator === account1 ? account2 : account1;
  const receiverJid = initiator === account1 ? jid2 : jid1;
  const rateCheck = checkRateLimit(initiator);
  if (!rateCheck.allowed) {
    addLog("ratelimit", `\u23F8\uFE0F Rate limited: ${rateCheck.reason}`, initiator.id);
    return;
  }
  const message = pair.currentTopic;
  try {
    if (initiator.socket && initiator.status === "online") {
      await initiator.socket.sendMessage(receiverJid, { text: message });
      pair.unansweredMessages++;
      pair.lastSenderId = initiator.id;
      incrementRateLimit(initiator);
      initiator.warmingStats.messagesSent++;
      initiator.warmingStats.lastActivity = /* @__PURE__ */ new Date();
      pair.messageCount++;
      pair.lastMessageAt = /* @__PURE__ */ new Date();
      pair.conversationContext.push(`${initiator.personality?.name || initiator.id}: ${message}`);
      pair.topicsDiscussed.push(message);
      addLog("warming", `\u{1F4AC} [${initiator.personality?.name || initiator.id}] "${message.substring(0, 25)}..." \u2192 ${receiver.personality?.name || receiver.id} (unanswered: ${pair.unansweredMessages}/3)`);
      io.emit("message", {
        id: `${Date.now()}`,
        accountId: initiator.id,
        from: "me",
        to: receiverJid,
        text: message,
        timestamp: /* @__PURE__ */ new Date(),
        direction: "outgoing",
        isAutoResponse: true
      });
      setTimeout(() => {
        simulateChatResponse(receiver, initiator, message, pair);
      }, getRandomInt(6e4, 18e4));
    }
  } catch (error) {
    addLog("error", `Failed to initiate chat: ${error}`, initiator.id);
  }
}
async function simulateChatResponse(responder, partner, incomingMessage, pair) {
  if (responder.pool !== "active" || partner.pool !== "active") return;
  if (!responder.socket || !partner.socket) return;
  if (isInSilentPeriod(responder)) {
    addLog("warming", `\u{1F634} [${responder.personality?.name || responder.id}] is in silent period, not responding`);
    pair.silenceCount++;
    return;
  }
  if (shouldIgnoreMessage()) {
    pair.silenceCount++;
    addLog("warming", `\u{1F4F1} [${responder.personality?.name || responder.id}] ignoring message (busy - Safe Mode) - unanswered: ${pair.unansweredMessages}/3`);
    return;
  }
  if (responder.sessionActivity.messagesInSession >= SAFE_MODE_CONFIG.maxActivityMinutesPerSession) {
    addLog("warming", `\u23F8\uFE0F [${responder.personality?.name || responder.id}] session limit reached, starting rest period`);
    startSilentPeriod(responder);
    return;
  }
  const endCheck = shouldConversationEnd(pair, responder);
  if (endCheck.end) {
    pair.silenceCount++;
    pair.lastRespondedAt = /* @__PURE__ */ new Date();
    if (pair.silenceCount >= (config.maxSilenceCount || 3)) {
      await endConversationNaturally(pair, responder, partner, endCheck.reason || "Natural decay");
      return;
    }
    addLog("warming", `\u{1F92B} [${responder.personality?.name || responder.id}] staying silent (silence ${pair.silenceCount}/${config.maxSilenceCount})`);
    return;
  }
  const rateCheck = checkRateLimit(responder);
  if (!rateCheck.allowed) {
    addLog("ratelimit", `\u23F8\uFE0F Rate limited: ${rateCheck.reason}`, responder.id);
    pair.silenceCount++;
    return;
  }
  const responderJid = responder.socket.user?.id;
  const partnerJid = partner.socket.user?.id;
  if (!responderJid || !partnerJid) return;
  pair.unansweredMessages = 0;
  pair.silenceCount = 0;
  pair.lastRespondedAt = /* @__PURE__ */ new Date();
  try {
    const context = buildConversationContext(pair, responder, partner);
    const response = await generateAIResponse(incomingMessage, responder.personality, context);
    if (config.typingSimulationEnabled) {
      await responder.socket.sendPresenceUpdate("composing", partnerJid);
      await delay(getTypingDelay(response.length));
      await responder.socket.sendPresenceUpdate("paused", partnerJid);
    }
    await responder.socket.sendMessage(partnerJid, { text: response });
    pair.unansweredMessages = 1;
    pair.lastSenderId = responder.id;
    incrementRateLimit(responder);
    responder.warmingStats.messagesSent++;
    responder.warmingStats.autoResponsesSent++;
    responder.warmingStats.lastActivity = /* @__PURE__ */ new Date();
    responder.sessionActivity.messagesInSession++;
    responder.sessionActivity.lastMessageTime = /* @__PURE__ */ new Date();
    if (!responder.sessionActivity.sessionStart) {
      responder.sessionActivity.sessionStart = /* @__PURE__ */ new Date();
    }
    pair.messageCount++;
    pair.lastMessageAt = /* @__PURE__ */ new Date();
    pair.conversationContext.push(`${responder.personality?.name || responder.id}: ${response}`);
    updateRelationshipStage(pair);
    if (pair.messageCount % getRandomInt(5, 8) === 0) {
      const newTopic = generateNewTopic(pair, responder, partner);
      pair.currentTopic = newTopic.topic;
      pair.topicCategory = newTopic.category;
      pair.topicStartedAt = /* @__PURE__ */ new Date();
      addLog("info", `\u{1F504} Topic changed for ${responder.id} \u2194 ${partner.id}: "${newTopic.topic}"`);
    }
    addLog("warming", `\u{1F4AC} [${responder.personality?.name || responder.id}] "${response.substring(0, 25)}..." (${RELATIONSHIP_STAGES[pair.relationshipStage].description})`);
    io.emit("message", {
      id: `${Date.now()}`,
      accountId: responder.id,
      from: "me",
      to: partnerJid,
      text: response,
      timestamp: /* @__PURE__ */ new Date(),
      direction: "outgoing",
      isAutoResponse: true
    });
    if (shouldStartSilentPeriod(responder)) {
      startSilentPeriod(responder);
    }
    let continueProbability = 0.3;
    switch (pair.relationshipStage) {
      case "stranger":
        continueProbability = 0.2;
        break;
      // Reduced
      case "acquaintance":
        continueProbability = 0.3;
        break;
      case "friend":
        continueProbability = 0.4;
        break;
      case "close_friend":
        continueProbability = 0.5;
        break;
    }
    const afterEndCheck = shouldConversationEnd(pair, responder);
    if (afterEndCheck.end) {
      setTimeout(async () => {
        await endConversationNaturally(pair, responder, partner, afterEndCheck.reason || "Natural decay");
      }, getRandomInt(6e4, 18e4));
      return;
    }
    const responseDelay = SAFE_MODE_CONFIG.enabled ? getSafeResponseDelay() : getRandomInt(12e4, 3e5);
    if (Math.random() < continueProbability && pair.messageCount < 15) {
      setTimeout(() => {
        if (partner.pool === "active") {
          simulateChatResponse(partner, responder, response, pair);
        }
      }, responseDelay);
    }
  } catch (error) {
    addLog("error", `Failed to send chat response: ${error}`, responder.id);
  }
}
async function generateAIResponse(message, personality, conversationContext) {
  let systemPrompt = config.aiSystemPrompt;
  if (personality) {
    systemPrompt = `Kamu adalah ${personality.name}, seorang ${personality.occupation} berusia ${personality.age} tahun dari ${personality.location}.

Kepribadianmu: ${personality.traits.join(", ")}.
Hobimu: ${personality.hobbies.join(", ")}.
Gaya menulis: ${personality.writingStyle}.
Gaya respons: ${personality.responseStyle}.

PENTING:
- Balas pesan dengan gaya chat WhatsApp yang natural dan konsisten dengan kepribadianmu
- Jangan pernah mengatakan bahwa kamu adalah AI atau bot
- Gunakan bahasa casual Indonesia dengan gaya khasmu
- Balas singkat (1-2 kalimat) dan natural
- Kadang gunakan emoji yang sesuai dengan kepribadianmu`;
  }
  if (conversationContext) {
    systemPrompt += `

${conversationContext}`;
  }
  try {
    const groq = getGroqInstance();
    if (groq) {
      const completion = await groq.chat.completions.create({
        model: aiApiSettings.groqModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        max_tokens: 150,
        temperature: 0.8
      });
      const response = completion.choices[0]?.message?.content;
      if (response && response.trim().length > 0) {
        return response;
      }
    }
  } catch (error) {
    console.error("Groq AI failed:", error);
  }
  return getRandomItem(FALLBACK_RESPONSES);
}
async function preGeneratePersonalities(count = 10) {
  if (isGeneratingPersonalities || personalityPool.length >= MAX_PERSONALITY_POOL) return;
  isGeneratingPersonalities = true;
  const personalityPrompt = `Generate ${Math.min(5, count - personalityPool.length)} unique Indonesian personalities for WhatsApp accounts.
Return as JSON array: [{"name":"Nama","age":25,"occupation":"Pekerjaan","location":"Kota","traits":["trait1","trait2"],"writingStyle":"gaya","hobbies":["hobi1","hobi2"],"responseStyle":"gaya respons"}]

Make each personality unique and diverse.`;
  try {
    const groq = getGroqInstance();
    if (groq) {
      const completion = await groq.chat.completions.create({
        model: aiApiSettings.groqModel,
        messages: [
          { role: "system", content: personalityPrompt },
          { role: "user", content: "Generate personalities now. Return ONLY valid JSON array, no other text." }
        ],
        max_tokens: 1e3,
        temperature: 0.8
      });
      const response = completion.choices[0]?.message?.content;
      if (response) {
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const personalities = JSON.parse(jsonMatch[0]);
          const toAdd = personalities.slice(0, MAX_PERSONALITY_POOL - personalityPool.length);
          const chronotypes = ["early_bird", "night_owl", "regular", "flexible"];
          toAdd.forEach((p) => {
            if (!p.chronotype) {
              p.chronotype = chronotypes[Math.floor(Math.random() * chronotypes.length)];
            }
          });
          personalityPool.push(...toAdd);
          console.log(`\u2705 Generated ${toAdd.length} personalities via Groq. Pool size: ${personalityPool.length}/${MAX_PERSONALITY_POOL}`);
          isGeneratingPersonalities = false;
          return;
        }
      }
    }
  } catch (error) {
    console.error("Groq personality generation failed:", error);
  }
  isGeneratingPersonalities = false;
}
var CHRONOTYPE_CONFIGS = {
  early_bird: {
    name: "Early Bird",
    activeHoursStart: 5,
    // 5 AM
    activeHoursEnd: 21,
    // 9 PM
    peakHours: [7, 8, 9, 12, 13, 17, 18],
    // Morning & lunch & early evening
    description: "Aktif pagi, tidur malam"
  },
  night_owl: {
    name: "Night Owl",
    activeHoursStart: 10,
    // 10 AM
    activeHoursEnd: 2,
    // 2 AM (next day)
    peakHours: [13, 14, 20, 21, 22, 23, 0, 1],
    // Afternoon & night
    description: "Bangun siang, aktif malam"
  },
  regular: {
    name: "Regular",
    activeHoursStart: 7,
    // 7 AM
    activeHoursEnd: 22,
    // 10 PM
    peakHours: [8, 9, 12, 13, 18, 19, 20],
    // Normal work hours
    description: "Jadwal normal"
  },
  flexible: {
    name: "Flexible",
    activeHoursStart: 6,
    // 6 AM
    activeHoursEnd: 23,
    // 11 PM
    peakHours: [9, 10, 14, 15, 19, 20, 21],
    // Flexible hours
    description: "Fleksibel, bisa kapan saja"
  }
};
function isInActiveWindow(personality) {
  if (!personality) return true;
  const now = /* @__PURE__ */ new Date();
  const currentHour = now.getHours();
  const { activeHoursStart, activeHoursEnd } = personality;
  if (activeHoursStart > activeHoursEnd) {
    return currentHour >= activeHoursStart || currentHour < activeHoursEnd;
  }
  return currentHour >= activeHoursStart && currentHour < activeHoursEnd;
}
async function generateUniquePersonality(accountId) {
  if (personalityPool.length > 0) {
    const personality2 = personalityPool.shift();
    console.log(`Using pooled personality for ${accountId}:`, personality2?.name);
    preGeneratePersonalities(10);
    return personality2 || null;
  }
  const indonesianNames = [
    "Andi",
    "Budi",
    "Citra",
    "Dewi",
    "Eko",
    "Fitri",
    "Gunawan",
    "Hani",
    "Indra",
    "Joko",
    "Kartini",
    "Lukman",
    "Maya",
    "Nadia",
    "Oscar",
    "Putri",
    "Rizki",
    "Sari",
    "Toni",
    "Wati",
    "Yudi",
    "Zahra",
    "Ahmad",
    "Bella",
    "Dimas",
    "Eva",
    "Fajar",
    "Gita",
    "Hendra",
    "Irma"
  ];
  const occupations = [
    "Mahasiswa",
    "Karyawan swasta",
    "Wiraswasta",
    "Guru",
    "Dokter",
    "Programmer",
    "Desainer",
    "Pengusaha",
    "Freelancer",
    "Content creator",
    "Pekerja seni",
    "Konsultan",
    "Pegawai negeri",
    "Penjual online",
    "Barista",
    "Fotografer"
  ];
  const locations = [
    "Jakarta",
    "Bandung",
    "Surabaya",
    "Yogyakarta",
    "Semarang",
    "Malang",
    "Bekasi",
    "Tangerang",
    "Depok",
    "Bogor",
    "Solo",
    "Medan",
    "Makassar"
  ];
  const traitsPool = ["ramah", "humoris", "penyabar", "aktif", "kreatif", "peduli", "tekun", "santai"];
  const hobbiesPool = ["musik", "film", "gaming", "traveling", "kuliner", "fotografi", "olahraga", "membaca", "nonton drama", "jalan-jalan"];
  const writingStyles = [
    "suka pakai emoji di setiap pesan \u{1F60A}",
    "jarang pakai emoji, lebih ke teks biasa",
    "suka pakai bahasa gaul Jakarta",
    'suka pakai "wkwk" atau "haha"',
    "suka pake singkatan (yg, gpp, bgt)",
    "respon formal dan sopan"
  ];
  const responseStyles = [
    "cepat merespon, langsung ke inti",
    "suka nanya balik sebelum jawab",
    "suka kasih saran atau solusi",
    "respon singkat tapi bermakna",
    "suka cerita panjang lebar",
    "suka pake pertanyaan di akhir kalimat"
  ];
  const occupation = getRandomItem(occupations);
  let chronotype = "regular";
  if (["Mahasiswa", "Content creator", "Freelancer", "Desainer", "Programmer"].includes(occupation)) {
    chronotype = Math.random() > 0.4 ? "night_owl" : "flexible";
  } else if (["Guru", "Pegawai negeri", "Dokter", "Barista"].includes(occupation)) {
    chronotype = Math.random() > 0.4 ? "early_bird" : "regular";
  } else {
    const types = ["early_bird", "night_owl", "regular", "flexible"];
    chronotype = getRandomItem(types);
  }
  const chronotypeConfig = CHRONOTYPE_CONFIGS[chronotype];
  const emojiUsage = getRandomItem(["heavy", "moderate", "minimal"]);
  const avgMessageLength = getRandomItem(["short", "medium", "long"]);
  let avgResponseTime = getRandomInt(2, 30);
  if (chronotype === "flexible") avgResponseTime = getRandomInt(1, 15);
  if (avgMessageLength === "long") avgResponseTime += 5;
  const randomTraits = Array.from({ length: 3 }, () => getRandomItem(traitsPool));
  const randomHobbies = Array.from({ length: 3 }, () => getRandomItem(hobbiesPool));
  const personality = {
    name: getRandomItem(indonesianNames),
    age: Math.floor(Math.random() * 22) + 18,
    occupation,
    location: getRandomItem(locations),
    traits: [...new Set(randomTraits)].slice(0, 3),
    writingStyle: getRandomItem(writingStyles),
    hobbies: [...new Set(randomHobbies)].slice(0, 3),
    responseStyle: getRandomItem(responseStyles),
    // Chronotype
    chronotype,
    activeHoursStart: chronotypeConfig.activeHoursStart,
    activeHoursEnd: chronotypeConfig.activeHoursEnd,
    peakHours: chronotypeConfig.peakHours,
    // Communication preferences
    avgResponseTime,
    emojiUsage,
    avgMessageLength
  };
  console.log(`Generated personality for ${accountId}:`, personality.name, `(${chronotypeConfig.name})`);
  return personality;
}
async function clearSessionData(accountId) {
  const sessionPath = join(SESSIONS_DIR, accountId);
  console.log("[CLEAR SESSION] Attempting to clear session for:", accountId);
  console.log("[CLEAR SESSION] Session path:", sessionPath);
  try {
    try {
      await access(sessionPath);
      console.log("[CLEAR SESSION] Session directory exists");
    } catch {
      console.log("[CLEAR SESSION] Session directory does not exist, nothing to clear");
      return { success: true };
    }
    console.log("[CLEAR SESSION] Deleting session directory with rimraf...");
    await rimraf(sessionPath, {
      maxRetries: 5,
      retryDelay: 100,
      glob: false
    });
    try {
      await access(sessionPath);
      console.log("[CLEAR SESSION] \u26A0\uFE0F Session directory still exists after deletion!");
      return { success: false, error: "Session directory still exists after deletion" };
    } catch {
      console.log("[CLEAR SESSION] \u2705 Session directory successfully deleted");
      return { success: true };
    }
  } catch (error) {
    console.error("[CLEAR SESSION] \u274C Error clearing session:", error);
    return { success: false, error: error?.message || "Unknown error" };
  }
}
function getRandomDelay() {
  const baseMin = config.warmerDelayMin;
  const baseMax = config.warmerDelayMax;
  let multiplier = 1;
  switch (config.warmingIntensity) {
    case "low":
      multiplier = 1.5;
      break;
    case "high":
      multiplier = 0.5;
      break;
  }
  return Math.floor(Math.random() * ((baseMax - baseMin) * multiplier) + baseMin * multiplier);
}
function getTypingDelay(messageLength) {
  const baseDelay = Math.min(messageLength / 40 * 1e3, 5e3);
  const randomFactor = 0.5 + Math.random();
  return Math.floor(baseDelay * randomFactor + 1e3);
}
function calculateHealthScore(stats) {
  let score = 100;
  if (stats.lastActivity) {
    const hoursSinceActivity = (Date.now() - stats.lastActivity.getTime()) / (1e3 * 60 * 60);
    if (hoursSinceActivity > 24) score -= 30;
    else if (hoursSinceActivity > 12) score -= 15;
    else if (hoursSinceActivity > 6) score -= 5;
  }
  if (stats.messagesSent > 0 && stats.messagesReceived > 0) {
    const ratio = Math.min(stats.messagesSent / stats.messagesReceived, 2);
    if (ratio >= 0.5 && ratio <= 1.5) score += 10;
  }
  if (stats.totalWarmingHours > 24) score += 10;
  else if (stats.totalWarmingHours > 12) score += 5;
  return Math.min(100, Math.max(0, score));
}
async function startSession(accountId, usePairingCode = false, phoneNumber, forceNew = false) {
  console.log("==========================================");
  console.log("[START SESSION] Called with:", { accountId, usePairingCode, phoneNumber, forceNew });
  console.log("[START SESSION] Current accounts:", Array.from(accounts.keys()));
  console.log("==========================================");
  try {
    const existingAccountForGuard = accounts.get(accountId);
    if (existingAccountForGuard?.status === "connecting") {
      console.log("[START SESSION] \u26A0\uFE0F Account already connecting, skipping duplicate call");
      addLog("warning", `\u26A0\uFE0F Session already connecting for ${accountId}, skipping duplicate`, accountId);
      return;
    }
    if (existingAccountForGuard?.socket) {
      console.log("[START SESSION] Closing old socket for:", accountId);
      try {
        existingAccountForGuard.socket.end?.();
      } catch (e) {
        console.log("[START SESSION] Error closing old socket:", e);
      }
    }
    if (forceNew) {
      console.log("[START SESSION] forceNew=true, clearing old session data...");
      addLog("info", `\u{1F504} Force new session - clearing old data for ${accountId}`, accountId);
      const clearResult = await clearSessionData(accountId);
      if (!clearResult.success) {
        console.log("[START SESSION] \u26A0\uFE0F Failed to clear session:", clearResult.error);
        addLog("warning", `\u26A0\uFE0F Session clear warning: ${clearResult.error}`, accountId);
      } else {
        console.log("[START SESSION] \u2705 Session data cleared successfully");
        addLog("info", `\u2705 Old session data cleared for ${accountId}`, accountId);
      }
    }
    if (BURNABLE_CONFIG.bannedAccounts.has(accountId)) {
      addLog("error", `\u{1F6AB} BLOCKED: Account ${accountId} is in banned list. Not starting session.`, accountId);
      return;
    }
    const existingAccount = accounts.get(accountId);
    const isReconnect = existingAccount !== void 0;
    const existingPersonality = personalityRegistry.get(accountId);
    const hasEverConnected = everConnected.get(accountId) || false;
    if (!reconnectAttempts.has(accountId)) {
      reconnectAttempts.set(accountId, 0);
    }
    const currentAttempts = reconnectAttempts.get(accountId) || 0;
    if (hasEverConnected && currentAttempts >= MAX_RECONNECT_ATTEMPTS) {
      addLog("error", `Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Account may be banned.`, accountId);
      await handleBannedAccount(accountId, "Max reconnect attempts reached");
      return;
    }
    if (isReconnect && hasEverConnected) {
      reconnectAttempts.set(accountId, currentAttempts + 1);
      addLog("info", `Reconnecting session for account ${accountId} (attempt ${currentAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`, accountId);
    } else if (existingPersonality) {
      addLog("info", `Starting session for account ${accountId} (reusing existing personality: ${existingPersonality.name})`, accountId);
    } else {
      addLog("info", `Starting new session for account ${accountId}`, accountId);
    }
    const sessionDir = join(SESSIONS_DIR, accountId);
    await mkdir(sessionDir, { recursive: true });
    console.log("[START SESSION] Session directory created:", sessionDir);
    console.log("[START SESSION] Loading auth state...");
    let { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    console.log("[START SESSION] Auth state loaded:");
    console.log("[START SESSION] - hasCreds:", !!state.creds);
    console.log("[START SESSION] - creds.me exists:", !!state.creds?.me);
    console.log("[START SESSION] - creds.me.id:", state.creds?.me?.id || "N/A");
    console.log("[START SESSION] - creds.me.name:", state.creds?.me?.name || "N/A");
    console.log("[START SESSION] - This account will:", state.creds?.me ? "TRY LOGIN (no QR)" : "REGISTER (expect QR)");
    if (state.creds && !state.creds.me && !forceNew) {
      console.log("[START SESSION] \u26A0\uFE0F INCOMPLETE SESSION DETECTED! creds exists but no me identity.");
      console.log("[START SESSION] This happens when QR was generated but never scanned.");
      console.log("[START SESSION] Auto-clearing incomplete session to force fresh QR generation...");
      addLog("warning", `\u26A0\uFE0F Incomplete session detected for ${accountId}, auto-clearing to generate fresh QR`, accountId);
      const clearResult = await clearSessionData(accountId);
      if (clearResult.success) {
        console.log("[START SESSION] \u2705 Incomplete session cleared, recreating fresh session...");
        await mkdir(sessionDir, { recursive: true });
        const freshAuth = await useMultiFileAuthState(sessionDir);
        state = freshAuth.state;
        saveCreds = freshAuth.saveCreds;
        console.log("[START SESSION] \u2705 Fresh auth state loaded");
        console.log("[START SESSION] - hasCreds:", !!state.creds);
        console.log("[START SESSION] - creds.me exists:", !!state.creds?.me);
      } else {
        console.log("[START SESSION] \u26A0\uFE0F Failed to clear incomplete session:", clearResult.error);
        addLog("warning", `\u26A0\uFE0F Failed to clear incomplete session: ${clearResult.error}`, accountId);
      }
    }
    console.log("[START SESSION] Fetching Baileys version...");
    const { version } = await fetchLatestBaileysVersion();
    console.log("[START SESSION] Baileys version:", version);
    console.log("[START SESSION] Creating WhatsApp socket...");
    console.log("[NETWORK] Testing connectivity to WhatsApp servers...");
    try {
      const dns = await import("dns").then((m) => m.promises);
      const addresses = await dns.resolve4("web.whatsapp.com").catch(() => []);
      console.log("[NETWORK] DNS resolution for web.whatsapp.com:", addresses.length > 0 ? addresses : "FAILED");
    } catch (e) {
      console.log("[NETWORK] DNS test error:", e);
    }
    try {
      const https = await import("https");
      const testHttps = () => new Promise((resolve, reject) => {
        const req = https.request("https://web.whatsapp.com", { method: "HEAD", timeout: 1e4 }, (res) => {
          console.log("[NETWORK] HTTPS test to web.whatsapp.com: Status", res.statusCode);
          resolve(res.statusCode);
        });
        req.on("error", (e) => {
          console.log("[NETWORK] HTTPS test FAILED:", e.message);
          reject(e);
        });
        req.on("timeout", () => {
          console.log("[NETWORK] HTTPS test TIMEOUT");
          req.destroy();
          reject(new Error("Timeout"));
        });
        req.end();
      });
      await testHttps().catch(() => {
      });
    } catch (e) {
      console.log("[NETWORK] HTTPS test error:", e);
    }
    const socket = makeWASocket({
      version,
      logger,
      auth: state,
      browser: Browsers.macOS("Chrome"),
      // Use macOS Chrome - more stable compatibility
      syncFullHistory: false,
      getMessage: async () => void 0,
      shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidGroup(jid),
      generateHighQualityLinkPreview: false,
      patchMessageBeforeSending: (message) => {
        const requiresPatch = !!(message.buttonsMessage || message.listMessage || message.templateMessage);
        if (requiresPatch) {
          message = JSON.parse(JSON.stringify(message));
          message.viewOnceMessage = { message: {} };
        }
        return message;
      }
    });
    console.log("[SOCKET] makeWASocket created for:", accountId);
    console.log("[SOCKET] Socket has ev?", !!socket.ev);
    console.log("[SOCKET] Socket has ws?", !!socket.ws);
    console.log("[SOCKET] Socket user?", socket.user);
    const pendingAccount = {
      id: accountId,
      status: "connecting",
      socket,
      warmingEnabled: config.warmerEnabled,
      warmingStats: {
        accountId,
        messagesReceived: 0,
        messagesSent: 0,
        autoResponsesSent: 0,
        totalWarmingHours: 0,
        healthScore: 50,
        rateLimit: createDefaultRateLimit(),
        currentPhase: 1,
        warmingDays: 0
      },
      warmingTimers: [],
      personality: existingPersonality || null,
      pool: "offline",
      poolSince: /* @__PURE__ */ new Date(),
      chatHistory: [],
      isInActiveWindow: true,
      silentPeriod: { isActive: false },
      sessionActivity: { messagesInSession: 0 }
    };
    accounts.set(accountId, pendingAccount);
    console.log("[ACCOUNT] \u2705 Added pending account to map immediately:", accountId);
    console.log("[SOCKET] \u{1F680} Registering connection.update handler IMMEDIATELY for:", accountId);
    socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;
      console.log("==========================================");
      console.log("[CONNECTION UPDATE] \u2705 EVENT RECEIVED!", {
        accountId,
        connection,
        hasQr: !!qr,
        qrPreview: qr ? qr.substring(0, 50) + "..." : null,
        isNewLogin
      });
      console.log("==========================================");
      const account2 = accounts.get(accountId);
      if (!account2) {
        console.error("[CONNECTION UPDATE] \u274C Account not found in map!", accountId);
        return;
      }
      if (connection === "open") {
        reconnectAttempts.set(accountId, 0);
        everConnected.set(accountId, true);
        account2.status = "online";
        account2.pool = "active";
        console.log("[CONNECTION] \u2705 Successfully connected:", accountId);
        addLog("info", `\u2705 WhatsApp connected successfully`, accountId);
        io.emit("account-status", { accountId, status: "online" });
        const t = connectionTimeouts.get(accountId);
        if (t) {
          clearTimeout(t);
          connectionTimeouts.delete(accountId);
        }
      }
      if (qr) {
        console.log("[QR] \u{1F3AF} QR code received for:", accountId);
        console.log("[QR] QR length:", qr.length);
        if (usePairingCode && phoneNumber) {
          try {
            const code = await socket.requestPairingCode(phoneNumber);
            account2.pairingCode = code;
            io.emit("pairing-code", { accountId, code });
            addLog("info", `\u{1F4F1} Pairing code generated: ${code}`, accountId);
            console.log("[PAIRING] Code generated:", code);
          } catch (error) {
            addLog("error", `\u274C Failed to generate pairing code: ${error?.message || error}`, accountId);
            console.error("[PAIRING ERROR]", error);
          }
        } else {
          console.log("[QR] Converting QR to data URL...");
          try {
            const qrDataUrl = await QRCode.toDataURL(qr);
            account2.qrCode = qrDataUrl;
            console.log("[QR] \u2705 QR converted, length:", qrDataUrl.length);
            io.emit("qr-code", { accountId, qr: qrDataUrl });
            addLog("info", "\u{1F4F1} QR code generated - scan with WhatsApp", accountId);
          } catch (qrError) {
            console.error("[QR] \u274C Failed to convert QR:", qrError);
            addLog("error", `\u274C QR conversion failed: ${qrError?.message}`, accountId);
          }
        }
      }
      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || "";
        console.log("[CONNECTION] \u274C Disconnected:", accountId, "code:", statusCode, "error:", errorMessage);
        if (pendingDeletion.has(accountId)) {
          addLog("info", `\u{1F6AE} Account deletion in progress, skipping reconnect`, accountId);
          pendingDeletion.delete(accountId);
          return;
        }
        const hasConnected = everConnected.get(accountId) || false;
        const currentAttemptCount = reconnectAttempts.get(accountId) || 0;
        const DEFINITE_BAN_CODE = 403;
        const TEMPORARY_CODES = [
          DisconnectReason.restartRequired,
          401,
          408,
          409,
          429,
          500,
          502,
          503,
          504,
          DisconnectReason.badSession
        ];
        const isTemporaryCode = TEMPORARY_CODES.includes(statusCode);
        const isDefiniteBan = statusCode === DEFINITE_BAN_CODE;
        let isBanned = false;
        let banReason = "";
        if (isDefiniteBan) {
          isBanned = true;
          banReason = `Account banned (code: ${statusCode})`;
        } else if (statusCode === 401 && hasConnected) {
          if (currentAttemptCount >= MAX_RECONNECT_ATTEMPTS) {
            isBanned = true;
            banReason = `Session lost after multiple attempts (code: ${statusCode})`;
          }
        }
        account2.status = "offline";
        account2.pool = "offline";
        io.emit("account-status", { accountId, status: "offline" });
        const statusDesc = isBanned ? "\u{1F6AB} BAN DETECTED" : isTemporaryCode ? "\u23F3 Temporary error" : "\u{1F50C} Disconnected";
        addLog("connection", `${statusDesc} (code: ${statusCode})${errorMessage ? ` - ${errorMessage}` : ""}`, accountId);
        stopWarmingTimers(accountId);
        clearChatPartner(accountId);
        if (isBanned) {
          await handleBannedAccount(accountId, banReason);
          return;
        }
        if (isTemporaryCode || statusCode === 401) {
          const delay2 = Math.min(5e3 * (currentAttemptCount + 1), 6e4);
          addLog("info", `\u{1F504} Reconnecting in ${delay2 / 1e3}s...`, accountId);
          setTimeout(async () => {
            const currentAttempt = reconnectAttempts.get(accountId) || 0;
            if (currentAttempt < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttempts.set(accountId, currentAttempt + 1);
              try {
                await fetch(`http://localhost:3030/session/retry`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ accountId, forceNew: statusCode === 401 })
                });
              } catch (e) {
                console.error("[RECONNECT] Failed to trigger reconnect:", e);
              }
            }
          }, delay2);
        }
      }
    });
    socket.ev.on("creds.update", saveCreds);
    console.log("[SOCKET] \u2705 Event handlers registered IMMEDIATELY");
    const getWsStateName = (state2) => {
      if (state2 === void 0) return "UNDEFINED";
      if (state2 === 0) return "CONNECTING";
      if (state2 === 1) return "OPEN";
      if (state2 === 2) return "CLOSING";
      if (state2 === 3) return "CLOSED";
      return `UNKNOWN(${state2})`;
    };
    const nativeWs = socket.ws?.socket;
    const wsState = nativeWs?.readyState;
    console.log("[WS] Native WebSocket exists:", !!nativeWs);
    console.log("[WS] Native WebSocket state:", wsState, "=", getWsStateName(wsState));
    console.log("[WS] WebSocketClient isConnecting:", socket.ws?.isConnecting);
    console.log("[WS] WebSocketClient isOpen:", socket.ws?.isOpen);
    console.log("[WS] WebSocketClient isClosed:", socket.ws?.isClosed);
    console.log("[WS] WebSocket URL:", socket.ws?.url || "N/A");
    const wsMonitorInterval = setInterval(() => {
      const currentNativeWs = socket.ws?.socket;
      const currentState = currentNativeWs?.readyState;
      const stateName = getWsStateName(currentState);
      const isConnecting = socket.ws?.isConnecting;
      const isOpen = socket.ws?.isOpen;
      console.log("[WS MONITOR] Native state:", currentState, "=", stateName, "| isConnecting:", isConnecting, "| isOpen:", isOpen, "for account:", accountId);
      if (currentState === 1 || currentState === 3) {
        clearInterval(wsMonitorInterval);
        console.log("[WS MONITOR] Stopped monitoring. Final state:", stateName);
      }
    }, 2e3);
    if (socket.ws) {
      socket.ws.on("error", (err) => {
        console.error("[WS ERROR] WebSocketClient error for", accountId, ":", err.message);
        console.error("[WS ERROR] Full error:", err);
        addLog("error", `\u{1F534} WebSocket error: ${err.message}`, accountId);
      });
      socket.ws.on("close", (code, reason) => {
        console.log("[WS CLOSE] WebSocketClient closed for", accountId, "code:", code, "reason:", reason.toString());
        clearInterval(wsMonitorInterval);
      });
      socket.ws.on("unexpected-response", (req, res) => {
        console.error("[WS UNEXPECTED] Unexpected response for", accountId);
        console.error("[WS UNEXPECTED] Status:", res?.statusCode);
        console.error("[WS UNEXPECTED] Headers:", res?.headers);
        addLog("error", `\u{1F534} WebSocket unexpected response: ${res?.statusCode}`, accountId);
      });
      if (nativeWs) {
        nativeWs.on("error", (err) => {
          console.error("[WS NATIVE ERROR] Native WebSocket error for", accountId, ":", err.message);
        });
        nativeWs.on("open", () => {
          console.log("[WS NATIVE OPEN] Native WebSocket opened for", accountId);
        });
        nativeWs.on("close", (code, reason) => {
          console.log("[WS NATIVE CLOSE] Native WebSocket closed for", accountId, "code:", code, "reason:", reason.toString());
        });
        nativeWs.on("message", (data, isBinary) => {
          const preview = data.length > 50 ? data.slice(0, 50).toString("base64") + "..." : data.toString("base64");
          console.log("[WS NATIVE MESSAGE] Received for", accountId, "binary:", isBinary, "len:", data.length, "preview:", preview);
        });
        const originalSend = nativeWs.send.bind(nativeWs);
        nativeWs.send = (data, ...args) => {
          const preview = typeof data === "string" ? data.slice(0, 50) : Buffer.isBuffer(data) ? data.slice(0, 50).toString("base64") : "unknown";
          console.log("[WS NATIVE SEND] Sending for", accountId, "type:", typeof data, "preview:", preview);
          return originalSend(data, ...args);
        };
      }
    }
    const account = accounts.get(accountId);
    if (!account) {
      console.error("[SESSION] \u274C Account not found in map after immediate registration!");
      return;
    }
    console.log("[SESSION] \u2705 Retrieved account from map:", accountId);
    if (!account.personality && !existingPersonality) {
      addLog("info", `\u{1F3AD} Generating personality for ${accountId}...`, accountId);
      generateUniquePersonality(accountId).then((personality) => {
        if (personality) {
          account.personality = personality;
          personalityRegistry.set(accountId, personality);
          account.isInActiveWindow = isInActiveWindow(personality);
          const chronotypeDesc = CHRONOTYPE_CONFIGS[personality.chronotype].description;
          addLog("info", `\u2728 Personality: ${personality.name}, ${personality.age}yo ${personality.occupation} (${chronotypeDesc})`, accountId);
        }
      }).catch((err) => console.error("[PERSONALITY] Generation failed:", err));
    } else if (existingPersonality) {
      account.personality = existingPersonality;
      account.isInActiveWindow = isInActiveWindow(existingPersonality);
    }
    io.emit("account-status", { accountId, status: "connecting" });
    const existingTimeout = connectionTimeouts.get(accountId);
    if (existingTimeout) clearTimeout(existingTimeout);
    const timeoutId = setTimeout(() => {
      const acc = accounts.get(accountId);
      if (acc && acc.status === "connecting") {
        addLog("warning", `\u23F0 QR/Pairing timeout - still connecting after 2 minutes.`, accountId);
      }
    }, CONNECTING_TIMEOUT_MS);
    connectionTimeouts.set(accountId, timeoutId);
    socket.ev.on("connection.update", () => {
      clearInterval(wsMonitorInterval);
    });
    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (isJidGroup(msg.key.remoteJid) || isJidBroadcast(msg.key.remoteJid)) continue;
        if (msg.key.fromMe) continue;
        const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || "";
        if (!messageText) continue;
        const from = msg.key.remoteJid;
        account.warmingStats.messagesReceived++;
        account.warmingStats.lastActivity = /* @__PURE__ */ new Date();
        account.warmingStats.healthScore = calculateHealthScore(account.warmingStats);
        addLog("message", `\u{1F4E5} Message: "${messageText.substring(0, 30)}..."`, accountId);
        io.emit("message", {
          id: msg.key.id,
          accountId,
          from,
          to: "me",
          text: messageText,
          timestamp: /* @__PURE__ */ new Date(),
          direction: "incoming"
        });
        io.emit("warming-stats", { accountId, stats: account.warmingStats });
        if (account.warmingEnabled && config.warmerEnabled && account.pool === "active") {
          const rateCheck = checkRateLimit(account);
          if (!rateCheck.allowed) {
            addLog("ratelimit", `\u23F8\uFE0F Auto-reply skipped: ${rateCheck.reason}`, accountId);
            continue;
          }
          const responseDelay = getRandomDelay();
          const delayMinutes = Math.round(responseDelay / 6e4);
          addLog("warming", `\u23F3 Auto-reply scheduled in ${delayMinutes} min`, accountId);
          const timeout = setTimeout(async () => {
            try {
              if (account.status !== "online" || account.pool !== "active") return;
              const rateCheckInner = checkRateLimit(account);
              if (!rateCheckInner.allowed) {
                addLog("ratelimit", `\u23F8\uFE0F Auto-reply cancelled: ${rateCheckInner.reason}`, accountId);
                return;
              }
              const response = await generateAIResponse(messageText, account.personality);
              if (config.typingSimulationEnabled) {
                await socket.sendPresenceUpdate("composing", from);
                await delay(getTypingDelay(response.length));
                await socket.sendPresenceUpdate("paused", from);
              }
              await socket.sendMessage(from, { text: response });
              incrementRateLimit(account);
              account.warmingStats.messagesSent++;
              account.warmingStats.autoResponsesSent++;
              account.warmingStats.lastActivity = /* @__PURE__ */ new Date();
              account.warmingStats.healthScore = calculateHealthScore(account.warmingStats);
              addLog("warming", `\u{1F4E4} Auto-reply: "${response.substring(0, 30)}..."`, accountId);
              io.emit("message", {
                id: `${Date.now()}`,
                accountId,
                from: "me",
                to: from,
                text: response,
                timestamp: /* @__PURE__ */ new Date(),
                direction: "outgoing",
                isAutoResponse: true
              });
              io.emit("warming-stats", { accountId, stats: account.warmingStats });
            } catch (error) {
              addLog("error", `Failed to send auto-reply: ${error}`, accountId);
            }
          }, responseDelay);
          if (!messageQueue.has(accountId)) {
            messageQueue.set(accountId, []);
          }
          messageQueue.get(accountId).push(timeout);
        }
      }
    });
  } catch (error) {
    addLog("error", `Failed to start session: ${error}`, accountId);
    io.emit("account-status", { accountId, status: "offline" });
  }
}
function stopWarmingTimers(accountId) {
  const intervals = warmingIntervals.get(accountId);
  if (intervals) {
    intervals.forEach((i) => clearInterval(i));
    warmingIntervals.delete(accountId);
  }
  const timeouts = messageQueue.get(accountId);
  if (timeouts) {
    timeouts.forEach((t) => clearTimeout(t));
    messageQueue.delete(accountId);
  }
}
async function stopSession(accountId) {
  pendingDeletion.add(accountId);
  const account = accounts.get(accountId);
  if (account?.socket) {
    try {
      await account.socket.logout();
      account.status = "offline";
      account.pool = "offline";
      io.emit("account-status", { accountId, status: "offline" });
      addLog("info", "Session stopped", accountId);
    } catch (error) {
      addLog("error", "Error stopping session", accountId);
    }
  }
  stopWarmingTimers(accountId);
  clearChatPartner(accountId);
}
function toggleWarming(accountId, enabled) {
  const account = accounts.get(accountId);
  if (account) {
    account.warmingEnabled = enabled;
    io.emit("warming-toggle", { accountId, enabled });
    addLog("warming", `${enabled ? "\u2705" : "\u23F8\uFE0F"} Warmer ${enabled ? "enabled" : "disabled"}`, accountId);
  }
}
app.use(express.json());
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
  // 10MB limit
});
var bulkQueue = [];
var isProcessingBulkQueue = false;
async function processBulkQueue() {
  if (isProcessingBulkQueue) return;
  isProcessingBulkQueue = true;
  while (bulkQueue.some((item) => item.status === "pending")) {
    const item = bulkQueue.find((i) => i.status === "pending");
    if (!item) break;
    item.status = "processing";
    io.emit("bulk-queue-update", { item, queue: bulkQueue });
    try {
      if (accounts.size >= MAX_ACCOUNTS) {
        throw new Error(`Maximum ${MAX_ACCOUNTS} accounts reached`);
      }
      await startSession(item.accountId, item.usePairingCode, item.phoneNumber);
      item.status = "completed";
    } catch (error) {
      item.status = "failed";
      item.error = error.message;
    }
    io.emit("bulk-queue-update", { item, queue: bulkQueue });
    await new Promise((resolve) => setTimeout(resolve, 2e3));
  }
  isProcessingBulkQueue = false;
  io.emit("bulk-queue-complete", { queue: bulkQueue });
}
app.get("/health", (req, res) => {
  res.json({ status: "ok", accounts: accounts.size });
});
app.get("/safe-mode", (req, res) => {
  res.json({
    enabled: SAFE_MODE_CONFIG.enabled,
    config: SAFE_MODE_CONFIG,
    currentOnline: getOnlineAccountCount(),
    maxAllowed: SAFE_MODE_CONFIG.maxConcurrentOnline,
    canBringOnline: canBringOnline()
  });
});
app.post("/safe-mode/toggle", async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be boolean" });
  }
  SAFE_MODE_CONFIG.enabled = enabled;
  addLog("info", `\u{1F6E1}\uFE0F Safe Mode ${enabled ? "ENABLED" : "DISABLED"}`);
  if (enabled) {
    await enforceMaxOnlineLimit();
  }
  res.json({
    success: true,
    enabled: SAFE_MODE_CONFIG.enabled,
    message: `Safe Mode ${enabled ? "enabled" : "disabled"}`
  });
});
app.post("/safe-mode/config", (req, res) => {
  const updates = req.body;
  const allowedFields = [
    "maxConcurrentOnline",
    "silentPeriodEnabled",
    "silentPeriodMinMinutes",
    "silentPeriodMaxMinutes",
    "ignoreMessageChance",
    "responseDelayMinMinutes",
    "responseDelayMaxMinutes",
    "maxActivityMinutesPerSession",
    "minRestMinutesBetweenSessions"
  ];
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      SAFE_MODE_CONFIG[key] = value;
    }
  }
  addLog("info", `\u{1F6E1}\uFE0F Safe Mode config updated`);
  res.json({ success: true, config: SAFE_MODE_CONFIG });
});
app.get("/burnable/stats", (req, res) => {
  res.json(getBurnableStats());
});
app.get("/burnable/banned", (req, res) => {
  const bannedList = Array.from(BURNABLE_CONFIG.bannedAccounts.values());
  res.json({
    total: bannedList.length,
    accounts: bannedList.map((b) => ({
      id: b.accountId,
      daysActive: b.daysActive,
      messagesSent: b.messagesSent,
      messagesReceived: b.messagesReceived,
      banCount: b.banCount,
      lastBanDate: b.lastBanDate,
      replacement: b.replacement
    }))
  });
});
app.post("/burnable/reserve/add", (req, res) => {
  const { accountId } = req.body;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }
  BURNABLE_CONFIG.reserveAccounts.push(accountId);
  addLog("info", `\u{1F4E6} Reserve account added: ${accountId}`);
  res.json({
    success: true,
    reserveCount: BURNABLE_CONFIG.reserveAccounts.length
  });
});
app.post("/burnable/replacement/queue", (req, res) => {
  const { accountId } = req.body;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }
  BURNABLE_CONFIG.replacementQueue.push(accountId);
  addLog("info", `\u{1F504} Replacement account queued: ${accountId}`);
  res.json({
    success: true,
    queueLength: BURNABLE_CONFIG.replacementQueue.length
  });
});
app.get("/burnable/health/:accountId", (req, res) => {
  const { accountId } = req.params;
  const account = accounts.get(accountId);
  if (!account) {
    return res.status(404).json({ error: "Account not found" });
  }
  const healthScore = calculateBurnableHealth(account);
  const lifecycle = updateAccountLifecycle(account);
  res.json({
    accountId,
    healthScore,
    lifecycle,
    stats: {
      messagesSent: account.warmingStats?.messagesSent || 0,
      messagesReceived: account.warmingStats?.messagesReceived || 0,
      daysActive: lifecycle.warmingDays
    }
  });
});
app.get("/personality-registry", (req, res) => {
  const registry = Array.from(personalityRegistry.entries()).map(([accountId, personality]) => ({
    accountId,
    personality: {
      name: personality.name,
      age: personality.age,
      occupation: personality.occupation,
      location: personality.location,
      chronotype: personality.chronotype
    },
    isBanned: BURNABLE_CONFIG.bannedAccounts.has(accountId),
    isActive: accounts.has(accountId)
  }));
  res.json({
    total: registry.length,
    registry
  });
});
app.post("/banned/clear/:accountId", (req, res) => {
  const { accountId } = req.params;
  if (!BURNABLE_CONFIG.bannedAccounts.has(accountId)) {
    return res.status(404).json({ error: "Account not in banned list" });
  }
  BURNABLE_CONFIG.bannedAccounts.delete(accountId);
  reconnectAttempts.delete(accountId);
  everConnected.delete(accountId);
  addLog("info", `\u{1F513} Banned status cleared for ${accountId}`);
  res.json({
    success: true,
    message: `Account ${accountId} removed from banned list. You can try to reconnect.`
  });
});
app.post("/personality/reset/:accountId", (req, res) => {
  const { accountId } = req.params;
  const hadPersonality = personalityRegistry.has(accountId);
  personalityRegistry.delete(accountId);
  if (BURNABLE_CONFIG.bannedAccounts.has(accountId)) {
    BURNABLE_CONFIG.bannedAccounts.delete(accountId);
  }
  reconnectAttempts.delete(accountId);
  everConnected.delete(accountId);
  addLog("info", `\u{1F504} Personality reset for ${accountId}`);
  res.json({
    success: true,
    hadPersonality,
    message: `Personality reset for ${accountId}. A new personality will be generated on next session start.`
  });
});
app.get("/ai-settings", (req, res) => {
  res.json({
    provider: aiApiSettings.provider,
    groqApiKey: aiApiSettings.groqApiKey ? `${aiApiSettings.groqApiKey.substring(0, 8)}...${aiApiSettings.groqApiKey.substring(aiApiSettings.groqApiKey.length - 4)}` : "",
    groqModel: aiApiSettings.groqModel,
    hasGroqKey: !!aiApiSettings.groqApiKey,
    lastUpdated: aiApiSettings.lastUpdated,
    availableModels: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (Recommended)", description: "Best quality, slower" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", description: "Fast, good quality" },
      { id: "llama-3.2-3b-preview", name: "Llama 3.2 3B", description: "Fastest, basic quality" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", description: "Good for longer responses" }
    ]
  });
});
app.post("/ai-settings", (req, res) => {
  const { provider, groqApiKey, groqModel } = req.body;
  if (provider && ["groq", "fallback"].includes(provider)) {
    aiApiSettings.provider = provider;
  }
  if (groqApiKey !== void 0) {
    if (groqApiKey && groqApiKey.trim()) {
      aiApiSettings.groqApiKey = groqApiKey.trim();
      resetGroqInstance();
      addLog("info", "\u{1F511} Groq API key updated");
    } else if (groqApiKey === "") {
      aiApiSettings.groqApiKey = "";
      resetGroqInstance();
      addLog("info", "\u{1F511} Groq API key cleared");
    }
  }
  if (groqModel) {
    aiApiSettings.groqModel = groqModel;
  }
  aiApiSettings.lastUpdated = /* @__PURE__ */ new Date();
  res.json({
    success: true,
    message: "AI settings updated",
    settings: {
      provider: aiApiSettings.provider,
      hasGroqKey: !!aiApiSettings.groqApiKey,
      groqModel: aiApiSettings.groqModel,
      lastUpdated: aiApiSettings.lastUpdated
    }
  });
});
app.post("/ai-settings/test", async (req, res) => {
  const testMessage = "Halo, ini test pesan. Balas dengan singkat dalam bahasa Indonesia.";
  try {
    const groq = getGroqInstance();
    if (!groq) {
      return res.json({
        success: false,
        provider: "groq",
        error: "Groq API key not set. Get free API key at https://console.groq.com/keys"
      });
    }
    const completion = await groq.chat.completions.create({
      model: aiApiSettings.groqModel,
      messages: [
        { role: "system", content: "Kamu adalah orang Indonesia yang ramah. Balas singkat." },
        { role: "user", content: testMessage }
      ],
      max_tokens: 50
    });
    const response = completion.choices[0]?.message?.content;
    return res.json({
      success: true,
      provider: "groq",
      model: aiApiSettings.groqModel,
      response,
      message: "Groq AI connection successful!"
    });
  } catch (error) {
    res.json({
      success: false,
      provider: "groq",
      error: error.message || "Failed to connect to Groq AI"
    });
  }
});
app.get("/accounts", (req, res) => {
  const accountList = Array.from(accounts.entries()).map(([id, account]) => ({
    id,
    phoneNumber: account.phoneNumber,
    name: account.name,
    profilePicture: account.profilePicture,
    status: account.status,
    qrCode: account.qrCode,
    pairingCode: account.pairingCode,
    warmingEnabled: account.warmingEnabled,
    warmingStats: account.warmingStats,
    personality: account.personality,
    pool: account.pool,
    currentChatPartner: account.currentChatPartner,
    isInActiveWindow: account.isInActiveWindow
  }));
  res.json(accountList);
});
app.get("/accounts/light", (req, res) => {
  const accountList = Array.from(accounts.entries()).map(([id, account]) => ({
    id,
    phoneNumber: account.phoneNumber,
    name: account.name,
    status: account.status,
    warmingEnabled: account.warmingEnabled,
    hasQr: !!account.qrCode,
    hasPairingCode: !!account.pairingCode,
    personality: account.personality ? {
      name: account.personality.name,
      age: account.personality.age,
      occupation: account.personality.occupation,
      location: account.personality.location,
      traits: account.personality.traits,
      hobbies: account.personality.hobbies,
      writingStyle: account.personality.writingStyle,
      responseStyle: account.personality.responseStyle,
      chronotype: account.personality.chronotype,
      activeHoursStart: account.personality.activeHoursStart,
      activeHoursEnd: account.personality.activeHoursEnd,
      peakHours: account.personality.peakHours,
      avgResponseTime: account.personality.avgResponseTime,
      emojiUsage: account.personality.emojiUsage,
      avgMessageLength: account.personality.avgMessageLength
    } : null,
    healthScore: account.warmingStats?.healthScore || 0,
    pool: account.pool,
    rateLimit: account.warmingStats?.rateLimit ? {
      hour: account.warmingStats.rateLimit.currentHourCount,
      day: account.warmingStats.rateLimit.currentDayCount,
      maxHour: account.warmingStats.rateLimit.messagesPerHour,
      maxDay: account.warmingStats.rateLimit.messagesPerDay
    } : null,
    warmingPhase: account.warmingStats?.currentPhase || 1,
    warmingDays: account.warmingStats?.warmingDays || 0,
    isInActiveWindow: account.isInActiveWindow
  }));
  res.json(accountList);
});
app.get("/stats", (req, res) => {
  const accountList = Array.from(accounts.values());
  const stats = {
    total: accountList.length,
    online: accountList.filter((a) => a.status === "online").length,
    connecting: accountList.filter((a) => a.status === "connecting").length,
    offline: accountList.filter((a) => a.status === "offline").length,
    warming: accountList.filter((a) => a.warmingEnabled && a.status === "online").length,
    totalMessagesReceived: accountList.reduce((sum, a) => sum + (a.warmingStats?.messagesReceived || 0), 0),
    totalMessagesSent: accountList.reduce((sum, a) => sum + (a.warmingStats?.messagesSent || 0), 0),
    totalAutoResponses: accountList.reduce((sum, a) => sum + (a.warmingStats?.autoResponsesSent || 0), 0),
    avgHealthScore: accountList.length > 0 ? Math.round(accountList.reduce((sum, a) => sum + (a.warmingStats?.healthScore || 0), 0) / accountList.length) : 0,
    pools: {
      active: getActiveAccounts().length,
      idle: getIdleAccounts().length,
      offline: getOfflinePoolAccounts().length
    },
    chatPairs: chatPairs.size,
    rateLimits: {
      enabled: config.rateLimitEnabled,
      maxHour: config.maxMessagesPerHour,
      maxDay: config.maxMessagesPerDay,
      warmingSchedule: config.warmingScheduleEnabled
    },
    backup: {
      enabled: config.autoBackupEnabled,
      intervalHours: config.backupIntervalHours
    },
    memoryUsage: {
      accounts: accounts.size,
      logs: eventLogs.length,
      personalityPool: personalityPool.length
    }
  };
  res.json(stats);
});
app.get("/warming-phases", (req, res) => {
  res.json(WARMING_PHASES);
});
app.get("/pools", (req, res) => {
  res.json({
    active: getActiveAccounts().map((a) => ({ id: a.id, name: a.personality?.name || a.name, partner: a.currentChatPartner })),
    idle: getIdleAccounts().map((a) => ({ id: a.id, name: a.personality?.name || a.name })),
    offline: getOfflinePoolAccounts().map((a) => ({ id: a.id, name: a.personality?.name || a.name }))
  });
});
app.get("/chat-pairs", (req, res) => {
  const pairs = Array.from(chatPairs.entries()).map(([id, pair]) => {
    const account1 = accounts.get(pair.account1Id);
    const account2 = accounts.get(pair.account2Id);
    return {
      id,
      account1: {
        id: pair.account1Id,
        name: account1?.personality?.name || pair.account1Id
      },
      account2: {
        id: pair.account2Id,
        name: account2?.personality?.name || pair.account2Id
      },
      currentTopic: pair.currentTopic,
      topicCategory: pair.topicCategory,
      messageCount: pair.messageCount,
      relationshipStage: pair.relationshipStage,
      relationshipLabel: RELATIONSHIP_STAGES[pair.relationshipStage].description,
      sharedInterests: pair.sharedInterests,
      topicsDiscussed: pair.topicsDiscussed.slice(-5),
      startedAt: pair.startedAt,
      lastMessageAt: pair.lastMessageAt,
      // Natural decay info - no fixed rotation
      silenceCount: pair.silenceCount,
      maxSilenceCount: config.maxSilenceCount,
      lastRespondedAt: pair.lastRespondedAt
    };
  });
  res.json(pairs);
});
app.get("/logs", (req, res) => {
  res.json(eventLogs.slice(0, 100));
});
app.get("/config", (req, res) => {
  res.json(config);
});
var ALLOWED_CONFIG_FIELDS = [
  "warmerEnabled",
  "warmerDelayMin",
  "warmerDelayMax",
  "autoPresenceUpdate",
  "presenceUpdateInterval",
  "typingSimulationEnabled",
  "readReceiptsEnabled",
  "aiSystemPrompt",
  "warmingIntensity",
  "activePoolSize",
  "idlePoolSize",
  "rotationIntervalMin",
  "rotationIntervalMax",
  "chatSimulationEnabled",
  "maxSilenceCount",
  "conversationDecayEnabled",
  "readReceiptRandomEnabled",
  "readReceiptInstantChance",
  "readReceiptDelayChance",
  "readReceiptIgnoreChance",
  "randomOfflineEnabled",
  "minOnlineHours",
  "maxOnlineHours",
  "minOfflineMinutes",
  "maxOfflineMinutes",
  "burstPreventionEnabled",
  "minDelayBetweenMessages",
  "maxMessagesPerBurst",
  "rateLimitEnabled",
  "maxMessagesPerHour",
  "maxMessagesPerDay",
  "warmingScheduleEnabled",
  "autoBackupEnabled",
  "backupIntervalHours"
];
app.post("/config", async (req, res) => {
  const updates = {};
  for (const key of ALLOWED_CONFIG_FIELDS) {
    if (req.body[key] !== void 0) {
      if (typeof config[key] === "number") {
        const val = Number(req.body[key]);
        if (!isNaN(val) && val >= 0) {
          updates[key] = val;
        }
      } else if (typeof config[key] === "boolean") {
        updates[key] = Boolean(req.body[key]);
      } else if (typeof config[key] === "string") {
        const val = String(req.body[key]).slice(0, 5e3);
        updates[key] = val;
      }
    }
  }
  config = { ...config, ...updates };
  const configPath = join(__dirname, "config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  if (updates.autoBackupEnabled !== void 0 || updates.backupIntervalHours !== void 0) {
    scheduleAutoBackup();
  }
  res.json(config);
});
app.post("/session/start", async (req, res) => {
  const { accountId, usePairingCode, phoneNumber, forceNew } = req.body;
  console.log("==========================================");
  console.log("[SESSION/START] Request received:", { accountId, usePairingCode, phoneNumber, forceNew });
  console.log("==========================================");
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    console.log("[SESSION/START] Validation failed:", validation.error);
    return res.status(400).json({ error: validation.error });
  }
  if (!forceNew && accounts.has(accountId)) {
    console.log("[SESSION/START] Account already exists:", accountId);
    return res.status(400).json({ error: "Account already exists" });
  }
  if (forceNew && accounts.has(accountId)) {
    const existingAccount = accounts.get(accountId);
    if (existingAccount?.socket) {
      try {
        existingAccount.socket.end?.();
      } catch (e) {
      }
    }
    accounts.delete(accountId);
    console.log("[SESSION/START] forceNew: Removed existing account from memory");
  }
  if (usePairingCode && phoneNumber) {
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.valid) {
      console.log("[SESSION/START] Phone validation failed:", phoneValidation.error);
      return res.status(400).json({ error: phoneValidation.error });
    }
  }
  if (usePairingCode && !phoneNumber) {
    console.log("[SESSION/START] Missing phone number for pairing code");
    return res.status(400).json({ error: "phoneNumber is required for pairing code" });
  }
  if (accounts.size >= MAX_ACCOUNTS) {
    console.log("[SESSION/START] Max accounts reached:", MAX_ACCOUNTS);
    return res.status(400).json({ error: `Maximum ${MAX_ACCOUNTS} accounts reached` });
  }
  console.log("[SESSION/START] Starting session for:", accountId, "forceNew:", !!forceNew);
  await startSession(accountId, usePairingCode || false, phoneNumber, !!forceNew);
  console.log("[SESSION/START] Session started successfully for:", accountId);
  res.json({ success: true, accountId });
});
app.post("/session/retry/:accountId", async (req, res) => {
  const { accountId } = req.params;
  const { usePairingCode, phoneNumber } = req.body;
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  if (BURNABLE_CONFIG.bannedAccounts.has(accountId)) {
    return res.status(400).json({ error: "Account is in banned list. Use /banned/clear first." });
  }
  reconnectAttempts.delete(accountId);
  everConnected.delete(accountId);
  const existingAccount = accounts.get(accountId);
  if (existingAccount) {
    if (existingAccount.socket) {
      try {
        existingAccount.socket.end?.();
      } catch (e) {
      }
    }
    accounts.delete(accountId);
  }
  addLog("info", `\u{1F504} Retrying connection for ${accountId} (forceNew=true)`, accountId);
  if (usePairingCode && phoneNumber) {
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.valid) {
      return res.status(400).json({ error: phoneValidation.error });
    }
  }
  if (usePairingCode && !phoneNumber) {
    return res.status(400).json({ error: "phoneNumber is required for pairing code" });
  }
  await startSession(accountId, usePairingCode || false, phoneNumber, true);
  res.json({ success: true, accountId, message: "Connection retry initiated with fresh session" });
});
app.get("/connection/status/:accountId", (req, res) => {
  const { accountId } = req.params;
  res.json({
    accountId,
    reconnectAttempts: reconnectAttempts.get(accountId) || 0,
    everConnected: everConnected.get(accountId) || false,
    isBanned: BURNABLE_CONFIG.bannedAccounts.has(accountId),
    isActive: accounts.has(accountId),
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS
  });
});
app.post("/session/batch-start", async (req, res) => {
  const { accountIds, usePairingCodes, phoneNumbers } = req.body;
  if (!accountIds || !Array.isArray(accountIds)) {
    return res.status(400).json({ error: "accountIds array is required" });
  }
  if (accountIds.length > 50) {
    return res.status(400).json({ error: "Maximum 50 accounts per batch" });
  }
  if (accounts.size + accountIds.length > MAX_ACCOUNTS) {
    return res.status(400).json({ error: `Cannot create ${accountIds.length} accounts. Maximum ${MAX_ACCOUNTS} total accounts.` });
  }
  for (const accountId of accountIds) {
    const validation = validateAccountId(accountId);
    if (!validation.valid) {
      return res.status(400).json({ error: `Invalid accountId "${accountId}": ${validation.error}` });
    }
    if (accounts.has(accountId)) {
      return res.status(400).json({ error: `Account "${accountId}" already exists` });
    }
  }
  const results = [];
  for (let i = 0; i < accountIds.length; i++) {
    const accountId = accountIds[i];
    const usePairingCode = usePairingCodes?.[i] || false;
    const phoneNumber = phoneNumbers?.[i];
    try {
      await startSession(accountId, usePairingCode, phoneNumber);
      results.push({ accountId, success: true });
    } catch (error) {
      results.push({ accountId, success: false, error: error.message });
    }
    if (i < accountIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  addLog("info", `\u{1F4E6} Batch created ${results.filter((r) => r.success).length}/${accountIds.length} accounts`);
  res.json({ success: true, results });
});
app.post("/bulk/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "File too large. Maximum 10MB" });
    }
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);
    if (data.length === 0) {
      return res.status(400).json({ error: "Excel file is empty" });
    }
    if (data.length > 100) {
      return res.status(400).json({ error: "Maximum 100 accounts per Excel file" });
    }
    const accountsData = [];
    const errors = [];
    for (let i = 0; i < data.length; i++) {
      const rowData = data[i];
      const accountId = rowData["account_id"] || rowData["accountId"] || rowData["id"] || rowData["Account ID"] || rowData["ID"];
      const phoneNumber = rowData["phone"] || rowData["phoneNumber"] || rowData["phone_number"] || rowData["Phone"] || rowData["Phone Number"] || rowData["nomor"];
      const method = rowData["method"] || rowData["auth_method"] || rowData["Auth Method"] || "qr";
      if (!accountId) {
        continue;
      }
      const accountIdStr = String(accountId).trim();
      const validation = validateAccountId(accountIdStr);
      if (!validation.valid) {
        errors.push(`Row ${i + 1}: ${validation.error}`);
        continue;
      }
      if (accountsData.some((a) => a.accountId === accountIdStr)) {
        errors.push(`Row ${i + 1}: Duplicate accountId "${accountIdStr}"`);
        continue;
      }
      accountsData.push({
        accountId: accountIdStr,
        phoneNumber: phoneNumber ? String(phoneNumber).trim() : void 0,
        usePairingCode: method.toLowerCase().includes("pair") || !!phoneNumber
      });
    }
    if (accountsData.length === 0) {
      return res.status(400).json({
        error: "No valid account data found in Excel",
        details: errors.length > 0 ? errors.slice(0, 5) : void 0
      });
    }
    bulkQueue = accountsData.map((item) => ({
      ...item,
      status: "pending"
    }));
    addLog("info", `\u{1F4CA} Excel uploaded: ${accountsData.length} accounts parsed`);
    res.json({
      success: true,
      total: accountsData.length,
      accounts: accountsData.slice(0, 10),
      // Preview first 10
      warnings: errors.length > 0 ? errors.slice(0, 5) : void 0,
      message: `${accountsData.length} accounts ready for bulk creation`
    });
  } catch (error) {
    console.error("Excel upload error:", error);
    res.status(500).json({ error: `Failed to parse Excel: ${error.message}` });
  }
});
app.get("/bulk/queue", (req, res) => {
  const summary = {
    total: bulkQueue.length,
    pending: bulkQueue.filter((i) => i.status === "pending").length,
    processing: bulkQueue.filter((i) => i.status === "processing").length,
    completed: bulkQueue.filter((i) => i.status === "completed").length,
    failed: bulkQueue.filter((i) => i.status === "failed").length,
    isProcessing: isProcessingBulkQueue
  };
  res.json({ queue: bulkQueue, summary });
});
app.post("/bulk/start", async (req, res) => {
  if (bulkQueue.length === 0) {
    return res.status(400).json({ error: "No accounts in queue. Upload Excel first." });
  }
  if (isProcessingBulkQueue) {
    return res.status(400).json({ error: "Bulk processing already in progress" });
  }
  bulkQueue.forEach((item) => {
    if (item.status === "failed") {
      item.status = "pending";
    }
  });
  addLog("info", `\u{1F680} Starting bulk account creation: ${bulkQueue.filter((i) => i.status === "pending").length} accounts`);
  processBulkQueue();
  res.json({
    success: true,
    message: "Bulk creation started",
    total: bulkQueue.length
  });
});
app.post("/bulk/stop", (req, res) => {
  isProcessingBulkQueue = false;
  addLog("info", "\u23F9\uFE0F Bulk creation stopped");
  res.json({ success: true, message: "Bulk creation stopped" });
});
app.post("/bulk/clear", (req, res) => {
  bulkQueue = [];
  isProcessingBulkQueue = false;
  addLog("info", "\u{1F5D1}\uFE0F Bulk queue cleared");
  res.json({ success: true, message: "Queue cleared" });
});
app.get("/bulk/template", (req, res) => {
  const template = [
    { account_id: "account_1", phone: "6281234567890", method: "pairing" },
    { account_id: "account_2", phone: "", method: "qr" },
    { account_id: "account_3", phone: "6281234567891", method: "pairing" }
  ];
  const ws = XLSX.utils.json_to_sheet(template);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Accounts");
  ws["!cols"] = [
    { wch: 20 },
    // account_id
    { wch: 20 },
    // phone
    { wch: 15 }
    // method
  ];
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=bulk_accounts_template.xlsx");
  res.send(buffer);
});
app.post("/session/stop", async (req, res) => {
  const { accountId } = req.body;
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  await stopSession(accountId);
  res.json({ success: true });
});
app.post("/session/restart", async (req, res) => {
  const { accountId } = req.body;
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  await stopSession(accountId);
  await new Promise((resolve) => setTimeout(resolve, 2e3));
  await startSession(accountId);
  res.json({ success: true });
});
app.post("/session/toggle-warming", (req, res) => {
  const { accountId, enabled } = req.body;
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  toggleWarming(accountId, enabled);
  res.json({ success: true });
});
app.post("/pool/rotate", async (req, res) => {
  await rotatePools();
  res.json({ success: true });
});
app.post("/backup/all", async (req, res) => {
  await backupAllSessions();
  res.json({ success: true });
});
app.post("/backup/:accountId", async (req, res) => {
  const { accountId } = req.params;
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  await backupSession(accountId);
  res.json({ success: true });
});
app.get("/account/:id", (req, res) => {
  const accountId = req.params.id;
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  const account = accounts.get(accountId);
  if (!account) {
    return res.status(404).json({ error: "Account not found" });
  }
  res.json({
    id: accountId,
    phoneNumber: account.phoneNumber,
    name: account.name,
    profilePicture: account.profilePicture,
    status: account.status,
    qrCode: account.qrCode,
    pairingCode: account.pairingCode,
    warmingEnabled: account.warmingEnabled,
    warmingStats: account.warmingStats,
    personality: account.personality,
    pool: account.pool,
    currentChatPartner: account.currentChatPartner
  });
});
app.delete("/account/:id", async (req, res) => {
  const accountId = req.params.id;
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  const account = accounts.get(accountId);
  if (!account) {
    return res.status(404).json({ error: "Account not found" });
  }
  try {
    pendingDeletion.add(accountId);
    addLog("info", `\u{1F5D1}\uFE0F Marking account for deletion...`, accountId);
    await stopSession(accountId);
    clearChatPartner(accountId);
    reconnectAttempts.delete(accountId);
    everConnected.delete(accountId);
    accounts.delete(accountId);
    const sessionDir = join(SESSIONS_DIR, accountId);
    try {
      await rm(sessionDir, { recursive: true, force: true });
    } catch (e) {
    }
    const backupDir = join(BACKUP_DIR, accountId);
    try {
      await rm(backupDir, { recursive: true, force: true });
    } catch (e) {
    }
    addLog("info", `\u{1F5D1}\uFE0F Account deleted: ${accountId}`);
    io.emit("account-deleted", { accountId });
    res.json({ success: true, accountId });
  } catch (error) {
    addLog("error", `Failed to delete account: ${error.message}`, accountId);
    pendingDeletion.delete(accountId);
    res.status(500).json({ error: error.message });
  }
});
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id, "Transport:", socket.conn?.transport?.name || "unknown");
  socket.conn?.on("upgrade", (transport) => {
    console.log("[SOCKET] Transport upgraded to:", transport.name, "for socket:", socket.id);
  });
  socket.conn?.on("upgradeError", (err) => {
    console.error("[SOCKET] Transport upgrade error:", err.message, "for socket:", socket.id);
  });
  socket.emit("init", {
    accounts: Array.from(accounts.entries()).map(([id, account]) => ({
      id,
      phoneNumber: account.phoneNumber,
      name: account.name,
      profilePicture: account.profilePicture,
      status: account.status,
      qrCode: account.qrCode,
      pairingCode: account.pairingCode,
      warmingEnabled: account.warmingEnabled,
      warmingStats: account.warmingStats,
      personality: account.personality,
      pool: account.pool,
      isInActiveWindow: account.isInActiveWindow
    })),
    config,
    logs: eventLogs.slice(0, 50),
    chatPairs: Array.from(chatPairs.entries()).map(([id, pair]) => ({
      id,
      account1: { id: pair.account1Id, name: accounts.get(pair.account1Id)?.personality?.name || pair.account1Id },
      account2: { id: pair.account2Id, name: accounts.get(pair.account2Id)?.personality?.name || pair.account2Id },
      currentTopic: pair.currentTopic,
      messageCount: pair.messageCount,
      relationshipStage: pair.relationshipStage
    }))
  });
  socket.on("start-session", async (data) => {
    await startSession(data.accountId, data.usePairingCode, data.phoneNumber);
  });
  socket.on("stop-session", async (accountId) => {
    await stopSession(accountId);
  });
  socket.on("stop-all", async () => {
    for (const [accountId] of accounts) {
      await stopSession(accountId);
    }
    addLog("info", "\u{1F6D1} All sessions stopped");
  });
  socket.on("toggle-warming", (data) => {
    toggleWarming(data.accountId, data.enabled);
  });
  socket.on("toggle-warming-all", (enabled) => {
    for (const [accountId] of accounts) {
      toggleWarming(accountId, enabled);
    }
    addLog("warming", `${enabled ? "\u2705" : "\u23F8\uFE0F"} Warmer ${enabled ? "enabled" : "disabled"} for all accounts`);
  });
  socket.on("rotate-pools", async () => {
    await rotatePools();
  });
  socket.on("backup-all", async () => {
    await backupAllSessions();
  });
  socket.on("send-message", async (data) => {
    const account = accounts.get(data.accountId);
    if (account?.socket && account.status === "online") {
      const rateCheck = checkRateLimit(account);
      if (!rateCheck.allowed) {
        addLog("ratelimit", `Message blocked: ${rateCheck.reason}`, data.accountId);
        return;
      }
      try {
        if (config.typingSimulationEnabled) {
          await account.socket.sendPresenceUpdate("composing", data.to);
          await delay(getTypingDelay(data.message.length));
          await account.socket.sendPresenceUpdate("paused", data.to);
        }
        await account.socket.sendMessage(data.to, { text: data.message });
        incrementRateLimit(account);
        account.warmingStats.messagesSent++;
        account.warmingStats.lastActivity = /* @__PURE__ */ new Date();
        account.warmingStats.healthScore = calculateHealthScore(account.warmingStats);
        addLog("message", `\u{1F4E4} Manual message sent to ${data.to}`, data.accountId);
        io.emit("message", {
          id: `${Date.now()}`,
          accountId: data.accountId,
          from: "me",
          to: data.to,
          text: data.message,
          timestamp: /* @__PURE__ */ new Date(),
          direction: "outgoing",
          isAutoResponse: false
        });
        io.emit("warming-stats", { accountId: data.accountId, stats: account.warmingStats });
      } catch (error) {
        addLog("error", `Failed to send message: ${error}`, data.accountId);
      }
    }
  });
  socket.on("disconnect", (reason) => {
    console.log("Client disconnected:", socket.id, "Reason:", reason, "Transport was:", socket.conn?.transport?.name || "unknown");
  });
  socket.on("error", (err) => {
    console.error("[SOCKET] Connection error for socket:", socket.id, "Error:", err.message || err);
  });
});
async function ensureSessionsDir() {
  try {
    await access(SESSIONS_DIR);
  } catch {
    await mkdir(SESSIONS_DIR, { recursive: true });
  }
}
var dbSyncTimer = null;
async function syncAccountsToDatabase() {
  try {
    for (const [id, account] of accounts.entries()) {
      await db.whatsAppAccount.upsert({
        where: { id },
        create: {
          id,
          phoneNumber: account.phoneNumber,
          name: account.name,
          profilePicture: account.profilePicture,
          status: account.status,
          warmingEnabled: account.warmingEnabled,
          pool: account.pool,
          poolSince: account.poolSince,
          lastSeen: account.lastSeen,
          warmingStartTime: account.warmingStats.warmingStartTime,
          messagesSent: account.warmingStats.messagesSent,
          messagesReceived: account.warmingStats.messagesReceived,
          autoResponsesSent: account.warmingStats.autoResponsesSent,
          healthScore: account.warmingStats.healthScore,
          currentPhase: account.warmingStats.currentPhase,
          warmingDays: account.warmingStats.warmingDays,
          lastActivity: account.warmingStats.lastActivity,
          rateLimitHourCount: account.warmingStats.rateLimit.currentHourCount,
          rateLimitDayCount: account.warmingStats.rateLimit.currentDayCount,
          rateLimitHourReset: account.warmingStats.rateLimit.lastHourReset,
          rateLimitDayReset: account.warmingStats.rateLimit.lastDayReset,
          currentChatPartnerId: account.currentChatPartner,
          isInActiveWindow: account.isInActiveWindow
        },
        update: {
          phoneNumber: account.phoneNumber,
          name: account.name,
          profilePicture: account.profilePicture,
          status: account.status,
          warmingEnabled: account.warmingEnabled,
          pool: account.pool,
          poolSince: account.poolSince,
          lastSeen: account.lastSeen,
          warmingStartTime: account.warmingStats.warmingStartTime,
          messagesSent: account.warmingStats.messagesSent,
          messagesReceived: account.warmingStats.messagesReceived,
          autoResponsesSent: account.warmingStats.autoResponsesSent,
          healthScore: account.warmingStats.healthScore,
          currentPhase: account.warmingStats.currentPhase,
          warmingDays: account.warmingStats.warmingDays,
          lastActivity: account.warmingStats.lastActivity,
          rateLimitHourCount: account.warmingStats.rateLimit.currentHourCount,
          rateLimitDayCount: account.warmingStats.rateLimit.currentDayCount,
          rateLimitHourReset: account.warmingStats.rateLimit.lastHourReset,
          rateLimitDayReset: account.warmingStats.rateLimit.lastDayReset,
          currentChatPartnerId: account.currentChatPartner,
          isInActiveWindow: account.isInActiveWindow
        }
      });
      if (account.personality) {
        await db.personality.upsert({
          where: { accountId: id },
          create: {
            accountId: id,
            name: account.personality.name,
            age: account.personality.age,
            occupation: account.personality.occupation,
            location: account.personality.location,
            traits: JSON.stringify(account.personality.traits),
            writingStyle: account.personality.writingStyle,
            hobbies: JSON.stringify(account.personality.hobbies),
            responseStyle: account.personality.responseStyle,
            chronotype: account.personality.chronotype,
            activeHoursStart: account.personality.activeHoursStart,
            activeHoursEnd: account.personality.activeHoursEnd,
            peakHours: JSON.stringify(account.personality.peakHours),
            avgResponseTime: account.personality.avgResponseTime,
            emojiUsage: account.personality.emojiUsage,
            avgMessageLength: account.personality.avgMessageLength
          },
          update: {
            name: account.personality.name,
            age: account.personality.age,
            occupation: account.personality.occupation,
            location: account.personality.location,
            traits: JSON.stringify(account.personality.traits),
            writingStyle: account.personality.writingStyle,
            hobbies: JSON.stringify(account.personality.hobbies),
            responseStyle: account.personality.responseStyle,
            chronotype: account.personality.chronotype,
            activeHoursStart: account.personality.activeHoursStart,
            activeHoursEnd: account.personality.activeHoursEnd,
            peakHours: JSON.stringify(account.personality.peakHours),
            avgResponseTime: account.personality.avgResponseTime,
            emojiUsage: account.personality.emojiUsage,
            avgMessageLength: account.personality.avgMessageLength
          }
        });
      }
    }
    console.log(`[DB] Synced ${accounts.size} accounts to database`);
  } catch (error) {
    console.error("[DB] Failed to sync accounts:", error);
  }
}
function scheduleDbSync() {
  if (dbSyncTimer) {
    clearInterval(dbSyncTimer);
  }
  dbSyncTimer = setInterval(syncAccountsToDatabase, 3e4);
}
async function loadConfig() {
  try {
    const configEntries = await db.warmingConfig.findMany();
    if (configEntries.length > 0) {
      for (const entry of configEntries) {
        if (entry.key in config) {
          const key = entry.key;
          if (typeof config[key] === "number") {
            config[key] = Number(entry.value);
          } else if (typeof config[key] === "boolean") {
            config[key] = entry.value === "true";
          } else {
            config[key] = entry.value;
          }
        }
      }
      console.log("[DB] Loaded config from database");
    }
  } catch (error) {
    console.error("[DB] Failed to load config:", error);
  }
}
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    uptime: process.uptime(),
    accounts: accounts.size,
    onlineAccounts: Array.from(accounts.values()).filter((a) => a.status === "online").length,
    note: "Health check available. Full initialization continues in background."
  });
});
async function initializeAsync() {
  try {
    console.log("[Init] Starting async initialization...");
    await ensureSessionsDir();
    await ensureBackupDir();
    loadConfig().catch((err) => {
      console.warn("[Init] Config load failed, using defaults:", err.message);
    });
    preGeneratePersonalities(10);
    scheduleNextRotation();
    scheduleAutoBackup();
    scheduleDbSync();
    console.log("[Init] Async initialization complete");
    addLog("info", "\u{1F680} WhatsApp Warmer Service fully initialized");
  } catch (error) {
    console.error("[Init] Async initialization error:", error);
  }
}
async function start() {
  try {
    httpServer.listen(PORT, () => {
      console.log(`==========================================`);
      console.log(`\u{1F525} WhatsApp Warmer Service running on port ${PORT}`);
      console.log(`\u{1F4CA} Health check: http://localhost:${PORT}/health`);
      console.log(`\u{1F511} Groq API: ${aiApiSettings.groqApiKey ? "Configured" : "NOT SET - Set GROQ_API_KEY"}`);
      console.log(`==========================================`);
      initializeAsync();
    });
  } catch (error) {
    console.error("Failed to start WhatsApp service:", error);
    process.exit(1);
  }
}
start();
