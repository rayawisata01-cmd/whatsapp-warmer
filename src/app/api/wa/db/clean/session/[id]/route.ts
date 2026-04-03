import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// DELETE - Delete a session (forces QR re-scan)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    // Delete session by accountId
    const result = await db.whatsAppSession.deleteMany({
      where: { accountId: id },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `Session for account ${id} deleted. User will need to scan QR again.`,
    });
  } catch (error: any) {
    console.error('[DB API] Error deleting session:', error);
    return NextResponse.json(
      { error: 'Failed to delete session', details: error.message },
      { status: 500 }
    );
  }
}
