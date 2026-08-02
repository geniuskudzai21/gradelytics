/* ═══════════════════════════════════════════════════════════════════════════
   Gradelytics — Supabase client configuration
   ───────────────────────────────────────────────────────────────────────────
   Fill in your Supabase project credentials below.

   Where to find them:
   1. Open your Supabase project → Settings → API
   2. Copy the "Project URL"  -> GRADELYTICS_SUPABASE.url
   3. Copy the "anon" (public) key -> GRADELYTICS_SUPABASE.anonKey

   NOTES:
   - The anon key is a PUBLIC key. It is safe to ship in the browser. Row
     Level Security (see supabase/schema.sql) is what protects your users'
     data, so never ship the service_role (secret) key here.
   - Before the app works, run supabase/schema.sql in the Supabase SQL editor.
   - If you leave the placeholders below, the app silently falls back to the
     original localStorage-only (offline) mode.
   ═══════════════════════════════════════════════════════════════════════════ */

window.GRADELYTICS_SUPABASE = {
    url: "YOUR_SUPABASE_URL",
    anonKey: "YOUR_SUPABASE_ANON_KEY"
};
