import { NextRequest, NextResponse } from 'next/server';

const WHATSAPP_SERVICE = 'http://localhost:3030';

// Store active socket sessions
const sessions = new Map<string, { sid: string; lastPing: number }>();

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const transport = url.searchParams.get('transport');
  const sid = url.searchParams.get('sid');
  
  // Handle polling
  if (transport === 'polling') {
    if (sid) {
      // Long polling for existing session - just return empty for now
      // In production, this would wait for new events
      return new NextResponse('1', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=UTF-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    
    // New session
    const targetUrl = `${WHATSAPP_SERVICE}/socket.io/?EIO=4&transport=polling`;
    
    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
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
      console.error('Socket.io proxy error:', error);
      return NextResponse.json({ error: 'Proxy error' }, { status: 500 });
    }
  }
  
  return NextResponse.json({ error: 'Invalid transport' }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const sid = url.searchParams.get('sid');
  
  // Forward to WhatsApp service
  let targetUrl = `${WHATSAPP_SERVICE}/socket.io/?EIO=4&transport=polling`;
  if (sid) {
    targetUrl += `&sid=${sid}`;
  }
  
  try {
    const body = await request.text();
    
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
      },
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
    console.error('Socket.io proxy POST error:', error);
    return NextResponse.json({ error: 'Proxy error' }, { status: 500 });
  }
}
