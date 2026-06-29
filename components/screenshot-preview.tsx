export default function ScreenShotPreview({
  image_url,
  version,
}: {
  image_url: string | null;
  // Cache-busting token (the screenshot's captured_at). The storage object is
  // overwritten in place on refresh, so without this the browser keeps serving
  // the stale cached image.
  version?: string | number | null;
}) {
  const src =
    image_url && version != null
      ? `${image_url}?v=${encodeURIComponent(String(version))}`
      : image_url;

  return (
    <div className="w-full h-full flex items-center justify-center">
      {src ? (
        <img
          src={src}
          alt={`Screenshot of website.`}
          className="w-full h-full object-top object-cover rounded-lg"
        />
      ) : (
        <p className="px-4 text-center text-sm text-muted-foreground">Website does not exist.</p>
      )}
    </div>
  );
}
