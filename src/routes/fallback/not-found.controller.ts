import { All, Controller, NotFoundException } from '@nestjs/common';

/**
 * Catch-all for any path no other controller matched. Slim's router throws
 * `HttpNotFoundException` itself when nothing matches; Nest's router doesn't, so this is the
 * explicit stand-in MERN.md's error-handling table calls for. Must be the *last* module imported
 * in AppModule — Express (and Nest's router built on it) matches routes in registration order, so
 * every real feature route needs to be tried before this one.
 */
@Controller()
export class NotFoundController {
  @All('*splat')
  notFound(): never {
    throw new NotFoundException();
  }
}
