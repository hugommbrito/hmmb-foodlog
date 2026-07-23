export interface User {
  id: string;
  phone_number: string;
  api_token: string | null;
  created_at: Date;
}

export type AnalysisStatus = 'pending' | 'done';

// CAP-9: user-managed context taxonomy. Replaces the old fixed enum; isolated per user.
export interface ContextTag {
  id: string;
  user_id: string;
  name: string;
  color: string; // HEX #RRGGBB; default '#9ca3af' until the user picks one
  created_at: Date;
}

// CAP-7a: a shareable read-only link to the nutritionist. `share_no` is the
// friendly sequential token used in the public URL (/share/:share_no).
export interface ShareLink {
  id: string;
  share_no: number;
  user_id: string;
  period_start: string; // 'YYYY-MM-DD'
  period_end: string; // 'YYYY-MM-DD'
  expires_at: Date;
  created_at: Date;
}

// Public, read-only view of an entry exposed through a share link. Deliberately
// excludes user_id and any PII — only what the nutritionist needs to see.
export interface SharedEntry {
  id: string;
  created_at: Date;
  photos: string[];
  title: string | null;
  context: string | null; // resolved tag name
  foods: FoodItem[];
}

// CAP-7b: AI-detected behavioral pattern shown in the nutritionist's read-only
// view. `category` groups the observation (e.g. horários, macros, contexto);
// `title` is a short headline; `detail` is the explanation. All text is pt-BR.
export interface PatternObservation {
  category: string;
  title: string;
  detail: string;
}

// CAP-7b: the cached result of the pattern analysis for a share link. At least 3
// observations when generated; `summary` is an optional overarching note.
export interface PatternAnalysis {
  observations: PatternObservation[];
  summary: string | null;
}

// CAP-7b: one entry fed (as a compact text line) to the pattern analysis. Built
// from the period's SharedEntry rows — never photos/user_id/PII.
export interface PatternEntryInput {
  created_at: Date;
  context: string | null;
  foods: FoodItem[];
}

export interface PhotoCaptureResponse {
  entry_id: string;
  analysis_status: AnalysisStatus;
  title: string | null;
  ai_confidence_overall: number;
  foods: FoodItem[];
  message: string;
}

export interface EntryAnalysisView {
  id: string;
  created_at: Date;
  photos: string[];
  title: string | null;
  context: string | null; // resolved tag name (via JOIN); null when unset
  context_tag_id: string | null;
  ai_confidence_overall: number;
  reviewed: boolean;
  ai_cycles: number;
  analysis_status: AnalysisStatus;
  foods: FoodItem[];
}

export interface Entry {
  id: string;
  user_id: string;
  created_at: Date;
  photos: string[];
  title: string | null;
  context_tag_id: string | null;
  ai_confidence_overall: number;
  reviewed: boolean;
  ai_cycles: number;
}

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

// Response shape for the daily review web app: an entry plus its AI-identified foods.
export interface EntryWithFoods extends Entry {
  context: string | null; // resolved tag name (via LEFT JOIN context_tags)
  foods: FoodItem[];
}

export interface AiFoodItem {
  description: string;
  quantity: string | null;
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  confidence: number;
}

export interface AiAnalysisResult {
  title: string | null;
  overall_confidence: number;
  // CAP-9: suggested context tag NAME chosen from the user's tags, or null. The
  // worker maps it to a tag id and only applies it when the entry has no tag yet.
  context: string | null;
  foods: AiFoodItem[];
}

export interface AnalyzeEntryJobData {
  entryId: string;
  // CAP-4: when present, the job is a re-analysis driven by a user correction
  // (composed from free text and/or granular food edits). Absent on initial capture.
  correction?: string;
  // Manual web entry: the user's free-text description of the meal. The AI segregates
  // the foods and estimates quantities/weights and macros from it (with the photo too,
  // if any). Set only on a manual-entry capture; absent on photo capture and re-analysis.
  description?: string;
}

// CAP-4: body of POST /entries/:id/reanalyze. The user corrects an entry via free
// text and/or an edited food list (deletions already applied). At least one must be
// meaningful; the route composes both into the single `correction` string for the AI.
export interface ReanalyzeRequest {
  correction?: string;
  foods?: { description: string; quantity: string | null }[];
}

export interface ZApiImagePayload {
  mimeType: string;
  imageUrl: string;
  caption: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

// One persisted request log (audit module). direction is 'inbound' (HTTP
// request received) or 'outbound' (external service call). request_headers is a
// redacted name→value map; bodies are scrubbed/truncated text (or null).
export interface RequestLog {
  id: string;
  created_at: Date;
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

export interface WebhookPayload {
  instanceId?: string;
  messageId?: string;
  phone: string;
  fromMe?: boolean;
  momment?: number;
  status?: string;
  chatName?: string;
  senderPhoto?: string | null;
  senderName?: string;
  participantPhone?: string | null;
  photo?: string;
  broadcast?: boolean;
  type?: string;
  isNewsletter?: boolean;
  image?: ZApiImagePayload | null;
  // CAP-5: free-text reply used to correct the most recent entry of the day.
  text?: { message?: string } | null;
}

// CAP-6b: query params for GET /report/weekly. Fastify parses all query
// params as strings by default (no JSON schema), so `force` is a string.
export interface ReportQuery {
  start_date?: string;
  end_date?: string;
  force?: string;
}

// CAP-6: intermediate DB-result type for the entries query in report.ts.
// `foods` is a JSON array already deserialized by pg from the json_agg result.
export interface EntryQueryRow {
  created_at: Date;
  context: string | null;
  foods: Array<{
    description: string;
    quantity_g: string | null;
    kcal: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    confidence: number;
  }>;
}

// CAP-6: one cached weekly report per user. `analysis_json` is JSONB — pg
// deserializes it automatically to `PatternAnalysis` on read. Date fields are
// returned as plain strings (YYYY-MM-DD) to avoid timezone shift on JS Date parse.
export interface WeeklyReportRow {
  user_id: string;
  period_start: string; // DATE as string YYYY-MM-DD
  period_end: string;   // DATE as string YYYY-MM-DD
  analysis_json: PatternAnalysis; // pg deserializes JSONB automatically
  generated_at: Date;
}
