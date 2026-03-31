import { NextRequest, NextResponse } from 'next/server';

const WHATSAPP_SERVICE = 'http://localhost:3030';

// CRITICAL: Timeout harus sinkron dengan Socket.io server pingTimeout (120s)
// Jika lebih pendek, proxy akan timeout sebelum server
const REQUEST_TIMEOUT = 120000; // 120 seconds - match server pingTimeout

// Socket.io protocol error codes
// Format: <packet-type><json-data>
// Packet type 4 = error message
const SOCKETIO_ERROR_PACKET = '4';

/**
 * Create a Socket.io compatible error response
 * Socket.io expects plain text in specific format, NOT JSON
 */
function createSocketioError(message: string, code: number = 500): NextResponse {
  // Socket.io error packet format: "4{json}"
  const errorPacket = `${SOCKETIO_ERROR_PACKET}${JSON.stringify({ message, code })}`;
  return new NextResponse(errorPacket, {
    status: 200, // Socket.io handles errors in packet, HTTP should be 200
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const transport = url.searchParams.get('transport') || 'polling';
  const sid = url.searchParams.get('sid');
  const EIO = url.searchParams.get('EIO') || '4';

  // Build target URL for WhatsApp service
  let targetUrl = `${WHATSAPP_SERVICE}/socket.io/?EIO=${EIO}&transport=${transport}`;
  if (sid) {
    targetUrl += `&sid=${sid}`;
  }

  try {
    const headers: Record<string, string> = {
      'Accept': '*/*',
      'Connection': 'keep-alive',
    };
    const cookie = request.headers.get('cookie');
    if (cookie) headers['cookie'] = cookie;

    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Connection': 'keep-alive',
        'Keep-Alive': 'timeout=120', // Match REQUEST_TIMEOUT
      },
    });
  } catch (error: any) {
    // Handle abort/timeout gracefully
    if (error.name === 'AbortError') {
      console.error('[Socket.io Proxy] GET timeout after', REQUEST_TIMEOUT, 'ms');
      // Return Socket.io compatible error, NOT JSON
      return createSocketioError('Request timeout', 408);
    }
    console.error('[Socket.io Proxy] GET error:', error?.message || error);
    return createSocketioError(error?.message || 'Service unavailable', 503);
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const sid = url.searchParams.get('sid');
  const EIO = url.searchParams.get('EIO') || '4';
  const transport = url.searchParams.get('transport') || 'polling';

  let targetUrl = `${WHATSAPP_SERVICE}/socket.io/?EIO=${EIO}&transport=${transport}`;
  if (sid) {
    targetUrl += `&sid=${sid}`;
  }

  try {
    const body = await request.text();

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Connection': 'keep-alive',
    };
    const cookie = request.headers.get('cookie');
    if (cookie) headers['cookie'] = cookie;

    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        'Access-Control-Allow-Origin': '*',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('[Socket.io Proxy] POST timeout after', REQUEST_TIMEOUT, 'ms');
      return createSocketioError('Request timeout', 408);
    }
    console.error('[Socket.io Proxy] POST error:', error?.message || error);
    return createSocketioError(error?.message || 'Service unavailable', 503);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Connection': 'keep-alive',
    },
  });
}
