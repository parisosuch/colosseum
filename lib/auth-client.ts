// Better Auth client for browser components (sign-up/in/out, password reset).
// Same-origin: it talks to app/api/auth/[...all].

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
