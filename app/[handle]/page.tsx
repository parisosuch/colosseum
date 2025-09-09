import {
  getUserChannels,
  getUserPublicChannels,
} from "@/lib/colosseum/channel";
import { createClient } from "@/lib/supabase/server";
import { Channel } from "@/lib/colosseum/channel";

type PageProps = {
  params: { handle: string };
};

export default async function UserPage({ params }: PageProps) {
  const { handle } = await params;

  const supabase = await createClient();

  const AuthView = ({ channels }: { channels: Channel[] }) => {
    if (channels.length === 0) {
      return <p>User has no channels</p>;
    }
    return <p>User has some channels</p>;
  };

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
    const channels = await getUserChannels(supabase, user.id);

    return (
      <div className="w-full bg-blue-100">
        <AuthView channels={channels} />
      </div>
    );
  }

  return <div>User no match view.</div>;
}
