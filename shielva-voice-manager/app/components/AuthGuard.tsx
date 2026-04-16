"use client";

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../context/AuthContext';

// Pages that require authentication to access
const PROTECTED_PATHS: string[] = [];

// Pages that should redirect authenticated users away (e.g. login page)
const AUTH_REDIRECT_PATHS = ['/login'];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, isLoading } = useAuth();
    const pathname = usePathname();
    const router = useRouter();

    useEffect(() => {
        if (isLoading) return;

        // Redirect authenticated users away from the login page
        if (isAuthenticated && AUTH_REDIRECT_PATHS.some(p => pathname.startsWith(p))) {
            router.replace('/');
        }

        // Redirect unauthenticated users away from explicitly protected pages
        if (!isAuthenticated && PROTECTED_PATHS.some(p => pathname.startsWith(p))) {
            router.replace('/login');
        }
    }, [isAuthenticated, isLoading, pathname, router]);

    return <>{children}</>;
}
