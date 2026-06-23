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
