import { notFound } from "next/navigation";
import ReferenceUpload from "@/components/reference-upload";

export default function IngestPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <ReferenceUpload />;
}
