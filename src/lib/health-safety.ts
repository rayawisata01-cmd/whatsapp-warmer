/**
 * ============================================================================
 * WHATSAPP WARMER - HEALTH & SAFETY SYSTEM
 * ============================================================================
 * 
 * Features:
 * - Health Score Algorithm (multi-factor analysis)
 * - Rate Limiting (hourly/daily limits with adaptive throttling)
 * - Anti-Ban Measures (pattern detection, behavior simulation)
 * - Warning System (alerts for suspicious activity)
 * 
 * ============================================================================
 */

import { db } from './db';

// ==================== TYPES ====================

export interface HealthFactors {
  messageBalance: number;        // Sent vs Received ratio (0-100)
  responseRate: number;          // Response rate to incoming messages (0-100)
  activityConsistency: number;   // How consistent the activity is (0-100)
  connectionStability: number;   // Connection uptime score (0-100)
  accountAge: number;            // Account warming duration score (0-100)
  humanBehavior: number;         // How human-like the behavior is (0-100)
}

export interface HealthScoreResult {
  score: number;                 // Overall health score (0-100)
  factors: HealthFactors;
  warnings: string[];
  recommendations: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface RateLimitConfig {
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
  minDelayBetweenMessages: number;  // ms
  maxDelayBetweenMessages: number;  // ms
  burstLimit: number;               // Max messages in rapid succession
  burstWindow: number;              // ms window for burst detection
}

export interface RateLimitState {
  hourCount: number;
  dayCount: number;
  lastMessageTime: Date | null;
  burstCount: number;
  burstWindowStart: Date | null;
  isThrottled: boolean;
  throttleUntil: Date | null;
  consecutiveHourlyLimits: number;  // Track repeated limits
}

export interface BanRiskFactors {
  highMessageVolume: boolean;       // Sending too many messages
  lowResponseRate: boolean;         // Not responding to messages
  suspiciousPattern: boolean;       // Detected automation patterns
  rapidActions: boolean;            // Too fast actions
  newAccount: boolean;              // Account too new
  reportRisk: boolean;              // Risk of being reported
}

export interface AntiBanState {
  cooldownActive: boolean;
  cooldownUntil: Date | null;
  mimicryLevel: number;             // 0-100, how much to mimic human behavior
  lastTypingSimulation: Date | null;
  lastPresenceUpdate: Date | null;
  readReceiptDelay: number;         // ms delay before marking as read
}

// ==================== CONFIGURATION ====================

const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  maxMessagesPerHour: 15,
  maxMessagesPerDay: 100,
  minDelayBetweenMessages: 30000,     // 30 seconds
  maxDelayBetweenMessages: 300000,    // 5 minutes
  burstLimit: 5,
  burstWindow: 60000,                 // 1 minute
};

// Risk thresholds
const RISK_THRESHOLDS = {
  healthScore: {
    low: 80,
    medium: 60,
    high: 40,
    critical: 20,
  },
  messageRatio: {
    // Sent/Received ratio - too high = suspicious
    normal: 2.0,    // Sending up to 2x received is normal
    warning: 3.0,   // Above 3x is warning
    danger: 5.0,    // Above 5x is dangerous
  },
  hourlyRate: {
    normal: 10,
    warning: 15,
    danger: 20,
  },
  accountAge: {
    new: 3,         // Days - very new
    young: 7,       // Days - still young
    mature: 30,     // Days - mature enough
  },
};

// ==================== HEALTH SCORE CALCULATOR ====================

export class HealthScoreCalculator {
  
