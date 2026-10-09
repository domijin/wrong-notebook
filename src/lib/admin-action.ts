import { compare } from "bcryptjs";
import { getCurrentSession } from "@/lib/current-session";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { forbidden, internalError } from "@/lib/api-errors";
import { NextResponse } from "next/server";

type CurrentSession = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
const RECENT_AUTH_MS = 5 * 60 * 1000;

export async function adminAction(
    req: Request, action: string, target: string,
    perform: (session: CurrentSession) => Promise<Response>
): Promise<Response> {
    // Only fixed metadata is persisted. Never log bodies, passwords, or provider keys.
    let auditId: string | undefined;
    try {
        const session = await getCurrentSession();
        const audit = await prisma.auditLog.create({
            data: { actorId: session?.user.id, action, target, result: 'pending' },
        });
        auditId = audit.id;
        let response: Response;
        if (session?.user.role !== 'admin') {
            response = forbidden("Current active admin required");
        } else {
            const authenticatedAt = session.user.authenticatedAt;
            const recent = typeof authenticatedAt === 'number' && authenticatedAt <= Date.now()
                && Date.now() - authenticatedAt < RECENT_AUTH_MS;
            const password = req.headers.get('x-reauth-password');
            let verified = recent;
            if (password) {
                verified = false;
            }
            if (password && Buffer.byteLength(password) <= 72 && consumeRateLimit(`reauth:${session.user.id}`, 6, 60000)) {
                const user = await prisma.user.findUnique({ where: { id: session.user.id } });
                verified = !!user?.isActive && user.role === 'admin'
                    && user.sessionVersion === session.user.sessionVersion && await compare(password, user.password);
            }
            response = verified ? await perform(session) : NextResponse.json({
                message: "Re-enter your current password to continue", code: "REAUTH_REQUIRED",
            }, { status: 403 });
        }
        await prisma.auditLog.update({ where: { id: auditId }, data: { result: response.ok ? 'success' : response.status >= 500 ? 'failure' : 'denied' } });
        return response;
    } catch {
        if (auditId) {
            await prisma.auditLog.update({ where: { id: auditId }, data: { result: 'failure' } }).catch(() => {});
        }
        return internalError("Admin action failed");
    }
}
