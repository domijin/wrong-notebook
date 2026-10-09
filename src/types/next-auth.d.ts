import { DefaultSession } from "next-auth"

declare module "next-auth" {
    interface Session {
        user: {
            id: string
            role?: string
            sessionVersion?: number
            authenticatedAt?: number
        } & DefaultSession["user"]
    }

    interface User {
        role?: string
        isActive?: boolean
        sessionVersion?: number
        authenticatedAt?: number
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        id: string
        role?: string
        sessionVersion?: number
        authenticatedAt?: number
    }
}
