import { NextRequest, NextResponse } from 'next/server';

const WHATSAPP_SERVICE = 'http://localhost:3030';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sid = url.searchParams.get('sid');
  const EIO = url.searchParams.get('EIO') || '4';

  let targetUrl = `${WHATSAPP_SERVICE}/socket.io/?EIO=${EIO}&transport=polling`;
  if (sid) {
    targetUrl += `&sid=${sid}`;
  }

  try {
    const headers: Record<string, string> = {};
    const cookie = request.headers.get('cookie');
    if (cookie) headers['cookie'] = cookie;

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
    });

    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Socket.io GET error:', error);
    return NextResponse.json({ error: 'Proxy error', details: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const sid = url.searchParams.get('sid');
  const EIO = url.searchParams.get('EIO') || '4';

  let targetUrl = `${WHATSAPP_SERVICE}/socket.io/?EIO=${EIO}&transport=polling`;
  if (sid) {
    targetUrl += `&sid=${sid}`;
  }

  try {
    const body = await request.text();

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=UTF-8',
    };
    const cookie = request.headers.get('cookie');
    if (cookie) headers['cookie'] = cookie;

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body,
    });

    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Socket.io POST error:', error);
    return NextResponse.json({ error: 'Proxy error', details: String(error) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
