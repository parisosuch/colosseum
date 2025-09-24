"use client";

import { createClient } from "@/lib/supabase/client";
import React, { useState, useRef, useEffect } from "react";
import { User } from "@supabase/supabase-js";
import { createColumnServerAction } from "@/lib/actions/create-column";

type CreateColumnFormProps = {
  channel_id: string;
};

export default function CreateColumnForm(props: CreateColumnFormProps) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const supabase = createClient();

  useEffect(() => {
    // get user
    supabase.auth
      .getUser()
      .then((userResponse) => {
        setUser(userResponse.data.user);
      })
      .catch((e) => {
        console.error("There was an error getting the user: ", e);
      });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) setFile(droppedFile);

    // TODO: handle upload on drop
  };

  const handleTextAreaUpload = async () => {
    if (!user?.id || text === "") return;

    createColumnServerAction({
      created_by: user.id,
      channel_id: props.channel_id,
      text,
    })
      .then((column) => console.log(column))
      .catch(console.error);
  };

  return (
    <div
      className={`relative w-[300px] h-[300px] rounded-lg dark:bg-white/10 bg-gray-100 
        ${isDragging ? "border-2 border-dashed dark:border-white/20 border-gray-200" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {/* Text input */}
      {!file && (
        <textarea
          ref={textareaRef}
          className="w-full h-full bg-transparent resize-none focus:outline-none p-3 leading-normal text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder=""
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleTextAreaUpload();
            }
          }}
        />
      )}

      {/* Overlay placeholder with clickable Upload */}
      {!text && !file && (
        <div className="absolute inset-0 px-3 pt-3 text-sm leading-normal text-gray-500 flex items-start pointer-events-none">
          <span className="pointer-events-auto">
            Type here... or{" "}
            <label className="underline cursor-pointer">
              upload file
              <input
                type="file"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>{" "}
            or drop a file
          </span>
        </div>
      )}

      {/* Show file name if file is selected */}
      {file && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-sm break-all px-3">
          <p>{file.name}</p>
        </div>
      )}
    </div>
  );
}
