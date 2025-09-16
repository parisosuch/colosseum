"use client";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { PlusIcon } from "lucide-react";

export default function CreateChannelForm({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        // 
    }

    return (
        <div className={cn("flex flex-col gap-6", className)} {...props}>
            <Card>
                <CardHeader>
                    <CardTitle className="text-2xl">Create Channel</CardTitle>
                    <CardDescription>
                        Start stashing your web.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit}>
                        <div className="flex flex-col gap-6">
                            <div className="grid gap-2">
                                <Label htmlFor="text">Title</Label>
                                <Input
                                    id="title"
                                    type="text"
                                    placeholder=""
                                    required
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                />
                                <Label htmlFor="text">Description</Label>
                                <Input
                                    id="description"
                                    type="text"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                />
                            </div>
                            {error && <p className="text-sm text-red-500">{error}</p>}
                            <Button type="submit" className="w-full" disabled={isLoading}>
                                {isLoading ? "Creating channel..." : "Create channel"}
                                <PlusIcon />
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div >
    )
}