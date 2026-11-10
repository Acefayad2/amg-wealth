"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export function useAccountProfile(user: User | null) {
  const [saved, setSaved] = useState<{ userId: string; name: string } | null>(null);
  const userId = user?.id;

  useEffect(() => {
    let active = true;
    setSaved(null);
    if (userId) {
      void supabase.from("profiles").select("first_name,last_name").eq("id", userId).maybeSingle().then(async ({ data }) => {
        let name = [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim();
        if (!name && active) {
          const membership = await supabase.from("amg_organization_memberships").select("display_name").eq("user_id", userId).eq("is_active", true).limit(1).maybeSingle();
          name = membership.data?.display_name?.trim() || "";
        }
        if (!active) return;
        if (name) setSaved({ userId, name });
      });
    }
    return () => { active = false; };
  }, [userId]);

  if (!user) return null;
  const metadata = user.user_metadata || {};
  const fallback = String(metadata.full_name || [metadata.first_name, metadata.last_name].filter(Boolean).join(" ") || metadata.name || user.email || "AMG account");
  const name = saved?.userId === user.id ? saved.name : fallback;
  return { name, email: user.email || "", initials: name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() };
}
