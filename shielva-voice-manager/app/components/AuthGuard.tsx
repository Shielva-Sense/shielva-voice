"use client";

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import { redirectToOrgSetup } from '../lib/login-redirect';

// Pages that require authentication to access
const PROTECTED_PATHS: string[] = [];

// Pages that should redirect authenticated users away (e.g. login page)
const AUTH_REDIRECT_PATHS = ['/login'];

// Never bounce someone off these while a sign-in is still completing, or the
// org-setup hop would fight the callback that is establishing the session.
const AUTH_FLOW_PATHS = ['/login', '/auth/callback'];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, isLoading, user } = useAuth();
    const pathname = usePathname();
    const router = useRouter();

    // A SIGNED-IN user with no organisation must name one before going further.
    // identity deliberately creates no tenant for voice signups
    // (`requires_own_organisation`) precisely so this step runs.
    //
    // Scoped to signed-in users only: voice serves anonymous trials, and an
    // anonymous visitor has no organisation by definition — bouncing them to
    // signup would break the public surface.
    const needsOrgSetup =
        !isLoading &&
        isAuthenticated &&
        (user?.tenants?.length ?? 0) === 0 &&
        !AUTH_FLOW_PATHS.some((p) => pathname.startsWith(p));

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

        if (needsOrgSetup) {
            void redirectToOrgSetup();
        }
    }, [isAuthenticated, isLoading, pathname, router, needsOrgSetup]);

    // Withhold the page while leaving, so voice does not paint behind a redirect
    // the way ARC's dashboard used to.
    if (needsOrgSetup) return null;

    return <>{children}</>;
}
