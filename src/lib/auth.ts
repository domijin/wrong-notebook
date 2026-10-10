import { NextAuthOptions } from "next-auth"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import { compare } from "bcryptjs"
import { createLogger } from "@/lib/logger"
import { consumeRateLimit } from "@/lib/rate-limit"
import { clearFailures, clientIpFromHeaders, getLockout, recordFailure, throttleKeys } from "@/lib/login-throttle"

const logger = createLogger('auth');

// 邮箱不存在时也做一次同等成本的 bcrypt 比对，避免通过响应时间探测哪些邮箱已注册
const DUMMY_PASSWORD_HASH = '$2b$12$8glo.QvnPXMSb0nms0tbfex7LuLVp5HDRMnNOX7Nsu.wnCETikY4S';

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prisma),
    session: {
        strategy: "jwt",
    },
    // @ts-expect-error trustHost is a valid option in newer NextAuth versions but types might be lagging
    trustHost: true,
    pages: {
        signIn: "/login",
    },
    // Force using a single cookie name to avoid HTTP/HTTPS mismatches in proxy environments
    // This allows running without NEXTAUTH_URL behind Cloudflare Tunnel
    cookies: {
        sessionToken: {
            name: "next-auth.session-token",
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                // Only use secure cookies if explicitly running on HTTPS (via NEXTAUTH_URL)
                // This enables HTTP local IP access in Docker/Production if NEXTAUTH_URL is unset
                secure: process.env.NODE_ENV === "production" && process.env.NEXTAUTH_URL?.startsWith("https"),
            },
        },
    },
    providers: [
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials, req) {
                logger.debug({ email: credentials?.email }, 'Authorize called');
                if (!credentials?.email || !credentials?.password) {
                    logger.debug('Missing credentials');
                    return null
                }

                if (Buffer.byteLength(credentials.password) > 72 || credentials.email.length > 254
                    || !consumeRateLimit('login:global', 100, 15 * 60000)) return null;

                const keys = throttleKeys(credentials.email, clientIpFromHeaders(req?.headers));
                const lockedUntil = await getLockout(keys);
                if (lockedUntil) {
                    logger.warn({ lockedUntil }, 'Login throttled');
                    throw new Error("TooManyAttempts")
                }

                const user = await prisma.user.findUnique({
                    where: {
                        email: credentials.email
                    }
                })

                if (!user) {
                    logger.debug('User not found');
                    await compare(credentials.password, DUMMY_PASSWORD_HASH)
                    await recordFailure(keys)
                    return null
                }

                // Check if user is active
                if (!user.isActive) {
                    logger.warn('User is disabled');
                    throw new Error("Account is disabled")
                }

                const isPasswordValid = await compare(credentials.password, user.password)

                if (!isPasswordValid) {
                    logger.debug('Invalid password');
                    await recordFailure(keys)
                    return null
                }

                await clearFailures(keys[0])

                logger.info({ email: user.email }, 'Login successful');

                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    sessionVersion: user.sessionVersion,
                    authenticatedAt: Date.now(),
                }
            }
        })
    ],
    // Enable debug messages in the console
    debug: process.env.NODE_ENV !== 'production',
    logger: {
        error(code, metadata) {
            logger.error({ code, metadata }, 'NextAuth error');
        },
        warn(code) {
            logger.warn({ code }, 'NextAuth warning');
        },
        debug(code, metadata) {
            logger.debug({ code, metadata }, 'NextAuth debug');
        }
    },
    callbacks: {
        async session({ session, token }) {
            logger.debug({ userId: token.id }, 'Session callback');
            return {
                ...session,
                user: {
                    ...session.user,
                    id: token.id,
                    role: token.role,
                    sessionVersion: token.sessionVersion as number,
                    authenticatedAt: token.authenticatedAt,
                }
            }
        },
        async jwt({ token, user }) {
            if (user) {
                logger.debug({ userId: user.id }, 'JWT callback - Initial signin');
                return {
                    ...token,
                    id: user.id,
                    role: user.role,
                    sessionVersion: user.sessionVersion,
                    authenticatedAt: user.authenticatedAt,
                }
            }
            logger.debug('JWT callback - Subsequent call');
            return token
        }
    }
}

// Log startup check
logger.info({
    NODE_ENV: process.env.NODE_ENV,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    HAS_SECRET: !!process.env.NEXTAUTH_SECRET,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST
}, 'AuthConfig loading');
