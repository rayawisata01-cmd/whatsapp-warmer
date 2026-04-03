import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// DELETE - Delete an account and all related data
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    // Check if account exists
    const account = await db.whatsAppAccount.findUnique({
      where: { id },
    });

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Delete in order (due to foreign key constraints)
    // 1. Delete messages
    await db.message.deleteMany({
      where: {
        OR: [{ accountId: id }, { toAccountId: id }],
      },
    });

    // 2. Delete chat pairs
    await db.chatPair.deleteMany({
      where: {
        OR: [{ account1Id: id }, { account2Id: id }],
      },
    });

    // 3. Delete event logs (set accountId to null, they stay for history)
    await db.eventLog.updateMany({
      where: { accountId: id },
      data: { accountId: null },
    });

    // 4. Delete personality
    await db.personality.deleteMany({
      where: { accountId: id },
    });

    // 5. Delete session
    await db.whatsAppSession.deleteMany({
      where: { accountId: id },
    });

    // 6. Delete bulk queue entries
    await db.bulkQueue.deleteMany({
      where: { accountId: id },
    });

    // 7. Finally delete the account
    await db.whatsAppAccount.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: `Account ${id} and all related data deleted`,
    });
  } catch (error: any) {
    console.error('[DB API] Error deleting account:', error);
    return NextResponse.json(
      { error: 'Failed to delete account', details: error.message },
      { status: 500 }
    );
  }
}
