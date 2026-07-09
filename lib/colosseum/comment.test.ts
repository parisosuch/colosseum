import { beforeAll, expect, test } from "bun:test";

import { BLOCKS, COMMENTS, seed, USERS } from "@/scripts/seed";
import { searchColumns } from "./column";
import {
  createComment,
  deleteComment,
  getColumnComments,
  getCommentAuthorization,
} from "./comment";

// The seed puts BLOCKS.alicePublic in a public channel; searchColumns is the
// exported way to resolve its id without threading block ids through the seed.
async function alicePublicBlockId(): Promise<number> {
  const [hit] = await searchColumns(USERS.alice.id, BLOCKS.alicePublic);
  return hit.id;
}

beforeAll(async () => {
  await seed();
});

test("getColumnComments returns the thread oldest-first with author handles", async () => {
  const comments = await getColumnComments(await alicePublicBlockId());
  expect(comments.map((c) => c.body)).toEqual([COMMENTS.byAlice, COMMENTS.byBob]);
  expect(comments[0].author_handle).toBe(USERS.alice.handle);
  expect(comments[1].author_handle).toBe(USERS.bob.handle);
});

test("createComment appends a comment carrying the author's handle", async () => {
  const columnId = await alicePublicBlockId();
  const created = await createComment({
    column_id: columnId,
    author_id: USERS.bob.id,
    body: "A fresh take.",
  });
  expect(created.author_handle).toBe(USERS.bob.handle);

  const bodies = (await getColumnComments(columnId)).map((c) => c.body);
  expect(bodies).toContain("A fresh take.");

  // Clean up so re-runs stay deterministic against the seeded thread.
  await deleteComment(created.id);
});

test("getCommentAuthorization exposes the author and block for delete checks", async () => {
  const columnId = await alicePublicBlockId();
  const [first] = await getColumnComments(columnId);
  const auth = await getCommentAuthorization(first.id);
  expect(auth).toEqual({ author_id: USERS.alice.id, column_id: columnId });

  expect(await getCommentAuthorization(-1)).toBeNull();
});
