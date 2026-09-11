"use client";

import { useRouter } from "next/navigation";
import { TwoFactorSection } from "../two-factor-section";

export function MfaSetupClient() {
  const router = useRouter();
  return (
    <TwoFactorSection
      twoFactorEnabled={false}
      forced
      onEnrollmentCompleted={() => {
        router.push("/dashboard");
        router.refresh();
      }}
    />
  );
}
