// Routes that use the full-bleed hero layout: the nav is hidden and the
// persistent Braille panel frames the page.
// Onboarding is one of them: a user who hasn't picked a handle is redirected
// back to it from every nav destination, so the nav there is a set of dead ends.
export const HERO_ROUTES = new Set(["/", "/auth/login", "/auth/sign-up", "/auth/onboarding"]);
