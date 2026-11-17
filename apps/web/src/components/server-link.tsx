import { Link } from '@tanstack/react-router';
import type * as React from 'react';

/**
 * Links whose targets come from the server (queue items, feed entries). The
 * server owns these paths; the router still handles them client-side.
 */
export const ServerLink = ({
  href,
  ...props
}: { readonly href: string } & Omit<React.ComponentProps<'a'>, 'href'>) => (
  <Link to={href as '/'} {...(props as object)} />
);
