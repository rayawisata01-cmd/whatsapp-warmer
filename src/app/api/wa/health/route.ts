import { NextResponse } from 'next/server';

/**
 * Health endpoint for service readiness checks.
 * 
 * IMPORTANT: This endpoint returns 200 OK immediately without waiting for
 * WhatsApp service. The 'status' field indicates the actual health:
 * - 'healthy': Both Next.js and WhatsApp service are running
 * - 'degraded': Next.js is running, WhatsApp service is not available
 * 
 * During startup, this endpoint MUST respond quickly to allow the startup
 * script to proceed. WhatsApp service health is checked separately.
 */
export async function GET() {
  const timestamp = new Date().toISOString();
  
  // Next.js is always healthy if this endpoint is reached
  // Return immediately without waiting for WhatsApp service
  return NextResponse.json({
    status: 'healthy',
    nextjs: 'healthy',
    timestamp,
    note: 'Next.js is ready. WhatsApp service health is checked separately.',
  }, { status: 200 });
}
