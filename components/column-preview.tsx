import { Column } from "@/lib/colosseum/column";

export default function ColumnPreview({ column }: { column: Column }) {
  // return the preview based on the column type

  if (column.type === "text") {
    return (
      <div className="p-3">
        <p className="text-sm line-clamp-[10]">{column.text}</p>
      </div>
    );
  }

  return <div>this column type has not been handled ye t</div>;
}
