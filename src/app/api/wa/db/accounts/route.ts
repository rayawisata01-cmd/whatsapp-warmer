import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET - List all accounts from database
export async function GET(request: NextRequest) {
  try {
    const accounts = await db.whatsAppAccount.findMany({
      include: {
        personality: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Transform data for frontend
    const data = accounts.map((acc) => ({
      id: acc.id,
      phoneNumber: acc.phoneNumber,
      name: acc.name,
      profilePicture: acc.profilePicture,
      status: acc.status,
      warmingEnabled: acc.warmingEnabled,
      pool: acc.pool,
      poolSince: acc.poolSince,
      lastSeen: acc.lastSeen,
      warmingStartTime: acc.warmingStartTime,
      messagesSent: acc.messagesSent,
      messagesReceived: acc.messagesReceived,
      autoResponsesSent: acc.autoResponsesSent,
      healthScore: acc.healthScore,
      currentPhase: acc.currentPhase,
      warmingDays: acc.warmingDays,
      lastActivity: acc.lastActivity,
      isInActiveWindow: acc.isInActiveWindow,
      currentChatPartnerId: acc.currentChatPartnerId,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt,
      personality: acc.personality
        ? {
            name: acc.personality.name,
            age: acc.personality.age,
            occupation: acc.personality.occupation,
            location: acc.personality.location,
            chronotype: acc.personality.chronotype,
          }
        : null,
    }));

    return NextResponse.json({ accounts: data, total: data.length });
  } catch (error: any) {
    console.error('[DB API] Error fetching accounts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch accounts', details: error.message },
      { status: 500 }
    );
  }
}
