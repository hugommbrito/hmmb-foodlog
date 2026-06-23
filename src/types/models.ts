export interface User {
  id: string;
  phone_number: string;
  api_token: string | null;
  created_at: Date;
}

export interface PhotoCaptureResponse {
  entry_id: string;
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
}

export interface ZApiImagePayload {
  mimeType: string;
  imageUrl: string;
  caption: string;
  thumbnailUrl: string;
  width: number;
  height: number;
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
}
