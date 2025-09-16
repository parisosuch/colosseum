import CreateChannelForm from "@/components/create-channel-form";

export default function CreateChannelPage() {
    return (
        <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
            <div className="w-full max-w-sm">
                <CreateChannelForm />
            </div>
        </div>
    );
}