import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  isJidGroup,
  isJidBroadcast,
  WAPresence
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { mkdir, writeFile, readFile, access, readdir, copyFile, stat, rm } from 'fs/promises';
import { rimraf } from 'rimraf';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// ZAI removed - using Groq only
import Groq from 'groq-sdk';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  allowEIO3: true,
  // CRITICAL: WebSocket first for better real-time performance
  // Polling as fallback for Railway proxy compatibility
  transports: ['websocket', 'polling'],
  path: '/socket.io',
  // ========================================
  // CRITICAL: Extended timeouts for Railway
  // ========================================
  // When browser suspends tab or proxy adds latency,
  // server needs longer timeout before disconnecting
  pingTimeout: 90000, // 90 seconds - extended for Railway
  pingInterval: 30000, // 30 seconds - keep connection alive
  upgradeTimeout: 60000, // 60 seconds for upgrade (longer for Railway)
  maxHttpBufferSize: 1e7, // 10MB for large QR codes
  // Allow transport upgrade
  allowUpgrades: true,
  // Per-connection settings
  connectTimeout: 60000, // 60 seconds to establish connection
  // Connection state recovery for better stability
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
});

// ========================================
// SOCKET.IO ENGINE ERROR HANDLER
// ========================================
// Critical for debugging Railway connection issues
io.engine.on('connection_error', (err: any) => {
  console.error('[Socket.io Engine Error]', {
    code: err.code,
    message: err.message,
    context: err.context,
    req: err.req?.url,
  });
});

// Log all connections for debugging
io.on('connection', (socket) => {
  const transport = socket.conn.transport.name;
  console.log(`[Socket.io] Client connected: ${socket.id} | Transport: ${transport}`);
  
  // Log transport upgrades
  socket.conn.on('upgrade', (transport: any) => {
    console.log(`[Socket.io] Transport upgraded: ${transport.name}`);
  });
  
  socket.on('disconnect', (reason) => {
    console.log(`[Socket.io] Client disconnected: ${socket.id} | Reason: ${reason}`);
  });
  
  socket.on('error', (err) => {
    console.error(`[Socket.io] Socket error: ${socket.id}`, err.message);
  });
});

const PORT = 3030;
const SESSIONS_DIR = join(__dirname, 'sessions');
const BACKUP_DIR = join(__dirname, 'backups');

// Logger configuration - set to 'debug' for troubleshooting
// Railway needs debug logs to diagnose connection issues
const logger = pino({
  level: process.env.BAILEYS_LOG_LEVEL || 'debug'
});

// ==================== TYPES ====================

interface RateLimit {
  messagesPerHour: number;
  messagesPerDay: number;
  currentHourCount: number;
  currentDayCount: number;
  lastHourReset: Date;
  lastDayReset: Date;
}

interface WarmingPhase {
  day: number;
  maxMessagesPerDay: number;
  maxMessagesPerHour: number;
  description: string;
}

interface WarmingStats {
  accountId: string;
  messagesReceived: number;
  messagesSent: number;
  autoResponsesSent: number;
  warmingStartTime?: Date;
  totalWarmingHours: number;
  lastActivity?: Date;
  healthScore: number;
  // Rate limiting
  rateLimit: RateLimit;
  // Warming phase
  currentPhase: number;
  warmingDays: number;
}

interface Personality {
  name: string;
  age: number;
  occupation: string;
  location: string;
  traits: string[];
  writingStyle: string;
  hobbies: string[];
  responseStyle: string;
  // Chronotype - affects active hours
  chronotype: 'early_bird' | 'night_owl' | 'regular' | 'flexible';
  activeHoursStart: number; // 0-23
  activeHoursEnd: number; // 0-23
  peakHours: number[]; // Hours when most active
  // Communication preferences
  avgResponseTime: number; // minutes
  emojiUsage: 'heavy' | 'moderate' | 'minimal';
  avgMessageLength: 'short' | 'medium' | 'long';
}

interface ChatPair {
  account1Id: string;
  account2Id: string;
  startedAt: Date;
  lastMessageAt?: Date;
  messageCount: number;
  // Topic system
  currentTopic: string;
  topicCategory: string;
  topicStartedAt: Date;
  topicsDiscussed: string[];
  conversationContext: string[];
  relationshipStage: 'stranger' | 'acquaintance' | 'friend' | 'close_friend';
  sharedInterests: string[];
  // Anti-spam: track unanswered messages
  unansweredMessages: number; // How many messages sent WITHOUT reply (max 3)
  lastSenderId: string; // Who sent the last message
  // Natural decay (no fixed timer)
  silenceCount: number; // How many times no response
  lastRespondedAt?: Date;
}

interface ActivityWindow {
  start: Date;
  end: Date;
  isActive: boolean;
}

interface Account {
  id: string;
  phoneNumber?: string;
  name?: string;
  profilePicture?: string;
  status: 'online' | 'offline' | 'connecting';
  socket: any;
  lastSeen?: Date;
  pairingCode?: string;
  qrCode?: string;
  warmingEnabled: boolean;
  warmingStats: WarmingStats;
  warmingTimers: NodeJS.Timeout[];
  personality: Personality | null;
  pool: 'active' | 'idle' | 'offline';
  poolSince: Date;
  currentChatPartner?: string;
  chatHistory: string[];
  // Activity tracking
  currentActivityWindow?: ActivityWindow;
  isInActiveWindow: boolean;
  // Safe Mode features
  silentPeriod: SilentPeriod;
  sessionActivity: SessionActivity;
}

interface Message {
  id: string;
  accountId: string;
  from: string;
  to: string;
  text: string;
  timestamp: Date;
  direction: 'incoming' | 'outgoing';
  isAutoResponse?: boolean;
}

// Silent period - akun "istirahat" tanpa aktivitas
interface SilentPeriod {
  isActive: boolean;
  startedAt?: Date;
  endsAt?: Date;
  duration?: number; // milliseconds
}

// Session activity tracking
interface SessionActivity {
  sessionStart?: Date;
  messagesInSession: number;
  lastMessageTime?: Date;
}

interface Config {
  warmerEnabled: boolean;
  warmerDelayMin: number;
  warmerDelayMax: number;
  autoPresenceUpdate: boolean;
  presenceUpdateInterval: number;
  typingSimulationEnabled: boolean;
  readReceiptsEnabled: boolean;
  aiSystemPrompt: string;
  warmingIntensity: 'low' | 'medium' | 'high';
  // Pool settings
  activePoolSize: number;
  idlePoolSize: number;
  rotationIntervalMin: number;
  rotationIntervalMax: number;
  chatSimulationEnabled: boolean;
  // Conversation decay (natural ending)
  maxSilenceCount: number; // Max silence before conversation ends
  conversationDecayEnabled: boolean;
  // Anti-detection features
  readReceiptRandomEnabled: boolean;
  readReceiptInstantChance: number; // % chance to read instantly
  readReceiptDelayChance: number; // % chance to read with delay
  readReceiptIgnoreChance: number; // % chance to not read (blue tick)
  randomOfflineEnabled: boolean;
  minOnlineHours: number; // Min hours before going offline
  maxOnlineHours: number; // Max hours before going offline
  minOfflineMinutes: number; // Min minutes offline
  maxOfflineMinutes: number; // Max minutes offline
  burstPreventionEnabled: boolean;
  minDelayBetweenMessages: number; // Minimum ms between messages
  maxMessagesPerBurst: number; // Max messages in quick succession
  // Rate limiting
  rateLimitEnabled: boolean;
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
  // Warming schedule
  warmingScheduleEnabled: boolean;
  // Backup
  autoBackupEnabled: boolean;
  backupIntervalHours: number;
}

// ==================== WARMING PHASES (SAFE MODE) ====================
// Gradual warming with SAFE MODE - MUCH more conservative to avoid ban

const WARMING_PHASES: WarmingPhase[] = [
  { day: 1, maxMessagesPerDay: 3, maxMessagesPerHour: 1, description: 'Day 1: Minimal activity (Safe Mode)' },
  { day: 2, maxMessagesPerDay: 5, maxMessagesPerHour: 2, description: 'Day 2: Very limited (Safe Mode)' },
  { day: 3, maxMessagesPerDay: 7, maxMessagesPerHour: 2, description: 'Day 3: Slow start (Safe Mode)' },
  { day: 4, maxMessagesPerDay: 10, maxMessagesPerHour: 3, description: 'Day 4: Light activity (Safe Mode)' },
  { day: 5, maxMessagesPerDay: 12, maxMessagesPerHour: 3, description: 'Day 5: Gradual increase (Safe Mode)' },
  { day: 6, maxMessagesPerDay: 15, maxMessagesPerHour: 4, description: 'Day 6: Building up (Safe Mode)' },
  { day: 7, maxMessagesPerDay: 18, maxMessagesPerHour: 4, description: 'Day 7: One week (Safe Mode)' },
  { day: 14, maxMessagesPerDay: 25, maxMessagesPerHour: 5, description: 'Day 14: Two weeks (Safe Mode)' },
  { day: 21, maxMessagesPerDay: 30, maxMessagesPerHour: 6, description: 'Day 21: Three weeks (Safe Mode)' },
  { day: 30, maxMessagesPerDay: 40, maxMessagesPerHour: 8, description: 'Day 30: Full month (Safe Mode)' },
];

function getWarmingPhase(warmingDays: number): WarmingPhase {
  // Find the appropriate phase based on days
  let phase = WARMING_PHASES[0];
  for (const p of WARMING_PHASES) {
    if (warmingDays >= p.day) {
      phase = p;
    }
  }
  return phase;
}

// ==================== STATE ====================

const accounts: Map<string, Account> = new Map();
const messageQueue: Map<string, NodeJS.Timeout[]> = new Map();
const warmingIntervals: Map<string, NodeJS.Timeout[]> = new Map();
const chatPairs: Map<string, ChatPair> = new Map();

const personalityPool: Personality[] = [];
const MAX_PERSONALITY_POOL = 50; // Limit personality pool to prevent memory leak
let isGeneratingPersonalities = false;

// ==================== CONNECTION TIMEOUT TRACKING ====================
// Track accounts stuck in "connecting" state (QR/Pairing timeout)
const connectionTimeouts: Map<string, NodeJS.Timeout> = new Map();
const CONNECTING_TIMEOUT_MS = 120000; // 2 minutes timeout for QR/Pairing

// ZAI instance removed

// ==================== GROQ AI BACKUP ====================
// Groq AI untuk generate response
let groqInstance: Groq | null = null;

// Fallback responses when all AI fails
const FALLBACK_RESPONSES = [
  'Oke siap!',
  'Baik, noted!',
  'Hmm iya bener',
  'Wah menarik ya',
  'Haha iya 😄',
  'Oh gitu ya',
  'Serius? Wkwkw',
  'Haha emang gitu',
  'Iya bener tuh',
  'Oh oke noted!',
  'Wkwkw lucu sih',
  'Hmm iya juga sih',
  'Bener juga ya',
  'Oh iya? Baru tau',
  'Haha biasa aja'
];

// ==================== AI API SETTINGS ====================
// Configurable AI API settings - can be updated via API
interface AIApiSettings {
  provider: 'groq' | 'fallback';
  groqApiKey: string;
  groqModel: string;
  lastUpdated?: Date;
}

const aiApiSettings: AIApiSettings = {
  provider: 'groq',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: 'llama-3.3-70b-versatile',
  lastUpdated: new Date()
};

// Get Groq instance with API key from settings
function getGroqInstance(): Groq | null {
  if (!groqInstance) {
    // Use API key from settings (can be updated via API) or environment
    const apiKey = aiApiSettings.groqApiKey || process.env.GROQ_API_KEY;
    
    if (!apiKey) {
      console.warn('⚠️ GROQ_API_KEY not set. Get free API key at https://console.groq.com/keys');
      return null;
    }
    
    try {
      groqInstance = new Groq({ apiKey });
      console.log('✅ Groq instance initialized with API key');
    } catch (error) {
      console.error('Failed to initialize Groq:', error);
      return null;
    }
  }
  return groqInstance;
}

// Reset Groq instance (call after API key update)
function resetGroqInstance(): void {
  groqInstance = null;
}

const eventLogs: Array<{
  id: string;
  type: 'message' | 'connection' | 'error' | 'info' | 'warming' | 'pool' | 'backup' | 'ratelimit' | 'warning';
  accountId?: string;
  message: string;
  timestamp: Date;
}> = [];

const MAX_LOGS = 500;
const MAX_ACCOUNTS = 100;
const MAX_RECONNECT_ATTEMPTS = 5; // Max reconnect before declaring banned

// ==================== RECONNECT TRACKING ====================
const reconnectAttempts: Map<string, number> = new Map();

// Track if account ever successfully connected (to differentiate QR timeout vs ban)
const everConnected: Map<string, boolean> = new Map();

// Track accounts that are being intentionally deleted (to prevent auto-reconnect)
const pendingDeletion: Set<string> = new Set();

// ==================== PAIRING SUCCESS TRACKING ====================
// Track recent pairing success to avoid clearing credentials during reconnect
const recentPairingSuccess: Map<string, { timestamp: Date; phoneNumber?: string }> = new Map();
const PAIRING_SUCCESS_TTL_MS = 60000; // 60 seconds - pairing success is "recent" for this long

// ==================== PERSONALITY TRACKING ====================
// Track personalities to prevent regeneration even if account is deleted
const personalityRegistry: Map<string, Personality> = new Map();

// ==================== SAFE MODE CONFIGURATION ====================
// Safe Mode: Mengurangi risiko banned dengan intensitas sangat rendah

const SAFE_MODE_CONFIG = {
  // Safe Mode enabled by default untuk menghindari ban
  enabled: true,

  // Batas maksimal akun yang ONLINE bersamaan
  // DIANJURKAN: 5-10 untuk testing, bisa dinaikkan setelah 1 minggu aman
  maxConcurrentOnline: 5, // DITURUNKAN dari 10

  // Silent period (akun "istirahat" tanpa aktivitas)
  silentPeriodEnabled: true,
  silentPeriodMinMinutes: 60, // DINAIKKAN dari 30
  silentPeriodMaxMinutes: 240, // DINAIKKAN dari 180 (1-4 jam diam)

  // Probability untuk tidak merespon (seperti manusia sibuk)
  ignoreMessageChance: 0.4, // DINAIKKAN dari 0.3 (40% tidak merespon)

  // Delay lebih panjang dan random
  responseDelayMinMinutes: 10, // DINAIKKAN dari 5
  responseDelayMaxMinutes: 120, // DINAIKKAN dari 60 (10 menit - 2 jam)

  // Activity burst limits
  maxActivityMinutesPerSession: 20, // DITURUNKAN dari 30
  minRestMinutesBetweenSessions: 90, // DINAIKKAN dari 60 (1.5 jam istirahat)
};

let rotationTimer: NodeJS.Timeout | null = null;
let backupTimer: NodeJS.Timeout | null = null;

// Default config with SAFE MODE settings (intensitas rendah)
let config: Config = {
  warmerEnabled: true,
  warmerDelayMin: 600000,  // 10 menit minimum (dari 3 menit)
  warmerDelayMax: 1800000, // 30 menit maximum (dari 7 menit)
  autoPresenceUpdate: true,
  presenceUpdateInterval: 60, // 60 menit (dari 30 menit)
  typingSimulationEnabled: false, // DIMATIKAN - berisiko terdeteksi
  readReceiptsEnabled: true,
  aiSystemPrompt: `Kamu adalah orang Indonesia yang ramah dan santai.
Balas pesan dengan gaya chat WhatsApp yang natural, singkat (1-2 kalimat), dan kadang pakai emoji.
Jangan terlihat seperti bot atau AI. Gunakan bahasa casual seperti "gimana", "yaudah", "btw", dll.
PENTING: Jangan terlalu cepat merespon. Jangan terlalu aktif. Kadang tidak perlu balas.`,
  warmingIntensity: 'low', // DITURUNKAN dari medium
  activePoolSize: 10, // DITURUNKAN dari 25
  idlePoolSize: 20, // DITURUNKAN dari 35
  rotationIntervalMin: 60 * 60 * 1000, // 1 jam (dari 15 menit)
  rotationIntervalMax: 120 * 60 * 1000, // 2 jam (dari 30 menit)
  chatSimulationEnabled: true, // AKTIF - tapi dengan aturan anti-spam
  // Conversation decay (natural ending)
  maxSilenceCount: 2, // DITURUNKAN dari 3 - lebih cepat ending
  conversationDecayEnabled: true,
  // Anti-detection features
  readReceiptRandomEnabled: true,
  readReceiptInstantChance: 30, // DITURUNKAN dari 50% - lebih jarang instant
  readReceiptDelayChance: 40, // DINAIKKAN - lebih sering delay
  readReceiptIgnoreChance: 30, // DINAIKKAN dari 15% - lebih sering ignore
  randomOfflineEnabled: true,
  minOnlineHours: 1, // DITURUNKAN dari 2 jam
  maxOnlineHours: 4, // DITURUNKAN dari 6 jam
  minOfflineMinutes: 30, // DINAIKKAN dari 10 menit
  maxOfflineMinutes: 240, // DINAIKKAN dari 120 menit (4 jam)
  burstPreventionEnabled: true,
  minDelayBetweenMessages: 120000, // 2 menit (dari 30 detik)
  maxMessagesPerBurst: 2, // DITURUNKAN dari 3
  // Rate limiting - SAFE MODE
  rateLimitEnabled: true,
  maxMessagesPerHour: 5, // DITURUNKAN DRAMATIS dari 15
  maxMessagesPerDay: 30, // DITURUNKAN DRAMATIS dari 100
  // Warming schedule
  warmingScheduleEnabled: true,
  // Backup
  autoBackupEnabled: true,
  backupIntervalHours: 6
};

