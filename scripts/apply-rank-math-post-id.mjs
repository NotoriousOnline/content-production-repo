import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const postId = Number(process.argv[2]);
const apply = process.argv[3] !== "preview";

if (!Number.isFinite(postId) || postId <= 0) {
  console.error("Usage: node scripts/apply-rank-math-post-id.mjs <postId> [preview]");
  process.exit(1);
}

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const res = await fetch("http://localhost:3000/api/weed-com-rank-math/update", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    siteId: "4207d196-cd86-478e-a8da-160e57e1c861",
    postId,
    apply,
  }),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
process.exit(res.ok ? 0 : 1);
