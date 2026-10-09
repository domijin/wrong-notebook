import { NextResponse } from "next/server";
import { getAppConfig, updateAppConfig } from "@/lib/config";
import { getCurrentSession } from "@/lib/current-session";
import { adminAction } from "@/lib/admin-action";
import { settingsSchema, prepareSettings, sanitizeConfig } from "@/lib/settings-schema";
import { forbidden, badRequest, internalError } from "@/lib/api-errors";

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getCurrentSession();
    if (session?.user.role !== 'admin') return forbidden("Current active admin required");
    return NextResponse.json(sanitizeConfig(getAppConfig()), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
    return adminAction(req, 'settings.update', 'system', async () => {
        let input;
        try { input = settingsSchema.parse(await req.json()); }
        catch { return badRequest("Invalid settings or AI destination"); }
        let config;
        try { config = prepareSettings(input, getAppConfig()); }
        catch { return badRequest("Invalid OpenAI instance selection"); }
        try {
            return NextResponse.json(sanitizeConfig(updateAppConfig(config)), { headers: { 'Cache-Control': 'no-store' } });
        } catch { return internalError("Failed to update settings"); }
    });
}
