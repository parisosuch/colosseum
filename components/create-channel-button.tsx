import { PlusIcon } from "lucide-react"
import { Button } from "./ui/button"
import Link from "next/link"

export default function CreateChannelButton() {
    return (
        <Link href="/create-channel">
            <Button variant="secondary">
                <p>Create channel</p>
                <PlusIcon />
            </Button >
        </Link>

    )
}