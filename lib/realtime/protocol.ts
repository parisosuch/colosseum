// Wire protocol for /realtime. The first four message types are y-websocket's,
// so the stock WebsocketProvider can talk to the server unchanged. Anything
// Colosseum adds on top uses a type number far above them.

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_AUTH = 2;
export const MESSAGE_QUERY_AWARENESS = 3;

// A JSON-encoded ChannelEvent (below), server → client only. Register a handler
// for it on the provider (`provider.messageHandlers[MESSAGE_CHANNEL_EVENT]`).
export const MESSAGE_CHANNEL_EVENT = 100;

export type ChannelEvent =
  // A block joined the channel from somewhere other than this canvas (grid,
  // API, MCP, a move or copy). The unplaced-blocks sidebar picks it up.
  | { type: "block.added"; columnId: number }
  // A block left the channel. The server has already removed its elements from
  // the doc; this tells the sidebar to drop it too.
  | { type: "block.removed"; columnId: number };

// Canvas rooms live under /realtime/canvas/<channelId>.
export const CANVAS_PATH = "/realtime/canvas/";

// Close codes in the 4000-4999 application range.
export const CLOSE_CHANNEL_GONE = 4404;
