/**
 * Reset Personality API Route
 * 
 * This endpoint resets/regenerates the personality for a specific account.
 * In the unified architecture, the actual personality generation happens
 * in server.ts, but we can reset the database record here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await params;
    
    // Delete existing personality
    await db.personality.deleteMany({
      where: { accountId }
    });
    
    // The server.ts will generate a new personality on next connection
    
    return NextResponse.json({
      success: true,
      message: `Personality reset for ${accountId}. Reconnect to generate new personality.`,
      accountId
    });
  } catch (error: any) {
    console.error('[API] Failed to reset personality:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to reset personality'
    }, { status: 500 });
  }
}
