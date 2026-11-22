'use client';

import NextLink from 'next/link';
import NextForm from 'next/form';
import { useRouter as useNextRouter } from 'next/navigation';
import { forwardRef, useMemo, type ComponentPropsWithoutRef } from 'react';

// These views are all rendered by the same client Screen in the catch-all page.
// Unknown destinations keep Next/browser behavior instead of assuming client data.
const appPath =
  /^(?:\/|\/(?:admin\/moderation|login|register|verify-email|forgot-password|reset-password|search|charts|new-releases|history|notifications|settings|artists|library(?:\/liked)?|playlists(?:\/[A-Za-z0-9_-]+)?|(?:tracks|artists|profile|profiles)\/[A-Za-z0-9_-]+|studio(?:\/tracks\/[A-Za-z0-9_-]+)?|oauth\/complete)\/?)$/;

function appURL(href: string): URL | null {
  if (!href.trim() || href.trim().startsWith('#')) return null;
  try {
    const current =
      typeof window === 'undefined'
        ? new URL('https://infosound.invalid/')
        : new URL(window.location.href);
    const next = new URL(href, current);
    return next.origin === current.origin &&
      !next.username &&
      !next.password &&
      appPath.test(next.pathname)
      ? next
      : null;
  } catch {
    return null;
  }
}

type NavigationOptions = { replace?: boolean; scroll?: boolean };
let navigationFrame: number | undefined;

/** Returns false for destinations that must retain the framework/browser path. */
export function navigateApp(
  href: string,
  { replace = false, scroll = true }: NavigationOptions = {},
): boolean {
  if (typeof window === 'undefined') return false;
  const next = appURL(href);
  if (!next) return false;
  const previousPath = window.location.pathname;
  const destination = next.pathname + next.search + next.hash;
  // Next's native-history integration copies its own private state. Supplying
  // history.state ourselves would skip its pathname/search-param synchronization.
  if (next.href !== window.location.href) {
    if (replace) window.history.replaceState(null, '', destination);
    else window.history.pushState(null, '', destination);
  }
  if (navigationFrame !== undefined) window.cancelAnimationFrame(navigationFrame);
  navigationFrame = window.requestAnimationFrame(() => {
    navigationFrame = undefined;
    if (window.location.href !== next.href) return;
    if (scroll) {
      const target = next.hash ? document.getElementById(decodeHash(next.hash)) : null;
      if (target) target.scrollIntoView();
      else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
    if (previousPath !== next.pathname)
      document.getElementById('main-content')?.focus({ preventScroll: true });
  });
  return true;
}

function decodeHash(hash: string) {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

type AppLinkProps = ComponentPropsWithoutRef<typeof NextLink>;

/** Keep real anchors and Next's modified-click/download/caller-cancellation rules. */
const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink(
  { href, as, onNavigate, prefetch, replace, scroll, ...props },
  ref,
) {
  const clientRoute = as === undefined && typeof href === 'string' && !!appURL(href);
  return (
    <NextLink
      {...props}
      ref={ref}
      href={href}
      as={as}
      replace={replace}
      scroll={scroll}
      prefetch={clientRoute ? false : prefetch}
      onNavigate={(event) => {
        let cancelled = false;
        onNavigate?.({
          preventDefault: () => {
            cancelled = true;
            event.preventDefault();
          },
        });
        if (cancelled || !clientRoute || typeof href !== 'string') return;
        event.preventDefault();
        navigateApp(href, { replace, scroll });
      }}
    />
  );
});

export default AppLink;

type AppFormProps = ComponentPropsWithoutRef<typeof NextForm>;

/** Client-only GET navigation for known app views; mutations/server actions stay native. */
export const AppForm = forwardRef<HTMLFormElement, AppFormProps>(function AppForm(
  { action, onSubmit, prefetch, replace, scroll, ...props },
  ref,
) {
  const clientRoute = typeof action === 'string' && !!appURL(action);
  return (
    <NextForm
      {...props}
      ref={ref}
      action={action}
      replace={replace}
      scroll={scroll}
      prefetch={clientRoute ? false : prefetch}
      onSubmit={(event) => {
        onSubmit?.(event);
        if (event.defaultPrevented || typeof action !== 'string') return;
        const form = event.currentTarget;
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (submitter?.getAttribute('name')?.startsWith('$ACTION_')) return;
        const effectiveAction = submitter?.getAttribute('formaction') ?? action;
        const method = (
          submitter?.getAttribute('formmethod') ??
          form.getAttribute('method') ??
          'get'
        ).toLowerCase();
        const target = submitter?.getAttribute('formtarget') ?? form.getAttribute('target') ?? '';
        const encoding =
          submitter?.getAttribute('formenctype') ??
          form.getAttribute('enctype') ??
          'application/x-www-form-urlencoded';
        const next = appURL(effectiveAction);
        if (
          !next ||
          method !== 'get' ||
          (target && target.toLowerCase() !== '_self') ||
          encoding !== 'application/x-www-form-urlencoded'
        )
          return;
        const skipValidation = form.noValidate || !!submitter?.hasAttribute('formnovalidate');
        if (!skipValidation && !form.checkValidity()) {
          event.preventDefault();
          return;
        }
        const entries = new FormData(form, submitter);
        const search = new URLSearchParams();
        for (const [name, value] of entries)
          search.append(name, typeof value === 'string' ? value : value.name);
        next.search = search.toString();
        event.preventDefault();
        navigateApp(next.href, { replace, scroll });
      }}
    />
  );
});

/** Stable router facade: all existing push/replace callers share the same policy. */
export function useAppRouter() {
  const router = useNextRouter();
  return useMemo(
    () => ({
      ...router,
      push: (
        href: Parameters<typeof router.push>[0],
        options?: Parameters<typeof router.push>[1],
      ) => {
        if (!navigateApp(href, { scroll: options?.scroll })) router.push(href, options);
      },
      replace: (
        href: Parameters<typeof router.replace>[0],
        options?: Parameters<typeof router.replace>[1],
      ) => {
        if (!navigateApp(href, { replace: true, scroll: options?.scroll }))
          router.replace(href, options);
      },
      prefetch: (
        href: Parameters<typeof router.prefetch>[0],
        options?: Parameters<typeof router.prefetch>[1],
      ) => {
        if (!appURL(href)) return router.prefetch(href, options);
      },
    }),
    [router],
  );
}
