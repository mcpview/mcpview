/**
 * A stuck child for the stdio harness: never reads stdin, never replies, and
 * stays alive even after stdin closes. Only forced termination can stop it.
 */
setInterval(() => {}, 60_000);
