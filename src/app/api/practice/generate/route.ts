import { acquireAIWork } from "@/lib/rate-limit";
import { getCurrentSession } from "@/lib/current-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAIService } from "@/lib/ai";
import { AI_SUBJECTS } from "@/lib/ai/schema";
import { notFound, internalError, unauthorized, badRequest } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:practice:generate');

export async function POST(req: Request) {
    const session = await getCurrentSession();

    if (!session?.user) {
        return unauthorized("Authentication required");
    }

    const work = acquireAIWork(session.user.id);
    if (work instanceof Response) return work;

    try {
        const { errorItemId, language, difficulty } = await req.json();
        if (typeof errorItemId !== 'string' || !errorItemId || errorItemId.length > 256) return badRequest("Invalid item id");

        const errorItemWithSubject = await prisma.errorItem.findFirst({
            where: { id: errorItemId, userId: session.user.id },
            include: { subject: true }
        });

        if (!errorItemWithSubject) {
            return notFound("Item not found");
        }

        let tags: string[] = [];
        try {
            tags = JSON.parse(errorItemWithSubject.knowledgePoints || "[]");
        } catch (e) {
            tags = [];
        }

        const aiService = getAIService();
        const similarQuestion = await aiService.generateSimilarQuestion(
            errorItemWithSubject.questionText || "",
            tags,
            language,
            difficulty || 'medium',
            errorItemWithSubject.gradeSemester
        );

        // Inject the subject from the database with type safety
        const subjectName = errorItemWithSubject.subject?.name || "其他";
        similarQuestion.subject = (AI_SUBJECTS as readonly string[]).includes(subjectName) ? subjectName as typeof AI_SUBJECTS[number] : "其他";

        return NextResponse.json(similarQuestion);
    } catch (error) {
        logger.error({ error }, 'Error generating practice');
        const errorMessage = error instanceof Error ? error.message : "Failed to generate practice question";
        return internalError(errorMessage);
    } finally {
        work.release();
    }
}
