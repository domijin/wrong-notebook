import { getCurrentSession } from "@/lib/current-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:error-items:clear');

export async function DELETE(req: Request) {
    const session = await getCurrentSession();

    if (!session || !session.user) {
        return unauthorized();
    }

    // @ts-ignore
    const userId = session.user.id;

    try {
        // Delete all error items for this user
        await prisma.errorItem.deleteMany({
            where: { userId }
        });

        return NextResponse.json({ message: "Error data cleared successfully" });
    } catch (error) {
        logger.error({ error }, 'Error clearing error data');
        return internalError("Failed to clear error data");
    }
}
