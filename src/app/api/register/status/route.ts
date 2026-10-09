import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";

export async function GET() {
    try {
        return NextResponse.json({ allowRegistration: getAppConfig().allowRegistration === true });
    } catch {
        return NextResponse.json({ allowRegistration: false });
    }
}
