import { getUserProfile, UserProfile } from "@/lib/colosseum/user";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type PageProps = {
  params: { handle: string };
};

export default async function UserPage({ params }: PageProps) {
  const { handle } = await params;

  const supabase = await createClient();

  // determine if user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("user_profile")
    .select("user_id")
    .eq("handle", handle)
    .single();

  if (!data) {
    return <div>This user does not exist.</div>;
  }

  if (!user) {
    return <div>Not authenticated</div>;
  }

  return <div>{data?.user_id === user!.id ? "Match" : "No match"}</div>;
}
