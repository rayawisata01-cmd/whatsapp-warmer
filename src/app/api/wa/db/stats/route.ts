import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET - Get database statistics
export async function GET(request: NextRequest) {
  try {
    // Get counts
    const [
      accountsCount,
      sessionsCount,
      personalitiesCount,
      chatPairsCount,
      logsCount,
      messagesCount,
      bulkQueueCount,
    ] = await Promise.all([
      db.whatsAppAccount.count(),
      db.whatsAppSession.count(),
      db.personality.count(),
      db.chatPair.count(),
      db.eventLog.count(),
      db.message.count(),
      db.bulkQueue.count(),
    ]);

    // Get account status breakdown
    const accountsByStatus = await db.whatsAppAccount.groupBy({
      by: ['status'],
      _count: {
        id: true,
      },
    });

    // Get account pool breakdown
    const accountsByPool = await db.whatsAppAccount.groupBy({
      by: ['pool'],
      _count: {
        id: true,
      },
    });

    // Get total messages sent/received
    const messageStats = await db.whatsAppAccount.aggregate({
      _sum: {
        messagesSent: true,
        messagesReceived: true,
        autoResponsesSent: true,
      },
    });

    // Get average health score
    const healthStats = await db.whatsAppAccount.aggregate({
      _avg: {
        healthScore: true,
      },
      _min: {
        healthScore: true,
      },
      _max: {
        healthScore: true,
      },
    });

    // Get active chat pairs
    const activeChatPairs = await db.chatPair.count({
      where: {
        isActive: true,
      },
    });

    // Get pending bulk queue
    const pendingBulkQueue = await db.bulkQueue.count({
      where: {
        status: 'pending',
      },
    });

    // Get recent logs count (last 24 hours)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentLogsCount = await db.eventLog.count({
      where: {
        timestamp: {
          gte: yesterday,
        },
      },
    });

    // Get error logs count (last 24 hours)
    const errorLogsCount = await db.eventLog.count({
      where: {
        type: 'error',
        timestamp: {
          gte: yesterday,
        },
      },
    });

    const stats = {
      counts: {
        accounts: accountsCount,
        sessions: sessionsCount,
        personalities: personalitiesCount,
        chatPairs: chatPairsCount,
        logs: logsCount,
        messages: messagesCount,
        bulkQueue: bulkQueueCount,
      },
      accountsByStatus: accountsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count.id;
        return acc;
      }, {} as Record<string, number>),
      accountsByPool: accountsByPool.reduce((acc, item) => {
        acc[item.pool] = item._count.id;
        return acc;
      }, {} as Record<string, number>),
      messageStats: {
        totalSent: messageStats._sum.messagesSent || 0,
        totalReceived: messageStats._sum.messagesReceived || 0,
        totalAutoResponses: messageStats._sum.autoResponsesSent || 0,
      },
      healthStats: {
        average: Math.round(healthStats._avg.healthScore || 0),
        min: healthStats._min.healthScore || 0,
        max: healthStats._max.healthScore || 0,
      },
      chatPairs: {
        total: chatPairsCount,
        active: activeChatPairs,
      },
      bulkQueue: {
        pending: pendingBulkQueue,
      },
      logs: {
        last24h: recentLogsCount,
        errors24h: errorLogsCount,
      },
    };

    return NextResponse.json(stats);
  } catch (error: any) {
    console.error('[DB API] Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats', details: error.message },
      { status: 500 }
    );
  }
}
