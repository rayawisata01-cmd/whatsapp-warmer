import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET - List event logs from database
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const type = url.searchParams.get('type');

    // Build where clause
    const where: any = {};
    if (type) {
      where.type = type;
    }

    const logs = await db.eventLog.findMany({
      where,
      take: limit,
      orderBy: {
        timestamp: 'desc',
      },
    });

    // Transform data for frontend
    const data = logs.map((log) => ({
      id: log.id,
      accountId: log.accountId,
      type: log.type,
      message: log.message,
      timestamp: log.timestamp,
    }));

    return NextResponse.json({ logs: data, total: data.length });
  } catch (error: any) {
    console.error('[DB API] Error fetching logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch logs', details: error.message },
      { status: 500 }
    );
  }
}
