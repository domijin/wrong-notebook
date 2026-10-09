"use client";

import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

export function usePasswordConfirmation() {
    const { language } = useLanguage();
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
                    <DialogTitle>{language === 'zh' ? '验证身份' : 'Confirm your identity'}</DialogTitle>
                    <DialogDescription>{language === 'zh' ? '请输入当前密码以执行管理操作。' : 'Enter your current password to perform this admin action.'}</DialogDescription>
                </DialogHeader>
                <form onSubmit={event => { event.preventDefault(); if (password) finish(true); }} className="space-y-4">
                    <Input type="password" autoComplete="current-password" autoFocus value={password}
                        aria-label={language === 'zh' ? '当前密码' : 'Current password'} onChange={event => setPassword(event.target.value)} />
                    <Button type="submit" disabled={!password}>{language === 'zh' ? '确认' : 'Confirm'}</Button>
                </form>
            </DialogContent>
        </Dialog>
    );
    return { confirmPassword, passwordDialog };
}
