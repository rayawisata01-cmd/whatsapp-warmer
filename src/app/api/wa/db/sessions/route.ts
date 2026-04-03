import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET - List all sessions from database
export async function GET(request: NextRequest) {
  try {
    const sessions = await db.whatsAppSession.findMany({
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Transform data for frontend (hide sensitive creds/keys details)
    const data = sessions.map((s) => ({
      id: s.id,
      accountId: s.accountId,
      phoneNumber: s.phoneNumber,
      hasCreds: !!s.creds && s.creds.length > 10,
      hasKeys: !!s.keys && s.keys.length > 10,
      credsPreview: s.creds ? `${s.creds.substring(0, 50)}...` : null,
      lastSync: s.lastSync,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    return NextResponse.json({ sessions: data, total: data.length });
  } catch (error: any) {
    console.error('[DB API] Error fetching sessions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sessions', details: error.message },
      { status: 500 }
    );
  }
}
