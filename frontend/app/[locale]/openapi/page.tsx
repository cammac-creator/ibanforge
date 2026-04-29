import type { Metadata } from "next";
import { ApiReferenceClient } from "./client";

export const metadata: Metadata = {
  title: "OpenAPI Reference — IBANforge",
  description:
    "Live OpenAPI 3.1 reference for the IBANforge API. 5 paid endpoints + free demo + key generation + health. Try-it-out enabled. Compatible with codegen tools.",
};

export default async function OpenApiPage() {
  return (
    <div className="min-h-screen bg-background">
      <ApiReferenceClient />
    </div>
  );
}
