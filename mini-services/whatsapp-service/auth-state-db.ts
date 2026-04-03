/**
 * Database-based Authentication State for Baileys
 *
 * This module replaces the file-based auth state with PostgreSQL storage.
 * It's designed for Railway free tier where volumes are not available.
 *
 * How it works:
 * 1. Credentials are stored in PostgreSQL (WhatsAppSession table)
 * 2. On startup, we load credentials from DB
 * 3. On credential update, we save to DB
 * 4. Session persists across container restarts!
 */

import { AuthenticationState, AuthenticationCreds, SignalKeyStore, SignalKeyStoreWithTransaction, initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { db } from './db.js';

/**
 * Create a SignalKeyStore that persists to database
 */
function createSignalKeyStore(accountId: string): SignalKeyStore {
  const getKeyString = (type: string, id: string) => `${type}-${id}`;

  return {
    async get(type: string, ids: string[]) {
      const result: { [id: string]: any } = {};

      try {
        const session = await db.whatsAppSession.findUnique({
          where: { accountId }
        });

        if (!session?.keys) return result;

        const keys = JSON.parse(session.keys) as Record<string, any>;

        for (const id of ids) {
          const keyStr = getKeyString(type, id);
          if (keys[keyStr] !== undefined) {
            result[id] = keys[keyStr];
          }
        }
      } catch (error) {
        console.error(`[AuthState] Error getting keys for ${accountId}:`, error);
      }

      return result;
    },

    async set(data: { [type: string]: { [id: string]: any } }) {
      try {
        const session = await db.whatsAppSession.findUnique({
          where: { accountId }
        });

        const existingKeys = session?.keys ? JSON.parse(session.keys) : {};

        // Merge new data
        for (const type in data) {
          for (const id in data[type]) {
            const keyStr = getKeyString(type, id);
            if (data[type][id] === null || data[type][id] === undefined) {
              delete existingKeys[keyStr];
            } else {
              existingKeys[keyStr] = data[type][id];
            }
          }
        }

        // Update database
        await db.whatsAppSession.upsert({
          where: { accountId },
          create: {
            accountId,
            keys: JSON.stringify(existingKeys),
            creds: '{}' // Will be filled later
          },
          update: {
            keys: JSON.stringify(existingKeys),
            updatedAt: new Date()
          }
        });
      } catch (error) {
        console.error(`[AuthState] Error setting keys for ${accountId}:`, error);
      }
    },

    async clear() {
      try {
        await db.whatsAppSession.update({
          where: { accountId },
          data: {
            keys: '{}',
            updatedAt: new Date()
          }
        });
      } catch (error) {
        console.error(`[AuthState] Error clearing keys for ${accountId}:`, error);
      }
    }
  };
}

/**
 * Create an AuthenticationState backed by PostgreSQL
 *
 * This replaces useMultiFileAuthState for Railway free tier
 */
export async function useDatabaseAuthState(accountId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearSession: () => Promise<void>;
}> {
  console.log(`[AuthState] Loading auth state from database for ${accountId}`);

  // Try to load existing session from database
  let session = await db.whatsAppSession.findUnique({
    where: { accountId }
  });

  let creds: AuthenticationCreds;

  if (session?.creds) {
    try {
      creds = JSON.parse(session.creds, BufferJSON.reviver);
      console.log(`[AuthState] ✅ Found existing credentials in database for ${accountId}`);
      console.log(`[AuthState] - creds.me exists: ${!!creds?.me}`);
      console.log(`[AuthState] - creds.me.id: ${creds?.me?.id || 'N/A'}`);
    } catch (error) {
      console.error(`[AuthState] Failed to parse creds, creating new:`, error);
      creds = initAuthCreds();
    }
  } else {
    console.log(`[AuthState] No existing credentials found, initializing new for ${accountId}`);
    creds = initAuthCreds();
  }

  // Create signal key store
  const keys = createSignalKeyStore(accountId);

  // Ensure session row exists
  if (!session) {
    try {
      session = await db.whatsAppSession.create({
        data: {
          accountId,
          creds: JSON.stringify(creds, BufferJSON.replacer),
          keys: '{}'
        }
      });
      console.log(`[AuthState] ✅ Created new session row for ${accountId}`);
    } catch (error: any) {
      // Handle race condition - another process might have created it
      if (error.code === 'P2002') {
        console.log(`[AuthState] Session already exists for ${accountId}, fetching...`);
        session = await db.whatsAppSession.findUnique({
          where: { accountId }
        });
      } else {
        throw error;
      }
    }
  }

  // Save credentials function
  const saveCreds = async () => {
    try {
      const credsJson = JSON.stringify(creds, BufferJSON.replacer);

      await db.whatsAppSession.update({
        where: { accountId },
        data: {
          creds: credsJson,
          updatedAt: new Date(),
          lastSync: new Date()
        }
      });

      console.log(`[AuthState] ✅ Credentials saved to database for ${accountId}`);
    } catch (error) {
      console.error(`[AuthState] ❌ Failed to save credentials for ${accountId}:`, error);
    }
  };

  // Clear session function
  const clearSession = async () => {
    try {
      await db.whatsAppSession.delete({
        where: { accountId }
      });
      console.log(`[AuthState] ✅ Session cleared from database for ${accountId}`);
    } catch (error: any) {
      if (error.code !== 'P2025') { // Not found is OK
        console.error(`[AuthState] ❌ Failed to clear session for ${accountId}:`, error);
      }
    }
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      ...keys,
      // Add transaction support (no-op for now, but required by interface)
      transaction: async (fn) => {
        return await fn();
      }
    } as SignalKeyStoreWithTransaction
  };

  return {
    state,
    saveCreds,
    clearSession
  };
}

/**
 * Load all sessions from database
 * Useful for startup to reconnect all accounts
 */
export async function loadAllSessionsFromDB(): Promise<string[]> {
  try {
    const sessions = await db.whatsAppSession.findMany({
      select: { accountId: true }
    });
    return sessions.map(s => s.accountId);
  } catch (error) {
    console.error('[AuthState] Failed to load sessions from database:', error);
    return [];
  }
}

/**
 * Get phone number from session in database
 */
export async function getPhoneFromSession(accountId: string): Promise<string | null> {
  try {
    const session = await db.whatsAppSession.findUnique({
      where: { accountId }
    });

    if (session?.creds) {
      const creds = JSON.parse(session.creds, BufferJSON.reviver);
      if (creds?.me?.id) {
        return creds.me.id.split('@')[0];
      }
    }
    return null;
  } catch (error) {
    console.error(`[AuthState] Failed to get phone for ${accountId}:`, error);
    return null;
  }
}

/**
 * Update phone number in session
 */
export async function updateSessionPhone(accountId: string, phoneNumber: string): Promise<void> {
  try {
    await db.whatsAppSession.update({
      where: { accountId },
      data: {
        phoneNumber,
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error(`[AuthState] Failed to update phone for ${accountId}:`, error);
  }
}
