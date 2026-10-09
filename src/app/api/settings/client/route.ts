import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import { getCurrentSession } from "@/lib/current-session";
import { unauthorized } from "@/lib/api-errors";

export async function GET() {
    if (!await getCurrentSession()) return unauthorized();
    const config = getAppConfig();
    return NextResponse.json({ timeouts: { analyze: config.timeouts?.analyze || 180000 } });
}
