"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { localePath } from "@/lib/locale-path";

/** One input, one button: /{locale}/{kind}/{code}. Digits only, trimmed. */
export function RegisterSearch({
  locale,
  kind,
  label,
  button,
  placeholder,
}: {
  locale: string;
  kind: "blz" | "iid" | "at" | "be" | "sk";
  label: string;
  button: string;
  placeholder: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = value.replace(/\D/g, "");
    if (code) router.push(localePath(locale, `/${kind}/${code}`));
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="numeric"
          placeholder={placeholder}
          className="rounded-md border bg-background px-3 py-2 font-mono text-sm w-44"
          style={{ borderColor: "var(--hairline)" }}
        />
      </label>
      <button
        type="submit"
        className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400"
      >
        {button}
      </button>
    </form>
  );
}
