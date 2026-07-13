import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type UserProfilePictureProps = {
  avatarUrl?: string | null;
  handle: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "4xl";
  className?: string;
};

const sizeMap = {
  xs: "size-5",
  sm: "size-6",
  md: "size-8",
  lg: "size-10",
  xl: "size-16",
  "2xl": "size-40",
  "4xl": "size-40",
};

const fallbackTextMap = {
  xs: "text-[10px]",
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-sm",
  xl: "text-lg",
  "2xl": "text-4xl",
  "4xl": "text-4xl",
};

export function UserProfilePicture({
  avatarUrl,
  handle,
  size = "md",
  className,
}: UserProfilePictureProps) {
  const initials = handle.slice(0, 2).toUpperCase();

  return (
    <Avatar className={`${sizeMap[size]} ${className ?? ""}`}>
      <AvatarImage src={avatarUrl ?? undefined} alt={`@${handle}`} />
      <AvatarFallback className={fallbackTextMap[size]}>{initials}</AvatarFallback>
    </Avatar>
  );
}
