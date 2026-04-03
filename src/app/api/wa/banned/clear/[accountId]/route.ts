/**
 * Clear Banned Status API Route
 * 
 * Clears the banned status for a specific account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await params;
    
    // Update account to remove banned status
    await db.whatsAppAccount.update({
      where: { id: accountId },
      data: {
        status: 'offline',
        pool: 'offline'
      }
    });
    
    return NextResponse.json({
      success: true,
      message: `Banned status cleared for ${accountId}`,
      accountId
    });
  } catch (error: any) {
    console.error('[API] Failed to clear banned status:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to clear banned status'
    }, { status: 500 });
  }
}
