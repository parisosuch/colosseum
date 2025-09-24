"use client";

import React, { useState, useRef } from "react";

export default function CreateColumnForm() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  return (
    <div className="relative w-[300px] h-[300px] rounded-lg dark:bg-white/10 bg-gray-200">
      <textarea
        ref={textareaRef}
        className="w-full h-full bg-transparent resize-none focus:outline-none p-3 leading-normal text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder=""
      />

      {/* Overlay placeholder with clickable Upload */}
      {!text && !file && (
        <div className="absolute inset-0 px-3 pt-3 text-sm leading-normal text-gray-500 flex items-start pointer-events-none">
          <span className="pointer-events-auto">
            Type here... or{" "}
            <label className="text-blue-600 underline cursor-pointer">
              Upload file
              <input
                type="file"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
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
