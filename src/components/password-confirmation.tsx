"use client";

import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

export function usePasswordConfirmation() {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState('');
    const pending = useRef<((value: { headers: Record<string, string> } | null) => void) | null>(null);
    const finish = (confirmed: boolean) => {
        pending.current?.(confirmed ? { headers: { 'x-reauth-password': password } } : null);
        pending.current = null;
        setPassword('');
        setOpen(false);
    };
    const confirmPassword = () => new Promise<{ headers: Record<string, string> } | null>(resolve => {
        pending.current = resolve;
        setOpen(true);
    });
    const passwordDialog = (
        <Dialog open={open} onOpenChange={value => { if (!value) finish(false); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t.passwordConfirm?.title}</DialogTitle>
                    <DialogDescription>{t.passwordConfirm?.desc}</DialogDescription>
                </DialogHeader>
                <form onSubmit={event => { event.preventDefault(); if (password) finish(true); }} className="space-y-4">
                    <Input type="password" autoComplete="current-password" autoFocus value={password}
                        aria-label={t.passwordConfirm?.label} onChange={event => setPassword(event.target.value)} />
                    <Button type="submit" disabled={!password}>{t.passwordConfirm?.submit}</Button>
                </form>
            </DialogContent>
        </Dialog>
    );
    return { confirmPassword, passwordDialog };
}
