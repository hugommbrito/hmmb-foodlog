export interface User {
  id: string;
  phone_number: string;
  api_token: string | null;
  created_at: Date;
}

export type AnalysisStatus = 'pending' | 'done';

export interface PhotoCaptureResponse {
  entry_id: string;
  analysis_status: AnalysisStatus;
  title: string | null;
  ai_confidence_overall: number;
  foods: FoodItem[];
}

export interface EntryAnalysisView {
  id: string;
  created_at: Date;
  photos: string[];
  title: string | null;
  context: 'casa' | 'restaurante' | 'trabalho' | 'rua' | null;
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
  context: 'casa' | 'restaurante' | 'trabalho' | 'rua' | null;
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
  foods: AiFoodItem[];
}

export interface AnalyzeEntryJobData {
  entryId: string;
  // CAP-4: when present, the job is a re-analysis driven by a user correction
  // (composed from free text and/or granular food edits). Absent on initial capture.
  correction?: string;
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