  /**
   * Calculate comprehensive health score for an account
   */
  static async calculate(accountId: string): Promise<HealthScoreResult> {
    const warnings: string[] = [];
    const recommendations: string[] = [];
    
    // Fetch account data
    const account = await db.whatsAppAccount.findUnique({
      where: { id: accountId },
      include: {
        sentMessages: {
          where: { timestamp: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          orderBy: { timestamp: 'desc' },
          take: 100,
        },
        recvMessages: {
          where: { timestamp: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          orderBy: { timestamp: 'desc' },
          take: 100,
        },
      },
    });

    if (!account) {
      return {
        score: 0,
        factors: this.getDefaultFactors(),
        warnings: ['Account not found'],
        recommendations: ['Create account first'],
        riskLevel: 'critical',
      };
    }

    // Calculate individual factors
    const factors: HealthFactors = {
      messageBalance: this.calculateMessageBalance(account, warnings),
      responseRate: await this.calculateResponseRate(accountId, warnings),
      activityConsistency: this.calculateActivityConsistency(account),
      connectionStability: this.calculateConnectionStability(account),
      accountAge: this.calculateAccountAge(account),
      humanBehavior: this.calculateHumanBehaviorScore(account),
    };

    // Calculate weighted overall score
    const weights = {
      messageBalance: 0.25,
      responseRate: 0.20,
      activityConsistency: 0.15,
      connectionStability: 0.15,
      accountAge: 0.15,
      humanBehavior: 0.10,
    };

    let score = 0;
    for (const [key, weight] of Object.entries(weights)) {
      score += factors[key as keyof HealthFactors] * weight;
    }

    // Round score
    score = Math.round(score);

    // Determine risk level
    let riskLevel: HealthScoreResult['riskLevel'] = 'low';
    if (score < RISK_THRESHOLDS.healthScore.critical) {
      riskLevel = 'critical';
    } else if (score < RISK_THRESHOLDS.healthScore.high) {
      riskLevel = 'high';
    } else if (score < RISK_THRESHOLDS.healthScore.medium) {
      riskLevel = 'medium';
    }

    // Generate recommendations
    if (factors.messageBalance < 50) {
      recommendations.push('Receive more messages to improve balance - ask friends to message you');
    }
    if (factors.responseRate < 70) {
      recommendations.push('Respond to incoming messages more frequently');
    }
    if (factors.activityConsistency < 60) {
      recommendations.push('Maintain more consistent activity patterns');
    }
    if (factors.connectionStability < 70) {
      recommendations.push('Ensure stable internet connection');
    }
    if (factors.accountAge < 50) {
      recommendations.push('Continue warming - account is still new');
    }

    return {
      score,
      factors,
      warnings,
      recommendations,
      riskLevel,
    };
  }

  private static getDefaultFactors(): HealthFactors {
    return {
      messageBalance: 50,
      responseRate: 50,
      activityConsistency: 50,
      connectionStability: 50,
      accountAge: 50,
      humanBehavior: 50,
    };
  }

  private static calculateMessageBalance(
    account: any, 
    warnings: string[]
  ): number {
    const sent = account.messagesSent || 0;
    const received = account.messagesReceived || 0;
    
    if (sent === 0 && received === 0) {
      return 50; // Neutral score for new accounts
    }

    // Ideal ratio: slightly more received than sent
    const ratio = sent > 0 ? sent / Math.max(received, 1) : 0;
    
    // Check for warning conditions
    if (ratio > RISK_THRESHOLDS.messageRatio.danger) {
      warnings.push(`⚠️ Very high send/receive ratio: ${ratio.toFixed(1)}x - Risk of being flagged as spam`);
    } else if (ratio > RISK_THRESHOLDS.messageRatio.warning) {
      warnings.push(`⚡ High send/receive ratio: ${ratio.toFixed(1)}x`);
    }

    // Score calculation:
    // ratio 0-1: excellent (80-100)
    // ratio 1-2: good (60-80)
    // ratio 2-3: moderate (40-60)
    // ratio 3-5: warning (20-40)
    // ratio >5: danger (0-20)

    let score: number;
    if (ratio <= 1) {
      score = 80 + (1 - ratio) * 20;  // 80-100
    } else if (ratio <= 2) {
      score = 60 + (2 - ratio) * 20;  // 60-80
    } else if (ratio <= 3) {
      score = 40 + (3 - ratio) * 20;  // 40-60
    } else if (ratio <= 5) {
      score = 20 + (5 - ratio) * 10;  // 20-40
    } else {
      score = Math.max(0, 20 - (ratio - 5) * 2);  // 0-20
    }

    return Math.round(Math.min(100, Math.max(0, score)));
  }

  private static async calculateResponseRate(
    accountId: string, 
    warnings: string[]
  ): Promise<number> {
    // Get messages from last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const incomingMessages = await db.message.count({
      where: {
        toAccountId: accountId,
        direction: 'incoming',
        timestamp: { gte: sevenDaysAgo },
      },
    });

    // For now, return a base score
    // In production, would check actual response patterns
    if (incomingMessages === 0) {
      return 75; // No incoming messages = can't measure
    }

    // Simulate response rate based on activity
    // Higher incoming = better chance of responses
    const responseRate = Math.min(100, 50 + incomingMessages * 5);
    return Math.round(responseRate);
  }

