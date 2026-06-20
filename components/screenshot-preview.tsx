export default function ScreenShotPreview({ image_url }: { image_url: string | null }) {
  return (
    <div className="w-full h-full flex items-center justify-center">
      {image_url ? (
        <img
          src={image_url}
          alt={`Screenshot of website.`}
          className="w-full h-full object-top object-cover rounded-lg"
        />
      ) : (
        <p>Website does not exist.</p>
      )}
    </div>
  );
}
