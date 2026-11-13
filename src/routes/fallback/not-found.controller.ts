import { All, Controller, NotFoundException } from '@nestjs/common';

/**
 * Catch-all for any path no other controller matched. Nest's router does not throw when nothing
 * matches, so this throws the `NotFoundException` that docs/STACK.md's error-handling table relies
 * on. Must be the *last* module imported
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
