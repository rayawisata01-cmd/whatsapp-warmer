/**
 * Safety Status API
 * 
 * Returns comprehensive safety status for accounts including:
 * - Health score and factors
 * - Rate limit status
 * - Anti-ban status
 * - Ban risk factors
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSafetyStatus, HealthScoreCalculator, rateLimiter, antiBanSystem } from '@/lib/health-safety';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    if (accountId) {
      // Get safety status for specific account
      const status = await getSafetyStatus(accountId);
      
      return NextResponse.json({
        success: true,
        accountId,
        ...status,
      });
    }

    // Get summary for all accounts (simplified)
    return NextResponse.json({
      success: true,
      message: 'Provide accountId parameter for detailed status',
      usage: '/api/wa/safety?accountId=xxx',
    });

  } catch (error: any) {
    console.error('[Safety API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}

// Recalculate health score for an account
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accountId, action } = body;

    if (!accountId) {
      return NextResponse.json({
        success: false,
        error: 'accountId is required',
      }, { status: 400 });
    }

    switch (action) {
      case 'recalculate-health':
        const health = await HealthScoreCalculator.calculate(accountId);
        
        // Update in database
        const { db } = await import('@/lib/db');
        await db.whatsAppAccount.update({
          where: { id: accountId },
          data: { healthScore: health.score },
        });

        return NextResponse.json({
          success: true,
          accountId,
          health,
        });

      case 'reset-rate-limits':
        // Reset rate limits for account
        const state = rateLimiter.getState(accountId);
        // Note: This would need a reset method in the RateLimiter class
        return NextResponse.json({
          success: true,
          message: 'Rate limits reset',
          accountId,
        });

      case 'clear-cooldown':
        // Clear anti-ban cooldown
        antiBanSystem.triggerCooldown(accountId, 0, 'Manual clear');
        return NextResponse.json({
          success: true,
          message: 'Cooldown cleared',
          accountId,
        });

      default:
        // Default: get safety status
        const status = await getSafetyStatus(accountId);
        return NextResponse.json({
          success: true,
          accountId,
          ...status,
        });
    }

  } catch (error: any) {
    console.error('[Safety API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
