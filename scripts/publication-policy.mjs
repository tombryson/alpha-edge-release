import { posix } from 'node:path';

const privatePaths = [
  /^DOCS\/archive\//,
  /^DOCS\/mockups\//,
  /^DOCS\/operations\/(?:UAT_RELEASE_|PRODUCTION_RELEASE_|RELEASE_)/,
  /^DOCS\/development\/(?:FINAL_MIGRATION_|APP_STYLE_AUDIT_|PUBLICATION_READINESS\.md$|STATUS_AND_GAPS\.md$|DOCUMENTATION_RECONCILIATION\.md$|DEPENDENCY_HARDENING_|ANALYSIS_STYLE_RECOMMENDATIONS_|TESTING_LOG\.md$|TERMINAL_STYLE_HISTORY\.md$)/,
  /^DOCS\/decisions\/(?:STOCK_TABLE_RESTRUCTURE_PLAN|NEWS_UPLIFT_PLAN)\.md$/,
  /^DOCS\/system\/ETF_PROFILE_SCREEN_/,
  /^DOCS\/Pinescripts\//,
  /^DOCS\/document-moves\.json$/,
  /^(?:AGENTS\.md|PLAN\.md|test-results\/)/,
];

export function excludedFromPublic(path) {
  return privatePaths.some(pattern => pattern.test(path));
}

export function unsafePath(path) {
  if (/[\x00-\x1f]/.test(path) || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => ['', '.', '..', '.git'].includes(part))) return true;
  return /(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\..*)?|backup\.sql)$|\.(?:db(?:-wal|-shm)?|sqlite(?:3)?(?:-wal|-shm)?|pem|key|p12|pfx|bundle|dump|bak|zip|tar|gz|pdf|csv|xlsx?)$/i.test(path);
}

// True when a relative Markdown link points at a file the export omits. The
// exporter then keeps the link text and drops the link.
export function linksToOmitted(from, href, omitted) {
  if (/^(?:[a-z]+:|#)/i.test(href)) return false;
  const target = posix.normalize(posix.join(posix.dirname(from), decodeURIComponent(href.split('#')[0])));
  return omitted.has(target) || [...omitted].some(path => path.startsWith(`${target.replace(/\/$/, '')}/`));
}
