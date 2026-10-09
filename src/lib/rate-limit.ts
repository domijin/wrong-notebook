import { NextResponse } from "next/server";

const windows = new Map<string, { count: number; expires: number }>();
const active = new Map<string, number>();
let totalActive = 0;

export function consumeRateLimit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    for (const [id, entry] of windows) {
        if (entry.expires <= now) windows.delete(id);
    }
    let entry = windows.get(key);
    if (!entry) {
        if (windows.size >= 10000) return false;
        entry = { count: 0, expires: now + windowMs };
        windows.set(key, entry);
    }
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
}

export function acquireAIWork(userId: string): { release: () => void } | NextResponse {
    if (!consumeRateLimit(`ai:${userId}`, 20, 10 * 60 * 1000)) {
        return NextResponse.json({ message: "Too many AI requests" }, { status: 429, headers: { 'Retry-After': '600' } });
    }
    if (totalActive >= 4 || (active.get(userId) || 0) >= 2) {
        return NextResponse.json({ message: "AI service is busy" }, { status: 429, headers: { 'Retry-After': '10' } });
    }
    totalActive++;
    active.set(userId, (active.get(userId) || 0) + 1);
    let released = false;
    return { release: () => {
        if (released) return;
        released = true;
        totalActive--;
        const remaining = (active.get(userId) || 1) - 1;
        if (remaining) active.set(userId, remaining);
        else active.delete(userId);
    } };
}
