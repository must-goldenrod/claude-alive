/** Open a local Chrome session, inspect one URL, and close it. */
import { inspectPage, type InspectReport, type InspectSpec } from './inspect.js';
import { withBrowserSession, type BrowserSessionOptions } from './session.js';

export async function inspectUrl(
  spec: InspectSpec,
  options: BrowserSessionOptions = {},
): Promise<InspectReport> {
  return withBrowserSession(options, async (session) =>
    inspectPage(session.page, spec, session.extract ? { extract: session.extract } : {}),
  );
}
