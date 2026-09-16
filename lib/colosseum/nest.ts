import "server-only";

import { createNotification } from "./notification";
import { ownerRecipients } from "./owner";
import type { Channel } from "./channel";

// Tell the linked channel's owner that someone nested their channel inside
// another one (the Are.na-style nest). Shared by the web action and the API,
// which authorize the nest differently but owe the same notice afterwards.
//
// Its own module rather than living beside addChannelColumn in column.ts:
// ./notification imports ./activity, which imports ./column, so putting this
// there would close that loop.
//
// The notification records the *host* — that's where their channel now sits, so
// that's where the link should land — plus the column that was created, which
// is what names the linked channel in the message.
//
// Nothing is sent when the host is private: what someone collects into a
// private channel is their own business, and the recipient couldn't open it to
// see anyway. Privacy runs both ways here.
//
// Addressed through ownerRecipients rather than the owner id itself: a
// notification's recipient is a person, and an owner is not necessarily one.
export async function notifyChannelNested(input: {
  host: Channel;
  linkedOwnerId: string;
  columnId: number;
  userId: string;
}): Promise<void> {
  if (input.host.private) return;
  for (const recipientId of await ownerRecipients(input.linkedOwnerId)) {
    await createNotification({
      recipient_id: recipientId,
      actor_id: input.userId,
      type: "connect",
      channel_id: input.host.id,
      column_id: input.columnId,
    });
  }
}
