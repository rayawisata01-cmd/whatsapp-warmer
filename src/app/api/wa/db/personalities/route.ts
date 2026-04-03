import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET - List all personalities from database
export async function GET(request: NextRequest) {
  try {
    const personalities = await db.personality.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Transform data for frontend
    const data = personalities.map((p) => ({
      id: p.id,
      accountId: p.accountId,
      phoneNumber: p.phoneNumber,
      name: p.name,
      age: p.age,
      occupation: p.occupation,
      location: p.location,
      traits: p.traits,
      writingStyle: p.writingStyle,
      hobbies: p.hobbies,
      responseStyle: p.responseStyle,
      chronotype: p.chronotype,
      activeHoursStart: p.activeHoursStart,
      activeHoursEnd: p.activeHoursEnd,
      peakHours: p.peakHours,
      avgResponseTime: p.avgResponseTime,
      emojiUsage: p.emojiUsage,
      avgMessageLength: p.avgMessageLength,
      isInitiator: p.isInitiator,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return NextResponse.json({ personalities: data, total: data.length });
  } catch (error: any) {
    console.error('[DB API] Error fetching personalities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch personalities', details: error.message },
      { status: 500 }
    );
  }
}
