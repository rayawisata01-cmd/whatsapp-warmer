/**
 * ============================================================================
 * WHATSAPP WARMER - WARMING ENGINE
 * ============================================================================
 * 
 * Features:
 * - Chat Pairing Logic - Match accounts for warming pool
 * - Natural Timing - Chat based on chronotype
 * - AI Auto-Response based on personality
 * - Conversation Context Management
 * - Milestone Tracking
 * 
 * ============================================================================
 */

import { db } from './src/lib/db';
import { rateLimiter, antiBanSystem, updateHealthScore, getSafetyStatus } from './src/lib/health-safety';

// ==================== TYPES ====================

export interface WarmingAccount {
  id: string;
  phoneNumber?: string;
  name?: string;
  status: 'online' | 'offline' | 'connecting';
  personality?: Personality | null;
  socket?: any; // Baileys socket
  warmingEnabled: boolean;
  currentChatPartnerId?: string;
  messagesSent: number;
  messagesReceived: number;
  lastActivity?: Date;
}

export interface Personality {
  name: string;
  age: number;
  occupation: string;
  location: string;
  traits: string[];
  writingStyle: string;
  hobbies: string[];
  responseStyle: string;
  chronotype: 'early_bird' | 'night_owl' | 'regular' | 'flexible';
  activeHoursStart: number;
  activeHoursEnd: number;
  peakHours: number[];
  avgResponseTime: number;
  emojiUsage: 'heavy' | 'moderate' | 'minimal';
  avgMessageLength: 'short' | 'medium' | 'long';
}

export interface ChatPair {
  id: string;
  account1Id: string;
  account2Id: string;
  initiatorId: string;  // Who starts the conversation
  currentTopic: string;
  topicCategory: string;
  messageCount: number;
  relationshipStage: 'stranger' | 'acquaintance' | 'friend' | 'close_friend';
  sharedInterests: string[];
  topicsDiscussed: string[];
  conversationContext: ConversationMessage[];
  startedAt: Date;
  lastMessageAt?: Date;
  silenceCount: number;
  isActive: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface WarmingConfig {
  minDelayBetweenMessages: number; // ms
  maxDelayBetweenMessages: number; // ms
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
  conversationMinMessages: number;
  conversationMaxMessages: number;
  silenceThreshold: number; // max silence before new topic
}

// ==================== CONFIGURATION ====================

const DEFAULT_CONFIG: WarmingConfig = {
  minDelayBetweenMessages: 30000, // 30 seconds
  maxDelayBetweenMessages: 300000, // 5 minutes
  maxMessagesPerHour: 15,
  maxMessagesPerDay: 100,
  conversationMinMessages: 5,
  conversationMaxMessages: 30,
  silenceThreshold: 3,
};

// Maximum conversation context size (prevents memory bloat)
const MAX_CONTEXT_SIZE = 20; // AI uses 10, we keep 20 for history

// Chronotype configurations
const CHRONOTYPE_CONFIGS = {
  early_bird: {
    name: 'Early Bird',
    activeHoursStart: 5,
    activeHoursEnd: 21,
    peakHours: [7, 8, 9, 12, 13, 17, 18],
    description: 'Aktif pagi, tidur malam'
  },
  night_owl: {
    name: 'Night Owl',
    activeHoursStart: 10,
    activeHoursEnd: 2,
    peakHours: [13, 14, 20, 21, 22, 23, 0, 1],
    description: 'Bangun siang, aktif malam'
  },
  regular: {
    name: 'Regular',
    activeHoursStart: 7,
    activeHoursEnd: 22,
    peakHours: [8, 9, 12, 13, 18, 19, 20],
    description: 'Jadwal normal'
  },
  flexible: {
    name: 'Flexible',
    activeHoursStart: 6,
    activeHoursEnd: 23,
    peakHours: [9, 10, 14, 15, 19, 20, 21],
    description: 'Fleksibel, bisa kapan saja'
  }
};

// ==================== CONVERSATION TOPICS ====================

const TOPIC_CATEGORIES = {
  daily_life: {
    name: 'Kehidupan Sehari-hari',
    topics: [
      'Hari ini gimana?',
      'Lagi sibuk apa?',
      'Udah makan belum?',
      'Pengen ngopi nanti?',
      'Weekend rencana apa?',
      'Lagi nonton apa?',
      'Musik favorit sekarang apa?',
    ]
  },
  work: {
    name: 'Pekerjaan',
    topics: [
      'Kerjaan lagi堆积 banget?',
      'Meeting mulu ya?',
      'Deadline kapan?',
      'Libur cuti belum?',
      'Proyek baru ada?',
      'Rekan kerja asik?',
    ]
  },
  hobbies: {
    name: 'Hobi',
    topics: [
      'Main game apa?',
      'Nonton film terakhir apa?',
      'Olahraga apa favorit?',
      'Dengerin musik genre apa?',
      'Buku terakhir dibaca?',
      'Traveling kemana aja?',
    ]
  },
  food: {
    name: 'Makanan',
    topics: [
      'Makanan favorit apa?',
      'Restoran enak direkomendasi?',
      'Pedes atau enggak?',
      'Masak sendiri atau beli?',
      'Minuman favorit?',
      'Jajanan malam enak dimana?',
    ]
  },
  tech: {
    name: 'Teknologi',
    topics: [
      'HP baru keluar kapan?',
      'Aplikasi recommended?',
      'ChatGPT pernah pakai?',
      'Game mobile enak?',
      'Laptop bagus brand apa?',
    ]
  },
  entertainment: {
    name: 'Hiburan',
    topics: [
      'Drakor lagi nonton?',
      'Anime recommended?',
      'Konser pernah nonton?',
      'Netflix series bagus?',
      'Podcast dengar apa?',
    ]
  }
};

// Opening messages for new conversations
const OPENING_MESSAGES = [
  'Halo! Apa kabar?',
  'Hey, lagi apa?',
  'Hai, gimana harinya?',
  'Pagi! Semangat hari ini!',
  'Malam, belum tidur?',
  'Halo, salam kenal!',
  'Hi, boleh chat yuk?',
  'Hey, udah lama nggak chat!',
];

// Response templates (fallback when AI not available)
const RESPONSE_TEMPLATES = {
  greeting: [
    'Halo juga! Apa kabar?',
    'Hey! Baik nih, kamu gimana?',
    'Hai! Lagi sibuk ya?',
    'Pagi! Semangat juga!',
  ],
  question: [
    'Hmm, iya sih haha',
    'Wah, bagus tuh!',
    'Serius? Aku juga!',
    'Oh iya? Baru tau nih',
    'Menarik juga ya',
  ],
  casual: [
    'Iya bener',
    'Haha iya',
    'Setuju!',
    'Same same',
    'Wkwk bener tuh',
  ],
  closing: [
    'Oh iya, mau tanya...',
    'Btw, kemarin...',
    'Eh, omong-omong...',
    'Ya udah deh, nanti chat lagi ya!',
    'Oke, ditunggu ya!',
  ],
};

// ==================== WARMING ENGINE CLASS ====================

// Retry configuration
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [5000, 15000, 60000]; // 5s, 15s, 60s

interface PendingMessage {
  accountId: string;
  recipientId: string;
  message: string;
  pairId: string;
  retryCount: number;
  timestamp: Date;
}

export class WarmingEngine {
  private accounts: Map<string, WarmingAccount>;
  private chatPairs: Map<string, ChatPair>;
  private messageQueue: Map<string, NodeJS.Timeout>;
  private pendingMessages: Map<string, PendingMessage>; // For retry mechanism
  private config: WarmingConfig;
  private groqApiKey: string | null = null;
  private groqModel: string = 'llama-3.3-70b-versatile';