// ==================== UTILITY FUNCTIONS ====================

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Security: Validate account ID to prevent path traversal
function validateAccountId(accountId: string): { valid: boolean; error?: string } {
  if (!accountId || typeof accountId !== 'string') {
    return { valid: false, error: 'accountId is required' };
  }
  
  // Length check
  if (accountId.length < 1 || accountId.length > 100) {
    return { valid: false, error: 'accountId must be 1-100 characters' };
  }
  
  // Only allow alphanumeric, dash, underscore
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(accountId)) {
    return { valid: false, error: 'accountId can only contain letters, numbers, dash, and underscore' };
  }
  
  // Prevent path traversal
  if (accountId.includes('..') || accountId.includes('/') || accountId.includes('\\')) {
    return { valid: false, error: 'Invalid accountId format' };
  }
  
  return { valid: true };
}

// Security: Validate phone number
function validatePhoneNumber(phone: string): { valid: boolean; error?: string } {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, error: 'phoneNumber is required' };
  }
  
  // Phone number format: digits only, optional + prefix
  const phonePattern = /^\+?[0-9]{8,15}$/;
  if (!phonePattern.test(phone.replace(/[\s-]/g, ''))) {
    return { valid: false, error: 'Invalid phone number format' };
  }
  
  return { valid: true };
}

// ==================== SAFE MODE FUNCTIONS ====================

// Check if account is in silent period (istirahat)
function isInSilentPeriod(account: Account): boolean {
  if (!SAFE_MODE_CONFIG.silentPeriodEnabled) return false;
  if (!account.silentPeriod?.isActive) return false;
  
  const now = new Date();
  if (account.silentPeriod.endsAt && now < account.silentPeriod.endsAt) {
    return true;
  }
  
  // Silent period ended
  account.silentPeriod.isActive = false;
  return false;
}

// Start a silent period for an account
function startSilentPeriod(account: Account): void {
  if (!SAFE_MODE_CONFIG.silentPeriodEnabled) return;
  
  const durationMinutes = getRandomInt(
    SAFE_MODE_CONFIG.silentPeriodMinMinutes,
    SAFE_MODE_CONFIG.silentPeriodMaxMinutes
  );
  const durationMs = durationMinutes * 60 * 1000;
  
  account.silentPeriod = {
    isActive: true,
    startedAt: new Date(),
    endsAt: new Date(Date.now() + durationMs),
    duration: durationMs
  };
  
  addLog('info', `😴 Silent period started for ${durationMinutes} minutes`, account.id);
}

// Check if we should start a silent period (random chance)
function shouldStartSilentPeriod(account: Account): boolean {
  if (!SAFE_MODE_CONFIG.silentPeriodEnabled) return false;
  if (account.silentPeriod?.isActive) return false;
  
  // 10% chance to start silent period after activity
  return Math.random() < 0.1;
}

// Check if should ignore message (like busy human)
function shouldIgnoreMessage(): boolean {
  if (!SAFE_MODE_CONFIG.enabled) return false;
  return Math.random() < SAFE_MODE_CONFIG.ignoreMessageChance;
}

// Get safe response delay (5-60 minutes)
function getSafeResponseDelay(): number {
  const minMs = SAFE_MODE_CONFIG.responseDelayMinMinutes * 60 * 1000;
  const maxMs = SAFE_MODE_CONFIG.responseDelayMaxMinutes * 60 * 1000;
  return getRandomInt(minMs, maxMs);
}

// Get count of currently online accounts
function getOnlineAccountCount(): number {
  return Array.from(accounts.values()).filter(a => a.status === 'online').length;
}

// Check if we can bring more accounts online
function canBringOnline(): boolean {
  if (!SAFE_MODE_CONFIG.enabled) return true;
  return getOnlineAccountCount() < SAFE_MODE_CONFIG.maxConcurrentOnline;
}

// Enforce max concurrent online limit
async function enforceMaxOnlineLimit(): Promise<void> {
  if (!SAFE_MODE_CONFIG.enabled) return;
  
  const onlineAccounts = Array.from(accounts.values()).filter(a => a.status === 'online');
  const excess = onlineAccounts.length - SAFE_MODE_CONFIG.maxConcurrentOnline;
  
  if (excess > 0) {
    addLog('info', `⚠️ Safe Mode: Too many online accounts (${onlineAccounts.length}), disconnecting ${excess}...`);
    
    // Sort by last activity (least recent first) and disconnect
    const sorted = onlineAccounts.sort((a, b) => {
      const aTime = a.warmingStats.lastActivity?.getTime() || 0;
      const bTime = b.warmingStats.lastActivity?.getTime() || 0;
      return aTime - bTime;
    });
    
    for (let i = 0; i < excess; i++) {
      const account = sorted[i];
      if (account.socket && account.status === 'online') {
        // Move to offline pool instead of disconnecting
        await assignAccountToPool(account, 'offline');
        addLog('info', `📴 Safe Mode: Moved ${account.id} to offline pool`, account.id);
      }
    }
  }
}

// ==================== BURNABLE ACCOUNT MANAGEMENT ====================
// Strategi untuk akun yang siap "dikorbankan" jika kena ban

interface BurnableAccountStats {
  accountId: string;
  createdAt: Date;
  lifecycle: 'new' | 'warming' | 'active' | 'warning' | 'banned';
  daysActive: number;
  messagesSent: number;
  messagesReceived: number;
  banCount: number;
  lastBanDate?: Date;
  healthScore: number;
  replacement?: string; // Account ID pengganti
}

