import { getCurrentSession } from "@/lib/current-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unauthorized, internalError, notFound, badRequest } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:error-items:notes');

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const session = await getCurrentSession();

    try {
        if (!session?.user) {
            return unauthorized("Authentication required");
        }

        const { userNotes } = await req.json();
        if (typeof userNotes !== 'string' || userNotes.length > 50000) return badRequest("Invalid notes");
        const owned = await prisma.errorItem.findFirst({ where: { id, userId: session.user.id } });
        if (!owned) return notFound("Item not found");

        const errorItem = await prisma.errorItem.update({
            where: {
                id: id,
                userId: session.user.id,
            },
            data: {
                userNotes: userNotes,
            },
        });

        return NextResponse.json(errorItem);
    } catch (error) {
        logger.error({ error }, 'Error updating notes');
        return internalError("Failed to update notes");
    }
}