  private static calculateActivityConsistency(account: any): number {
    const now = new Date();
    const createdAt = account.createdAt;
    const lastActivity = account.lastActivity;
    
    if (!createdAt) return 50;
    
    // Check if account is active recently
    const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
    
    if (daysSinceCreation < 1) {
      return 80; // New account, give benefit of doubt
    }

    // Check last activity
    if (!lastActivity) {
      return 30; // No activity
    }

    const hoursSinceActivity = (now.getTime() - lastActivity.getTime()) / (60 * 60 * 1000);
    
    if (hoursSinceActivity < 1) {
      return 95; // Very active
    } else if (hoursSinceActivity < 6) {
      return 85;
    } else if (hoursSinceActivity < 24) {
      return 70;
    } else if (hoursSinceActivity < 72) {
      return 50;
    } else {
      return 30;
    }
  }

  private static calculateConnectionStability(account: any): number {
    // Check reconnection history
    // For now, base on status
    if (account.status === 'online') {
      return 90;
    } else if (account.status === 'connecting') {
      return 60;
    } else {
      return 40;
    }
  }

  private static calculateAccountAge(account: any): number {
    const now = new Date();
    const createdAt = account.createdAt;
    
    if (!createdAt) return 50;
    
    const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
    
    if (daysSinceCreation < RISK_THRESHOLDS.accountAge.new) {
      return 20; // Very new - risky
    } else if (daysSinceCreation < RISK_THRESHOLDS.accountAge.young) {
      return 40;
    } else if (daysSinceCreation < RISK_THRESHOLDS.accountAge.mature) {
      return 70;
    } else {
      return 95; // Mature account - very safe
    }
  }

  private static calculateHumanBehaviorScore(account: any): number {
    // Analyze behavior patterns
    // This is a simplified version
    let score = 70; // Base score
    
    // Check warming days
    if (account.warmingDays && account.warmingDays > 7) {
      score += 10;
    }
    
    // Check if in active window
    if (account.isInActiveWindow) {
      score += 5;
    }
    
    // Check health score history
    if (account.healthScore > 80) {
      score += 10;
    } else if (account.healthScore < 50) {
      score -= 10;
    }
    
    return Math.min(100, Math.max(0, score));
  }
}

// ==================== RATE LIMITER ====================

