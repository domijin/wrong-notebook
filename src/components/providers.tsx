"use client";

import { LanguageProvider } from "@/contexts/LanguageContext";
import { SessionProvider } from "next-auth/react";
import { AppTitle } from "@/components/app-title";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            <LanguageProvider>
                <AppTitle />
                {children}
            </LanguageProvider>
        </SessionProvider>
    );
}
