import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export type SocialPostLogRow = {
  id: string;
  created_at: string;
  wp_post_title: string;
  short_title: string | null;
  instagram_status: string | null;
  instagram_permalink: string | null;
};

export async function GET(): Promise<NextResponse<{ rows: SocialPostLogRow[] } | { error: string }>> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("social_posts")
      .select("id, created_at, wp_post_title, short_title, instagram_status, instagram_permalink")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []).map((r) => ({
      id: String((r as { id: string }).id),
      created_at: String((r as { created_at: string }).created_at ?? ""),
      wp_post_title: String((r as { wp_post_title: string }).wp_post_title ?? ""),
      short_title: (r as { short_title: string | null }).short_title ?? null,
      instagram_status: (r as { instagram_status: string | null }).instagram_status ?? null,
      instagram_permalink: (r as { instagram_permalink: string | null }).instagram_permalink ?? null,
    }));

    return NextResponse.json({ rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
