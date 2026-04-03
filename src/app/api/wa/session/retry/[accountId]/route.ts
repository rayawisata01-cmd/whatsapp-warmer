import { NextRequest, NextResponse } from 'next/server';

const WA_SERVICE_URL = 'http://localhost:3030';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await params;
    const body = await request.json().catch(() => ({}));

    const response = await fetch(`${WA_SERVICE_URL}/session/retry/${accountId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || 'Failed to retry connection' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Retry connection error:', error);
    return NextResponse.json(
      { error: 'Failed to retry connection' },
      { status: 500 }
    );
  }
}
