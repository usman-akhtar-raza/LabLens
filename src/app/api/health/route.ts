export function GET() {
  return Response.json({ app: "LabLens", status: "ok", stage: "setup" });
}
