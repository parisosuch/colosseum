"use client";

import { useRouter } from "next/navigation";
import React, { useId, useState } from "react";
import { PlusIcon } from "lucide-react";

import { createGroupAction } from "@/lib/colosseum/actions";
import { HANDLE_MAX_LENGTH, sanitizeHandleInput, validateHandle } from "@/lib/colosseum/handle";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

// New group: a display name and the handle it lives at. The handle is the part
// that can fail on someone else's account, so it gets the live validation and
// the taken-handle message comes back as data rather than a thrown error.
export default function CreateGroupForm() {
  const [name, setName] = useState("");
  // Tracks whether the handle has been edited by hand. Until it has, it follows
  // the name — typing "Studio Ceramics" fills in "studio-ceramics" — which is
  // what makes the second field feel optional rather than like a second task.
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const uid = useId();

  const effectiveHandle = handleTouched ? handle : sanitizeHandleInput(name);
  const handleError = effectiveHandle ? validateHandle(effectiveHandle) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (handleError) {
      setError(handleError);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await createGroupAction({ handle: effectiveHandle, name });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/${result.group.handle}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-6">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-name`}>Name</Label>
          <Input
            id={`${uid}-name`}
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Label htmlFor={`${uid}-handle`}>Handle</Label>
          <Input
            id={`${uid}-handle`}
            type="text"
            required
            maxLength={HANDLE_MAX_LENGTH}
            value={effectiveHandle}
            onChange={(e) => {
              setHandleTouched(true);
              setHandle(sanitizeHandleInput(e.target.value));
            }}
          />
          <p className="text-xs text-muted-foreground">
            The group lives at /{effectiveHandle || "handle"}. Handles are shared with people, so
            this one has to be free.
          </p>
          {handleError ? <p className="text-sm text-destructive-text">{handleError}</p> : null}
        </div>
        {error && <p className="text-sm text-destructive-text">{error}</p>}
        <Button type="submit" className="w-full" disabled={isLoading || !!handleError}>
          {isLoading ? "Creating group..." : "Create group"}
          <PlusIcon />
        </Button>
      </div>
    </form>
  );
}
