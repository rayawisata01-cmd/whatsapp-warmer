import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/connection-states
 * Fetch all connection states from the database
 * This is the persistence layer for Socket.io events
 * Critical for Railway deployment - clients fetch state on connect/reconnect
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get('accountId');

    if (accountId) {
      // Fetch single account state
      const state = await db.connectionState.findUnique({
        where: { accountId }
      });

      return NextResponse.json({
        success: true,
        state: state || null
      });
    }

    // Fetch all states
    const states = await db.connectionState.findMany({
      orderBy: { updatedAt: 'desc' }
    });

    return NextResponse.json({
      success: true,
      states
    });
  } catch (error) {
    console.error('[CONNECTION STATES] Error fetching states:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      states: []
    }, { status: 500 });
  }
}

/**
 * DELETE /api/connection-states
 * Delete a connection state (when account is deleted)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { accountId } = await request.json();

    if (!accountId) {
      return NextResponse.json({
        success: false,
        error: 'accountId is required'
      }, { status: 400 });
    }

    await db.connectionState.delete({
      where: { accountId }
    });

    return NextResponse.json({
      success: true
    });
  } catch (error) {
    console.error('[CONNECTION STATES] Error deleting state:', error);
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}