interface AccountLifecycle {
  warmingDays: number;
  maxWarmingDays: number;
  activityScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

// Burnable account configuration
const BURNABLE_CONFIG = {
  // Akun yang sudah "mati" dan perlu diganti
  bannedAccounts: new Map<string, BurnableAccountStats>(),
  
  // Queue untuk akun pengganti
  replacementQueue: [] as string[],
  
  // Akun cadangan (fresh)
  reserveAccounts: [] as string[],
  
  // Stats tracking
  totalBans: 0,
  totalReplacements: 0,
  averageAccountLifespan: 0, // days
  
  // Warming configuration
  warmingRequired: true,
  warmingDaysMin: 3,
  warmingDaysMax: 7,
  
  // Health thresholds
  healthWarningThreshold: 30,
  healthCriticalThreshold: 15,
};

// Hitung health score untuk burnable account
function calculateBurnableHealth(account: Account): number {
  if (!account.warmingStats) return 0;
  
  let score = 100;
  
  // Faktor negatif
  const daysSinceActivity = account.warmingStats.lastActivity 
    ? (Date.now() - account.warmingStats.lastActivity.getTime()) / (1000 * 60 * 60 * 24)
    : 999;
  
  if (daysSinceActivity > 7) score -= 50;
  else if (daysSinceActivity > 3) score -= 25;
  else if (daysSinceActivity > 1) score -= 10;
  
  // Ratio messages sent/received (terlalu banyak kirim = curiga)
  const ratio = account.warmingStats.messagesSent / Math.max(account.warmingStats.messagesReceived, 1);
  if (ratio > 3) score -= 30; // Kirim 3x lebih banyak dari terima
  else if (ratio > 2) score -= 15;
  
  // Account age (akun baru lebih riskan)
  const daysSinceStart = account.warmingStats.warmingStartTime 
    ? (Date.now() - account.warmingStats.warmingStartTime.getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  
  if (daysSinceStart < 1) score -= 20; // Akun baru < 1 hari
  else if (daysSinceStart < 3) score -= 10;
  
  return Math.max(0, Math.min(100, score));
}

// Update account lifecycle status
function updateAccountLifecycle(account: Account): AccountLifecycle {
  const healthScore = calculateBurnableHealth(account);
  const daysActive = account.warmingStats.warmingStartTime
    ? Math.floor((Date.now() - account.warmingStats.warmingStartTime.getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  
  let riskLevel: AccountLifecycle['riskLevel'] = 'low';
  if (healthScore < BURNABLE_CONFIG.healthCriticalThreshold) {
    riskLevel = 'critical';
  } else if (healthScore < BURNABLE_CONFIG.healthWarningThreshold) {
    riskLevel = 'high';
  } else if (healthScore < 50) {
    riskLevel = 'medium';
  }
  
  // Determine lifecycle stage
  let lifecycle: BurnableAccountStats['lifecycle'] = 'active';
  if (daysActive < BURNABLE_CONFIG.warmingDaysMin) {
    lifecycle = 'warming';
  } else if (riskLevel === 'critical') {
    lifecycle = 'warning';
  }
  
  return {
    warmingDays: daysActive,
    maxWarmingDays: BURNABLE_CONFIG.warmingDaysMax,
    activityScore: healthScore,
    riskLevel
  };
}

// Handle banned account
async function handleBannedAccount(accountId: string, reason?: string): Promise<void> {
  const account = accounts.get(accountId);

  // Record ban stats
  const stats: BurnableAccountStats = {
    accountId,
    createdAt: account?.warmingStats?.warmingStartTime || new Date(),
    lifecycle: 'banned',
    daysActive: account?.warmingStats?.warmingDays || 0,
    messagesSent: account?.warmingStats?.messagesSent || 0,
    messagesReceived: account?.warmingStats?.messagesReceived || 0,
    banCount: (BURNABLE_CONFIG.bannedAccounts.get(accountId)?.banCount || 0) + 1,
    lastBanDate: new Date(),
    healthScore: 0
  };

  BURNABLE_CONFIG.bannedAccounts.set(accountId, stats);
  BURNABLE_CONFIG.totalBans++;

  // Log ban event
  addLog('error', `🚫 Account BANNED: ${accountId}. Reason: ${reason || 'Unknown'}`, accountId);

  // Check if we have replacement
  if (BURNABLE_CONFIG.replacementQueue.length > 0) {
    const replacementId = BURNABLE_CONFIG.replacementQueue.shift()!;
    stats.replacement = replacementId;
    BURNABLE_CONFIG.totalReplacements++;

    addLog('info', `🔄 Replacement account queued: ${replacementId} for banned ${accountId}`);
  }

  // ========== CLEANUP ==========
  // Stop all warming timers and message queues
  stopWarmingTimers(accountId);
  
  // Clear chat partner relationships
  clearChatPartner(accountId);
  
  // Clear connection timeout if exists
  const connTimeout = connectionTimeouts.get(accountId);
  if (connTimeout) {
    clearTimeout(connTimeout);
    connectionTimeouts.delete(accountId);
  }

  // Clean up from active accounts map
  accounts.delete(accountId);

  // Clean up reconnect attempts (no more retries needed)
  reconnectAttempts.delete(accountId);
  
  // Clean up ever connected tracking
  everConnected.delete(accountId);
  
  // Remove from pending deletion if present
  pendingDeletion.delete(accountId);
  
  // Clear pairing success tracking
  recentPairingSuccess.delete(accountId);

  // IMPORTANT: We do NOT delete from personalityRegistry
  // This prevents personality regeneration if startSession is somehow called again

  // Emit banned event
  io.emit('account-banned', { accountId, reason, replacement: stats.replacement });
}

// Get burnable statistics
function getBurnableStats() {
  const activeAccounts = Array.from(accounts.values()).filter(a => a.status === 'online');
  const warmingAccounts = activeAccounts.filter(a => {
    const lifecycle = updateAccountLifecycle(a);
    return lifecycle.warmingDays < BURNABLE_CONFIG.warmingDaysMin;
  });
  const warningAccounts = activeAccounts.filter(a => {
    const lifecycle = updateAccountLifecycle(a);
    return lifecycle.riskLevel === 'high' || lifecycle.riskLevel === 'critical';
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

// ==================== TOPIC SYSTEM ====================

const TOPIC_CATEGORIES = {
  daily_life: {
    name: 'Kehidupan Sehari-hari',
    topics: [
      'Lagi ngapain sekarang?',
      'Udah makan belum?',
      'Kemarin ngapain aja?',
      'Weekend ada rencana apa?',
      'Lagi sibuk ga sih?',
      'Cuaca hari ini gimana di tempatmu?',
      'Udah sarapan?',
      'Lagi di kantor atau di rumah?',
      'Hari ini lembur ga?',
      'Traffic tadi gimana?'
    ]
  },
  work_study: {
    name: 'Kerja/Kuliah',
    topics: [
      'Kerjaan lagi banyak ga?',
      'Deadline ada ga?',
      'Boss nyebelin ga?',
      'Rekan kerja gimana?',
      'Ada meeting banyak ga hari ini?',
      'Kantor enak ga sih?',
      'Kuliah lagi sibuk?',
      'Tugas banyak?',
      'Ujian dah dekat?',
      'Dosen killer ada?'
    ]
  },
  entertainment: {
    name: 'Hiburan',
    topics: [
      'Nonton film apa belakangan?',
      'Drama Korea ada rekomendasi?',
      'Film horor ada yang bagus?',
      'Lagu enak apa sekarang?',
      'Konser ada yang mau dateng?',
      'Netflix ada tontonan bagus?',
      'Anime ada rekomendasi?',
      'Game lagi main apa?',
      'YouTube sering nonton apa?',
      'Podcast dengerin apa?'
    ]
  },
  food: {
    name: 'Makanan',
    topics: [
      'Makanan favorit apa?',
      'Restoran enak ada rekomendasi?',
      'Pedes suka ga?',
      'Suka masak?',
      'Mie ayam enak dimana?',
      'Kopi atau teh?',
      'Jajanan malam ada yang enak?',
      'Diet lagi ga?',
      'Suka makanan apa?',
      'Makan siang dimana tadi?'
    ]
  },
  travel: {
    name: 'Traveling',
    topics: [
      'Liburan terakhir kemana?',
      'Destinasi impian?',
      'Pantai atau gunung?',
      'Naik pesawat suka?',
      'Wisata lokal ada rekomendasi?',
      'Staycation pernah?',
      'Jalan-jalan sendiri atau bareng?',
      'Backpacker pernah?',
      'Hotel favorit?',
      'Wisata kuliner pernah?'
    ]
  },
  technology: {
    name: 'Teknologi',
    topics: [
      'HP baru ada yang bagus?',
      'iPhone atau Android?',
      'Laptop rekomendasi?',
      'ChatGPT pernah pake?',
      'Apps produktif ada rekomendasi?',
      'Gaming PC atau console?',
      'Smartwatch punya?',
      'Internet di rumah cepet?',
      'Sosmed apa yang sering?',
      'TikTok sering scroll?'
    ]
  },
  sports: {
    name: 'Olahraga',
    topics: [
      'Olahraga apa yang suka?',
      'Gym atau jogging?',
      'Badminton main ga?',
      'Futsal sering?',
      'Nonton bola ga?',
      'Tim bola favorit?',
      'Olympics nonton ga?',
      'Renang bisa?',
      'Yoga pernah coba?',
      'Gym membership punya?'
    ]
  },
  personal: {
    name: 'Pribadi',
    topics: [
      'Aku kemarin mimpi aneh',
      'Lagi mood apa hari ini?',
      'Resolusi tahun ini apa?',
      'Habit baru coba?',
      'Lagi belajar apa?',
      'Project pribadi ada?',
      'Impian jangka panjang?',
      'Kebiasaan pagi apa?',
      'Sleep schedule gimana?',
      'Me time kayak gimana?'
    ]
  },
  trending: {
    name: 'Trending',
    topics: [
      'Berita hari ini baca?',
      'Viral lagi apa?',
      'Meme terbaru ada?',
      'Trending topic liat?',
      'Gosip artis dengar?',
      'Event lagi ada?',
      'Promo lagi ada?',
      'Black Friday ada?',
      'Sale besar ada?',
      'Tren fashion baru?'
    ]
  }
};

// Relationship stages with conversation depth
const RELATIONSHIP_STAGES = {
  stranger: { minMessages: 0, maxMessages: 5, description: 'Baru kenal' },
  acquaintance: { minMessages: 5, maxMessages: 15, description: 'Sudah kenal' },
  friend: { minMessages: 15, maxMessages: 30, description: 'Teman' },
  close_friend: { minMessages: 30, maxMessages: 999, description: 'Teman dekat' }
} as const;

// Find shared interests between two personalities
function findSharedInterests(p1: Personality | null, p2: Personality | null): string[] {
  if (!p1?.hobbies || !p2?.hobbies) return [];
  return p1.hobbies.filter(h => p2.hobbies.includes(h));
}

// Determine topic category based on shared interests
function getTopicCategoryForInterests(interests: string[]): keyof typeof TOPIC_CATEGORIES {
  const interestToCategory: Record<string, keyof typeof TOPIC_CATEGORIES> = {
    'musik': 'entertainment',
    'film': 'entertainment',
    'gaming': 'technology',
    'traveling': 'travel',
    'kuliner': 'food',
    'fotografi': 'daily_life',
    'olahraga': 'sports',
    'membaca': 'entertainment',
    'nonton drama': 'entertainment',
    'jalan-jalan': 'travel'
  };
  
  for (const interest of interests) {
    const category = interestToCategory[interest.toLowerCase()];
    if (category) return category;
  }
  
  // Random category if no match
  const categories = Object.keys(TOPIC_CATEGORIES) as (keyof typeof TOPIC_CATEGORIES)[];
  return getRandomItem(categories);
}

// Generate a new topic for a chat pair
function generateNewTopic(pair: ChatPair, account1: Account, account2: Account): { topic: string; category: string } {
  const sharedInterests = findSharedInterests(account1.personality, account2.personality);
  
  // Prefer shared interests topics
  let category: keyof typeof TOPIC_CATEGORIES;
  if (sharedInterests.length > 0 && Math.random() > 0.3) {
    category = getTopicCategoryForInterests(sharedInterests);
  } else {
    // Mix of categories, avoid recently discussed
    const availableCategories = (Object.keys(TOPIC_CATEGORIES) as (keyof typeof TOPIC_CATEGORIES)[])
      .filter(c => !pair.topicsDiscussed.slice(-3).includes(c));
    category = availableCategories.length > 0 ? getRandomItem(availableCategories) : 'daily_life';
  }
  
  const categoryData = TOPIC_CATEGORIES[category];
  
  // Get topic not recently discussed
  const availableTopics = categoryData.topics.filter(t => !pair.topicsDiscussed.includes(t));
  const topic = availableTopics.length > 0 ? getRandomItem(availableTopics) : getRandomItem(categoryData.topics);
  
  return { topic, category: categoryData.name };
}

// Update relationship stage based on message count
function updateRelationshipStage(pair: ChatPair): void {
  const msgCount = pair.messageCount;
  
  if (msgCount >= RELATIONSHIP_STAGES.close_friend.minMessages) {
    pair.relationshipStage = 'close_friend';
  } else if (msgCount >= RELATIONSHIP_STAGES.friend.minMessages) {
    pair.relationshipStage = 'friend';
  } else if (msgCount >= RELATIONSHIP_STAGES.acquaintance.minMessages) {
    pair.relationshipStage = 'acquaintance';
  } else {
    pair.relationshipStage = 'stranger';
  }
}

// Get relationship-specific conversation style
function getRelationshipStyle(stage: ChatPair['relationshipStage']): string {
  switch (stage) {
    case 'stranger':
      return 'Masih baru kenal, jadi masih agak formal dan sopan. Tanya-tanya dulu.';
    case 'acquaintance':
      return 'Sudah kenal, mulai bisa bercanda sedikit. Lebih santai.';
    case 'friend':
      return 'Teman akrab, bisa ngomong apa aja. Sering bercanda.';
    case 'close_friend':
      return 'Teman dekat, bisa curhat, bercanda, dan saling support. Tidak ada batasan topik.';
  }
}

// Generate conversation context for AI
function buildConversationContext(pair: ChatPair, sender: Account, receiver: Account): string {
  const sharedInterests = findSharedInterests(sender.personality, receiver.personality);
  const relStyle = getRelationshipStyle(pair.relationshipStage);
  
  let context = `Kamu sedang chat dengan ${receiver.personality?.name || 'seseorang'}.
Topik pembicaraan sekarang: "${pair.currentTopic}"
Kategori: ${pair.topicCategory}
Tingkat hubungan: ${RELATIONSHIP_STAGES[pair.relationshipStage].description}
Gaya: ${relStyle}`;

  if (sharedInterests.length > 0) {
    context += `\nKalian punya hobi yang sama: ${sharedInterests.join(', ')}`;
  }
  
  if (pair.conversationContext.length > 0) {
    context += `\nPercakapan terakhir:\n${pair.conversationContext.slice(-3).join('\n')}`;
  }
  
  return context;
}

function addLog(type: typeof eventLogs[0]['type'], message: string, accountId?: string) {
  const log = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    accountId,
    message,
    timestamp: new Date()
  };
  eventLogs.unshift(log);
  if (eventLogs.length > MAX_LOGS) {
    eventLogs.pop();
  }
  io.emit('log', log);
  
  // Persist log to database (async, don't wait)
  // Only save if accountId is provided AND account exists in database
  if (accountId) {
    // Check if account exists in database first to avoid foreign key error
    db.whatsAppAccount.findUnique({ where: { id: accountId } })
      .then((existingAccount) => {
        if (existingAccount) {
          return db.eventLog.create({
            data: { type, message, accountId, timestamp: new Date() }
          });
        }
        // Account not in DB yet, skip silently
        return null;
      })
      .catch(() => {
        // Silent fail
      });
  }
}

// ==================== RATE LIMITING ====================

function createDefaultRateLimit(): RateLimit {
  return {
    messagesPerHour: config.maxMessagesPerHour,
    messagesPerDay: config.maxMessagesPerDay,
    currentHourCount: 0,
    currentDayCount: 0,
    lastHourReset: new Date(),
    lastDayReset: new Date()
  };
}

function checkRateLimit(account: Account): { allowed: boolean; reason?: string; waitTime?: number } {
  if (!config.rateLimitEnabled) {
    return { allowed: true };
  }

  const rateLimit = account.warmingStats.rateLimit;
  const now = new Date();

  // Check hour reset
  const hourDiff = now.getTime() - rateLimit.lastHourReset.getTime();
  if (hourDiff >= 3600000) { // 1 hour
    rateLimit.currentHourCount = 0;
    rateLimit.lastHourReset = now;
  }

  // Check day reset
  const dayDiff = now.getTime() - rateLimit.lastDayReset.getTime();
  if (dayDiff >= 86400000) { // 24 hours
    rateLimit.currentDayCount = 0;
    rateLimit.lastDayReset = now;
  }

  // Get warming phase limits
  let maxPerHour = rateLimit.messagesPerHour;
  let maxPerDay = rateLimit.messagesPerDay;

  if (config.warmingScheduleEnabled && account.warmingStats.warmingStartTime) {
    const warmingDays = Math.floor((now.getTime() - account.warmingStats.warmingStartTime.getTime()) / 86400000);
    const phase = getWarmingPhase(warmingDays);
    maxPerHour = phase.maxMessagesPerHour;
    maxPerDay = phase.maxMessagesPerDay;
    
    // Update stats
    account.warmingStats.currentPhase = phase.day;
    account.warmingStats.warmingDays = warmingDays;
  }

  // Check limits
  if (rateLimit.currentHourCount >= maxPerHour) {
    const waitTime = 3600000 - hourDiff;
    return { 
      allowed: false, 
      reason: `Hourly limit reached (${maxPerHour}/hour)`,
      waitTime 
    };
  }

  if (rateLimit.currentDayCount >= maxPerDay) {
    const waitTime = 86400000 - dayDiff;
    return { 
      allowed: false, 
      reason: `Daily limit reached (${maxPerDay}/day)`,
      waitTime 
    };
  }

  return { allowed: true };
}

function incrementRateLimit(account: Account) {
  account.warmingStats.rateLimit.currentHourCount++;
  account.warmingStats.rateLimit.currentDayCount++;
}

// ==================== BACKUP SYSTEM ====================

async function ensureBackupDir() {
  try {
    await access(BACKUP_DIR);
  } catch {
    await mkdir(BACKUP_DIR, { recursive: true });
  }
}

async function backupSession(accountId: string) {
  try {
    const sessionDir = join(SESSIONS_DIR, accountId);
    const backupAccountDir = join(BACKUP_DIR, accountId);
    
    // Check if session exists
    try {
      await access(sessionDir);
    } catch {
      return; // No session to backup
    }

    // Create backup directory
    await mkdir(backupAccountDir, { recursive: true });

    // Copy all session files
    const files = await readdir(sessionDir);
    for (const file of files) {
      const srcPath = join(sessionDir, file);
      const destPath = join(backupAccountDir, file);
      await copyFile(srcPath, destPath);
    }

    addLog('backup', `✅ Session backed up successfully`, accountId);
  } catch (error) {
    addLog('error', `❌ Backup failed: ${error}`, accountId);
  }
}

async function backupAllSessions() {
  addLog('backup', '🔄 Starting scheduled backup for all sessions...');
  
  const accountList = Array.from(accounts.keys());
  let successCount = 0;

  for (const accountId of accountList) {
    await backupSession(accountId);
    successCount++;
    // Small delay to avoid I/O overload
    await delay(100);
  }

  addLog('backup', `✅ Backup complete: ${successCount} sessions backed up`);
}

function scheduleAutoBackup() {
  if (backupTimer) {
    clearInterval(backupTimer);
  }

  if (config.autoBackupEnabled) {
    const interval = config.backupIntervalHours * 60 * 60 * 1000;
    
    backupTimer = setInterval(() => {
      backupAllSessions();
    }, interval);

    addLog('info', `💾 Auto-backup scheduled every ${config.backupIntervalHours} hours`);
  }
}

// ==================== POOL MANAGEMENT ====================

function getAccountsByPool(pool: Account['pool']): Account[] {
  return Array.from(accounts.values()).filter(a => a.pool === pool && a.status === 'online');
}

function getActiveAccounts(): Account[] {
  return getAccountsByPool('active');
}

function getIdleAccounts(): Account[] {
  return getAccountsByPool('idle');
}

function getOfflinePoolAccounts(): Account[] {
  return getAccountsByPool('offline');
}

async function assignAccountToPool(account: Account, pool: Account['pool']) {
  const oldPool = account.pool;
  account.pool = pool;
  account.poolSince = new Date();
  
  addLog('pool', `📦 Account moved from ${oldPool} to ${pool}`, account.id);
  io.emit('pool-change', { accountId: account.id, pool, previousPool: oldPool });
  
  if (pool === 'offline' && account.socket && account.status === 'online') {
    try {
      account.socket.end?.();
      account.status = 'offline';
      io.emit('account-status', { accountId: account.id, status: 'offline' });
    } catch (e) {}
  }
  
  if (pool === 'active' && config.chatSimulationEnabled) {
    await findChatPartner(account);
  }
  
  if (oldPool === 'active' && pool !== 'active') {
    clearChatPartner(account.id);
  }
}

async function rotatePools() {
  const onlineAccounts = Array.from(accounts.values()).filter(a => a.status === 'online');
  
  if (onlineAccounts.length === 0) {
    scheduleNextRotation();
    return;
  }
  
  addLog('info', `🔄 Starting pool rotation for ${onlineAccounts.length} accounts`);
  
  const totalOnline = onlineAccounts.length;
  const targetActive = Math.min(config.activePoolSize, Math.ceil(totalOnline * 0.3));
  const targetIdle = Math.min(config.idlePoolSize, Math.ceil(totalOnline * 0.5));
  
  const shuffled = shuffleArray(onlineAccounts);
  
  let activeCount = 0;
  let idleCount = 0;
  
  for (const account of shuffled) {
    if (activeCount < targetActive) {
      if (account.pool !== 'active') {
        await assignAccountToPool(account, 'active');
      }
      activeCount++;
    } else if (idleCount < targetIdle) {
      if (account.pool !== 'idle') {
        await assignAccountToPool(account, 'idle');
      }
      idleCount++;
    } else {
      if (account.pool !== 'offline') {
        await assignAccountToPool(account, 'offline');
      }
    }
  }
  
  addLog('info', `✅ Pool rotation complete: ${activeCount} active, ${idleCount} idle, ${totalOnline - activeCount - idleCount} offline`);
  io.emit('pool-rotation', { 
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
  
  addLog('info', `⏰ Next pool rotation in ${Math.round(interval / 60000)} minutes`);
  
  rotationTimer = setTimeout(() => {
    rotatePools();
  }, interval);
}

// ==================== CHAT PAIRING ====================

async function findChatPartner(account: Account): Promise<string | null> {
  if (!config.chatSimulationEnabled) return null;
  
  const activeAccounts = getActiveAccounts().filter(a => 
    a.id !== account.id && 
    !a.currentChatPartner &&
    account.socket?.user?.id &&
    a.socket?.user?.id
  );
  
  if (activeAccounts.length === 0) return null;
  
  const partner = getRandomItem(activeAccounts);
  
  account.currentChatPartner = partner.id;
  partner.currentChatPartner = account.id;
  
  // Find shared interests
  const sharedInterests = findSharedInterests(account.personality, partner.personality);
  
  // Generate initial topic
  const initialTopic = {
    topic: getRandomItem(TOPIC_CATEGORIES.daily_life.topics),
    category: TOPIC_CATEGORIES.daily_life.name
  };
  
  const pairId = `${account.id}-${partner.id}`;
  const newPair: ChatPair = {
    account1Id: account.id,
    account2Id: partner.id,
    startedAt: new Date(),
    messageCount: 0,
    currentTopic: initialTopic.topic,
    topicCategory: initialTopic.category,
    topicStartedAt: new Date(),
    topicsDiscussed: [],
    conversationContext: [],
    relationshipStage: 'stranger',
    sharedInterests,
    // Anti-spam tracking
    unansweredMessages: 0,
    lastSenderId: '',
    // Natural decay
    silenceCount: 0,
    lastRespondedAt: undefined
  };
  chatPairs.set(pairId, newPair);
  
  addLog('warming', `💕 Chat pair created: ${account.personality?.name || account.id} ↔ ${partner.personality?.name || partner.id} | Topic: "${initialTopic.topic}"`);
  
  setTimeout(() => {
    initiateChatSimulation(account, partner);
  }, getRandomInt(30000, 120000));
  
  return partner.id;
}

function clearChatPartner(accountId: string) {
  const account = accounts.get(accountId);
  if (!account) return;
  
  if (account.currentChatPartner) {
    const partner = accounts.get(account.currentChatPartner);
    if (partner) {
      partner.currentChatPartner = undefined;
    }
    
    for (const [pairId, pair] of chatPairs.entries()) {
      if (pair.account1Id === accountId || pair.account2Id === accountId) {
        chatPairs.delete(pairId);
      }
    }
    
    account.currentChatPartner = undefined;
  }
}

// Natural conversation decay - should conversation end naturally?
function shouldConversationEnd(pair: ChatPair, sender: Account): { end: boolean; reason?: string } {
  if (!config.conversationDecayEnabled) {
    return { end: false };
  }
  
  // Check silence count
  if (pair.silenceCount >= (config.maxSilenceCount || 3)) {
    return { end: true, reason: 'Too many silences - conversation naturally ended' };
  }
  
  // Check if outside activity window for either account
  if (!isInActiveWindow(sender.personality)) {
    return { end: true, reason: `${sender.personality?.name || sender.id} is outside active hours` };
  }
  
  // Random "got busy" chance (5% chance)
  if (Math.random() < 0.05) {
    return { end: true, reason: 'Random busy event - person got busy' };
  }
  
  // Relationship affects conversation length
  // Strangers: shorter conversations, Close friends: longer
  let endChance = 0.02; // Base 2% chance
  switch (pair.relationshipStage) {
    case 'stranger': endChance = 0.05; break;
    case 'acquaintance': endChance = 0.03; break;
    case 'friend': endChance = 0.02; break;
    case 'close_friend': endChance = 0.01; break;
  }
  
  // Increase chance based on message count (conversations naturally end after a while)
  const messageCountFactor = Math.min(pair.messageCount / 50, 0.1);
  endChance += messageCountFactor;
  
  if (Math.random() < endChance) {
    return { end: true, reason: 'Natural conversation decay' };
  }
  
  return { end: false };
}

// End conversation naturally
async function endConversationNaturally(pair: ChatPair, account1: Account, account2: Account, reason: string) {
  addLog('warming', ` 🔚 Conversation ended naturally: ${account1.personality?.name || account1.id} ↔ ${account2.personality?.name || account2.id} | ${reason}`);
  
  // Clear the pair
  const pairId = `${account1.id}-${account2.id}`;
  chatPairs.delete(pairId);
  
  // Clear current partners
  account1.currentChatPartner = undefined;
  account2.currentChatPartner = undefined;
  
  // Find new partners with random delay (like real humans)
  const delay1 = getRandomInt(5 * 60 * 1000, 30 * 60 * 1000); // 5-30 minutes
  const delay2 = getRandomInt(5 * 60 * 1000, 30 * 60 * 1000);
  
  setTimeout(async () => {
    if (account1.pool === 'active' && account1.status === 'online') {
      await findChatPartner(account1);
    }
  }, delay1);
  
  setTimeout(async () => {
    if (account2.pool === 'active' && account2.status === 'online') {
      await findChatPartner(account2);
    }
  }, delay2);
}

async function initiateChatSimulation(account1: Account, account2: Account) {
  if (account1.pool !== 'active' || account2.pool !== 'active') return;
  if (!account1.socket || !account2.socket) return;

  const jid1 = account1.socket.user?.id;
  const jid2 = account2.socket.user?.id;

  if (!jid1 || !jid2) return;

  // Get the chat pair
  const pairId = `${account1.id}-${account2.id}`;
  const pair = chatPairs.get(pairId);
  if (!pair) return;

  // ========== ANTI-SPAM CHECK ==========
  // Max 3 messages without reply - STOP sending!
  if (pair.unansweredMessages >= 3) {
    addLog('warming', `🛑 [SPAM PREVENT] ${account1.personality?.name || account1.id} ↔ ${account2.personality?.name || account2.id}: Already sent ${pair.unansweredMessages} unanswered messages. Waiting for reply...`);
    return;
  }

  const initiator = Math.random() > 0.5 ? account1 : account2;
  const receiver = initiator === account1 ? account2 : account1;
  const receiverJid = initiator === account1 ? jid2 : jid1;

  // Check rate limit before sending
  const rateCheck = checkRateLimit(initiator);
  if (!rateCheck.allowed) {
    addLog('ratelimit', `⏸️ Rate limited: ${rateCheck.reason}`, initiator.id);
    return;
  }

  // Use the pair's current topic as opening message
  const message = pair.currentTopic;

  try {
    if (initiator.socket && initiator.status === 'online') {
      await initiator.socket.sendMessage(receiverJid, { text: message });

      // ========== ANTI-SPAM: Track unanswered message ==========
      pair.unansweredMessages++;
      pair.lastSenderId = initiator.id;

      incrementRateLimit(initiator);
      initiator.warmingStats.messagesSent++;
      initiator.warmingStats.lastActivity = new Date();

      // Update pair
      pair.messageCount++;
      pair.lastMessageAt = new Date();
      pair.conversationContext.push(`${initiator.personality?.name || initiator.id}: ${message}`);
      pair.topicsDiscussed.push(message);

      addLog('warming', `💬 [${initiator.personality?.name || initiator.id}] "${message.substring(0, 25)}..." → ${receiver.personality?.name || receiver.id} (unanswered: ${pair.unansweredMessages}/3)`);

      io.emit('message', {
        id: `${Date.now()}`,
        accountId: initiator.id,
        from: 'me',
        to: receiverJid,
        text: message,
        timestamp: new Date(),
        direction: 'outgoing',
        isAutoResponse: true
      });

      setTimeout(() => {
        simulateChatResponse(receiver, initiator, message, pair);
      }, getRandomInt(60000, 180000));
    }
  } catch (error) {
    addLog('error', `Failed to initiate chat: ${error}`, initiator.id);
  }
}

async function simulateChatResponse(responder: Account, partner: Account, incomingMessage: string, pair: ChatPair) {
  if (responder.pool !== 'active' || partner.pool !== 'active') return;
  if (!responder.socket || !partner.socket) return;
  
  // ========== SAFE MODE CHECKS ==========

  // Check if in silent period
  if (isInSilentPeriod(responder)) {
    addLog('warming', `😴 [${responder.personality?.name || responder.id}] is in silent period, not responding`);
    // Still count as unanswered - partner sent but got no reply
    pair.silenceCount++;
    return;
  }

  // Safe Mode: Random chance to ignore message (like busy human)
  if (shouldIgnoreMessage()) {
    pair.silenceCount++;
    // ========== ANTI-SPAM: Count as unanswered ==========
    // Partner sent message but we ignored = unanswered for them
    addLog('warming', `📱 [${responder.personality?.name || responder.id}] ignoring message (busy - Safe Mode) - unanswered: ${pair.unansweredMessages}/3`);
    return;
  }

  // Check session activity limit
  if (responder.sessionActivity.messagesInSession >= SAFE_MODE_CONFIG.maxActivityMinutesPerSession) {
    addLog('warming', `⏸️ [${responder.personality?.name || responder.id}] session limit reached, starting rest period`);
    startSilentPeriod(responder);
    return;
  }
  
  // ========== END SAFE MODE CHECKS ==========
  
  // Check if conversation should end naturally (before responding)
  const endCheck = shouldConversationEnd(pair, responder);
  if (endCheck.end) {
    // Increment silence count
    pair.silenceCount++;
    pair.lastRespondedAt = new Date();
    
    // Check if max silence reached
    if (pair.silenceCount >= (config.maxSilenceCount || 3)) {
      await endConversationNaturally(pair, responder, partner, endCheck.reason || 'Natural decay');
      return;
    }
    
    // Just don't respond this time (silence)
    addLog('warming', `🤫 [${responder.personality?.name || responder.id}] staying silent (silence ${pair.silenceCount}/${config.maxSilenceCount})`);
    return;
  }
  
  // Check rate limit
  const rateCheck = checkRateLimit(responder);
  if (!rateCheck.allowed) {
    addLog('ratelimit', `⏸️ Rate limited: ${rateCheck.reason}`, responder.id);
    pair.silenceCount++;
    return;
  }
  
  const responderJid = responder.socket.user?.id;
  const partnerJid = partner.socket.user?.id;
  
  if (!responderJid || !partnerJid) return;

  // ========== ANTI-SPAM: Reset unanswered count ==========
  // We're replying to partner's message, so reset their unanswered count
  // And set our unanswered to 1 (we just sent, waiting for their reply)
  pair.unansweredMessages = 0;  // Partner's message was "answered" by us
  pair.silenceCount = 0;
  pair.lastRespondedAt = new Date();

  try {
    // Build context with topic and conversation history
    const context = buildConversationContext(pair, responder, partner);
    const response = await generateAIResponse(incomingMessage, responder.personality, context);

    if (config.typingSimulationEnabled) {
      await responder.socket.sendPresenceUpdate('composing', partnerJid);
      await delay(getTypingDelay(response.length));
      await responder.socket.sendPresenceUpdate('paused', partnerJid);
    }

    await responder.socket.sendMessage(partnerJid, { text: response });

    // ========== ANTI-SPAM: Track our unanswered message ==========
    pair.unansweredMessages = 1;  // We sent 1 message, waiting for partner's reply
    pair.lastSenderId = responder.id;

    incrementRateLimit(responder);
    responder.warmingStats.messagesSent++;
    responder.warmingStats.autoResponsesSent++;
    responder.warmingStats.lastActivity = new Date();
    
    // Safe Mode: Track session activity
    responder.sessionActivity.messagesInSession++;
    responder.sessionActivity.lastMessageTime = new Date();
    if (!responder.sessionActivity.sessionStart) {
      responder.sessionActivity.sessionStart = new Date();
    }
    
    // Update pair
    pair.messageCount++;
    pair.lastMessageAt = new Date();
    pair.conversationContext.push(`${responder.personality?.name || responder.id}: ${response}`);
    updateRelationshipStage(pair);
    
    // Check if we should change topic (every 5-8 messages)
    if (pair.messageCount % getRandomInt(5, 8) === 0) {
      const newTopic = generateNewTopic(pair, responder, partner);
      pair.currentTopic = newTopic.topic;
      pair.topicCategory = newTopic.category;
      pair.topicStartedAt = new Date();
      addLog('info', `🔄 Topic changed for ${responder.id} ↔ ${partner.id}: "${newTopic.topic}"`);
    }
    
    addLog('warming', `💬 [${responder.personality?.name || responder.id}] "${response.substring(0, 25)}..." (${RELATIONSHIP_STAGES[pair.relationshipStage].description})`);
    
    io.emit('message', {
      id: `${Date.now()}`,
      accountId: responder.id,
      from: 'me',
      to: partnerJid,
      text: response,
      timestamp: new Date(),
      direction: 'outgoing',
      isAutoResponse: true
    });
    
    // Safe Mode: Random chance to start silent period after activity
    if (shouldStartSilentPeriod(responder)) {
      startSilentPeriod(responder);
    }
    
    // Continue conversation with probability based on relationship stage
    // SAFE MODE: Reduced continuation probability
    let continueProbability = 0.3; // Reduced from 0.5
    switch (pair.relationshipStage) {
      case 'stranger': continueProbability = 0.2; break; // Reduced
      case 'acquaintance': continueProbability = 0.3; break;
      case 'friend': continueProbability = 0.4; break;
      case 'close_friend': continueProbability = 0.5; break;
    }
    
    // Check if conversation should end after this message
    const afterEndCheck = shouldConversationEnd(pair, responder);
    if (afterEndCheck.end) {
      setTimeout(async () => {
        await endConversationNaturally(pair, responder, partner, afterEndCheck.reason || 'Natural decay');
      }, getRandomInt(60000, 180000));
      return;
    }
    
    // SAFE MODE: Use longer response delay (5-60 minutes instead of 2-5 minutes)
    const responseDelay = SAFE_MODE_CONFIG.enabled 
      ? getSafeResponseDelay() 
      : getRandomInt(120000, 300000);
    
    if (Math.random() < continueProbability && pair.messageCount < 15) { // Reduced from 20
      setTimeout(() => {
        if (partner.pool === 'active') {
          simulateChatResponse(partner, responder, response, pair);
        }
      }, responseDelay);
    }
  } catch (error) {
    addLog('error', `Failed to send chat response: ${error}`, responder.id);
  }
}

// ==================== AI RESPONSE ====================

async function generateAIResponse(message: string, personality: Personality | null, conversationContext?: string): Promise<string> {
  let systemPrompt = config.aiSystemPrompt;
  
  if (personality) {
    systemPrompt = `Kamu adalah ${personality.name}, seorang ${personality.occupation} berusia ${personality.age} tahun dari ${personality.location}.

Kepribadianmu: ${personality.traits.join(', ')}.
Hobimu: ${personality.hobbies.join(', ')}.
Gaya menulis: ${personality.writingStyle}.
Gaya respons: ${personality.responseStyle}.

PENTING:
- Balas pesan dengan gaya chat WhatsApp yang natural dan konsisten dengan kepribadianmu
- Jangan pernah mengatakan bahwa kamu adalah AI atau bot
- Gunakan bahasa casual Indonesia dengan gaya khasmu
- Balas singkat (1-2 kalimat) dan natural
- Kadang gunakan emoji yang sesuai dengan kepribadianmu`;
  }
  
  // Add conversation context if available
  if (conversationContext) {
    systemPrompt += `\n\n${conversationContext}`;
  }

  // ========== GROQ AI ==========
  try {
    const groq = getGroqInstance();
    if (groq) {
      const completion = await groq.chat.completions.create({
        model: aiApiSettings.groqModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
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
    console.error('Groq AI failed:', error);
  }

  // ========== FINAL FALLBACK: Random responses ==========
  return getRandomItem(FALLBACK_RESPONSES);
}

// ==================== PERSONALITY GENERATION ====================

async function preGeneratePersonalities(count: number = 10) {
  // Don't generate if already generating or pool is at max
  if (isGeneratingPersonalities || personalityPool.length >= MAX_PERSONALITY_POOL) return;
  
  isGeneratingPersonalities = true;
  
  const personalityPrompt = `Generate ${Math.min(5, count - personalityPool.length)} unique Indonesian personalities for WhatsApp accounts.
Return as JSON array: [{"name":"Nama","age":25,"occupation":"Pekerjaan","location":"Kota","traits":["trait1","trait2"],"writingStyle":"gaya","hobbies":["hobi1","hobi2"],"responseStyle":"gaya respons"}]

Make each personality unique and diverse.`;

  // ========== GROQ AI ==========
  try {
    const groq = getGroqInstance();
    if (groq) {
      const completion = await groq.chat.completions.create({
        model: aiApiSettings.groqModel,
        messages: [
          { role: 'system', content: personalityPrompt },
          { role: 'user', content: 'Generate personalities now. Return ONLY valid JSON array, no other text.' }
        ],
        max_tokens: 1000,
        temperature: 0.8
      });

      const response = completion.choices[0]?.message?.content;
      if (response) {
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const personalities = JSON.parse(jsonMatch[0]);
          // Limit personality pool to prevent memory leak
          const toAdd = personalities.slice(0, MAX_PERSONALITY_POOL - personalityPool.length);

          // Assign chronotype to each personality from Groq (since Groq doesn't generate it)
          const chronotypes: Personality['chronotype'][] = ['early_bird', 'night_owl', 'regular', 'flexible'];
          toAdd.forEach(p => {
            if (!p.chronotype) {
              p.chronotype = chronotypes[Math.floor(Math.random() * chronotypes.length)];
            }
          });

          personalityPool.push(...toAdd);
          console.log(`✅ Generated ${toAdd.length} personalities via Groq. Pool size: ${personalityPool.length}/${MAX_PERSONALITY_POOL}`);
          isGeneratingPersonalities = false;
          return;
        }
      }
    }
  } catch (error) {
    console.error('Groq personality generation failed:', error);
  }
  
  isGeneratingPersonalities = false;
}

// Chronotype configurations - determines active hours based on personality
const CHRONOTYPE_CONFIGS = {
  early_bird: {
    name: 'Early Bird' as const,
    activeHoursStart: 5,   // 5 AM
    activeHoursEnd: 21,    // 9 PM
    peakHours: [7, 8, 9, 12, 13, 17, 18], // Morning & lunch & early evening
    description: 'Aktif pagi, tidur malam'
  },
  night_owl: {
    name: 'Night Owl' as const,
    activeHoursStart: 10,  // 10 AM
    activeHoursEnd: 2,     // 2 AM (next day)
    peakHours: [13, 14, 20, 21, 22, 23, 0, 1], // Afternoon & night
    description: 'Bangun siang, aktif malam'
  },
  regular: {
    name: 'Regular' as const,
    activeHoursStart: 7,   // 7 AM
    activeHoursEnd: 22,    // 10 PM
    peakHours: [8, 9, 12, 13, 18, 19, 20], // Normal work hours
    description: 'Jadwal normal'
  },
  flexible: {
    name: 'Flexible' as const,
    activeHoursStart: 6,   // 6 AM
    activeHoursEnd: 23,    // 11 PM
    peakHours: [9, 10, 14, 15, 19, 20, 21], // Flexible hours
    description: 'Fleksibel, bisa kapan saja'
  }
};

// Check if current hour is within personality's active window
function isInActiveWindow(personality: Personality | null): boolean {
  if (!personality) return true; // Default to active if no personality
  
  const now = new Date();
  const currentHour = now.getHours();
  const { activeHoursStart, activeHoursEnd } = personality;
  
  // Handle overnight schedule (e.g., 22:00 - 02:00)
  if (activeHoursStart > activeHoursEnd) {
    return currentHour >= activeHoursStart || currentHour < activeHoursEnd;
  }
  
  return currentHour >= activeHoursStart && currentHour < activeHoursEnd;
}

// Check if current hour is a peak hour for the personality
function isPeakHour(personality: Personality | null): boolean {
  if (!personality) return false;
  const currentHour = new Date().getHours();
  return personality.peakHours.includes(currentHour);
}

// Get activity intensity multiplier based on personality and time
function getActivityMultiplier(personality: Personality | null): number {
  if (!personality) return 1;
  
  const inWindow = isInActiveWindow(personality);
  const isPeak = isPeakHour(personality);
  
  if (!inWindow) return 0.3; // Reduced activity outside window
  if (isPeak) return 1.5;    // Increased activity during peak
  
  return 1;
}

async function generateUniquePersonality(accountId: string): Promise<Personality | null> {
  if (personalityPool.length > 0) {
    const personality = personalityPool.shift();
    console.log(`Using pooled personality for ${accountId}:`, personality?.name);
    preGeneratePersonalities(10);
    return personality || null;
  }

  const indonesianNames = [
    'Andi', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fitri', 'Gunawan', 'Hani', 'Indra', 'Joko',
    'Kartini', 'Lukman', 'Maya', 'Nadia', 'Oscar', 'Putri', 'Rizki', 'Sari', 'Toni', 'Wati',
    'Yudi', 'Zahra', 'Ahmad', 'Bella', 'Dimas', 'Eva', 'Fajar', 'Gita', 'Hendra', 'Irma'
  ];

  const occupations = [
    'Mahasiswa', 'Karyawan swasta', 'Wiraswasta', 'Guru', 'Dokter', 'Programmer', 
    'Desainer', 'Pengusaha', 'Freelancer', 'Content creator', 'Pekerja seni',
    'Konsultan', 'Pegawai negeri', 'Penjual online', 'Barista', 'Fotografer'
  ];

  const locations = [
    'Jakarta', 'Bandung', 'Surabaya', 'Yogyakarta', 'Semarang', 'Malang', 
    'Bekasi', 'Tangerang', 'Depok', 'Bogor', 'Solo', 'Medan', 'Makassar'
  ];

  const traitsPool = ['ramah', 'humoris', 'penyabar', 'aktif', 'kreatif', 'peduli', 'tekun', 'santai'];
  const hobbiesPool = ['musik', 'film', 'gaming', 'traveling', 'kuliner', 'fotografi', 'olahraga', 'membaca', 'nonton drama', 'jalan-jalan'];
  const writingStyles = [
    'suka pakai emoji di setiap pesan 😊',
    'jarang pakai emoji, lebih ke teks biasa',
    'suka pakai bahasa gaul Jakarta',
    'suka pakai "wkwk" atau "haha"',
    'suka pake singkatan (yg, gpp, bgt)',
    'respon formal dan sopan'
  ];
  const responseStyles = [
    'cepat merespon, langsung ke inti',
    'suka nanya balik sebelum jawab',
    'suka kasih saran atau solusi',
    'respon singkat tapi bermakna',
    'suka cerita panjang lebar',
    'suka pake pertanyaan di akhir kalimat'
  ];

  // Determine chronotype based on occupation
  const occupation = getRandomItem(occupations);
  let chronotype: Personality['chronotype'] = 'regular';
  
  // Some occupations tend to have specific sleep patterns
  if (['Mahasiswa', 'Content creator', 'Freelancer', 'Desainer', 'Programmer'].includes(occupation)) {
    // Higher chance of being night owl
    chronotype = Math.random() > 0.4 ? 'night_owl' : 'flexible';
  } else if (['Guru', 'Pegawai negeri', 'Dokter', 'Barista'].includes(occupation)) {
    // Higher chance of being early bird
    chronotype = Math.random() > 0.4 ? 'early_bird' : 'regular';
  } else {
    // Random distribution
    const types: Personality['chronotype'][] = ['early_bird', 'night_owl', 'regular', 'flexible'];
    chronotype = getRandomItem(types);
  }
  
  const chronotypeConfig = CHRONOTYPE_CONFIGS[chronotype];
  
  // Communication style preferences
  const emojiUsage: Personality['emojiUsage'] = getRandomItem(['heavy', 'moderate', 'minimal']);
  const avgMessageLength: Personality['avgMessageLength'] = getRandomItem(['short', 'medium', 'long']);
  
  // Response time based on chronotype and personality
  let avgResponseTime = getRandomInt(2, 30); // 2-30 minutes base
  if (chronotype === 'flexible') avgResponseTime = getRandomInt(1, 15); // Faster
  if (avgMessageLength === 'long') avgResponseTime += 5; // Takes longer to write

  const randomTraits = Array.from({ length: 3 }, () => getRandomItem(traitsPool));
  const randomHobbies = Array.from({ length: 3 }, () => getRandomItem(hobbiesPool));
  
  const personality: Personality = {
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

// ==================== SESSION MANAGEMENT ====================

// Clear session data using rimraf for reliable deletion on Docker volumes
async function clearSessionData(accountId: string): Promise<{ success: boolean; error?: string }> {
  const sessionPath = join(SESSIONS_DIR, accountId);
  
  console.log('[CLEAR SESSION] Attempting to clear session for:', accountId);
  console.log('[CLEAR SESSION] Session path:', sessionPath);
  
  try {
    // Check if session directory exists
    try {
      await access(sessionPath);
      console.log('[CLEAR SESSION] Session directory exists');
    } catch {
      console.log('[CLEAR SESSION] Session directory does not exist, nothing to clear');
      return { success: true };
    }
    
    // Use rimraf for reliable deletion (works better on Docker volumes than fs.rmSync)
    console.log('[CLEAR SESSION] Deleting session directory with rimraf...');
    await rimraf(sessionPath, { 
      maxRetries: 5, 
      retryDelay: 100,
      glob: false 
    });
    
    // Verify deletion
    try {
      await access(sessionPath);
      console.log('[CLEAR SESSION] ⚠️ Session directory still exists after deletion!');
      return { success: false, error: 'Session directory still exists after deletion' };
    } catch {
      console.log('[CLEAR SESSION] ✅ Session directory successfully deleted');
      return { success: true };
    }
  } catch (error: any) {
    console.error('[CLEAR SESSION] ❌ Error clearing session:', error);
    return { success: false, error: error?.message || 'Unknown error' };
  }
}

function getRandomDelay(): number {
  const baseMin = config.warmerDelayMin;
  const baseMax = config.warmerDelayMax;
  
  let multiplier = 1;
  switch (config.warmingIntensity) {
    case 'low': multiplier = 1.5; break;
    case 'high': multiplier = 0.5; break;
  }
  
  return Math.floor(Math.random() * ((baseMax - baseMin) * multiplier) + baseMin * multiplier);
}

function getTypingDelay(messageLength: number): number {
  const baseDelay = Math.min(messageLength / 40 * 1000, 5000);
  const randomFactor = 0.5 + Math.random();
  return Math.floor(baseDelay * randomFactor + 1000);
}

function calculateHealthScore(stats: WarmingStats): number {
  let score = 100;
  
  if (stats.lastActivity) {
    const hoursSinceActivity = (Date.now() - stats.lastActivity.getTime()) / (1000 * 60 * 60);
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

function startAutoPresenceUpdates(account: Account) {
  if (!config.autoPresenceUpdate) return;
  
  const interval = setInterval(async () => {
    if (account.status !== 'online' || !account.socket) return;
    
    try {
      const presences: WAPresence[] = ['available', 'unavailable', 'composing'];
      const randomPresence = getRandomItem(presences);
      
      await account.socket.sendPresenceUpdate(randomPresence);
      
      if (randomPresence === 'composing') {
        await delay(3000 + Math.random() * 5000);
        await account.socket.sendPresenceUpdate('available');
      }
      
      account.warmingStats.lastActivity = new Date();
    } catch (error) {}
  }, config.presenceUpdateInterval * 60 * 1000 + Math.random() * 60000);
  
  if (!warmingIntervals.has(account.id)) {
    warmingIntervals.set(account.id, []);
  }
  warmingIntervals.get(account.id)!.push(interval);
}

async function startSession(accountId: string, usePairingCode: boolean = false, phoneNumber?: string, forceNew: boolean = false) {
  console.log('==========================================');
  console.log('[START SESSION] Called with:', { accountId, usePairingCode, phoneNumber, forceNew });
  console.log('[START SESSION] Current accounts:', Array.from(accounts.keys()));
  console.log('==========================================');
  
  try {
    // ========== RACE CONDITION GUARD ==========
    // Prevent multiple startSession calls for the same account
    const existingAccountForGuard = accounts.get(accountId);
    if (existingAccountForGuard?.status === 'connecting') {
      console.log('[START SESSION] ⚠️ Account already connecting, skipping duplicate call');
      addLog('warning', `⚠️ Session already connecting for ${accountId}, skipping duplicate`, accountId);
      return;
    }

    // ========== CLOSE OLD SOCKET IF EXISTS ==========
    if (existingAccountForGuard?.socket) {
      console.log('[START SESSION] Closing old socket for:', accountId);
      try {
        existingAccountForGuard.socket.end?.();
      } catch (e) {
        console.log('[START SESSION] Error closing old socket:', e);
      }
    }

    // ========== FORCE NEW: CLEAR OLD SESSION DATA ==========
    if (forceNew) {
      console.log('[START SESSION] forceNew=true, clearing old session data...');
      addLog('info', `🔄 Force new session - clearing old data for ${accountId}`, accountId);
      
      const clearResult = await clearSessionData(accountId);
      if (!clearResult.success) {
        console.log('[START SESSION] ⚠️ Failed to clear session:', clearResult.error);
        addLog('warning', `⚠️ Session clear warning: ${clearResult.error}`, accountId);
      } else {
        console.log('[START SESSION] ✅ Session data cleared successfully');
        addLog('info', `✅ Old session data cleared for ${accountId}`, accountId);
      }
    }
    
    // ========== CHECK IF ACCOUNT IS BANNED ==========
    // Check banned list first to prevent any further attempts
    if (BURNABLE_CONFIG.bannedAccounts.has(accountId)) {
      addLog('error', `🚫 BLOCKED: Account ${accountId} is in banned list. Not starting session.`, accountId);
      return;
    }

    // ========== CHECK EXISTING ACCOUNT FOR RECONNECT ==========
    const existingAccount = accounts.get(accountId);
    const isReconnect = existingAccount !== undefined;

    // ========== CHECK FOR EXISTING PERSONALITY (prevent regeneration) ==========
    const existingPersonality = personalityRegistry.get(accountId);

    // ========== CHECK IF ACCOUNT EVER CONNECTED SUCCESSFULLY ==========
    const hasEverConnected = everConnected.get(accountId) || false;

    // Reconnect counter to prevent infinite loop
    // Only count reconnects for accounts that HAVE connected before
    if (!reconnectAttempts.has(accountId)) {
      reconnectAttempts.set(accountId, 0);
    }
    const currentAttempts = reconnectAttempts.get(accountId) || 0;

    // Only enforce max reconnect for accounts that were previously connected
    // New accounts trying to scan QR/pairing can retry more times
    if (hasEverConnected && currentAttempts >= MAX_RECONNECT_ATTEMPTS) {
      addLog('error', `Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Account may be banned.`, accountId);
      await handleBannedAccount(accountId, 'Max reconnect attempts reached');
      return;
    }

    if (isReconnect && hasEverConnected) {
      reconnectAttempts.set(accountId, currentAttempts + 1);
      addLog('info', `Reconnecting session for account ${accountId} (attempt ${currentAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`, accountId);
    } else if (existingPersonality) {
      addLog('info', `Starting session for account ${accountId} (reusing existing personality: ${existingPersonality.name})`, accountId);
    } else {
      addLog('info', `Starting new session for account ${accountId}`, accountId);
    }

    const sessionDir = join(SESSIONS_DIR, accountId);
    await mkdir(sessionDir, { recursive: true });
    console.log('[START SESSION] Session directory created:', sessionDir);

    console.log('[START SESSION] Loading auth state...');
    let { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    console.log('[START SESSION] Auth state loaded:');
    console.log('[START SESSION] - hasCreds:', !!state.creds);
    console.log('[START SESSION] - creds.me exists:', !!state.creds?.me);
    console.log('[START SESSION] - creds.me.id:', state.creds?.me?.id || 'N/A');
    console.log('[START SESSION] - creds.me.name:', state.creds?.me?.name || 'N/A');
    console.log('[START SESSION] - This account will:', state.creds?.me ? 'TRY LOGIN (no QR)' : 'REGISTER (expect QR)');

    // ========== AUTO-DETECT AND CLEAR INCOMPLETE SESSIONS ==========
    // If creds exists but creds.me doesn't exist, it's an incomplete session
    // (QR was generated but never scanned). This causes Baileys to not emit QR again!
    // We MUST clear this and start fresh.
    if (state.creds && !state.creds.me && !forceNew) {
      console.log('[START SESSION] ⚠️ INCOMPLETE SESSION DETECTED! creds exists but no me identity.');
      console.log('[START SESSION] This happens when QR was generated but never scanned.');
      console.log('[START SESSION] Auto-clearing incomplete session to force fresh QR generation...');
      addLog('warning', `⚠️ Incomplete session detected for ${accountId}, auto-clearing to generate fresh QR`, accountId);

      // Clear the incomplete session
      const clearResult = await clearSessionData(accountId);
      if (clearResult.success) {
        console.log('[START SESSION] ✅ Incomplete session cleared, recreating fresh session...');
        // Re-create session directory and reload auth state
        await mkdir(sessionDir, { recursive: true });
        const freshAuth = await useMultiFileAuthState(sessionDir);
        state = freshAuth.state;
        saveCreds = freshAuth.saveCreds;
        console.log('[START SESSION] ✅ Fresh auth state loaded');
        console.log('[START SESSION] - hasCreds:', !!state.creds);
        console.log('[START SESSION] - creds.me exists:', !!state.creds?.me);
      } else {
        console.log('[START SESSION] ⚠️ Failed to clear incomplete session:', clearResult.error);
        addLog('warning', `⚠️ Failed to clear incomplete session: ${clearResult.error}`, accountId);
      }
    }

    console.log('[START SESSION] Fetching Baileys version...');
    const { version } = await fetchLatestBaileysVersion();
    console.log('[START SESSION] Baileys version:', version);

    console.log('[START SESSION] Creating WhatsApp socket...');
    
    // ========== TEST NETWORK CONNECTIVITY ==========
    // Test if Railway can reach WhatsApp servers
    console.log('[NETWORK] Testing connectivity to WhatsApp servers...');
    try {
      const dns = await import('dns').then(m => m.promises);
      const addresses = await dns.resolve4('web.whatsapp.com').catch(() => []);
      console.log('[NETWORK] DNS resolution for web.whatsapp.com:', addresses.length > 0 ? addresses : 'FAILED');
    } catch (e) {
      console.log('[NETWORK] DNS test error:', e);
    }
    
    // Test HTTPS connection to WhatsApp
    try {
      const https = await import('https');
      const testHttps = () => new Promise((resolve, reject) => {
        const req = https.request('https://web.whatsapp.com', { method: 'HEAD', timeout: 10000 }, (res) => {
          console.log('[NETWORK] HTTPS test to web.whatsapp.com: Status', res.statusCode);
          resolve(res.statusCode);
        });
        req.on('error', (e) => {
          console.log('[NETWORK] HTTPS test FAILED:', e.message);
          reject(e);
        });
        req.on('timeout', () => {
          console.log('[NETWORK] HTTPS test TIMEOUT');
          req.destroy();
          reject(new Error('Timeout'));
        });
        req.end();
      });
      await testHttps().catch(() => {});
    } catch (e) {
      console.log('[NETWORK] HTTPS test error:', e);
    }
    
    const socket = makeWASocket({
      version,
      logger,
      auth: state,
      browser: Browsers.macOS('Chrome'), // Use macOS Chrome - more stable compatibility
      syncFullHistory: false,
      getMessage: async () => undefined,
      shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidGroup(jid),
      generateHighQualityLinkPreview: false,
      patchMessageBeforeSending: (message) => {
        const requiresPatch = !!(message.buttonsMessage || message.listMessage || message.templateMessage);
        if (requiresPatch) {
          message = JSON.parse(JSON.stringify(message));
          message.viewOnceMessage = { message: {} as any };
        }
        return message;
      }
    });

    console.log('[SOCKET] makeWASocket created for:', accountId);
    console.log('[SOCKET] Socket has ev?', !!socket.ev);
    console.log('[SOCKET] Socket has ws?', !!socket.ws);
    console.log('[SOCKET] Socket user?', socket.user);

    // ========== CRITICAL: REGISTER EVENT HANDLERS IMMEDIATELY ==========
    // Baileys starts emitting events IMMEDIATELY after socket creation.
    // We MUST register handlers BEFORE any async operations (like personality generation)
    // otherwise we MISS the QR code and other critical events!
    
    // Create a pending account placeholder that will be updated later
    const pendingAccount: Account = {
      id: accountId,
      status: 'connecting',
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
      pool: 'offline',
      poolSince: new Date(),
      chatHistory: [],
      isInActiveWindow: true,
      silentPeriod: { isActive: false },
      sessionActivity: { messagesInSession: 0 }
    };
    
    // Add to accounts map IMMEDIATELY so event handlers can find it
    accounts.set(accountId, pendingAccount);
    console.log('[ACCOUNT] ✅ Added pending account to map immediately:', accountId);
    
    // Register connection.update handler IMMEDIATELY (before any await!)
    console.log('[SOCKET] 🚀 Registering connection.update handler IMMEDIATELY for:', accountId);
    
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;
      
      console.log('==========================================');
      console.log('[CONNECTION UPDATE] ✅ EVENT RECEIVED!', { 
        accountId, 
        connection, 
        hasQr: !!qr,
        qrPreview: qr ? qr.substring(0, 50) + '...' : null,
        isNewLogin
      });
      console.log('==========================================');

      // Get the account (should exist since we added it immediately)
      const account = accounts.get(accountId);
      if (!account) {
        console.error('[CONNECTION UPDATE] ❌ Account not found in map!', accountId);
        return;
      }

      // ========== HANDLE SUCCESSFUL CONNECTION ==========
      if (connection === 'open') {
        reconnectAttempts.set(accountId, 0);
        everConnected.set(accountId, true);
        account.status = 'online';
        account.pool = 'active';
        console.log('[CONNECTION] ✅ Successfully connected:', accountId);
        
        // Log if this was a new login (after QR scan/pairing)
        if (isNewLogin) {
          console.log('[CONNECTION] 🎉 NEW LOGIN - QR scan/pairing was successful!');
          addLog('info', `🎉 WhatsApp connected - NEW LOGIN successful!`, accountId);
        } else {
          addLog('info', `✅ WhatsApp connected successfully`, accountId);
        }
        
        io.emit('account-status', { accountId, status: 'online', isNewLogin });
        
        // Clear pairing success tracking since connection is now stable
        recentPairingSuccess.delete(accountId);
        
        // Clear connection timeout
        const t = connectionTimeouts.get(accountId);
        if (t) {
          clearTimeout(t);
          connectionTimeouts.delete(accountId);
        }
      }

      // ========== HANDLE QR CODE ==========
      if (qr) {
        console.log('[QR] 🎯 QR code received for:', accountId);
        console.log('[QR] QR length:', qr.length);
        
        if (usePairingCode && phoneNumber) {
          try {
            const code = await socket.requestPairingCode(phoneNumber);
            account.pairingCode = code;
            io.emit('pairing-code', { accountId, code });
            addLog('info', `📱 Pairing code generated: ${code}`, accountId);
            console.log('[PAIRING] Code generated:', code);
          } catch (error: any) {
            addLog('error', `❌ Failed to generate pairing code: ${error?.message || error}`, accountId);
            console.error('[PAIRING ERROR]', error);
          }
        } else {
          console.log('[QR] Converting QR to data URL...');
          try {
            const qrDataUrl = await QRCode.toDataURL(qr);
            account.qrCode = qrDataUrl;
            console.log('[QR] ✅ QR converted, length:', qrDataUrl.length);
            io.emit('qr-code', { accountId, qr: qrDataUrl });
            addLog('info', '📱 QR code generated - scan with WhatsApp', accountId);
          } catch (qrError: any) {
            console.error('[QR] ❌ Failed to convert QR:', qrError);
            addLog('error', `❌ QR conversion failed: ${qrError?.message}`, accountId);
          }
        }
      }

      // ========== HANDLE DISCONNECT ==========
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const errorMessage = (lastDisconnect?.error as any)?.message || '';
        
        // ========================================
        // STREAM ERROR DETECTION (Railway Issue)
        // ========================================
        // Stream Errored is a common issue on Railway/cloud deployments
        // It happens when WebSocket connection is interrupted during QR auth
        const isStreamError = errorMessage.includes('Stream Errored') || 
                              errorMessage.includes('restart required') ||
                              statusCode === 515 ||
                              statusCode === DisconnectReason.restartRequired;
        
        console.log('[CONNECTION] ❌ Disconnected:', accountId, {
          code: statusCode,
          error: errorMessage,
          isStreamError
        });

        // Check if account is being deleted
        if (pendingDeletion.has(accountId)) {
          addLog('info', `🚮 Account deletion in progress, skipping reconnect`, accountId);
          pendingDeletion.delete(accountId);
          return;
        }

        const hasConnected = everConnected.get(accountId) || false;
        const currentAttemptCount = reconnectAttempts.get(accountId) || 0;

        // Ban detection logic
        const DEFINITE_BAN_CODE = 403;
        const TEMPORARY_CODES = [
          DisconnectReason.restartRequired,
          401, 408, 409, 429, 500, 502, 503, 504, 515,
          DisconnectReason.badSession,
        ];

        const isTemporaryCode = TEMPORARY_CODES.includes(statusCode);
        const isDefiniteBan = statusCode === DEFINITE_BAN_CODE;

        let isBanned = false;
        let banReason = '';

        if (isDefiniteBan) {
          isBanned = true;
          banReason = `Account banned (code: ${statusCode})`;
        } else if (statusCode === 401 && hasConnected) {
          if (currentAttemptCount >= MAX_RECONNECT_ATTEMPTS) {
            isBanned = true;
            banReason = `Session lost after multiple attempts (code: ${statusCode})`;
          }
        }

        account.status = 'offline';
        account.pool = 'offline';
        io.emit('account-status', { accountId, status: 'offline' });

        // Special handling for Stream Errored
        let statusDesc = isBanned ? '🚫 BAN DETECTED' : (isTemporaryCode ? '⏳ Temporary error' : '🔌 Disconnected');
        if (isStreamError) {
          statusDesc = '⚠️ Stream Errored (auto-reconnect)';
        }
        addLog('connection', `${statusDesc} (code: ${statusCode})${errorMessage ? ` - ${errorMessage}` : ''}`, accountId);

        stopWarmingTimers(accountId);
        clearChatPartner(accountId);

        if (isBanned) {
          await handleBannedAccount(accountId, banReason);
          return;
        }

        // ========================================
        // AUTO-RECONNECT FOR STREAM ERROR
        // ========================================
        // CRITICAL FIX: After successful QR scan/pairing, credentials are saved.
        // Stream Error 515 happens right after pairing. We MUST NOT clear session!
        // Check if this is right after pairing success.
        const pairingInfo = recentPairingSuccess.get(accountId);
        const timeSincePairing = pairingInfo ? Date.now() - pairingInfo.timestamp.getTime() : Infinity;
        const isAfterPairingSuccess = timeSincePairing < PAIRING_SUCCESS_TTL_MS;
        
        console.log('[STREAM ERROR] Pairing info:', {
          hasPairingInfo: !!pairingInfo,
          timeSincePairing: timeSincePairing / 1000 + 's',
          isAfterPairingSuccess,
          isNewLogin
        });
        
        if (isStreamError) {
          const delay = Math.min(3000 * (currentAttemptCount + 1), 30000);
          
          // CRITICAL: Don't clear session if pairing just succeeded!
          // The credentials ARE saved, we just need to reconnect.
          const shouldForceNew = !isAfterPairingSuccess && !isNewLogin;
          
          addLog('info', `🔄 Stream Error - Reconnecting in ${delay/1000}s... (forceNew: ${shouldForceNew}, afterPairing: ${isAfterPairingSuccess})`, accountId);
          
          // Emit reconnecting event for client
          io.emit('reconnecting', { accountId, attempt: currentAttemptCount + 1, afterPairing: isAfterPairingSuccess });
          
          // ========================================
          // CRITICAL FIX: Delete from memory to allow API to accept reconnect
          // ========================================
          // The API rejects if account already exists in memory.
          // We need to delete from memory BUT keep:
          // - Session files (credentials) on disk
          // - Personality registry in memory
          // - Database records
          console.log('[STREAM ERROR] Deleting account from memory to allow reconnect:', accountId);
          accounts.delete(accountId);
          console.log('[STREAM ERROR] Account deleted from memory. Session files and personality preserved.');
          
          setTimeout(async () => {
            const currentAttempt = reconnectAttempts.get(accountId) || 0;
            if (currentAttempt < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttempts.set(accountId, currentAttempt + 1);
              try {
                // Use /session/start endpoint which allows forceNew control
                // CRITICAL FIX: Use correct URL with accountId in path
                // forceNew: false means we keep session files and use saved credentials
                await fetch(`http://localhost:3030/session/start`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ accountId, forceNew: shouldForceNew })
                });
              } catch (e) {
                console.error('[RECONNECT] Failed to trigger reconnect:', e);
              }
            }
          }, delay);
          return;
        }

        // Auto-reconnect for temporary errors
        if (isTemporaryCode || statusCode === 401) {
          const delay = Math.min(5000 * (currentAttemptCount + 1), 60000);
          addLog('info', `🔄 Reconnecting in ${delay/1000}s...`, accountId);
          
          // Delete from memory to allow API to accept reconnect
          console.log('[TEMP ERROR] Deleting account from memory to allow reconnect:', accountId);
          accounts.delete(accountId);
          
          setTimeout(async () => {
            const currentAttempt = reconnectAttempts.get(accountId) || 0;
            if (currentAttempt < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttempts.set(accountId, currentAttempt + 1);
              // Trigger reconnect via API
              // CRITICAL FIX: Use correct endpoint /session/start with accountId in body
              try {
                await fetch(`http://localhost:3030/session/start`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ accountId, forceNew: statusCode === 401 })
                });
              } catch (e) {
                console.error('[RECONNECT] Failed to trigger reconnect:', e);
              }
            }
          }, delay);
        }
      }
    });

    // Register creds.update handler immediately
    // CRITICAL: Also track when pairing succeeds for Stream Error handling
    socket.ev.on('creds.update', async (update) => {
      await saveCreds(update);
      
      // Track when new credentials are saved (indicating successful pairing)
      // This is crucial for Stream Error 515 handling - we must not clear session
      // if pairing just succeeded!
      if (update.me && update.me.id) {
        console.log('[CREDS] ✅ Credentials saved with user ID:', update.me.id);
        recentPairingSuccess.set(accountId, {
          timestamp: new Date(),
          phoneNumber: update.me.id.split('@')[0]
        });
        addLog('info', `🔐 Credentials saved - pairing successful for ${accountId}`, accountId);
      }
    });
    console.log('[SOCKET] ✅ Event handlers registered IMMEDIATELY');

    // ========== WEBSOCKET STATE DEBUGGING ==========
    // Monitor WebSocket connection state to diagnose Railway connection issues
    // NOTE: socket.ws is a WebSocketClient wrapper, socket.ws.socket is the native WebSocket
    const getWsStateName = (state: number | undefined): string => {
      if (state === undefined) return 'UNDEFINED';
      if (state === 0) return 'CONNECTING';
      if (state === 1) return 'OPEN';
      if (state === 2) return 'CLOSING';
      if (state === 3) return 'CLOSED';
      return `UNKNOWN(${state})`;
    };

    // Access native WebSocket from Baileys WebSocketClient wrapper
    const nativeWs = (socket.ws as any)?.socket;
    const wsState = nativeWs?.readyState;
    
    console.log('[WS] Native WebSocket exists:', !!nativeWs);
    console.log('[WS] Native WebSocket state:', wsState, '=', getWsStateName(wsState));
    console.log('[WS] WebSocketClient isConnecting:', (socket.ws as any)?.isConnecting);
    console.log('[WS] WebSocketClient isOpen:', (socket.ws as any)?.isOpen);
    console.log('[WS] WebSocketClient isClosed:', (socket.ws as any)?.isClosed);
    console.log('[WS] WebSocket URL:', (socket.ws as any)?.url || 'N/A');

    // Monitor WebSocket state changes every 2 seconds
    const wsMonitorInterval = setInterval(() => {
      const currentNativeWs = (socket.ws as any)?.socket;
      const currentState = currentNativeWs?.readyState;
      const stateName = getWsStateName(currentState);
      const isConnecting = (socket.ws as any)?.isConnecting;
      const isOpen = (socket.ws as any)?.isOpen;
      console.log('[WS MONITOR] Native state:', currentState, '=', stateName, '| isConnecting:', isConnecting, '| isOpen:', isOpen, 'for account:', accountId);
      
      // Stop monitoring if socket is open or closed
      if (currentState === 1 || currentState === 3) {
        clearInterval(wsMonitorInterval);
        console.log('[WS MONITOR] Stopped monitoring. Final state:', stateName);
      }
    }, 2000);

    // Add WebSocket event listeners for debugging
    // Listen on both wrapper and native socket
    if (socket.ws) {
      // Listen on wrapper
      (socket.ws as any).on('error', (err: Error) => {
        console.error('[WS ERROR] WebSocketClient error for', accountId, ':', err.message);
        console.error('[WS ERROR] Full error:', err);
        addLog('error', `🔴 WebSocket error: ${err.message}`, accountId);
      });

      (socket.ws as any).on('close', (code: number, reason: Buffer) => {
        console.log('[WS CLOSE] WebSocketClient closed for', accountId, 'code:', code, 'reason:', reason.toString());
        clearInterval(wsMonitorInterval);
      });

      (socket.ws as any).on('unexpected-response', (req: any, res: any) => {
        console.error('[WS UNEXPECTED] Unexpected response for', accountId);
        console.error('[WS UNEXPECTED] Status:', res?.statusCode);
        console.error('[WS UNEXPECTED] Headers:', res?.headers);
        addLog('error', `🔴 WebSocket unexpected response: ${res?.statusCode}`, accountId);
      });
      
      // Also listen on native socket if available
      if (nativeWs) {
        nativeWs.on('error', (err: Error) => {
          console.error('[WS NATIVE ERROR] Native WebSocket error for', accountId, ':', err.message);
        });
        
        nativeWs.on('open', () => {
          console.log('[WS NATIVE OPEN] Native WebSocket opened for', accountId);
        });
        
        nativeWs.on('close', (code: number, reason: Buffer) => {
          console.log('[WS NATIVE CLOSE] Native WebSocket closed for', accountId, 'code:', code, 'reason:', reason.toString());
        });
        
        // Log all incoming messages to debug data flow
        nativeWs.on('message', (data: Buffer, isBinary: boolean) => {
          const preview = data.length > 50 ? data.slice(0, 50).toString('base64') + '...' : data.toString('base64');
          console.log('[WS NATIVE MESSAGE] Received for', accountId, 'binary:', isBinary, 'len:', data.length, 'preview:', preview);
        });
        
        // Log when a message is sent
        const originalSend = nativeWs.send.bind(nativeWs);
        nativeWs.send = (data: any, ...args: any[]) => {
          const preview = typeof data === 'string' ? data.slice(0, 50) : (Buffer.isBuffer(data) ? data.slice(0, 50).toString('base64') : 'unknown');
          console.log('[WS NATIVE SEND] Sending for', accountId, 'type:', typeof data, 'preview:', preview);
          return originalSend(data, ...args);
        };
      }
    }

    // ========== GET ACCOUNT (already created in immediate registration) ==========
    // The account was already added to the map immediately after socket creation
    // to ensure event handlers can find it
    const account = accounts.get(accountId);
    if (!account) {
      console.error('[SESSION] ❌ Account not found in map after immediate registration!');
      return;
    }
    console.log('[SESSION] ✅ Retrieved account from map:', accountId);

    // ========== UPDATE PERSONALITY ASYNC ==========
    // Personality generation is async and doesn't block QR handling
    if (!account.personality && !existingPersonality) {
      addLog('info', `🎭 Generating personality for ${accountId}...`, accountId);
      generateUniquePersonality(accountId).then(personality => {
        if (personality) {
          account.personality = personality;
          personalityRegistry.set(accountId, personality);
          account.isInActiveWindow = isInActiveWindow(personality);
          const chronotypeDesc = CHRONOTYPE_CONFIGS[personality.chronotype].description;
          addLog('info', `✨ Personality: ${personality.name}, ${personality.age}yo ${personality.occupation} (${chronotypeDesc})`, accountId);
        }
      }).catch(err => console.error('[PERSONALITY] Generation failed:', err));
    } else if (existingPersonality) {
      account.personality = existingPersonality;
      account.isInActiveWindow = isInActiveWindow(existingPersonality);
    }

    // ========== EMIT STATUS & SET TIMEOUT ==========
    io.emit('account-status', { accountId, status: 'connecting' });
    
    const existingTimeout = connectionTimeouts.get(accountId);
    if (existingTimeout) clearTimeout(existingTimeout);
    
    const timeoutId = setTimeout(() => {
      const acc = accounts.get(accountId);
      if (acc && acc.status === 'connecting') {
        addLog('warning', `⏰ QR/Pairing timeout - still connecting after 2 minutes.`, accountId);
      }
    }, CONNECTING_TIMEOUT_MS);
    connectionTimeouts.set(accountId, timeoutId);

    // Clear WebSocket monitor when connection update is received
    socket.ev.on('connection.update', () => {
      clearInterval(wsMonitorInterval);
    });

    // Handle incoming messages
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (isJidGroup(msg.key.remoteJid!) || isJidBroadcast(msg.key.remoteJid!)) continue;
        if (msg.key.fromMe) continue;

        const messageText = msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption || '';

        if (!messageText) continue;

        const from = msg.key.remoteJid!;
        
        account.warmingStats.messagesReceived++;
        account.warmingStats.lastActivity = new Date();
        account.warmingStats.healthScore = calculateHealthScore(account.warmingStats);
        
        addLog('message', `📥 Message: "${messageText.substring(0, 30)}..."`, accountId);
        
        io.emit('message', {
          id: msg.key.id,
          accountId,
          from,
          to: 'me',
          text: messageText,
          timestamp: new Date(),
          direction: 'incoming'
        });
        
        io.emit('warming-stats', { accountId, stats: account.warmingStats });

        // Auto-reply only for active pool accounts
        if (account.warmingEnabled && config.warmerEnabled && account.pool === 'active') {
          // Check rate limit
          const rateCheck = checkRateLimit(account);
          if (!rateCheck.allowed) {
            addLog('ratelimit', `⏸️ Auto-reply skipped: ${rateCheck.reason}`, accountId);
            continue;
          }
          
          const responseDelay = getRandomDelay();
          const delayMinutes = Math.round(responseDelay / 60000);
          
          addLog('warming', `⏳ Auto-reply scheduled in ${delayMinutes} min`, accountId);

          const timeout = setTimeout(async () => {
            try {
              if (account.status !== 'online' || account.pool !== 'active') return;
              
              // Double check rate limit
              const rateCheckInner = checkRateLimit(account);
              if (!rateCheckInner.allowed) {
                addLog('ratelimit', `⏸️ Auto-reply cancelled: ${rateCheckInner.reason}`, accountId);
                return;
              }
              
              const response = await generateAIResponse(messageText, account.personality);

              if (config.typingSimulationEnabled) {
                await socket.sendPresenceUpdate('composing', from);
                await delay(getTypingDelay(response.length));
                await socket.sendPresenceUpdate('paused', from);
              }

              await socket.sendMessage(from, { text: response });

              incrementRateLimit(account);
              account.warmingStats.messagesSent++;
              account.warmingStats.autoResponsesSent++;
              account.warmingStats.lastActivity = new Date();
              account.warmingStats.healthScore = calculateHealthScore(account.warmingStats);

              addLog('warming', `📤 Auto-reply: "${response.substring(0, 30)}..."`, accountId);
              
              io.emit('message', {
                id: `${Date.now()}`,
                accountId,
                from: 'me',
                to: from,
                text: response,
                timestamp: new Date(),
                direction: 'outgoing',
                isAutoResponse: true
              });
              
              io.emit('warming-stats', { accountId, stats: account.warmingStats });
            } catch (error) {
              addLog('error', `Failed to send auto-reply: ${error}`, accountId);
            }
          }, responseDelay);

          if (!messageQueue.has(accountId)) {
            messageQueue.set(accountId, []);
          }
          messageQueue.get(accountId)!.push(timeout);
        }
      }
    });

  } catch (error) {
    addLog('error', `Failed to start session: ${error}`, accountId);
    io.emit('account-status', { accountId, status: 'offline' });
  }
}

function stopWarmingTimers(accountId: string) {
  const intervals = warmingIntervals.get(accountId);
  if (intervals) {
    intervals.forEach(i => clearInterval(i));
    warmingIntervals.delete(accountId);
  }
  
  const timeouts = messageQueue.get(accountId);
  if (timeouts) {
    timeouts.forEach(t => clearTimeout(t));
    messageQueue.delete(accountId);
  }
}

async function stopSession(accountId: string) {
  // Mark as pending deletion to prevent auto-reconnect
  pendingDeletion.add(accountId);

  const account = accounts.get(accountId);
  if (account?.socket) {
    try {
      await account.socket.logout();
      account.status = 'offline';
      account.pool = 'offline';
      io.emit('account-status', { accountId, status: 'offline' });
      addLog('info', 'Session stopped', accountId);
    } catch (error) {
      addLog('error', 'Error stopping session', accountId);
    }
  }

  // Clear all timers and queues
  stopWarmingTimers(accountId);
  clearChatPartner(accountId);
  
  // Clear connection timeout if exists
  const connTimeout = connectionTimeouts.get(accountId);
  if (connTimeout) {
    clearTimeout(connTimeout);
    connectionTimeouts.delete(accountId);
  }
  
  // Clear pairing success tracking
  recentPairingSuccess.delete(accountId);
}

function toggleWarming(accountId: string, enabled: boolean) {
  const account = accounts.get(accountId);
  if (account) {
    account.warmingEnabled = enabled;
    io.emit('warming-toggle', { accountId, enabled });
    addLog('warming', `${enabled ? '✅' : '⏸️'} Warmer ${enabled ? 'enabled' : 'disabled'}`, accountId);
  }
}

// ==================== EXPRESS ROUTES ====================

app.use(express.json());

// Multer configuration for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Bulk queue for sequential account creation
interface BulkQueueItem {
  accountId: string;
  usePairingCode: boolean;
  phoneNumber?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

let bulkQueue: BulkQueueItem[] = [];
let isProcessingBulkQueue = false;

// Process bulk queue one by one
async function processBulkQueue() {
  if (isProcessingBulkQueue) return;
  isProcessingBulkQueue = true;
  
  while (bulkQueue.some(item => item.status === 'pending')) {
    const item = bulkQueue.find(i => i.status === 'pending');
    if (!item) break;
    
    item.status = 'processing';
    io.emit('bulk-queue-update', { item, queue: bulkQueue });
    
    try {
      if (accounts.size >= MAX_ACCOUNTS) {
        throw new Error(`Maximum ${MAX_ACCOUNTS} accounts reached`);
      }
      
      await startSession(item.accountId, item.usePairingCode, item.phoneNumber);
      item.status = 'completed';
    } catch (error: any) {
      item.status = 'failed';
      item.error = error.message;
    }
    
    io.emit('bulk-queue-update', { item, queue: bulkQueue });
    
    // Wait for the account to connect before processing next
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  isProcessingBulkQueue = false;
  io.emit('bulk-queue-complete', { queue: bulkQueue });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', accounts: accounts.size });
});

// ==================== SAFE MODE ENDPOINTS ====================

app.get('/safe-mode', (req, res) => {
  res.json({
    enabled: SAFE_MODE_CONFIG.enabled,
    config: SAFE_MODE_CONFIG,
    currentOnline: getOnlineAccountCount(),
    maxAllowed: SAFE_MODE_CONFIG.maxConcurrentOnline,
    canBringOnline: canBringOnline()
  });
});

app.post('/safe-mode/toggle', async (req, res) => {
  const { enabled } = req.body;
  
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }
  
  SAFE_MODE_CONFIG.enabled = enabled;
  
  addLog('info', `🛡️ Safe Mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
  
  if (enabled) {
    // Enforce limits when enabling
    await enforceMaxOnlineLimit();
  }
  
  res.json({
    success: true,
    enabled: SAFE_MODE_CONFIG.enabled,
    message: `Safe Mode ${enabled ? 'enabled' : 'disabled'}`
  });
});

app.post('/safe-mode/config', (req, res) => {
  const updates = req.body;
  
  const allowedFields = [
    'maxConcurrentOnline', 'silentPeriodEnabled', 'silentPeriodMinMinutes',
    'silentPeriodMaxMinutes', 'ignoreMessageChance', 'responseDelayMinMinutes',
    'responseDelayMaxMinutes', 'maxActivityMinutesPerSession', 'minRestMinutesBetweenSessions'
  ];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      (SAFE_MODE_CONFIG as any)[key] = value;
    }
  }
  
  addLog('info', `🛡️ Safe Mode config updated`);
  res.json({ success: true, config: SAFE_MODE_CONFIG });
});

// ==================== BURNABLE ACCOUNT ENDPOINTS ====================

app.get('/burnable/stats', (req, res) => {
  res.json(getBurnableStats());
});

app.get('/burnable/banned', (req, res) => {
  const bannedList = Array.from(BURNABLE_CONFIG.bannedAccounts.values());
  res.json({
    total: bannedList.length,
    accounts: bannedList.map(b => ({
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

app.post('/burnable/reserve/add', (req, res) => {
  const { accountId } = req.body;
  
  if (!accountId) {
    return res.status(400).json({ error: 'accountId is required' });
  }
  
  BURNABLE_CONFIG.reserveAccounts.push(accountId);
  addLog('info', `📦 Reserve account added: ${accountId}`);
  
  res.json({ 
    success: true, 
    reserveCount: BURNABLE_CONFIG.reserveAccounts.length 
  });
});

app.post('/burnable/replacement/queue', (req, res) => {
  const { accountId } = req.body;
  
  if (!accountId) {
    return res.status(400).json({ error: 'accountId is required' });
  }
  
  BURNABLE_CONFIG.replacementQueue.push(accountId);
  addLog('info', `🔄 Replacement account queued: ${accountId}`);
  
  res.json({ 
    success: true, 
    queueLength: BURNABLE_CONFIG.replacementQueue.length 
  });
});

app.get('/burnable/health/:accountId', (req, res) => {
  const { accountId } = req.params;
  const account = accounts.get(accountId);

  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
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

// ==================== PERSONALITY REGISTRY ENDPOINTS ====================

// View personality registry
app.get('/personality-registry', (req, res) => {
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

// Clear banned status for an account (for false positives)
app.post('/banned/clear/:accountId', (req, res) => {
  const { accountId } = req.params;

  if (!BURNABLE_CONFIG.bannedAccounts.has(accountId)) {
    return res.status(404).json({ error: 'Account not in banned list' });
  }

  BURNABLE_CONFIG.bannedAccounts.delete(accountId);
  reconnectAttempts.delete(accountId);
  everConnected.delete(accountId); // Reset connection tracking

  addLog('info', `🔓 Banned status cleared for ${accountId}`);

  res.json({
    success: true,
    message: `Account ${accountId} removed from banned list. You can try to reconnect.`
  });
});

// Reset personality for an account (generate new one on next session start)
app.post('/personality/reset/:accountId', (req, res) => {
  const { accountId } = req.params;

  const hadPersonality = personalityRegistry.has(accountId);
  personalityRegistry.delete(accountId);

  // Also clear from banned list if present
  if (BURNABLE_CONFIG.bannedAccounts.has(accountId)) {
    BURNABLE_CONFIG.bannedAccounts.delete(accountId);
  }

  reconnectAttempts.delete(accountId);
  everConnected.delete(accountId); // Reset connection tracking

  addLog('info', `🔄 Personality reset for ${accountId}`);

  res.json({
    success: true,
    hadPersonality,
    message: `Personality reset for ${accountId}. A new personality will be generated on next session start.`
  });
});

// ==================== AI API SETTINGS ENDPOINTS ====================

// Get current AI API settings (mask sensitive data)
app.get('/ai-settings', (req, res) => {
  res.json({
    provider: aiApiSettings.provider,
    groqApiKey: aiApiSettings.groqApiKey ? `${aiApiSettings.groqApiKey.substring(0, 8)}...${aiApiSettings.groqApiKey.substring(aiApiSettings.groqApiKey.length - 4)}` : '',
    groqModel: aiApiSettings.groqModel,
    hasGroqKey: !!aiApiSettings.groqApiKey,
    lastUpdated: aiApiSettings.lastUpdated,
    availableModels: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Recommended)', description: 'Best quality, slower' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', description: 'Fast, good quality' },
      { id: 'llama-3.2-3b-preview', name: 'Llama 3.2 3B', description: 'Fastest, basic quality' },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', description: 'Good for longer responses' }
    ]
  });
});

// Update AI API settings
app.post('/ai-settings', (req, res) => {
  const { provider, groqApiKey, groqModel } = req.body;
  
  // Update provider if provided
  if (provider && ['groq', 'fallback'].includes(provider)) {
    aiApiSettings.provider = provider;
  }
  
  // Update Groq API key if provided
  if (groqApiKey !== undefined) {
    if (groqApiKey && groqApiKey.trim()) {
      aiApiSettings.groqApiKey = groqApiKey.trim();
      // Reset Groq instance to use new key
      resetGroqInstance();
      addLog('info', '🔑 Groq API key updated');
    } else if (groqApiKey === '') {
      // Clear API key
      aiApiSettings.groqApiKey = '';
      resetGroqInstance();
      addLog('info', '🔑 Groq API key cleared');
    }
  }
  
  // Update model if provided
  if (groqModel) {
    aiApiSettings.groqModel = groqModel;
  }
  
  aiApiSettings.lastUpdated = new Date();
  
  res.json({
    success: true,
    message: 'AI settings updated',
    settings: {
      provider: aiApiSettings.provider,
      hasGroqKey: !!aiApiSettings.groqApiKey,
      groqModel: aiApiSettings.groqModel,
      lastUpdated: aiApiSettings.lastUpdated
    }
  });
});

// Test AI connection
app.post('/ai-settings/test', async (req, res) => {
  const testMessage = 'Halo, ini test pesan. Balas dengan singkat dalam bahasa Indonesia.';
  
  try {
    // Test with Groq
    const groq = getGroqInstance();
    if (!groq) {
      return res.json({
        success: false,
        provider: 'groq',
        error: 'Groq API key not set. Get free API key at https://console.groq.com/keys'
      });
    }
    
    const completion = await groq.chat.completions.create({
      model: aiApiSettings.groqModel,
      messages: [
        { role: 'system', content: 'Kamu adalah orang Indonesia yang ramah. Balas singkat.' },
        { role: 'user', content: testMessage }
      ],
      max_tokens: 50
    });
    
    const response = completion.choices[0]?.message?.content;
    
    return res.json({
      success: true,
      provider: 'groq',
      model: aiApiSettings.groqModel,
      response: response,
      message: 'Groq AI connection successful!'
    });
    
  } catch (error: any) {
    res.json({
      success: false,
      provider: 'groq',
      error: error.message || 'Failed to connect to Groq AI'
    });
  }
});

// ==================== ACCOUNT ROUTES ====================

app.get('/accounts', (req, res) => {
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

app.get('/accounts/light', (req, res) => {
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

app.get('/stats', (req, res) => {
  const accountList = Array.from(accounts.values());
  const stats = {
    total: accountList.length,
    online: accountList.filter(a => a.status === 'online').length,
    connecting: accountList.filter(a => a.status === 'connecting').length,
    offline: accountList.filter(a => a.status === 'offline').length,
    warming: accountList.filter(a => a.warmingEnabled && a.status === 'online').length,
    totalMessagesReceived: accountList.reduce((sum, a) => sum + (a.warmingStats?.messagesReceived || 0), 0),
    totalMessagesSent: accountList.reduce((sum, a) => sum + (a.warmingStats?.messagesSent || 0), 0),
    totalAutoResponses: accountList.reduce((sum, a) => sum + (a.warmingStats?.autoResponsesSent || 0), 0),
    avgHealthScore: accountList.length > 0 
      ? Math.round(accountList.reduce((sum, a) => sum + (a.warmingStats?.healthScore || 0), 0) / accountList.length)
      : 0,
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

app.get('/warming-phases', (req, res) => {
  res.json(WARMING_PHASES);
});

app.get('/pools', (req, res) => {
  res.json({
    active: getActiveAccounts().map(a => ({ id: a.id, name: a.personality?.name || a.name, partner: a.currentChatPartner })),
    idle: getIdleAccounts().map(a => ({ id: a.id, name: a.personality?.name || a.name })),
    offline: getOfflinePoolAccounts().map(a => ({ id: a.id, name: a.personality?.name || a.name }))
  });
});

app.get('/chat-pairs', (req, res) => {
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

app.get('/logs', (req, res) => {
  res.json(eventLogs.slice(0, 100));
});

// ==================== DEBUG ENDPOINTS ====================
// These help diagnose Railway issues

// Read log file from disk
app.get('/logs/file', async (req, res) => {
  try {
    const logPath = '/app/data/whatsapp-service.log';
    const logContent = await readFile(logPath, 'utf-8');
    const lines = logContent.split('\n').slice(-200); // Last 200 lines
    res.json({
      path: logPath,
      lines: lines.length,
      content: lines
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to read log file', message: error.message });
  }
});

// Get connection states for all accounts
app.get('/debug/connections', (req, res) => {
  const connectionStates: any[] = [];

  accounts.forEach((account, id) => {
    const socket = account.socket;
    const ws = (socket as any)?.ws;
    const nativeWs = ws?.socket;

    connectionStates.push({
      accountId: id,
      status: account.status,
      pool: account.pool,
      hasSocket: !!socket,
      socketUser: socket?.user?.id || null,
      // Baileys WebSocket state
      wsExists: !!ws,
      wsUrl: ws?.url || null,
      wsIsConnecting: ws?.isConnecting || false,
      wsIsOpen: ws?.isOpen || false,
      wsIsClosed: ws?.isClosed || false,
      // Native WebSocket state
      nativeWsExists: !!nativeWs,
      nativeWsState: nativeWs?.readyState,
      nativeWsStateName: nativeWs?.readyState === 0 ? 'CONNECTING' :
                         nativeWs?.readyState === 1 ? 'OPEN' :
                         nativeWs?.readyState === 2 ? 'CLOSING' :
                         nativeWs?.readyState === 3 ? 'CLOSED' : 'UNKNOWN',
      // Reconnect tracking
      reconnectAttempts: reconnectAttempts.get(id) || 0,
      everConnected: everConnected.get(id) || false,
      isBanned: BURNABLE_CONFIG.bannedAccounts.has(id),
      // Timing
      lastActivity: account.warmingStats?.lastActivity || null
    });
  });

  res.json({
    timestamp: new Date().toISOString(),
    totalAccounts: accounts.size,
    onlineCount: Array.from(accounts.values()).filter(a => a.status === 'online').length,
    connectingCount: Array.from(accounts.values()).filter(a => a.status === 'connecting').length,
    connections: connectionStates
  });
});

// Get detailed debug info for one account
app.get('/debug/account/:id', (req, res) => {
  const account = accounts.get(req.params.id);
  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  const socket = account.socket;
  const ws = (socket as any)?.ws;
  const nativeWs = ws?.socket;

  res.json({
    account: {
      id: account.id,
      status: account.status,
      pool: account.pool,
      phoneNumber: account.phoneNumber,
      name: account.name,
      qrCode: account.qrCode ? account.qrCode.substring(0, 50) + '...' : null,
      pairingCode: account.pairingCode,
      warmingEnabled: account.warmingEnabled,
      personality: account.personality,
      warmingStats: account.warmingStats,
      silentPeriod: account.silentPeriod,
      sessionActivity: account.sessionActivity
    },
    socket: {
      exists: !!socket,
      userId: socket?.user?.id || null,
      userName: socket?.user?.name || null,
      hasEv: !!socket?.ev
    },
    ws: {
      exists: !!ws,
      url: ws?.url || null,
      isConnecting: ws?.isConnecting || false,
      isOpen: ws?.isOpen || false,
      isClosed: ws?.isClosed || false
    },
    nativeWs: {
      exists: !!nativeWs,
      readyState: nativeWs?.readyState,
      readyStateName: nativeWs?.readyState === 0 ? 'CONNECTING' :
                      nativeWs?.readyState === 1 ? 'OPEN' :
                      nativeWs?.readyState === 2 ? 'CLOSING' :
                      nativeWs?.readyState === 3 ? 'CLOSED' : 'UNKNOWN',
      url: nativeWs?.url || null
    },
    tracking: {
      reconnectAttempts: reconnectAttempts.get(req.params.id) || 0,
      everConnected: everConnected.get(req.params.id) || false,
      isBanned: BURNABLE_CONFIG.bannedAccounts.has(req.params.id),
      isPendingDeletion: pendingDeletion.has(req.params.id)
    }
  });
});

// Force reconnect an account (for testing)
app.post('/debug/force-reconnect/:id', async (req, res) => {
  const accountId = req.params.id;
  const account = accounts.get(accountId);

  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  console.log(`[DEBUG] Force reconnect requested for ${accountId}`);

  // Close existing socket
  if (account.socket) {
    try {
      account.socket.end?.();
    } catch (e) {
      console.log('[DEBUG] Error closing socket:', e);
    }
  }

  // Remove from accounts map
  accounts.delete(accountId);

  // Reset tracking
  reconnectAttempts.set(accountId, 0);

  // Start fresh session
  setTimeout(async () => {
    await startSession(accountId, false, undefined, true);
  }, 1000);

  res.json({ success: true, message: `Force reconnect initiated for ${accountId}` });
});

// Get system info
app.get('/debug/system', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      GROQ_API_KEY_SET: !!process.env.GROQ_API_KEY,
      BAILEYS_LOG_LEVEL: process.env.BAILEYS_LOG_LEVEL || 'debug'
    },
    counts: {
      accounts: accounts.size,
      chatPairs: chatPairs.size,
      eventLogs: eventLogs.length,
      personalityPool: personalityPool.length,
      reconnectAttempts: reconnectAttempts.size,
      everConnected: everConnected.size,
      bannedAccounts: BURNABLE_CONFIG.bannedAccounts.size
    }
  });
});

app.get('/config', (req, res) => {
  res.json(config);
});

// Allowed config fields for update
const ALLOWED_CONFIG_FIELDS = [
  'warmerEnabled', 'warmerDelayMin', 'warmerDelayMax', 'autoPresenceUpdate',
  'presenceUpdateInterval', 'typingSimulationEnabled', 'readReceiptsEnabled',
  'aiSystemPrompt', 'warmingIntensity', 'activePoolSize', 'idlePoolSize',
  'rotationIntervalMin', 'rotationIntervalMax', 'chatSimulationEnabled',
  'maxSilenceCount', 'conversationDecayEnabled', 'readReceiptRandomEnabled',
  'readReceiptInstantChance', 'readReceiptDelayChance', 'readReceiptIgnoreChance',
  'randomOfflineEnabled', 'minOnlineHours', 'maxOnlineHours',
  'minOfflineMinutes', 'maxOfflineMinutes', 'burstPreventionEnabled',
  'minDelayBetweenMessages', 'maxMessagesPerBurst', 'rateLimitEnabled',
  'maxMessagesPerHour', 'maxMessagesPerDay', 'warmingScheduleEnabled',
  'autoBackupEnabled', 'backupIntervalHours'
];

app.post('/config', async (req, res) => {
  // Security: Only allow specific config fields
  const updates: Partial<Config> = {};
  for (const key of ALLOWED_CONFIG_FIELDS) {
    if (req.body[key] !== undefined) {
      // Type validation for numbers
      if (typeof config[key as keyof Config] === 'number') {
        const val = Number(req.body[key]);
        if (!isNaN(val) && val >= 0) {
          updates[key as keyof Config] = val;
        }
      } else if (typeof config[key as keyof Config] === 'boolean') {
        updates[key as keyof Config] = Boolean(req.body[key]);
      } else if (typeof config[key as keyof Config] === 'string') {
        // Security: Limit string length
        const val = String(req.body[key]).slice(0, 5000);
        updates[key as keyof Config] = val;
      }
    }
  }
  
  config = { ...config, ...updates };
  const configPath = join(__dirname, 'config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2));
  
  // Reschedule backup if settings changed
  if (updates.autoBackupEnabled !== undefined || updates.backupIntervalHours !== undefined) {
    scheduleAutoBackup();
  }
  
  res.json(config);
});

app.post('/session/start', async (req, res) => {
  const { accountId, usePairingCode, phoneNumber, forceNew } = req.body;
  
  console.log('==========================================');
  console.log('[SESSION/START] Request received:', { accountId, usePairingCode, phoneNumber, forceNew });
  console.log('==========================================');
  
  // Security: Validate accountId
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    console.log('[SESSION/START] Validation failed:', validation.error);
    return res.status(400).json({ error: validation.error });
  }
  
  // Check if account already exists (unless forceNew is true)
  if (!forceNew && accounts.has(accountId)) {
    console.log('[SESSION/START] Account already exists:', accountId);
    return res.status(400).json({ error: 'Account already exists' });
  }
  
  // If forceNew, delete existing account first
  if (forceNew && accounts.has(accountId)) {
    const existingAccount = accounts.get(accountId);
    if (existingAccount?.socket) {
      try {
        existingAccount.socket.end?.();
      } catch (e) {}
    }
    accounts.delete(accountId);
    console.log('[SESSION/START] forceNew: Removed existing account from memory');
  }
  
  // Validate phone number if using pairing code
  if (usePairingCode && phoneNumber) {
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.valid) {
      console.log('[SESSION/START] Phone validation failed:', phoneValidation.error);
      return res.status(400).json({ error: phoneValidation.error });
    }
  }
  
  if (usePairingCode && !phoneNumber) {
    console.log('[SESSION/START] Missing phone number for pairing code');
    return res.status(400).json({ error: 'phoneNumber is required for pairing code' });
  }
  
  if (accounts.size >= MAX_ACCOUNTS) {
    console.log('[SESSION/START] Max accounts reached:', MAX_ACCOUNTS);
    return res.status(400).json({ error: `Maximum ${MAX_ACCOUNTS} accounts reached` });
  }
  
  console.log('[SESSION/START] Starting session for:', accountId, 'forceNew:', !!forceNew);
  await startSession(accountId, usePairingCode || false, phoneNumber, !!forceNew);
  console.log('[SESSION/START] Session started successfully for:', accountId);
  res.json({ success: true, accountId });
});

// Retry QR/Pairing - reset tracking and try again (always forceNew=true to clear old session)
app.post('/session/retry/:accountId', async (req, res) => {
  const { accountId } = req.params;
  const { usePairingCode, phoneNumber } = req.body;

  // Security: Validate accountId
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Check if account is in banned list
  if (BURNABLE_CONFIG.bannedAccounts.has(accountId)) {
    return res.status(400).json({ error: 'Account is in banned list. Use /banned/clear first.' });
  }

  // Reset all tracking for this account
  reconnectAttempts.delete(accountId);
  everConnected.delete(accountId);

  // Delete existing account if present
  const existingAccount = accounts.get(accountId);
  if (existingAccount) {
    if (existingAccount.socket) {
      try {
        existingAccount.socket.end?.();
      } catch (e) {}
    }
    accounts.delete(accountId);
  }

  addLog('info', `🔄 Retrying connection for ${accountId} (forceNew=true)`, accountId);

  // Validate phone number if using pairing code
  if (usePairingCode && phoneNumber) {
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.valid) {
      return res.status(400).json({ error: phoneValidation.error });
    }
  }

  if (usePairingCode && !phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber is required for pairing code' });
  }

  // Always use forceNew=true for retry to clear old session data
  await startSession(accountId, usePairingCode || false, phoneNumber, true);
  res.json({ success: true, accountId, message: 'Connection retry initiated with fresh session' });
});

// Get connection tracking info
app.get('/connection/status/:accountId', (req, res) => {
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

app.post('/session/batch-start', async (req, res) => {
  const { accountIds, usePairingCodes, phoneNumbers } = req.body;
  
  if (!accountIds || !Array.isArray(accountIds)) {
    return res.status(400).json({ error: 'accountIds array is required' });
  }
  
  if (accountIds.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 accounts per batch' });
  }
  
  if (accounts.size + accountIds.length > MAX_ACCOUNTS) {
    return res.status(400).json({ error: `Cannot create ${accountIds.length} accounts. Maximum ${MAX_ACCOUNTS} total accounts.` });
  }
  
  // Security: Validate all account IDs first
  for (const accountId of accountIds) {
    const validation = validateAccountId(accountId);
    if (!validation.valid) {
      return res.status(400).json({ error: `Invalid accountId "${accountId}": ${validation.error}` });
    }
    if (accounts.has(accountId)) {
      return res.status(400).json({ error: `Account "${accountId}" already exists` });
    }
  }
  
  const results: Array<{ accountId: string; success: boolean; error?: string }> = [];
  
  for (let i = 0; i < accountIds.length; i++) {
    const accountId = accountIds[i];
    const usePairingCode = usePairingCodes?.[i] || false;
    const phoneNumber = phoneNumbers?.[i];
    
    try {
      await startSession(accountId, usePairingCode, phoneNumber);
      results.push({ accountId, success: true });
    } catch (error: any) {
      results.push({ accountId, success: false, error: error.message });
    }
    
    if (i < accountIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  addLog('info', `📦 Batch created ${results.filter(r => r.success).length}/${accountIds.length} accounts`);
  res.json({ success: true, results });
});

// Excel upload for bulk account creation
app.post('/bulk/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Security: Check file size (already limited by multer, but double check)
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large. Maximum 10MB' });
    }
    
    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);
    
    if (data.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }
    
    // Security: Limit number of rows
    if (data.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 accounts per Excel file' });
    }
    
    // Validate and extract account data
    const accountsData: Array<{ accountId: string; phoneNumber?: string; usePairingCode: boolean }> = [];
    const errors: string[] = [];
    
    for (let i = 0; i < data.length; i++) {
      const rowData = data[i] as Record<string, any>;
      // Support various column names
      const accountId = rowData['account_id'] || rowData['accountId'] || rowData['id'] || rowData['Account ID'] || rowData['ID'];
      const phoneNumber = rowData['phone'] || rowData['phoneNumber'] || rowData['phone_number'] || rowData['Phone'] || rowData['Phone Number'] || rowData['nomor'];
      const method = rowData['method'] || rowData['auth_method'] || rowData['Auth Method'] || 'qr';
      
      if (!accountId) {
        continue; // Skip rows without account ID
      }
      
      const accountIdStr = String(accountId).trim();
      
      // Security: Validate account ID
      const validation = validateAccountId(accountIdStr);
      if (!validation.valid) {
        errors.push(`Row ${i + 1}: ${validation.error}`);
        continue;
      }
      
      // Check for duplicates in the same file
      if (accountsData.some(a => a.accountId === accountIdStr)) {
        errors.push(`Row ${i + 1}: Duplicate accountId "${accountIdStr}"`);
        continue;
      }
      
      accountsData.push({
        accountId: accountIdStr,
        phoneNumber: phoneNumber ? String(phoneNumber).trim() : undefined,
        usePairingCode: method.toLowerCase().includes('pair') || !!phoneNumber
      });
    }
    
    if (accountsData.length === 0) {
      return res.status(400).json({ 
        error: 'No valid account data found in Excel', 
        details: errors.length > 0 ? errors.slice(0, 5) : undefined
      });
    }
    
    // Clear previous queue and add new items
    bulkQueue = accountsData.map(item => ({
      ...item,
      status: 'pending' as const
    }));
    
    addLog('info', `📊 Excel uploaded: ${accountsData.length} accounts parsed`);
    
    res.json({ 
      success: true, 
      total: accountsData.length,
      accounts: accountsData.slice(0, 10), // Preview first 10
      warnings: errors.length > 0 ? errors.slice(0, 5) : undefined,
      message: `${accountsData.length} accounts ready for bulk creation`
    });
    
  } catch (error: any) {
    console.error('Excel upload error:', error);
    res.status(500).json({ error: `Failed to parse Excel: ${error.message}` });
  }
});

// Get bulk queue status
app.get('/bulk/queue', (req, res) => {
  const summary = {
    total: bulkQueue.length,
    pending: bulkQueue.filter(i => i.status === 'pending').length,
    processing: bulkQueue.filter(i => i.status === 'processing').length,
    completed: bulkQueue.filter(i => i.status === 'completed').length,
    failed: bulkQueue.filter(i => i.status === 'failed').length,
    isProcessing: isProcessingBulkQueue
  };
  
  res.json({ queue: bulkQueue, summary });
});

// Start bulk queue processing
app.post('/bulk/start', async (req, res) => {
  if (bulkQueue.length === 0) {
    return res.status(400).json({ error: 'No accounts in queue. Upload Excel first.' });
  }
  
  if (isProcessingBulkQueue) {
    return res.status(400).json({ error: 'Bulk processing already in progress' });
  }
  
  // Reset failed items to pending
  bulkQueue.forEach(item => {
    if (item.status === 'failed') {
      item.status = 'pending';
    }
  });
  
  addLog('info', `🚀 Starting bulk account creation: ${bulkQueue.filter(i => i.status === 'pending').length} accounts`);
  
  // Start processing in background
  processBulkQueue();
  
  res.json({ 
    success: true, 
    message: 'Bulk creation started',
    total: bulkQueue.length
  });
});

// Stop bulk queue processing
app.post('/bulk/stop', (req, res) => {
  isProcessingBulkQueue = false;
  addLog('info', '⏹️ Bulk creation stopped');
  res.json({ success: true, message: 'Bulk creation stopped' });
});

// Clear bulk queue
app.post('/bulk/clear', (req, res) => {
  bulkQueue = [];
  isProcessingBulkQueue = false;
  addLog('info', '🗑️ Bulk queue cleared');
  res.json({ success: true, message: 'Queue cleared' });
});

// Download Excel template
app.get('/bulk/template', (req, res) => {
  const template = [
    { account_id: 'account_1', phone: '6281234567890', method: 'pairing' },
    { account_id: 'account_2', phone: '', method: 'qr' },
    { account_id: 'account_3', phone: '6281234567891', method: 'pairing' }
  ];
  
  const ws = XLSX.utils.json_to_sheet(template);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Accounts');
  
  // Set column widths
  ws['!cols'] = [
    { wch: 20 }, // account_id
    { wch: 20 }, // phone
    { wch: 15 }  // method
  ];
  
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=bulk_accounts_template.xlsx');
  res.send(buffer);
});

app.post('/session/stop', async (req, res) => {
  const { accountId } = req.body;
  
  // Security: Validate accountId
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  
  await stopSession(accountId);
  res.json({ success: true });
});

app.post('/session/restart', async (req, res) => {
  const { accountId } = req.body;
  
  // Security: Validate accountId
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  
  await stopSession(accountId);
  await new Promise(resolve => setTimeout(resolve, 2000));
  await startSession(accountId);
  res.json({ success: true });
});

app.post('/session/toggle-warming', (req, res) => {
  const { accountId, enabled } = req.body;
  
  // Security: Validate accountId
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  
  toggleWarming(accountId, enabled);
  res.json({ success: true });
});

app.post('/pool/rotate', async (req, res) => {
  await rotatePools();
  res.json({ success: true });
});

app.post('/backup/all', async (req, res) => {
  await backupAllSessions();
  res.json({ success: true });
});

app.post('/backup/:accountId', async (req, res) => {
  const { accountId } = req.params;
  
  // Security: Validate accountId
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  
  await backupSession(accountId);
  res.json({ success: true });
});

app.get('/account/:id', (req, res) => {
  const accountId = req.params.id;
  
  // Security: Validate accountId
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  
  const account = accounts.get(accountId);
  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
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

// Delete account and its session
app.delete('/account/:id', async (req, res) => {
  const accountId = req.params.id;

  // Security: Validate accountId
  const validation = validateAccountId(accountId);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const account = accounts.get(accountId);

  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  try {
    // ========== MARK AS PENDING DELETION ==========
    // This prevents auto-reconnect when socket closes
    pendingDeletion.add(accountId);
    addLog('info', `🗑️ Marking account for deletion...`, accountId);

    // Stop the session first
    await stopSession(accountId);

    // Clear any chat partners
    clearChatPartner(accountId);

    // Clear all tracking
    reconnectAttempts.delete(accountId);
    everConnected.delete(accountId);

    // Remove from accounts map
    accounts.delete(accountId);

    // Delete session files
    const sessionDir = join(SESSIONS_DIR, accountId);
    try {
      await rm(sessionDir, { recursive: true, force: true });
    } catch (e) {
      // Session dir might not exist
    }

    // Delete backup files
    const backupDir = join(BACKUP_DIR, accountId);
    try {
      await rm(backupDir, { recursive: true, force: true });
    } catch (e) {
      // Backup dir might not exist
    }

    addLog('info', `🗑️ Account deleted: ${accountId}`);
    io.emit('account-deleted', { accountId });

    res.json({ success: true, accountId });
  } catch (error: any) {
    addLog('error', `Failed to delete account: ${error.message}`, accountId);
    // Clean up deletion flag on error
    pendingDeletion.delete(accountId);
    res.status(500).json({ error: error.message });
  }
});

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id, 'Transport:', socket.conn?.transport?.name || 'unknown');

  // Log transport upgrades
  socket.conn?.on('upgrade', (transport) => {
    console.log('[SOCKET] Transport upgraded to:', transport.name, 'for socket:', socket.id);
  });

  // Log transport upgrade errors
  socket.conn?.on('upgradeError', (err) => {
    console.error('[SOCKET] Transport upgrade error:', err.message, 'for socket:', socket.id);
  });

  socket.emit('init', {
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
      relationshipStage: pair.relationshipStage,
    }))
  });

  socket.on('start-session', async (data: { accountId: string; usePairingCode: boolean; phoneNumber?: string }) => {
    await startSession(data.accountId, data.usePairingCode, data.phoneNumber);
  });

  socket.on('stop-session', async (accountId: string) => {
    await stopSession(accountId);
  });

  socket.on('stop-all', async () => {
    for (const [accountId] of accounts) {
      await stopSession(accountId);
    }
    addLog('info', '🛑 All sessions stopped');
  });

  socket.on('toggle-warming', (data: { accountId: string; enabled: boolean }) => {
    toggleWarming(data.accountId, data.enabled);
  });

  socket.on('toggle-warming-all', (enabled: boolean) => {
    for (const [accountId] of accounts) {
      toggleWarming(accountId, enabled);
    }
    addLog('warming', `${enabled ? '✅' : '⏸️'} Warmer ${enabled ? 'enabled' : 'disabled'} for all accounts`);
  });

  socket.on('rotate-pools', async () => {
    await rotatePools();
  });

  socket.on('backup-all', async () => {
    await backupAllSessions();
  });

  socket.on('send-message', async (data: { accountId: string; to: string; message: string }) => {
    const account = accounts.get(data.accountId);
    if (account?.socket && account.status === 'online') {
      // Check rate limit
      const rateCheck = checkRateLimit(account);
      if (!rateCheck.allowed) {
        addLog('ratelimit', `Message blocked: ${rateCheck.reason}`, data.accountId);
        return;
      }
      
      try {
        if (config.typingSimulationEnabled) {
          await account.socket.sendPresenceUpdate('composing', data.to);
          await delay(getTypingDelay(data.message.length));
          await account.socket.sendPresenceUpdate('paused', data.to);
        }
        
        await account.socket.sendMessage(data.to, { text: data.message });
        
        incrementRateLimit(account);
        account.warmingStats.messagesSent++;
        account.warmingStats.lastActivity = new Date();
        account.warmingStats.healthScore = calculateHealthScore(account.warmingStats);
        
        addLog('message', `📤 Manual message sent to ${data.to}`, data.accountId);
        io.emit('message', {
          id: `${Date.now()}`,
          accountId: data.accountId,
          from: 'me',
          to: data.to,
          text: data.message,
          timestamp: new Date(),
          direction: 'outgoing',
          isAutoResponse: false
        });
        io.emit('warming-stats', { accountId: data.accountId, stats: account.warmingStats });
      } catch (error) {
        addLog('error', `Failed to send message: ${error}`, data.accountId);
      }
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('Client disconnected:', socket.id, 'Reason:', reason, 'Transport was:', socket.conn?.transport?.name || 'unknown');
  });

  // Log connection errors
  socket.on('error', (err) => {
    console.error('[SOCKET] Connection error for socket:', socket.id, 'Error:', err.message || err);
  });
});

// ==================== STARTUP ====================

async function ensureSessionsDir() {
  try {
    await access(SESSIONS_DIR);
  } catch {
    await mkdir(SESSIONS_DIR, { recursive: true });
  }
}

// ==================== DATABASE SYNC ====================

// Periodically sync accounts to database (every 30 seconds)
let dbSyncTimer: NodeJS.Timeout | null = null;

async function syncAccountsToDatabase() {
  try {
    for (const [id, account] of accounts.entries()) {
      // Upsert account
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
          isInActiveWindow: account.isInActiveWindow,
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
          isInActiveWindow: account.isInActiveWindow,
        }
      });
      
      // Upsert personality if exists
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
            avgMessageLength: account.personality.avgMessageLength,
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
            avgMessageLength: account.personality.avgMessageLength,
          }
        });
      }
    }
    console.log(`[DB] Synced ${accounts.size} accounts to database`);
  } catch (error) {
    console.error('[DB] Failed to sync accounts:', error);
  }
}

function scheduleDbSync() {
  if (dbSyncTimer) {
    clearInterval(dbSyncTimer);
  }
  
  // Sync every 30 seconds
  dbSyncTimer = setInterval(syncAccountsToDatabase, 30000);
}

// Load config from database
async function loadConfig() {
  try {
    const configEntries = await db.warmingConfig.findMany();
    if (configEntries.length > 0) {
      for (const entry of configEntries) {
        if (entry.key in config) {
          const key = entry.key as keyof Config;
          if (typeof config[key] === 'number') {
            (config as any)[key] = Number(entry.value);
          } else if (typeof config[key] === 'boolean') {
            (config as any)[key] = entry.value === 'true';
          } else {
            (config as any)[key] = entry.value;
          }
        }
      }
      console.log('[DB] Loaded config from database');
    }
  } catch (error) {
    console.error('[DB] Failed to load config:', error);
  }
}

async function start() {
  try {
    await ensureSessionsDir();
    await ensureBackupDir();
    await loadConfig();

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        accounts: accounts.size,
        onlineAccounts: Array.from(accounts.values()).filter(a => a.status === 'online').length
      });
    });

    httpServer.listen(PORT, () => {
      console.log(`==========================================`);
      console.log(`🔥 WhatsApp Warmer Service running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🔑 Groq API: ${aiApiSettings.groqApiKey ? 'Configured' : 'NOT SET - Set GROQ_API_KEY'}`);
      console.log(`==========================================`);
      addLog('info', '🚀 WhatsApp Warmer Service started');
      
      preGeneratePersonalities(10);
      
      scheduleNextRotation();
      scheduleAutoBackup();
      scheduleDbSync(); // Start periodic database sync
    });
  } catch (error) {
    console.error('Failed to start WhatsApp service:', error);
    process.exit(1);
  }
}

start();

// ==================== CRITICAL ERROR HANDLERS ====================
// These are ESSENTIAL for debugging Railway issues
// Without these, errors cause silent crashes with no logs

process.on('uncaughtException', (error: Error) => {
  console.error('==========================================');
  console.error('🚨 UNCAUGHT EXCEPTION - CRITICAL ERROR');
  console.error('==========================================');
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  console.error('Time:', new Date().toISOString());
  console.error('==========================================');
  
  // Log to event system
  addLog('error', `🚨 UNCAUGHT EXCEPTION: ${error.message}`);
  
  // Don't exit immediately - let logs flush
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('==========================================');
  console.error('🚨 UNHANDLED PROMISE REJECTION');
  console.error('==========================================');
  console.error('Reason:', reason);
  console.error('Time:', new Date().toISOString());
  console.error('==========================================');
  
  // Log to event system
  const reasonStr = reason instanceof Error ? reason.message : String(reason);
  addLog('error', `🚨 UNHANDLED REJECTION: ${reasonStr}`);
});

// Log when process is about to exit
process.on('beforeExit', (code) => {
  console.log('[PROCESS] About to exit with code:', code);
});

process.on('exit', (code) => {
  console.log('[PROCESS] Exiting with code:', code);
});

// Handle termination signals gracefully
process.on('SIGTERM', () => {
  console.log('[PROCESS] SIGTERM received, shutting down gracefully...');
  addLog('info', '🛑 SIGTERM received, shutting down');
  httpServer.close(() => {
    console.log('[PROCESS] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[PROCESS] SIGINT received, shutting down gracefully...');
  addLog('info', '🛑 SIGINT received, shutting down');
  httpServer.close(() => {
    console.log('[PROCESS] Server closed');
    process.exit(0);
  });
});

console.log('✅ Error handlers installed');
