/**
 * Re-export of the shared PATH helper, which now lives in core so the CLI's
 * `doctor` probes resolve runtimes the same way the server spawns them — probing
 * under a reduced launchd PATH would otherwise report installed runtimes as
 * missing. Kept as a module so existing server imports and tests stay unchanged.
 */
export { augmentPath } from '@claude-alive/core';
