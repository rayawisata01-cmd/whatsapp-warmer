import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET - List all chat pairs from database
export async function GET(request: NextRequest) {
  try {
    const chatPairs = await db.chatPair.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Transform data for frontend
    const data = chatPairs.map((cp) => ({
      id: cp.id,
      account1Id: cp.account1Id,
      account2Id: cp.account2Id,
      startedAt: cp.startedAt,
      lastMessageAt: cp.lastMessageAt,
      messageCount: cp.messageCount,
      currentTopic: cp.currentTopic,
      topicCategory: cp.topicCategory,
      topicsDiscussed: cp.topicsDiscussed,
      relationshipStage: cp.relationshipStage,
      sharedInterests: cp.sharedInterests,
      silenceCount: cp.silenceCount,
      isActive: cp.isActive,
      endedAt: cp.endedAt,
      createdAt: cp.createdAt,
      updatedAt: cp.updatedAt,
    }));

    return NextResponse.json({ chatPairs: data, total: data.length });
  } catch (error: any) {
    console.error('[DB API] Error fetching chat pairs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch chat pairs', details: error.message },
      { status: 500 }
    );
  }
}
