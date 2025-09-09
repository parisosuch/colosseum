import { createClient } from "@/lib/supabase/server";

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

  if (error) {
    console.error("There was an error getting user_profile: ", error.message);
  }

  if (!data) {
    return <div>This user does not exist.</div>;
  }

  if (!user) {
    return <div>Not authenticated view.</div>;
  }
  const match = data?.user_id === user!.id;

  if (match) {
    return <div>User match view.</div>;
  }

  return <div>User no match view.</div>;
}
