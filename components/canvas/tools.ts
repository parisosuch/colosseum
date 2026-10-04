// The canvas tools and their keys. Figma's key where Figma has the tool,
// Excalidraw's otherwise.

export const TOOLS = [
  "select",
  "hand",
  "text",
  "pen",
  "highlighter",
  "eraser",
  "rect",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "sticky",
  "frame",
  "comment",
] as const;

export type Tool = (typeof TOOLS)[number];

export const TOOL_LABELS: Record<Tool, string> = {
  select: "Select",
  hand: "Hand",
  text: "Text",
  pen: "Pen",
  highlighter: "Highlighter",
  eraser: "Eraser",
  rect: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  line: "Line",
  arrow: "Arrow",
  sticky: "Sticky note",
  frame: "Frame",
  comment: "Comment",
};

// The key as shown in tooltips and menus.
export const TOOL_KEYS: Record<Tool, string> = {
  select: "V",
  hand: "H",
  text: "T",
  pen: "P",
  highlighter: "⇧P",
  eraser: "E",
  rect: "R",
  ellipse: "O",
  diamond: "D",
  line: "L",
  arrow: "⇧L",
  sticky: "S",
  frame: "F",
  comment: "C",
};

// Which tool a key picks, by KeyboardEvent.code and shift.
export function toolForKey(code: string, shift: boolean): Tool | null {
  switch (code) {
    case "KeyV":
      return shift ? null : "select";
    case "KeyH":
      return shift ? null : "hand";
    case "KeyT":
      return shift ? null : "text";
    case "KeyP":
      return shift ? "highlighter" : "pen";
    case "KeyE":
      return shift ? null : "eraser";
    case "KeyR":
      return shift ? null : "rect";
    case "KeyO":
      return shift ? null : "ellipse";
    case "KeyD":
      return shift ? null : "diamond";
    case "KeyL":
      return shift ? "arrow" : "line";
    case "KeyS":
      return shift ? null : "sticky";
    case "KeyF":
      return shift ? null : "frame";
    case "KeyC":
      return shift ? null : "comment";
    default:
      return null;
  }
}

// Read-only viewers get these, per the issue: select to open blocks, hand,
// and comments. Zoom stays in its own island.
export const VIEWER_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["select", "hand", "comment"]);

// The tools that stay picked after one use. The rest go back to select.
export const STICKY_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  "hand",
  "pen",
  "highlighter",
  "eraser",
  "comment",
]);

// The toolbar's grouped buttons: pen and highlighter share one, and so do the
// shapes, the button showing whichever was used last.
export const PEN_GROUP = ["pen", "highlighter"] as const satisfies readonly Tool[];
export const SHAPE_GROUP = [
  "rect",
  "ellipse",
  "diamond",
  "line",
] as const satisfies readonly Tool[];
