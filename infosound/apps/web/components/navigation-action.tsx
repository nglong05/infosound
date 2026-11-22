'use client';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import Link from './app-navigation';
import { Icon } from './icons';

type Direction = { previous?: boolean };
function Content({ children }: { children: ReactNode }) {
  const label =
    typeof children === 'string' ? children.replace(/^[←→]\s*|\s*[←→]$/g, '') : children;
  return (
    <>
      <span className="navigation-action-label">{label}</span>
      <span className="navigation-action-arrow" aria-hidden="true">
        <Icon name="arrow" size={18} />
      </span>
    </>
  );
}

/** Shared presentation for navigation CTAs; AppLink retains its routing policy. */
export function NavigationAction({
  children,
  className,
  previous = false,
  ...props
}: ComponentPropsWithoutRef<typeof Link> & Direction) {
  return (
    <Link
      {...props}
      className={'navigation-action' + (className ? ' ' + className : '')}
      data-direction={previous ? 'previous' : 'next'}
    >
      <Content>{children}</Content>
    </Link>
  );
}

/** Native semantics for disabled or locally controlled pagination. */
export function NavigationActionButton({
  children,
  className,
  previous = false,
  type = 'button',
  ...props
}: ComponentPropsWithoutRef<'button'> & Direction) {
  return (
    <button
      {...props}
      type={type}
      className={'navigation-action' + (className ? ' ' + className : '')}
      data-direction={previous ? 'previous' : 'next'}
    >
      <Content>{children}</Content>
    </button>
  );
}
