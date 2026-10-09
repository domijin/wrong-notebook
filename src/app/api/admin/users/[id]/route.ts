import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminAction } from "@/lib/admin-action";
import { badRequest, notFound } from "@/lib/api-errors";
import { z } from "zod";

const updateSchema = z.object({
    isActive: z.boolean().optional(),
    role: z.enum(['admin', 'user']).optional(),
}).strict().refine(body => body.isActive !== undefined || body.role !== undefined);
const publicUser = { id: true, name: true, email: true, role: true, isActive: true, createdAt: true } as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return adminAction(req, 'user.update', id, async session => {
        let data;
        try { data = updateSchema.parse(await req.json()); }
        catch { return badRequest("Invalid user update"); }
        if (id === session.user.id && (data.isActive === false || data.role === 'user')) {
            return badRequest("Cannot disable or demote your own account");
        }
        return prisma.$transaction(async tx => {
            const target = await tx.user.findUnique({ where: { id } });
            if (!target) return notFound("User not found");
            if (target.role === 'admin' && target.isActive && (data.isActive === false || data.role === 'user')
                && await tx.user.count({ where: { role: 'admin', isActive: true } }) <= 1) {
                return badRequest("Cannot remove the last active admin");
            }
            const revoke = data.isActive === false || (data.role !== undefined && data.role !== target.role);
            const user = await tx.user.update({
                where: { id }, data: { ...data, ...(revoke && { sessionVersion: { increment: 1 } }) }, select: publicUser,
            });
            return NextResponse.json(user);
        });
    });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return adminAction(req, 'user.delete', id, async session => {
        if (id === session.user.id) return badRequest("Cannot delete your own account");
        return prisma.$transaction(async tx => {
            const target = await tx.user.findUnique({ where: { id } });
            if (!target) return notFound("User not found");
            if (target.role === 'admin' && target.isActive
                && await tx.user.count({ where: { role: 'admin', isActive: true } }) <= 1) {
                return badRequest("Cannot remove the last active admin");
            }
            const user = await tx.user.delete({ where: { id }, select: publicUser });
            return NextResponse.json(user);
        });
    });
}
