/**
 * Bulk Queue Status API Route
 * 
 * Returns the status of bulk account creation queue.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    // Get queue stats from database
    const [total, completed, pending, failed] = await Promise.all([
      db.bulkQueue.count(),
      db.bulkQueue.count({ where: { status: 'completed' } }),
      db.bulkQueue.count({ where: { status: 'pending' } }),
      db.bulkQueue.count({ where: { status: 'failed' } }),
    ]);
    
    return NextResponse.json({
      success: true,
      summary: {
        total,
        completed,
        pending,
        failed,
        isProcessing: pending > 0
      }
    });
  } catch (error: any) {
    console.error('[API] Queue status error:', error);
    return NextResponse.json({
      success: true,
      summary: {
        total: 0,
        completed: 0,
        pending: 0,
        failed: 0,
        isProcessing: false
      }
    });
  }
}