  constructor(config: Partial<WarmingConfig> = {}) {
    this.accounts = new Map();
    this.chatPairs = new Map();
    this.messageQueue = new Map();
    this.pendingMessages = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==================== INITIALIZATION ====================

  async initialize() {
    console.log('[WarmingEngine] Initializing...');
    
    // Load AI settings from DB
    await this.loadAISettings();
    
    // Load existing chat pairs from DB
    await this.loadChatPairs();
    
    console.log('[WarmingEngine] Initialized');
  }

  private async loadAISettings() {
    try {
      // PRIORITY 1: Read from environment variable (Railway sets this)
      const envGroqKey = process.env.GROQ_API_KEY;
      
      if (envGroqKey) {
        this.groqApiKey = envGroqKey;
        console.log(`[WarmingEngine] AI Settings: Using GROQ_API_KEY from environment`);
      } else {
        // PRIORITY 2: Fallback to database
        const groqKey = await db.warmingConfig.findUnique({
          where: { key: 'groqApiKey' }
        });
        this.groqApiKey = groqKey?.value || null;
        console.log(`[WarmingEngine] AI Settings: ${this.groqApiKey ? 'Configured (from DB)' : 'Not configured'}`);
      }
      
      // Load model setting from DB or use default
      const groqModelSetting = await db.warmingConfig.findUnique({
        where: { key: 'groqModel' }
      });
      this.groqModel = groqModelSetting?.value || 'llama-3.3-70b-versatile';
      
    } catch (error: any) {
      console.error('[WarmingEngine] Failed to load AI settings:', error?.message || error);
      // Last resort: try env variable
      this.groqApiKey = process.env.GROQ_API_KEY || null;
    }
  }

  private async loadChatPairs() {
    try {
      const pairs = await db.chatPair.findMany({
        where: { isActive: true }
      });
      
      for (const pair of pairs) {
        this.chatPairs.set(pair.id, {
          id: pair.id,
          account1Id: pair.account1Id,
          account2Id: pair.account2Id,
          currentTopic: pair.currentTopic,
          topicCategory: pair.topicCategory,
          messageCount: pair.messageCount,
          relationshipStage: pair.relationshipStage as ChatPair['relationshipStage'],
          sharedInterests: JSON.parse(pair.sharedInterests || '[]'),
          topicsDiscussed: JSON.parse(pair.topicsDiscussed || '[]'),
          conversationContext: JSON.parse(pair.conversationCtx || '[]'),
          startedAt: pair.startedAt,
          lastMessageAt: pair.lastMessageAt || undefined,
          silenceCount: pair.silenceCount,
          isActive: pair.isActive,
        });
      }
      
      console.log(`[WarmingEngine] Loaded ${pairs.length} chat pairs`);
    } catch (error: any) {
      console.error('[WarmingEngine] Failed to load chat pairs:', error?.message || error);
    }
  }

  // ==================== ACCOUNT MANAGEMENT ====================

  registerAccount(account: WarmingAccount) {
    this.accounts.set(account.id, account);
    console.log(`[WarmingEngine] Account registered: ${account.id}`);
    
    // Try to pair with another account
    this.tryPairAccount(account.id);
  }

  unregisterAccount(accountId: string) {
    this.accounts.delete(accountId);
    
    // Clear any pending messages
    const timeout = this.messageQueue.get(accountId);
    if (timeout) {
      clearTimeout(timeout);
      this.messageQueue.delete(accountId);
    }
    
    // Deactivate chat pairs
    for (const [pairId, pair] of this.chatPairs) {
      if (pair.account1Id === accountId || pair.account2Id === accountId) {
        pair.isActive = false;
        this.chatPairs.delete(pairId);
      }
    }
    
    console.log(`[WarmingEngine] Account unregistered: ${accountId}`);
  }

  // ==================== CHAT PAIRING ====================

  async tryPairAccount(accountId: string) {
    const account = this.accounts.get(accountId);
    if (!account || account.status !== 'online' || !account.warmingEnabled) {
      return null;
    }

    // Check if already paired
    for (const pair of this.chatPairs.values()) {
      if ((pair.account1Id === accountId || pair.account2Id === accountId) && pair.isActive) {
        return pair;
      }
    }

    // Find a suitable partner
    let bestPartner: WarmingAccount | null = null;
    let bestScore = 0;

    for (const [candidateId, candidate] of this.accounts) {
      if (candidateId === accountId) continue;
      if (candidate.status !== 'online') continue;
      if (!candidate.warmingEnabled) continue;

      // Check if already in active pair
      let isAlreadyPaired = false;
      for (const pair of this.chatPairs.values()) {
        if ((pair.account1Id === candidateId || pair.account2Id === candidateId) && pair.isActive) {
          isAlreadyPaired = true;
          break;
        }
      }
      if (isAlreadyPaired) continue;

      // Calculate compatibility score
      const score = this.calculateCompatibility(account, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestPartner = candidate;
      }
    }

    if (bestPartner) {
      return await this.createPair(account, bestPartner);
    }

    return null;
  }

  private calculateCompatibility(acc1: WarmingAccount, acc2: WarmingAccount): number {
    let score = 50; // Base score

    const p1 = acc1.personality;
    const p2 = acc2.personality;

    if (p1 && p2) {
      // Same location bonus
      if (p1.location === p2.location) score += 15;

      // Shared hobbies bonus
      const sharedHobbies = p1.hobbies.filter(h => p2.hobbies.includes(h));
      score += sharedHobbies.length * 5;

      // Age proximity bonus
      const ageDiff = Math.abs(p1.age - p2.age);
      if (ageDiff <= 3) score += 10;
      else if (ageDiff <= 7) score += 5;

      // Chronotype compatibility
      if (p1.chronotype === p2.chronotype) score += 10;
      else if (p1.chronotype === 'flexible' || p2.chronotype === 'flexible') score += 5;

      // Different occupation = more interesting conversations
      if (p1.occupation !== p2.occupation) score += 5;
    }

    // Randomness factor for variety
    score += Math.random() * 20 - 10;

    return Math.max(0, Math.min(100, score));
  }

  // ==================== INITIATOR DETERMINATION ====================

  /**
   * Determine who should start the conversation based on multiple factors
   * Priority: Chronotype > Personality > Age > Fallback
   */
  private determineInitiator(acc1: WarmingAccount, acc2: WarmingAccount): string {
    const p1 = acc1.personality;
    const p2 = acc2.personality;
    const now = new Date();
    const currentHour = now.getHours();

    // ========================================
    // STEP 1: CHRONOTYPE CHECK (Priority 1)
    // ========================================
    // Who is in peak hours or more active right now?
    let score1 = 0;
    let score2 = 0;

    if (p1 && p2) {
      // Check if in peak hours
      if (p1.peakHours.includes(currentHour)) score1 += 40;
      if (p2.peakHours.includes(currentHour)) score2 += 40;

      // Check if within active hours
      const isActive1 = this.isInActiveHours(p1, currentHour);
      const isActive2 = this.isInActiveHours(p2, currentHour);

      if (isActive1 && !isActive2) score1 += 30;
      if (isActive2 && !isActive1) score2 += 30;

      // ========================================
      // STEP 2: PERSONALITY CHECK (Priority 2)
      // ========================================
      // Extrovert traits: ramah, humoris, aktif
      // Introvert traits: penyabar, santai, tekun
      const extrovertTraits = ['ramah', 'humoris', 'aktif', 'kreatif'];
      const introvertTraits = ['penyabar', 'santai', 'tekun', 'peduli'];

      const extrovertScore1 = p1.traits.filter(t => extrovertTraits.includes(t)).length * 10;
      const extrovertScore2 = p2.traits.filter(t => extrovertTraits.includes(t)).length * 10;
      const introvertScore1 = p1.traits.filter(t => introvertTraits.includes(t)).length * 5;
      const introvertScore2 = p2.traits.filter(t => introvertTraits.includes(t)).length * 5;

      score1 += extrovertScore1 - introvertScore1;
      score2 += extrovertScore2 - introvertScore2;

      // ========================================
      // STEP 3: AGE CHECK (Priority 3)
      // ========================================
      // Older person usually initiates (more confident)
      if (p1.age > p2.age) score1 += 10;
      else if (p2.age > p1.age) score2 += 10;
    }

    // ========================================
    // STEP 4: FALLBACK
    // ========================================
    // If scores are equal, use account1Id (first to connect)
    const initiatorId = score1 >= score2 ? acc1.id : acc2.id;

    console.log(`[WarmingEngine] Initiator determination: ${acc1.id}(${score1}) vs ${acc2.id}(${score2}) → ${initiatorId} starts`);

    return initiatorId;
  }

  /**
   * Check if current hour is within active hours
   */
  private isInActiveHours(personality: Personality, currentHour: number): boolean {
    const { activeHoursStart, activeHoursEnd } = personality;

    // Handle overnight (e.g., night owl: 10:00 - 02:00)
    if (activeHoursStart > activeHoursEnd) {
      return currentHour >= activeHoursStart || currentHour <= activeHoursEnd;
    }

    return currentHour >= activeHoursStart && currentHour <= activeHoursEnd;
  }

  private async createPair(acc1: WarmingAccount, acc2: WarmingAccount): Promise<ChatPair | null> {
    try {
      const personality1 = acc1.personality;
      const personality2 = acc2.personality;

      // Determine shared interests
      const sharedInterests: string[] = [];
      if (personality1 && personality2) {
        sharedInterests.push(
          ...personality1.hobbies.filter(h => personality2.hobbies.includes(h))
        );
      }

      // Select initial topic
      const categoryKeys = Object.keys(TOPIC_CATEGORIES);
      const randomCategory = categoryKeys[Math.floor(Math.random() * categoryKeys.length)];
      const category = TOPIC_CATEGORIES[randomCategory as keyof typeof TOPIC_CATEGORIES];
      const randomTopic = category.topics[Math.floor(Math.random() * category.topics.length)];

      // ========================================
      // DETERMINE WHO STARTS THE CONVERSATION
      // ========================================
      const initiatorId = this.determineInitiator(acc1, acc2);

      const pairId = `${acc1.id}-${acc2.id}-${Date.now()}`;

      const pair: ChatPair = {
        id: pairId,
        account1Id: acc1.id,
        account2Id: acc2.id,
        initiatorId,  // Who starts the conversation
        currentTopic: randomTopic,
        topicCategory: randomCategory,
        messageCount: 0,
        relationshipStage: 'stranger',
        sharedInterests,
        topicsDiscussed: [],
        conversationContext: [],
        startedAt: new Date(),
        silenceCount: 0,
        isActive: true,
      };

      // Save to database
      await db.chatPair.create({
        data: {
          id: pairId,
          account1Id: acc1.id,
          account2Id: acc2.id,
          currentTopic: pair.currentTopic,
          topicCategory: pair.topicCategory,
          messageCount: 0,
          relationshipStage: 'stranger',
          sharedInterests: JSON.stringify(sharedInterests),
          topicsDiscussed: '[]',
          conversationCtx: '[]',
          silenceCount: 0,
          isActive: true,
        }
      });

      // Update account partner IDs
      await db.whatsAppAccount.update({
        where: { id: acc1.id },
        data: { currentChatPartnerId: acc2.id }
      });
      await db.whatsAppAccount.update({
        where: { id: acc2.id },
        data: { currentChatPartnerId: acc1.id }
      });

      this.chatPairs.set(pairId, pair);

      console.log(`[WarmingEngine] Created pair: ${acc1.id} <-> ${acc2.id}`);
      console.log(`[WarmingEngine] Initiator: ${initiatorId} will start the conversation`);
      console.log(`[WarmingEngine] Topic: ${randomTopic} (${randomCategory})`);

      return pair;
    } catch (error: any) {
      console.error('[WarmingEngine] Failed to create pair:', error?.message || error);
      return null;
    }
  }

  // ==================== MESSAGE SCHEDULING ====================

  scheduleNextMessage(accountId: string) {
    const account = this.accounts.get(accountId);
    if (!account || account.status !== 'online' || !account.warmingEnabled) {
      return;
    }

    // Check if within active hours
    if (!this.isActiveHours(account)) {
      // Schedule for next active period
      const delay = this.getTimeUntilNextActivePeriod(account);
      console.log(`[WarmingEngine] ${accountId} outside active hours, scheduling for ${Math.round(delay / 60000)} minutes`);
      
      const timeout = setTimeout(() => {
        this.sendMessage(accountId);
      }, delay);
      
      this.messageQueue.set(accountId, timeout);
      return;
    }

    // Check rate limits
    if (!this.checkRateLimits(accountId)) {
      console.log(`[WarmingEngine] ${accountId} hit rate limit, waiting...`);
      return;
    }

    // Calculate delay based on chronotype and conversation state
    const delay = this.calculateMessageDelay(account);

    console.log(`[WarmingEngine] Scheduling message for ${accountId} in ${Math.round(delay / 1000)}s`);

    const timeout = setTimeout(() => {
      this.sendMessage(accountId);
    }, delay);

    this.messageQueue.set(accountId, timeout);
  }

  private isActiveHours(account: WarmingAccount): boolean {
    const now = new Date();
    const hour = now.getHours();
    const personality = account.personality;

    if (!personality) {
      // Default active hours if no personality
      return hour >= 7 && hour <= 22;
    }

    const { activeHoursStart, activeHoursEnd } = personality;

    // Handle overnight active hours (e.g., night owl)
    if (activeHoursStart > activeHoursEnd) {
      return hour >= activeHoursStart || hour <= activeHoursEnd;
    }

    return hour >= activeHoursStart && hour <= activeHoursEnd;
  }

  private getTimeUntilNextActivePeriod(account: WarmingAccount): number {
    const now = new Date();
    const hour = now.getHours();
    const personality = account.personality;

    const activeHoursStart = personality?.activeHoursStart || 7;

    if (hour < activeHoursStart) {
      // Today, wait until active hours
      return (activeHoursStart - hour) * 60 * 60 * 1000;
    } else {
      // Tomorrow
      return (24 - hour + activeHoursStart) * 60 * 60 * 1000;
    }
  }

  private calculateMessageDelay(account: WarmingAccount): number {
    const personality = account.personality;
    let baseDelay = this.config.minDelayBetweenMessages;

    if (personality) {
      // Adjust based on avg response time
      baseDelay = personality.avgResponseTime * 60 * 1000; // Convert minutes to ms

      // Check if current hour is peak hour
      const hour = new Date().getHours();
      if (personality.peakHours.includes(hour)) {
        // Faster responses during peak hours
        baseDelay *= 0.7;
      }

      // Add randomness based on personality
      const randomFactor = 0.5 + Math.random(); // 0.5x to 1.5x
      baseDelay *= randomFactor;
    } else {
      // Random delay if no personality
      baseDelay = this.config.minDelayBetweenMessages + 
        Math.random() * (this.config.maxDelayBetweenMessages - this.config.minDelayBetweenMessages);
    }

    // Ensure within bounds
    return Math.max(this.config.minDelayBetweenMessages, 
      Math.min(this.config.maxDelayBetweenMessages, baseDelay));
  }

  private checkRateLimits(accountId: string): { allowed: boolean; reason?: string; waitTime?: number } {
    return rateLimiter.canSendMessage(accountId);
  }

  // ==================== MESSAGE SENDING ====================

  private async sendMessage(accountId: string) {
    const account = this.accounts.get(accountId);
    if (!account || account.status !== 'online' || !account.warmingEnabled) {
      return;
    }

    // ========================================
    // RATE LIMIT CHECK
    // ========================================
    const rateCheck = this.checkRateLimits(accountId);
    if (!rateCheck.allowed) {
      console.log(`[WarmingEngine] Rate limit: ${accountId} - ${rateCheck.reason}`);
      
      // Schedule retry after wait time
      if (rateCheck.waitTime) {
        const delay = Math.min(rateCheck.waitTime, 300000); // Max 5 min delay
        setTimeout(() => this.scheduleNextMessage(accountId), delay);
      }
      return;
    }

    // ========================================
    // ANTI-BAN CHECK
    // ========================================
    const antiBanDelay = antiBanSystem.shouldDelayAction(accountId, 'send');
    if (antiBanDelay.shouldDelay && antiBanDelay.delay > 0) {
      console.log(`[WarmingEngine] Anti-ban delay: ${accountId} - ${antiBanDelay.delay}ms`);
      await new Promise(resolve => setTimeout(resolve, antiBanDelay.delay));
    }

    // Find active chat pair
    let activePair: ChatPair | null = null;
    for (const pair of this.chatPairs.values()) {
      if ((pair.account1Id === accountId || pair.account2Id === accountId) && pair.isActive) {
        activePair = pair;
        break;
      }
    }

    if (!activePair) {
      // Try to create a new pair
      activePair = await this.tryPairAccount(accountId);
      if (!activePair) {
        console.log(`[WarmingEngine] No pair available for ${accountId}`);
        return;
      }
    }

    // ========================================
    // INITIATOR CHECK - WHO STARTS FIRST?
    // ========================================
    // If this is the first message (messageCount === 0), only initiator can send
    if (activePair.messageCount === 0 && activePair.initiatorId !== accountId) {
      console.log(`[WarmingEngine] ${accountId} waiting for initiator ${activePair.initiatorId} to start`);
      // Don't schedule anything - the initiator will trigger the conversation
      // The non-initiator will respond after receiving the first message
      return;
    }

    // Determine recipient
    const recipientId = activePair.account1Id === accountId 
      ? activePair.account2Id 
      : activePair.account1Id;

    const recipient = this.accounts.get(recipientId);
    if (!recipient || recipient.status !== 'online') {
      console.log(`[WarmingEngine] Recipient ${recipientId} not available`);
      return;
    }

    // Generate message
    const message = await this.generateMessage(account, recipient, activePair);

    if (message && account.socket) {
      try {
        // ========================================
        // SIMULATE HUMAN BEHAVIOR
        // ========================================
        await antiBanSystem.simulateHumanBehavior(accountId, account.socket);

        // Send message via Baileys
        const jid = `${recipient.phoneNumber}@s.whatsapp.net`;
        await account.socket.sendMessage(jid, { text: message });

        // ========================================
        // RECORD MESSAGE FOR RATE LIMITING
        // ========================================
        rateLimiter.recordMessage(accountId);

        // Update pair state
        activePair.messageCount++;
        activePair.lastMessageAt = new Date();
        activePair.conversationContext.push({
          role: 'assistant',
          content: message,
          timestamp: new Date(),
        });
        
        // ========================================
        // TRUNCATE CONTEXT TO PREVENT MEMORY BLOAT
        // ========================================
        // Keep only last 20 messages in memory to prevent memory bloat
        // AI already only uses last 10 for context, but we keep 20 for DB history
        if (activePair.conversationContext.length > MAX_CONTEXT_SIZE) {
          activePair.conversationContext = activePair.conversationContext.slice(-MAX_CONTEXT_SIZE);
        }

        // Update relationship stage based on message count
        this.updateRelationshipStage(activePair);

        // Save to database
        await this.savePairToDB(activePair);

        // ========================================
        // UPDATE HEALTH SCORE
        // ========================================
        const healthScore = await updateHealthScore(accountId);
        console.log(`[WarmingEngine] Health score updated: ${accountId} = ${healthScore}`);

        // Log success
        console.log(`[WarmingEngine] ✅ Message sent: ${accountId} -> ${recipientId}: "${message.substring(0, 50)}..."`);

        // Emit event
        this.emitWarmingEvent('message-sent', {
          from: accountId,
          to: recipientId,
          message: message.substring(0, 100),
          pairId: activePair.id,
          healthScore,
        });

        // Clear any pending retry for this account
        this.pendingMessages.delete(accountId);

        // Schedule next message for recipient
        this.scheduleNextMessage(recipientId);

      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        console.error(`[WarmingEngine] ❌ Failed to send message from ${accountId}:`, errorMessage);
        
        // ========================================
        // RETRY MECHANISM
        // ========================================
        const pendingMessage = this.pendingMessages.get(accountId);
        const retryCount = pendingMessage ? pendingMessage.retryCount + 1 : 1;
        
        if (retryCount <= MAX_RETRY_ATTEMPTS) {
          const retryDelay = RETRY_DELAYS[retryCount - 1] || 60000;
          console.log(`[WarmingEngine] 🔄 Scheduling retry ${retryCount}/${MAX_RETRY_ATTEMPTS} in ${retryDelay/1000}s for ${accountId}`);
          
          this.pendingMessages.set(accountId, {
            accountId,
            recipientId,
            message,
            pairId: activePair.id,
            retryCount,
            timestamp: new Date(),
          });
          
          // Schedule retry
          setTimeout(() => {
            const pending = this.pendingMessages.get(accountId);
            if (pending && pending.retryCount === retryCount) {
              this.sendMessage(accountId);
            }
          }, retryDelay);
        } else {
          console.error(`[WarmingEngine] 🚫 Max retries reached for ${accountId}, giving up`);
          this.pendingMessages.delete(accountId);
          
          // Log failed message to database for analysis
          try {
            await db.eventLog.create({
              data: {
                accountId,
                type: 'error',
                message: `Failed to send message after ${MAX_RETRY_ATTEMPTS} retries: ${errorMessage}`,
              }
            });
          } catch (dbError) {
            console.error('[WarmingEngine] Failed to log error to DB:', dbError);
          }
        }
      }
    }

    // Schedule next message for this account
    this.scheduleNextMessage(accountId);
  }

  private async generateMessage(
    sender: WarmingAccount, 
    recipient: WarmingAccount, 
    pair: ChatPair
  ): Promise<string> {
    const senderPersonality = sender.personality;
    const recipientPersonality = recipient.personality;

    // Try AI generation first
    if (this.groqApiKey) {
      try {
        const aiMessage = await this.generateAIResponse(sender, recipient, pair);
        if (aiMessage) return this.applyPersonalityStyle(aiMessage, senderPersonality);
      } catch (error: any) {
        console.error('[WarmingEngine] AI generation failed:', error?.message || error);
        // Fallback to template below
      }
    }

    // Fallback to template-based generation
    return this.generateTemplateMessage(sender, recipient, pair);
  }

  private async generateAIResponse(
    sender: WarmingAccount,
    recipient: WarmingAccount,
    pair: ChatPair
  ): Promise<string | null> {
    const systemPrompt = this.buildSystemPrompt(sender, recipient, pair);
    const context = pair.conversationContext.slice(-10); // Last 10 messages

    const messages = [
      { role: 'system', content: systemPrompt },
      ...context.map(m => ({
        role: m.role,
        content: m.content
      })),
    ];

    // Add context about what to discuss
    if (pair.messageCount === 0) {
      messages.push({
        role: 'user',
        content: `Kamu mulai percakapan. Topik: "${pair.currentTopic}". Sapa lawan chat dengan natural.`
      });
    } else {
      messages.push({
        role: 'user',
        content: 'Balas pesan terakhir dengan natural dan lanjutkan percakapan.'
      });
    }

    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
      
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.groqApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.groqModel,
          messages,
          max_tokens: 150,
          temperature: 0.8,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || null;
    } catch (error: any) {
      // Handle timeout specifically
      if (error.name === 'AbortError') {
        console.error('[WarmingEngine] AI request timeout (15s)');
      } else {
        console.error('[WarmingEngine] AI request failed:', error?.message || error);
      }
      return null;
    }
  }

