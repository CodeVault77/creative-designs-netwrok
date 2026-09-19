import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';

/**
 * Every screen except the entry transition renders inside the shell.
 *
 * The shell is mounted ONCE here, above the route segments, so navigating
 * between tabs does not unmount the navigation. That is what keeps the tab
 * bar from flickering on every route change, and it is what will let the
 * map canvas survive a sheet opening over it in P4.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
