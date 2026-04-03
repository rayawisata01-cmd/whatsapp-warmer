import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// DELETE - Clear old event logs
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '7');
    const type = url.searchParams.get('type');

    // Calculate cutoff date
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Build where clause
    const where: any = {
      timestamp: {
        lt: cutoffDate,
      },
    };

    if (type) {
      where.type = type;
    }

    const result = await db.eventLog.deleteMany({
      where,
    });

    return NextResponse.json({
      success: true,
      message: `Deleted ${result.count} logs older than ${days} days`,
      deletedCount: result.count,
    });
  } catch (error: any) {
    console.error('[DB API] Error cleaning logs:', error);
    return NextResponse.json(
      { error: 'Failed to clean logs', details: error.message },
      { status: 500 }
    );
  }
}
