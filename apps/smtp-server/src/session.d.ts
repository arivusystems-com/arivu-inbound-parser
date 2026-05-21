import type { RoutingAddress } from '@arivu/types';

declare module 'smtp-server' {
  interface SMTPServerSession {
    routing?: RoutingAddress;
  }
}