  private buildSystemPrompt(
    sender: WarmingAccount,
    recipient: WarmingAccount,
    pair: ChatPair
  ): string {
    const p = sender.personality;
    const r = recipient.personality;

    return `Kamu adalah ${p?.name || 'seseorang'}, ${p?.age || 25} tahun, ${p?.occupation || 'pekerja'} dari ${p?.location || 'Indonesia'}.

Kepribadian: ${p?.traits?.join(', ') || 'ramah dan penyabar'}
Gaya menulis: ${p?.writingStyle || 'santai'}
Hobi: ${p?.hobbies?.join(', ') || 'musik dan film'}

Kamu sedang chat dengan ${r?.name || 'seseorang'} (${r?.occupation || 'pekerja'} dari ${r?.location || 'Indonesia'}).

Aturan penting:
1. Respon dengan gaya natural seperti chat WhatsApp Indonesia
2. ${p?.emojiUsage === 'heavy' ? 'Gunakan banyak emoji' : p?.emojiUsage === 'minimal' ? 'Gunakan emoji minimal' : 'Gunakan emoji secukupnya'}
3. Panjang pesan: ${p?.avgMessageLength === 'short' ? 'singkat (1-2 kalimat)' : p?.avgMessageLength === 'long' ? 'panjang (3-5 kalimat)' : 'sedang (2-3 kalimat)'}
4. Jangan terlalu formal, gunakan bahasa sehari-hari
5. Topik saat ini: ${pair.currentTopic}
6. Status hubungan: ${pair.relationshipStage}
7. Minat bersama: ${pair.sharedInterests.join(', ') || 'belum diketahui'}

Jangan pernah menyebutkan bahwa kamu adalah AI atau asisten. Jadilah ${p?.name || 'karakter'} yang asli.`;
  }

