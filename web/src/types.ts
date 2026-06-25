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
