// The canvas route's shell while the server resolves the page: the bare board.
// It has to be its own boundary, or the channel page's skeleton would flash
// between the channel and its canvas.
export default function Loading() {
  return <div className="fixed inset-0 bg-canvas-surface" data-vt="board" />;
}
