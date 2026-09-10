/**
 * Output-language requirement shared by every prompt whose answer a human reads
 * in the ticket UI: the completion gate, the verification panel, the decision
 * advisors and the tiebreaker.
 *
 * It lives in its own module rather than next to any one of those prompts
 * because they import each other — `ticketVerifier` pulls in the verification
 * panel, which would then have to reach back for the constant and read it while
 * still in its temporal dead zone.
 *
 * Two rules govern how it is used:
 *  - It is appended LAST, after the judging criteria. Those criteria were fixed
 *    by measurement (see `verificationPanel.ts`) and a language instruction must
 *    not be interleaved with them.
 *  - It constrains wording only. Identifiers a reader needs verbatim — paths,
 *    commands, exit codes, JSON keys, true/false — stay as they are.
 */
export const VERDICT_LANGUAGE_RULE =
  'LANGUAGE: write every human-readable string value in Korean (한국어). ' +
  'Keep the JSON keys, true/false, and identifiers such as file paths, commands and ' +
  'error codes exactly as they are.';
