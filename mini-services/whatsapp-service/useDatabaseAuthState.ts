/**
 * Database-based Auth State for Baileys
 * 
 * This replaces useMultiFileAuthState to store WhatsApp session data
 * in PostgreSQL instead of files. This is essential for Railway free tier
 * which doesn't have persistent file storage.
 * 
 * The session data is stored in the WhatsAppSession table which persists
 * across container restarts.
 */

import { AuthenticationCreds, CacheStore, SignalDataTypeMap, initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';
import { db } from './db.js';

// Key types used by Baileys for signal protocol
type KeyType = 'pre-key' | 'session' | 'sender-key' | 'app-state-sync-key' | 'app-state-sync-version';

interface AuthState {
  creds: AuthenticationCreds;
  keys: CacheStore;
}

/**
 * Creates a database-backed auth state for Baileys
 * Compatible with Railway free tier - stores session in PostgreSQL
 */
export async function useDatabaseAuthState(accountId: string): Promise<{
  state: AuthState;
  saveCreds: () => Promise<void>;
  clearSession: () => Promise<void>;
}> {
  // Load existing session from database
  let session = await db.whatsAppSession.findUnique({
    where: { accountId }
  });

  // Parse or initialize credentials
  let creds: AuthenticationCreds;
  let keys: CacheStore;

  if (session?.creds) {
    try {
      creds = JSON.parse(session.creds, BufferJSON.reviver);
      console.log(`[DB-AUTH] Loaded existing credentials for ${accountId}`);
    } catch (error) {
      console.error(`[DB-AUTH] Failed to parse credentials, creating new:`, error);
      creds = initAuthCreds();
    }
  } else {
    console.log(`[DB-AUTH] No existing credentials, initializing new for ${accountId}`);
    creds = initAuthCreds();
  }

  // Parse or initialize keys
  let parsedKeys: Record<string, Record<string, any>> = {};
  if (session?.keys) {
    try {
      parsedKeys = JSON.parse(session.keys, BufferJSON.reviver);
    } catch (error) {
      console.error(`[DB-AUTH] Failed to parse keys, using empty:`, error);
      parsedKeys = {};
    }
  }

  // Create CacheStore implementation backed by database
  keys = {
    get: async <T>(type: KeyType, ids: string[]): Promise<{ [id: string]: T }> => {
      const result: { [id: string]: T } = {};
      const typeKey = type;
      
      for (const id of ids) {
        const key = `${typeKey}-${id}`;
        if (parsedKeys[key] !== undefined) {
          result[id] = parsedKeys[key] as T;
        }
      }
      return result;
    },
    
    set: async (data: { [type: string]: { [id: string]: any } }): Promise<void> => {
      for (const type in data) {
        for (const id in data[type]) {
          const key = `${type}-${id}`;
          parsedKeys[key] = data[type][id];
        }
      }
      // Persist to database
      await saveCreds();
    }
  };

  // Save credentials to database
  async function saveCreds(): Promise<void> {
    try {
      const credsJson = JSON.stringify(creds, BufferJSON.replacer);
      const keysJson = JSON.stringify(parsedKeys, BufferJSON.replacer);

      // Extract phone number from creds if available
      const phoneNumber = creds.me?.id?.split('@')[0] || null;

      await db.whatsAppSession.upsert({
        where: { accountId },
        create: {
          accountId,
          creds: credsJson,
          keys: keysJson,
          phoneNumber,
          lastSync: new Date()
        },
        update: {
          creds: credsJson,
          keys: keysJson,
          phoneNumber,
          lastSync: new Date()
        }
      });

      console.log(`[DB-AUTH] Credentials saved for ${accountId}`);
    } catch (error) {
      console.error(`[DB-AUTH] Failed to save credentials:`, error);
      throw error;
    }
  }

  // Clear session from database
  async function clearSession(): Promise<void> {
    try {
      await db.whatsAppSession.delete({
        where: { accountId }
      });
      console.log(`[DB-AUTH] Session cleared for ${accountId}`);
    } catch (error) {
      // Ignore if not found
      console.log(`[DB-AUTH] Session clear (may not exist): ${accountId}`);
    }
  }

  return {
    state: { creds, keys },
    saveCreds,
    clearSession
  };
}

/**
 * Check if session exists for an account
 */
export async function hasSession(accountId: string): Promise<boolean> {
  const session = await db.whatsAppSession.findUnique({
    where: { accountId },
    select: { id: true }
  });
  return !!session;
}

/**
 * Get phone number from stored session
 */
export async function getSessionPhone(accountId: string): Promise<string | null> {
  const session = await db.whatsAppSession.findUnique({
    where: { accountId },
    select: { phoneNumber: true }
  });
  return session?.phoneNumber || null;
}

/**
 * Find account ID by phone number (for reconnection)
 */
export async function findAccountByPhone(phoneNumber: string): Promise<string | null> {
  const session = await db.whatsAppSession.findFirst({
    where: { phoneNumber },
    select: { accountId: true }
  });
  return session?.accountId || null;
}

/**
 * Clean up old/incomplete sessions (no creds.me)
 */
export async function cleanIncompleteSessions(): Promise<number> {
  let cleaned = 0;
  const sessions = await db.whatsAppSession.findMany();
  
  for (const session of sessions) {
    try {
      const creds = JSON.parse(session.creds, BufferJSON.reviver);
      // If creds exists but no me, it's incomplete (QR was generated but never scanned)
      if (creds && !creds.me) {
        await db.whatsAppSession.delete({
          where: { id: session.id }
        });
        cleaned++;
        console.log(`[DB-AUTH] Cleaned incomplete session: ${session.accountId}`);
      }
    } catch (error) {
      // Invalid JSON, delete it
      await db.whatsAppSession.delete({
        where: { id: session.id }
      });
      cleaned++;
      console.log(`[DB-AUTH] Cleaned invalid session: ${session.accountId}`);
    }
  }
  
  return cleaned;
}
