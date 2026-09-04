// The shape of a mobile bottom-bar tab. It lives here rather than in
// mobile-bottom-bar so the drawer triggers the bar renders (the "+" and the
// avatar) can wear it without importing back into their own parent.

// Full bar height and an equal share of its width, so the space between the
// icons is target rather than padding.
export const TAB =
  "flex h-14 min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md text-muted-foreground focus-ring [&_svg]:size-5";

// The tab for the route you're on.
export const TAB_ACTIVE = "text-foreground";

// The visible tab label, which doubles as the tab's accessible name. Truncates
// rather than wraps: five tabs on a 320px viewport leave about 60px each, and
// "Notifications" is wider than that.
export function TabLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-full truncate px-0.5 text-center text-[10px] font-medium leading-none">
      {children}
    </span>
  );
}
