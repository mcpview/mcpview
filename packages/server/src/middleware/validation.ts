/**
 * Schema validation middleware.
 *
 * Validates tool arguments against JSON Schema before execution.
 *
 * @module lib/server/middleware/validation
 */

import type {
  CompiledSchemaValidator,
  SchemaValidator,
} from "../validation/schema-validator.ts";
import type { Middleware, MiddlewareContext } from "./types.ts";

type CompiledSchemaResolver = (
  ctx: MiddlewareContext,
) => CompiledSchemaValidator | undefined;

/**
 * Create a schema validation middleware.
 *
 * Validates `ctx.args` against the registered schema for `ctx.toolName`.
 * Throws with a descriptive error if validation fails.
 *
 * @param validator - SchemaValidator instance with pre-registered schemas
 * @param resolveCompiled - Optional replacement for name-based lookup. Return
 *   undefined when the current call has no schema and validation should be
 *   skipped.
 */
export function createValidationMiddleware(
  validator: SchemaValidator,
  resolveCompiled?: CompiledSchemaResolver,
): Middleware {
  // deno-lint-ignore require-await
  return async (ctx, next) => {
    if (resolveCompiled) {
      resolveCompiled(ctx)?.validateOrThrow(ctx.toolName, ctx.args);
    } else {
      validator.validateOrThrow(ctx.toolName, ctx.args);
    }
    return next();
  };
}
