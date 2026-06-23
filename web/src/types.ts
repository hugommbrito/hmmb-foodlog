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

export interface EntryWithFoods {
  id: string;
  user_id: string;
  created_at: string;
  photos: string[];
  title: string | null;
  context: 'casa' | 'restaurante' | 'trabalho' | 'rua' | null;
  ai_confidence_overall: number;
  reviewed: boolean;
  ai_cycles: number;
  foods: FoodItem[];
}

// Mirrors the backend `RequestLog` (src/types/models.ts). One persisted inbound
// HTTP request from the audit module. created_at arrives as an ISO string.
export interface RequestLog {
  id: string;
  created_at: string;
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
