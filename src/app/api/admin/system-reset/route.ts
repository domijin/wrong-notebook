import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAction } from "@/lib/admin-action";

export async function POST(req: Request) {
    return adminAction(req, 'system.reset', 'system', async session => {
        await prisma.$transaction(async tx => {
            await tx.practiceRecord.deleteMany({});
            await tx.errorItem.deleteMany({});
            await tx.subject.deleteMany({});
            await tx.knowledgeTag.deleteMany({ where: { isSystem: false } });
            await tx.user.deleteMany({ where: { id: { not: session.user.id } } });
            // The actor and all audit records survive reset.
        });
        return NextResponse.json({ success: true, message: "System reset complete" });
    });
}
