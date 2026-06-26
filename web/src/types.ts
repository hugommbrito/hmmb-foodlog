// Mirrors the backend `EntryWithFoods` / `FoodItem` shapes (src/types/models.ts).
// created_at arrives as an ISO string over the wire.
export interface FoodItem {
  id: string;
  entry_id: string;
  description: string;
  quantity: string | null;
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  confidence: number;
}

// CAP-9: user-managed context tag. `color` is a HEX #RRGGBB used for the card
// badge and the review filter segment.
export interface ContextTag {
  id: string;
  name: string;
  color: string;
}

export interface EntryWithFoods {
  id: string;
  user_id: string;
  created_at: string;
  photos: string[];
  title: string | null;
  context: string | null; // resolved tag name for display
  context_tag_id: string | null;
  ai_confidence_overall: number;
  reviewed: boolean;
  ai_cycles: number;
  foods: FoodItem[];
}

// CAP-4: body of POST /entries/:id/reanalyze. Free-text note and/or an edited
// food list (deletions already applied); at least one must be meaningful.
export interface ReanalyzeRequest {
  correction?: string;
  foods?: { description: string; quantity: string | null }[];
}

// Mirrors the backend `EntryAnalysisView` — the re-analysis response. Same render
// fields as EntryWithFoods (minus user_id, plus analysis_status).
export interface EntryAnalysisView {
  id: string;
  created_at: string;
  photos: string[];
  title: string | null;
  context: string | null; // resolved tag name for display
  context_tag_id: string | null;
  ai_confidence_overall: number;
  reviewed: boolean;
  ai_cycles: number;
  analysis_status: 'pending' | 'done';
  foods: FoodItem[];
}

// CAP-7a: a shareable read-only link. `token` is the friendly sequential share_no
// used in the public URL. `status` is computed server-side from expires_at.
export interface ShareLink {
  id: string;
  token: number;
  period_start: string; // 'YYYY-MM-DD'
  period_end: string;
  expires_at: string; // ISO
  created_at: string; // ISO
  status: 'active' | 'expired';
}

// Public read-only entry exposed through a share link (no user_id/PII).
export interface SharedEntry {
  id: string;
  created_at: string;
  photos: string[];
  title: string | null;
  context: string | null;
  foods: FoodItem[];
}

// Payload of the public GET /shared/:token.
export interface SharedPayload {
  period_start: string;
  period_end: string;
  expires_at: string;
  entries: SharedEntry[];
}

// CAP-7b: AI-detected behavioral pattern shown in the nutritionist's view.
export interface PatternObservation {
  category: string;
  title: string;
  detail: string;
}

export interface PatternAnalysis {
  observations: PatternObservation[];
  summary: string | null;
}

// Payload of the public GET /shared/:token/patterns. Either the analysis (with
// the timestamp it was generated/cached) or `insufficient` when there's too
// little data to analyze (no Claude call was made).
export interface PatternsPayload {
  generated_at?: string | null; // ISO
  analysis?: PatternAnalysis;
  insufficient?: boolean;
}

// CAP-6: payload of GET /report/weekly (authenticated). Either the analysis
// (with period and generated_at) or `insufficient` when there's too little data.
export type WeeklyReportPayload =
  | { generated_at: string; period_start: string; period_end: string; analysis: PatternAnalysis }
  | { insufficient: true };

// Mirrors the backend `RequestLog` (src/types/models.ts). One persisted request
// log; direction is 'inbound' or 'outbound'. created_at arrives as an ISO string.
export interface RequestLog {
  id: string;
  created_at: string;
  direction: string;
  method: string;
  path: string;
  query: string | null;
  status_code: number | null;
  duration_ms: number | null;
  request_headers: Record<string, string> | null;
  request_body: string | null;
  response_body: string | null;
  remote_ip: string | null;
}
