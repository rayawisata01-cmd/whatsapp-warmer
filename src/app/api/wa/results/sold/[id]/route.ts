import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST - Mark account as sold
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { soldTo } = body;

    const account = await db.whatsAppAccount.update({
      where: { id },
      data: {
        soldAt: new Date(),
        soldTo: soldTo || null,
      },
    });

    return NextResponse.json({
      success: true,
      account,
    });
  } catch (error) {
    console.error('[Mark Sold API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to mark as sold' },
      { status: 500 }
    );
  }
}

// DELETE - Unmark as sold
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const account = await db.whatsAppAccount.update({
      where: { id },
      data: {
        soldAt: null,
        soldTo: null,
      },
    });

    return NextResponse.json({
      success: true,
      account,
    });
  } catch (error) {
    console.error('[Unmark Sold API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to unmark as sold' },
      { status: 500 }
    );
  }
}
