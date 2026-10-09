import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// JWT claims identify the account; the database decides its current permissions.
export async function getCurrentSession() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id || !Number.isInteger(session.user.sessionVersion)) return null;
        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { id: true, email: true, name: true, role: true, isActive: true, sessionVersion: true },
        });
        if (!user?.isActive || user.sessionVersion !== session.user.sessionVersion) return null;
        return { ...session, user: { ...session.user, ...user } };
    } catch {
        // A database/auth failure must never turn into an authorization bypass.
        return null;
    }
}
