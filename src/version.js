// Which build this is.
//
// Bump on every release, together with VERSION in sw.js at the root. The two
// have to agree, and tests/version.test.mjs fails the build if they drift.
//
// This is a constant rather than something read back out of the service
// worker's caches, and that distinction matters. While an update is installing,
// both the old and the new cache exist at once, so the caches say what has been
// downloaded while this says what is actually running. On a home-screen web
// app, which keeps serving the version it last cached until it is properly
// closed, those two are different for as long as the app stays open — which is
// exactly the situation this number exists to explain.

export const APP_VERSION = 6;
