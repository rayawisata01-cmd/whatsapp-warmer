import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Tier calculation based on message count
function calculateTier(messagesSent: number): { tier: number; tierName: string } {
  const total = messagesSent;
  if (total >= 500) return { tier: 5, tierName: 'Aged Pro' };
  if (total >= 300) return { tier: 4, tierName: 'High Quality' };
  if (total >= 200) return { tier: 3, tierName: 'Premium' };
  if (total >= 100) return { tier: 2, tierName: 'Regular' };
  return { tier: 1, tierName: 'Fresh Warmed' };
}

// Tier colors for frontend
const TIER_COLORS: Record<number, { bg: string; text: string; border: string }> = {
  1: { bg: 'bg-green-100 dark:bg-green-500/20', text: 'text-green-600 dark:text-green-400', border: 'border-green-200 dark:border-green-500/30' },
  2: { bg: 'bg-blue-100 dark:bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-500/30' },
  3: { bg: 'bg-purple-100 dark:bg-purple-500/20', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-500/30' },
  4: { bg: 'bg-orange-100 dark:bg-orange-500/20', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-500/30' },
  5: { bg: 'bg-yellow-100 dark:bg-yellow-500/20', text: 'text-yellow-600 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-500/30' },
};

// GET - Get accounts ready for results (minimum 50 messages)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tier = searchParams.get('tier'); // Filter by tier
    const search = searchParams.get('search'); // Search by phone/name
    const includeSold = searchParams.get('includeSold') === 'true'; // Include sold accounts

    // Get all accounts with their personalities
    const accounts = await db.whatsAppAccount.findMany({
      where: {
        messagesSent: { gte: 50 }, // Minimum 50 messages
        ...(tier ? { tier: parseInt(tier) } : {}),
        ...(includeSold ? {} : { soldAt: null }),
      },
      include: {
        personality: true,
      },
      orderBy: [
        { tier: 'desc' },
        { messagesSent: 'desc' },
      ],
    });

    // Filter by search if provided
    let filteredAccounts = accounts;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredAccounts = accounts.filter(acc => 
        acc.phoneNumber?.toLowerCase().includes(searchLower) ||
        acc.name?.toLowerCase().includes(searchLower) ||
        acc.personality?.name?.toLowerCase().includes(searchLower)
      );
    }

    // Update tier for each account (in case it changed)
    const accountsWithTier = filteredAccounts.map(acc => {
      const calculatedTier = calculateTier(acc.messagesSent);
      return {
        ...acc,
        tier: calculatedTier.tier,
        tierName: calculatedTier.tierName,
        tierColor: TIER_COLORS[calculatedTier.tier],
        totalMessages: acc.messagesSent + acc.messagesReceived,
        personalityName: acc.personality?.name || acc.name || acc.id,
      };
    });

    // Calculate summary stats
    const allAccounts = await db.whatsAppAccount.findMany({
      where: { messagesSent: { gte: 50 } },
    });

    const tierSummary = {
      t1: allAccounts.filter(a => calculateTier(a.messagesSent).tier === 1).length,
      t2: allAccounts.filter(a => calculateTier(a.messagesSent).tier === 2).length,
      t3: allAccounts.filter(a => calculateTier(a.messagesSent).tier === 3).length,
      t4: allAccounts.filter(a => calculateTier(a.messagesSent).tier === 4).length,
      t5: allAccounts.filter(a => calculateTier(a.messagesSent).tier === 5).length,
    };

    // Count low health accounts
    const lowHealthCount = filteredAccounts.filter(a => a.healthScore < 70).length;

    return NextResponse.json({
      accounts: accountsWithTier,
      summary: tierSummary,
      total: accountsWithTier.length,
      lowHealthCount,
    });
  } catch (error) {
    console.error('[Results API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch results' },
      { status: 500 }
    );
  }
}
