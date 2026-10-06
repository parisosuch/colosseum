import { expect, test } from "bun:test";

import { signUpHref, signupState } from "./signup-state";

test("signupState is invite-only once the first account exists", () => {
  expect(signupState({ signupsDisabled: false, inviteRequired: true })).toBe("invite");
});

test("signupState offers the first account on an empty instance", () => {
  expect(signupState({ signupsDisabled: false, inviteRequired: false })).toBe("first");
});

test("signupState reports closed whenever sign-ups are disabled", () => {
  expect(signupState({ signupsDisabled: true, inviteRequired: true })).toBe("closed");
  // Even on an empty instance: there is no first account to create.
  expect(signupState({ signupsDisabled: true, inviteRequired: false })).toBe("closed");
});

test("signUpHref carries an invite code through, encoded", () => {
  expect(signUpHref("")).toBe("/auth/sign-up");
  expect(signUpHref("ab cd&x")).toBe("/auth/sign-up?invite=ab%20cd%26x");
});