  private applyPersonalityStyle(message: string, personality?: Personality | null): string {
    if (!personality) return message;

    // Add emojis if heavy usage - use proper emoji detection
    if (personality.emojiUsage === 'heavy') {
      // Check if message already has emojis using a simple check
      const hasEmoji = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(message);
      if (!hasEmoji) {
        const emojis = ['😊', '😄', '👍', '👌', '🎉', '💪', '✨'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        message = `${message} ${randomEmoji}`;
      }
    }

    // Truncate if short preference
    if (personality.avgMessageLength === 'short' && message.length > 100) {
      const sentences = message.split(/[.!?]/);
      message = sentences.slice(0, 2).join('. ').trim();
      if (!message.endsWith('.')) message += '.';
    }

    return message;
  }

  private generateTemplateMessage(
    sender: WarmingAccount,
    recipient: WarmingAccount,
    pair: ChatPair
  ): string {
    const personality = sender.personality;

    // First message
    if (pair.messageCount === 0) {
      const greeting = OPENING_MESSAGES[Math.floor(Math.random() * OPENING_MESSAGES.length)];
      return this.applyPersonalityStyle(greeting, personality);
    }

    // Check if need new topic
    if (pair.silenceCount >= this.config.silenceThreshold) {
      // Select new topic
      const categoryKeys = Object.keys(TOPIC_CATEGORIES);
      const randomCategory = categoryKeys[Math.floor(Math.random() * categoryKeys.length)];
      const category = TOPIC_CATEGORIES[randomCategory as keyof typeof TOPIC_CATEGORIES];
      const randomTopic = category.topics[Math.floor(Math.random() * category.topics.length)];

      pair.currentTopic = randomTopic;
      pair.topicCategory = randomCategory;
      pair.silenceCount = 0;

      return this.applyPersonalityStyle(`Btw, ${randomTopic.toLowerCase()}`, personality);
    }

    // Regular response
    const templates = [
      ...RESPONSE_TEMPLATES.question,
      ...RESPONSE_TEMPLATES.casual,
    ];

    const response = templates[Math.floor(Math.random() * templates.length)];
    return this.applyPersonalityStyle(response, personality);
  }

  // ==================== RELATIONSHIP PROGRESSION ====================

  private updateRelationshipStage(pair: ChatPair) {
    const { messageCount } = pair;

    if (messageCount >= 50) {
      pair.relationshipStage = 'close_friend';
    } else if (messageCount >= 20) {
      pair.relationshipStage = 'friend';
    } else if (messageCount >= 5) {
      pair.relationshipStage = 'acquaintance';
    }
  }

  // ==================== DATABASE OPERATIONS ====================

  private async savePairToDB(pair: ChatPair) {
    try {
      await db.chatPair.update({
        where: { id: pair.id },
        data: {
          messageCount: pair.messageCount,
          relationshipStage: pair.relationshipStage,
          sharedInterests: JSON.stringify(pair.sharedInterests),
          topicsDiscussed: JSON.stringify(pair.topicsDiscussed),
          conversationCtx: JSON.stringify(pair.conversationContext),
          lastMessageAt: pair.lastMessageAt,
          silenceCount: pair.silenceCount,
          isActive: pair.isActive,
        }
      });
    } catch (error: any) {
      console.error('[WarmingEngine] Failed to save pair to DB:', error?.message || error);
    }
  }

  // ==================== EVENT EMISSION ====================

  private emitWarmingEvent(event: string, data: any) {
    // This will be connected to Socket.io in server.ts
    console.log(`[WarmingEngine] Event: ${event}`, data);
  }

  // ==================== PUBLIC API ====================

  startWarming(accountId: string) {
    const account = this.accounts.get(accountId);
    if (!account) {
      console.log(`[WarmingEngine] Account not found: ${accountId}`);
      return false;
    }

    account.warmingEnabled = true;
    this.scheduleNextMessage(accountId);
    console.log(`[WarmingEngine] Warming started for ${accountId}`);
    return true;
  }

  stopWarming(accountId: string) {
    const account = this.accounts.get(accountId);
    if (!account) return false;

    account.warmingEnabled = false;

    // Clear pending messages
    const timeout = this.messageQueue.get(accountId);
    if (timeout) {
      clearTimeout(timeout);
      this.messageQueue.delete(accountId);
    }

    console.log(`[WarmingEngine] Warming stopped for ${accountId}`);
    return true;
  }

  getActivePairs(): ChatPair[] {
    return Array.from(this.chatPairs.values()).filter(p => p.isActive);
  }

  getStats() {
    return {
      totalAccounts: this.accounts.size,
      activePairs: this.chatPairs.size,
      warmingAccounts: Array.from(this.accounts.values()).filter(a => a.warmingEnabled).length,
    };
  }
}

// Export singleton instance
export const warmingEngine = new WarmingEngine();
