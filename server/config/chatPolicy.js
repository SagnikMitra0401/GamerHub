/**
 * Global chat parameters.
 *
 * These are the knobs that decide how "safe" the chat is. They are deliberately
 * defined once, here, and consumed by the socket engine, the REST controllers
 * and the client (mirrored values live in client/src/utils/permissions.js).
 *
 * Threat model these numbers address:
 *  - message flooding / spam        -> flood window + per-user limiter
 *  - channel spam / slowmode abuse  -> slowmodeSeconds (0..120), bypass for mods
 *  - memory exhaustion              -> message length, history page cap,
 *                                      tracker pruning, channel/member caps
 *  - stored XSS / header injection  -> text normalisation (control chars out)
 *  - data exfiltration              -> capped history pages, cursor pagination
 *  - unauthorised access            -> role gates + membership checks
 */
const CHAT_POLICY = Object.freeze({
  message: Object.freeze({
    minLength: 1,
    maxLength: 1000,
    /** Collapse runs of blank lines so a message cannot inflate the DOM. */
    maxBlankLineRun: 2,
    /** Maximum number of lines accepted in a single message. */
    maxLines: 40
  }),
  flood: Object.freeze({
    windowMs: 5 * 1000,
    maxMessages: 5
  }),
  typing: Object.freeze({
    throttleMs: 2000,
    /** Client-side "is typing" display lifetime. */
    indicatorTtlMs: 6000
  }),
  slowmode: Object.freeze({
    minSeconds: 0,
    maxSeconds: 120
  }),
  history: Object.freeze({
    defaultLimit: 50,
    maxLimit: 50
  }),
  channels: Object.freeze({
    maxPerCommunity: 50,
    maxNameLength: 40,
    maxTopicLength: 100,
    namePattern: /^[a-z0-9-]+$/
  }),
  community: Object.freeze({
    maxMembers: 5000,
    maxNameLength: 40,
    minNameLength: 3,
    maxDescriptionLength: 200
  }),
  audit: Object.freeze({
    defaultLimit: 30,
    maxLimit: 50
  }),
  retention: Object.freeze({
    minDays: 0,
    maxDays: 365
  })
});

module.exports = { CHAT_POLICY };