export class RateLimiter {
  private states: Map<string, RateLimitState> = new Map();
  private config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMITS, ...config };
  }

  /**
   * Check if an account can send a message
   */
  canSendMessage(accountId: string): { allowed: boolean; reason?: string; waitTime?: number } {
    const state = this.getOrCreateState(accountId);
    const now = new Date();

    // Check if throttled
    if (state.isThrottled && state.throttleUntil) {
      if (now < state.throttleUntil) {
        const waitTime = state.throttleUntil.getTime() - now.getTime();
        return { 
          allowed: false, 
          reason: 'Account is throttled due to rate limit violation',
          waitTime 
        };
      } else {
        // Throttle period over
        state.isThrottled = false;
        state.throttleUntil = null;
      }
    }

    // Check hourly limit
    if (state.hourCount >= this.config.maxMessagesPerHour) {
      return { 
        allowed: false, 
        reason: `Hourly limit reached (${this.config.maxMessagesPerHour} messages/hour)`,
        waitTime: this.getTimeUntilNextHour()
      };
    }

    // Check daily limit
    if (state.dayCount >= this.config.maxMessagesPerDay) {
      return { 
        allowed: false, 
        reason: `Daily limit reached (${this.config.maxMessagesPerDay} messages/day)`,
        waitTime: this.getTimeUntilNextDay()
      };
    }

    // Check burst limit
    if (state.burstWindowStart) {
      const windowAge = now.getTime() - state.burstWindowStart.getTime();
      if (windowAge < this.config.burstWindow) {
        if (state.burstCount >= this.config.burstLimit) {
          const waitTime = this.config.burstWindow - windowAge;
          return { 
            allowed: false, 
            reason: `Burst limit reached - slow down`,
            waitTime 
          };
        }
      } else {
        // Reset burst window
        state.burstCount = 0;
        state.burstWindowStart = now;
      }
    }

    // Check minimum delay
    if (state.lastMessageTime) {
      const timeSinceLastMessage = now.getTime() - state.lastMessageTime.getTime();
      if (timeSinceLastMessage < this.config.minDelayBetweenMessages) {
        const waitTime = this.config.minDelayBetweenMessages - timeSinceLastMessage;
        return { 
          allowed: false, 
          reason: 'Minimum delay not met',
          waitTime 
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record a sent message
   */
  recordMessage(accountId: string): void {
    const state = this.getOrCreateState(accountId);
    const now = new Date();

    state.hourCount++;
    state.dayCount++;
    state.lastMessageTime = now;

    // Update burst tracking
    if (!state.burstWindowStart || 
        (now.getTime() - state.burstWindowStart.getTime()) >= this.config.burstWindow) {
      state.burstWindowStart = now;
      state.burstCount = 1;
    } else {
      state.burstCount++;
    }

    // Check for repeated hourly limits (pattern detection)
    if (state.hourCount >= this.config.maxMessagesPerHour) {
      state.consecutiveHourlyLimits++;
      
      // Throttle if repeatedly hitting limits
      if (state.consecutiveHourlyLimits >= 3) {
        state.isThrottled = true;
        state.throttleUntil = new Date(now.getTime() + 30 * 60 * 1000); // 30 min cooldown
        console.log(`[RateLimiter] ${accountId} throttled for 30 minutes due to repeated hourly limits`);
      }
    } else {
      state.consecutiveHourlyLimits = 0;
    }

    // Update database
    this.updateDatabaseState(accountId, state);
  }

  /**
   * Get next allowed message time with delay
   */
  getNextMessageDelay(accountId: string): number {
    const state = this.getOrCreateState(accountId);
    
    // Adaptive delay based on current rate
    const hourUsage = state.hourCount / this.config.maxMessagesPerHour;
    
    let delay = this.config.minDelayBetweenMessages;
    
    if (hourUsage > 0.8) {
      // Near limit - increase delay significantly
      delay = this.config.maxDelayBetweenMessages;
    } else if (hourUsage > 0.6) {
      // Getting close - increase delay moderately
      delay = (this.config.minDelayBetweenMessages + this.config.maxDelayBetweenMessages) / 2;
    } else {
      // Normal operation - randomize within range
      const range = this.config.maxDelayBetweenMessages - this.config.minDelayBetweenMessages;
      delay = this.config.minDelayBetweenMessages + Math.random() * range * 0.5;
    }

    // Add randomness to avoid patterns
    delay *= (0.8 + Math.random() * 0.4);

    return Math.round(delay);
  }

  /**
   * Reset hourly counters (call from cron job)
   */
  resetHourlyCounters(): void {
    for (const state of this.states.values()) {
      state.hourCount = 0;
    }
    console.log('[RateLimiter] Hourly counters reset');
  }

  /**
   * Reset daily counters (call from cron job)
   */
  resetDailyCounters(): void {
    for (const state of this.states.values()) {
      state.hourCount = 0;
      state.dayCount = 0;
      state.consecutiveHourlyLimits = 0;
    }
    console.log('[RateLimiter] Daily counters reset');
  }

  /**
   * Get current state for an account
   */
  getState(accountId: string): RateLimitState {
    return this.getOrCreateState(accountId);
  }

  /**
   * Cleanup state for an account (call when account is unregistered)
   */
  cleanupAccount(accountId: string): void {
    if (this.states.has(accountId)) {
      this.states.delete(accountId);
      console.log(`[RateLimiter] Cleaned up state for ${accountId}`);
    }
  }

  /**
   * Get number of tracked accounts (for monitoring)
   */
  getTrackedAccountsCount(): number {
    return this.states.size;
  }

  private getOrCreateState(accountId: string): RateLimitState {
    if (!this.states.has(accountId)) {
      this.states.set(accountId, {
        hourCount: 0,
        dayCount: 0,
        lastMessageTime: null,
        burstCount: 0,
        burstWindowStart: null,
        isThrottled: false,
        throttleUntil: null,
        consecutiveHourlyLimits: 0,
      });
    }
    return this.states.get(accountId)!;
  }

  private getTimeUntilNextHour(): number {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    return nextHour.getTime() - now.getTime();
  }

  private getTimeUntilNextDay(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime() - now.getTime();
  }

  private async updateDatabaseState(accountId: string, state: RateLimitState): Promise<void> {
    try {
      await db.whatsAppAccount.update({
        where: { id: accountId },
        data: {
          rateLimitHourCount: state.hourCount,
          rateLimitDayCount: state.dayCount,
          rateLimitHourReset: new Date(Date.now() + this.getTimeUntilNextHour()),
          rateLimitDayReset: new Date(Date.now() + this.getTimeUntilNextDay()),
        },
      });
    } catch (error: any) {
      console.error('[RateLimiter] Failed to update DB state:', error?.message || error);
    }
  }
}

// ==================== ANTI-BAN SYSTEM ====================

export class AntiBanSystem {
  private states: Map<string, AntiBanState> = new Map();

  /**
   * Check if action should be delayed for anti-ban
   */
  shouldDelayAction(accountId: string, action: 'send' | 'read' | 'typing'): { 
    shouldDelay: boolean; 
    delay: number;
    reason?: string;
  } {
    const state = this.getOrCreateState(accountId);
    const now = new Date();

    // Check if in cooldown
    if (state.cooldownActive && state.cooldownUntil) {
      if (now < state.cooldownUntil) {
        return {
          shouldDelay: true,
          delay: state.cooldownUntil.getTime() - now.getTime(),
          reason: 'Account in cooldown period',
        };
      } else {
        state.cooldownActive = false;
        state.cooldownUntil = null;
      }
    }

    // Calculate appropriate delay based on action
    switch (action) {
      case 'send':
        // Simulate human typing and thinking time
        const baseDelay = 2000 + Math.random() * 5000; // 2-7 seconds
        const typingDelay = state.lastTypingSimulation 
          ? Math.max(0, 1000 - (now.getTime() - state.lastTypingSimulation.getTime()))
          : 0;
        return {
          shouldDelay: true,
          delay: baseDelay + typingDelay,
        };

      case 'read':
        // Delay before marking as read (simulates reading time)
        const readDelay = state.readReceiptDelay || (2000 + Math.random() * 3000);
        return {
          shouldDelay: true,
          delay: readDelay,
        };

      case 'typing':
        // Typing simulation intervals
        const typingInterval = 500 + Math.random() * 1500; // 0.5-2 seconds
        return {
          shouldDelay: true,
          delay: typingInterval,
        };

      default:
        return { shouldDelay: false, delay: 0 };
    }
  }

  /**
   * Simulate human-like behavior before sending
   */
  async simulateHumanBehavior(accountId: string, socket: any): Promise<void> {
    const state = this.getOrCreateState(accountId);
    
    // Random chance of updating presence
    if (Math.random() > 0.7) {
      const presences = ['available', 'composing', 'recording', 'paused'];
      const presence = presences[Math.floor(Math.random() * presences.length)];
      
      try {
        // Simulate presence update
        // await socket.sendPresenceUpdate(presence);
        state.lastPresenceUpdate = new Date();
        console.log(`[AntiBan] ${accountId} presence: ${presence}`);
      } catch (error: any) {
        // Presence errors are non-critical, just log
        console.log(`[AntiBan] ${accountId} presence update failed:`, error?.message || 'unknown');
      }
    }

    // Simulate typing
    if (Math.random() > 0.5) {
      const typingDuration = 1000 + Math.random() * 3000;
      await new Promise(resolve => setTimeout(resolve, typingDuration));
      state.lastTypingSimulation = new Date();
    }
  }

  /**
   * Detect ban risk factors
   */
  async detectBanRisk(accountId: string): Promise<BanRiskFactors> {
    const account = await db.whatsAppAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      return {
        highMessageVolume: false,
        lowResponseRate: false,
        suspiciousPattern: false,
        rapidActions: false,
        newAccount: true,
        reportRisk: false,
      };
    }

    const sent = account.messagesSent || 0;
    const received = account.messagesReceived || 0;
    const ratio = received > 0 ? sent / received : sent;

    // Calculate risk factors
    const risks: BanRiskFactors = {
      highMessageVolume: sent > 100 && ratio > 3,
      lowResponseRate: received > 10 && sent / received < 0.3,  // Not responding
      suspiciousPattern: false, // Would need more analysis
      rapidActions: false,      // Would need timing analysis
      newAccount: this.isNewAccount(account.createdAt),
      reportRisk: ratio > 5 && sent > 50,
    };

    // Check for suspicious patterns
    const lastActivity = account.lastActivity;
    if (lastActivity) {
      const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (60 * 60 * 1000);
      if (hoursSinceActivity < 1 && sent > 20) {
        risks.rapidActions = true;
      }
    }

    return risks;
  }

  /**
   * Trigger cooldown for an account
   */
  triggerCooldown(accountId: string, duration: number, reason: string): void {
    const state = this.getOrCreateState(accountId);
    
    state.cooldownActive = true;
    state.cooldownUntil = new Date(Date.now() + duration);
    
    console.log(`[AntiBan] ${accountId} cooldown for ${duration / 60000} minutes: ${reason}`);
    
    // Increase mimicry level during cooldown
    state.mimicryLevel = Math.min(100, state.mimicryLevel + 20);
  }

  /**
   * Get anti-ban state for an account
   */
  getState(accountId: string): AntiBanState {
    return this.getOrCreateState(accountId);
  }

  /**
   * Update mimicry level based on account behavior
   */
  updateMimicryLevel(accountId: string, healthScore: number): void {
    const state = this.getOrCreateState(accountId);
    
    // Lower health = higher mimicry needed
    if (healthScore < 50) {
      state.mimicryLevel = Math.min(100, state.mimicryLevel + 10);
    } else if (healthScore > 80) {
      state.mimicryLevel = Math.max(0, state.mimicryLevel - 5);
    }

    // Update read receipt delay based on mimicry
    state.readReceiptDelay = 1000 + state.mimicryLevel * 50; // 1-6 seconds
  }

  /**
   * Cleanup state for an account (call when account is unregistered)
   */
  cleanupAccount(accountId: string): void {
    if (this.states.has(accountId)) {
      this.states.delete(accountId);
      console.log(`[AntiBan] Cleaned up state for ${accountId}`);
    }
  }

  /**
   * Get number of tracked accounts (for monitoring)
   */
  getTrackedAccountsCount(): number {
    return this.states.size;
  }

  private getOrCreateState(accountId: string): AntiBanState {
    if (!this.states.has(accountId)) {
      this.states.set(accountId, {
        cooldownActive: false,
        cooldownUntil: null,
        mimicryLevel: 50,
        lastTypingSimulation: null,
        lastPresenceUpdate: null,
        readReceiptDelay: 3000,
      });
    }
    return this.states.get(accountId)!;
  }

  private isNewAccount(createdAt: Date | null): boolean {
    if (!createdAt) return true;
    const daysSinceCreation = (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
    return daysSinceCreation < RISK_THRESHOLDS.accountAge.young;
  }
}

// ==================== EXPORT SINGLETONS ====================

export const rateLimiter = new RateLimiter();
export const antiBanSystem = new AntiBanSystem();

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate and update health score for an account
 */
export async function updateHealthScore(accountId: string): Promise<number> {
  const result = await HealthScoreCalculator.calculate(accountId);
  
  // Update in database
  await db.whatsAppAccount.update({
    where: { id: accountId },
    data: { healthScore: result.score },
  });

  // Update anti-ban mimicry
  antiBanSystem.updateMimicryLevel(accountId, result.score);

  // Trigger cooldown if critical
  if (result.riskLevel === 'critical') {
    antiBanSystem.triggerCooldown(
      accountId, 
      60 * 60 * 1000, // 1 hour
      'Critical health score - need rest'
    );
  }

  return result.score;
}

/**
 * Get comprehensive safety status for an account
 */
export async function getSafetyStatus(accountId: string): Promise<{
  health: HealthScoreResult;
  rateLimit: RateLimitState;
  antiBan: AntiBanState;
  banRisks: BanRiskFactors;
}> {
  const [health, banRisks] = await Promise.all([
    HealthScoreCalculator.calculate(accountId),
    antiBanSystem.detectBanRisk(accountId),
  ]);

  return {
    health,
    rateLimit: rateLimiter.getState(accountId),
    antiBan: antiBanSystem.getState(accountId),
    banRisks,
  };
}
